import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'

import type { PlanMonth } from '#/features/plans/plan-month'
import type { MoneyMove } from './budget.schemas'

const testDirectory = mkdtempSync(join(tmpdir(), 'envelove-budget-'))
const databasePath = join(testDirectory, 'test.sqlite')
const migrationDirectory = join(process.cwd(), 'drizzle')

const migrationDatabase = new Database(databasePath)
for (const migrationFile of readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort()) {
  const migration = readFileSync(
    join(migrationDirectory, migrationFile),
    'utf8',
  )
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) migrationDatabase.exec(statement)
  }
}
migrationDatabase.close()

process.env.DATABASE_URL = databasePath

const { db } = await import('#/db')
const {
  accounts,
  categories,
  categoryAssignments,
  categoryGroups,
  plans,
  payees,
  transactions,
  transfers,
} = await import('#/db/schema')
const { user } = await import('#/db/auth-schema')
const {
  findOwnedMoneyMoveOptions,
  findPlanMonthBudget,
  moveOwnedMoney,
  setOwnedCategoryAssigned,
} = await import('./budget.server')
const {
  findCategoryActivityByPlanOwner,
  findCategoryHierarchyByPlanOwner,
  findCreditPaymentActivityByPlanOwner,
} = await import('#/features/categories/categories.server')
const { findPlanByOwner } = await import('#/features/plans/plans.server')

const now = new Date('2026-08-13T12:00:00.000Z')
const today = '2026-10-15'
const september = '2026-09' as PlanMonth
const october = '2026-10' as PlanMonth
const november = '2026-11' as PlanMonth

db.insert(user)
  .values(
    ['owner', 'stranger'].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  )
  .run()
db.insert(plans)
  .values([
    { id: 'plan', ownerId: 'owner', name: 'Plan' },
    {
      id: 'guarani-plan',
      ownerId: 'owner',
      name: 'Guaraníes',
      countryCode: 'PY',
      currencyCode: 'PYG',
    },
  ])
  .run()
db.insert(accounts)
  .values([
    { id: 'checking', planId: 'plan', name: 'Checking', type: 'checking' },
    { id: 'visa', planId: 'plan', name: 'Visa', type: 'credit_card' },
  ])
  .run()
db.insert(categoryGroups)
  .values([
    { id: 'living', planId: 'plan', name: 'Living', position: 0 },
    {
      id: 'payments',
      planId: 'plan',
      name: 'Credit Card Payments',
      kind: 'credit_card_payments',
      position: 1,
    },
    { id: 'guarani-group', planId: 'guarani-plan', name: 'Bills', position: 0 },
    {
      id: 'inflow',
      planId: 'plan',
      name: 'Inflow',
      kind: 'inflow',
      position: 0,
    },
  ])
  .run()
db.insert(categories)
  .values([
    {
      id: 'groceries',
      categoryGroupId: 'living',
      name: 'Groceries',
      position: 0,
    },
    { id: 'dining', categoryGroupId: 'living', name: 'Dining', position: 1 },
    {
      id: 'archived',
      categoryGroupId: 'living',
      name: 'Archived',
      hidden: true,
      position: 2,
    },
    {
      id: 'visa-payment',
      categoryGroupId: 'payments',
      name: 'Visa',
      kind: 'credit_payment',
      creditAccountId: 'visa',
      position: 0,
    },
    { id: 'rent', categoryGroupId: 'guarani-group', name: 'Rent', position: 0 },
    {
      id: 'ready-to-assign',
      categoryGroupId: 'inflow',
      name: 'Ready to Assign',
      kind: 'ready_to_assign',
      position: 0,
    },
  ])
  .run()

after(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

function assign(categoryId: string, month: PlanMonth, amount: number) {
  return setOwnedCategoryAssigned({
    ownerId: 'owner',
    categoryId,
    month,
    amount,
  })
}

function assignmentRow(categoryId: string, month: PlanMonth) {
  return db
    .select({ amount: categoryAssignments.amount })
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.categoryId, categoryId),
        eq(categoryAssignments.month, month),
      ),
    )
    .get()
}

test('upserts Assigned and keeps a row set back to zero', async () => {
  assert.deepEqual(await assign('rent', september, 1_000_000), {
    status: 'ok',
    categoryId: 'rent',
    month: september,
    amount: 1_000_000,
  })
  await assign('rent', september, -2_000_000)
  assert.deepEqual(assignmentRow('rent', september), { amount: -2_000_000 })

  await assign('rent', september, 0)
  assert.deepEqual(assignmentRow('rent', september), { amount: 0 })

  await assign('rent', october, 0)
  assert.equal(assignmentRow('rent', october), undefined)
})

test('rejects amounts finer than the Plan currency', async () => {
  assert.deepEqual(await assign('rent', september, 1_500), {
    status: 'invalid_amount',
  })
  assert.deepEqual(await assign('groceries', september, 1_005), {
    status: 'invalid_amount',
  })
  assert.equal((await assign('groceries', september, 1_010))?.status, 'ok')
  assert.deepEqual(assignmentRow('rent', september), { amount: 0 })
})

test('assigns only to owned Categories, hidden and internal included', async () => {
  assert.equal(
    await setOwnedCategoryAssigned({
      ownerId: 'stranger',
      categoryId: 'groceries',
      month: september,
      amount: 1_000,
    }),
    null,
  )
  assert.equal(await assign('missing', september, 1_000), null)
  assert.equal((await assign('archived', october, 7_000))?.status, 'ok')
  assert.equal((await assign('visa-payment', october, 20_000))?.status, 'ok')
  assert.equal(await assign('ready-to-assign', october, 1_000), null)
  assert.equal(assignmentRow('ready-to-assign', october), undefined)
})

test('budgets Assigned and Available across months', async () => {
  const purchase = (
    categoryId: string,
    accountId: string,
    date: string,
    amount: number,
  ) => ({ categoryId, accountId, date, amount })
  db.insert(transactions)
    .values([
      purchase('groceries', 'checking', '2026-09-10', -40_000),
      purchase('groceries', 'checking', '2026-10-02', -95_000),
      purchase('groceries', 'checking', '2026-10-20', -1_000_000),
      purchase('dining', 'visa', '2026-10-01', -15_000),
      purchase('dining', 'checking', '2026-10-03', -25_000),
    ])
    .run()
  await assign('groceries', september, 100_000)
  await assign('groceries', october, 10_000)
  await assign('groceries', november, 5_000)
  await assign('dining', september, 30_000)

  assert.deepEqual(await budgetByMonth(september), {
    living: [130_000, -40_000, 90_000],
    groceries: [100_000, -40_000, 60_000, 'positive', 0],
    dining: [30_000, 0, 30_000, 'positive', 0],
    archived: [0, 0, 0, 'zero', 0],
    payments: [0, 0, 0],
    'visa-payment': [0, 0, 0, 'zero', 0],
  })
  assert.deepEqual(await budgetByMonth(october), {
    living: [10_000, -135_000, -35_000],
    groceries: [10_000, -95_000, -25_000, 'cash_overspent', 25_000],
    dining: [0, -40_000, -10_000, 'credit_overspent', 10_000],
    archived: [7_000, 0, 7_000, 'positive', 0],
    payments: [20_000, 5_000, 25_000],
    'visa-payment': [20_000, 5_000, 25_000, 'positive', 0],
  })
  assert.deepEqual(await budgetByMonth(november), {
    living: [5_000, 0, 5_000],
    groceries: [5_000, 0, 5_000, 'positive', 0],
    dining: [0, 0, 0, 'zero', 0],
    archived: [0, 0, 7_000, 'positive', 0],
    payments: [0, 0, 25_000],
    'visa-payment': [0, 0, 25_000, 'positive', 0],
  })
})

test('reads the latest month with money assigned with the Plan', async () => {
  assert.equal(
    (await findPlanByOwner('plan', 'owner'))?.latestAssignedMonth,
    november,
  )
  assert.equal(
    (await findPlanByOwner('guarani-plan', 'owner'))?.latestAssignedMonth,
    september,
  )
})

test('reads Ready to Assign with the Plan month', async () => {
  const before = await budgetByMonth(october)
  db.insert(transactions)
    .values([
      {
        categoryId: 'ready-to-assign',
        accountId: 'checking',
        date: '2026-09-01',
        amount: 500_000,
      },
      {
        categoryId: 'ready-to-assign',
        accountId: 'visa',
        date: '2026-10-10',
        amount: 50_000,
      },
      {
        categoryId: 'ready-to-assign',
        accountId: 'checking',
        date: '2026-10-12',
        amount: -20_000,
      },
      {
        categoryId: 'ready-to-assign',
        accountId: 'checking',
        date: '2026-10-20',
        amount: 999_000,
      },
    ])
    .run()
  assert.deepEqual(await budgetByMonth(october), before)

  const readyToAssign = async (month: PlanMonth) =>
    (
      await findCategoryHierarchyByPlanOwner({
        planId: 'plan',
        ownerId: 'owner',
        month,
        today,
      })
    )?.readyToAssign
  // Assigned counts hidden and Credit Payment Categories; Cash Overspending
  // in October (groceries, 25.000) lowers November only. Of the 50.000 on the
  // Visa, 15.000 repays its debt and 35.000 reaches Ready to Assign.
  assert.deepEqual(await readyToAssign(september), {
    leftOverFromPreviousMonth: 0,
    inflow: 500_000,
    debtAccountInflow: 0,
    cashOverspendingPreviousMonth: 0,
    assignedThisMonth: 130_000,
    assignedInFuture: 42_000,
    total: 328_000,
    futureMonths: [
      { month: october, assigned: 37_000 },
      { month: november, assigned: 5_000 },
    ],
  })
  assert.deepEqual(await readyToAssign(october), {
    leftOverFromPreviousMonth: 370_000,
    inflow: 15_000,
    debtAccountInflow: 0,
    cashOverspendingPreviousMonth: 0,
    assignedThisMonth: 37_000,
    assignedInFuture: 5_000,
    total: 343_000,
    futureMonths: [{ month: november, assigned: 5_000 }],
  })
  assert.deepEqual(await readyToAssign(november), {
    leftOverFromPreviousMonth: 348_000,
    inflow: 0,
    debtAccountInflow: 0,
    cashOverspendingPreviousMonth: 25_000,
    assignedThisMonth: 5_000,
    assignedInFuture: 0,
    total: 318_000,
    futureMonths: [],
  })
})

test('budgets a Credit Payment Category from its card', async () => {
  db.insert(plans)
    .values({ id: 'card-plan', ownerId: 'owner', name: 'Card' })
    .run()
  db.insert(accounts)
    .values([
      {
        id: 'card-checking',
        planId: 'card-plan',
        name: 'Checking',
        type: 'checking',
      },
      {
        id: 'mastercard',
        planId: 'card-plan',
        name: 'Mastercard',
        type: 'credit_card',
      },
    ])
    .run()
  db.insert(categoryGroups)
    .values([
      { id: 'card-living', planId: 'card-plan', name: 'Living', position: 0 },
      {
        id: 'card-payments',
        planId: 'card-plan',
        name: 'Credit Card Payments',
        kind: 'credit_card_payments',
        position: 1,
      },
      {
        id: 'card-inflow',
        planId: 'card-plan',
        name: 'Inflow',
        kind: 'inflow',
        position: 0,
      },
    ])
    .run()
  db.insert(categories)
    .values([
      {
        id: 'card-groceries',
        categoryGroupId: 'card-living',
        name: 'Groceries',
        position: 0,
      },
      {
        id: 'mastercard-payment',
        categoryGroupId: 'card-payments',
        name: 'Mastercard',
        kind: 'credit_payment',
        creditAccountId: 'mastercard',
        position: 0,
      },
      {
        id: 'card-ready-to-assign',
        categoryGroupId: 'card-inflow',
        name: 'Ready to Assign',
        kind: 'ready_to_assign',
        position: 0,
      },
    ])
    .run()
  db.insert(transfers)
    .values([
      { id: 'payment', planId: 'card-plan' },
      { id: 'cash-advance', planId: 'card-plan' },
    ])
    .run()
  const row = (
    accountId: string,
    date: string,
    amount: number,
    link: Partial<typeof transactions.$inferInsert>,
  ) => ({ accountId, date, amount, ...link })
  db.insert(transactions)
    .values([
      row('card-checking', '2026-10-01', 500_000, {
        categoryId: 'card-ready-to-assign',
      }),
      row('mastercard', '2026-10-02', -100_000, {
        categoryId: 'card-groceries',
      }),
      row('card-checking', '2026-10-05', -150_000, {
        transferId: 'payment',
        transferSide: 'outflow',
      }),
      row('mastercard', '2026-10-05', 150_000, {
        transferId: 'payment',
        transferSide: 'inflow',
      }),
      row('mastercard', '2026-10-06', 20_000, {
        categoryId: 'card-ready-to-assign',
      }),
      row('mastercard', '2026-10-07', -100_000, {
        transferId: 'cash-advance',
        transferSide: 'outflow',
      }),
      row('card-checking', '2026-10-07', 100_000, {
        transferId: 'cash-advance',
        transferSide: 'inflow',
      }),
      row('mastercard', '2026-10-20', -999_000, {
        categoryId: 'card-groceries',
      }),
    ])
    .run()
  await assign('card-groceries', october, 60_000)

  const plan = async (month: PlanMonth) =>
    findCategoryHierarchyByPlanOwner({
      planId: 'card-plan',
      ownerId: 'owner',
      month,
      today,
    })
  const categoriesOf = (hierarchy: Awaited<ReturnType<typeof plan>>) =>
    Object.fromEntries(
      hierarchy?.groups.flatMap((group) =>
        group.categories.map((category) => [
          category.id,
          [
            category.assigned,
            category.activity,
            category.available,
            category.status,
            category.cardBalance,
          ],
        ]),
      ) ?? [],
    )

  // 60.000 of the 100.000 purchase is funded. The 150.000 payment repays the
  // 100.000 debt and leaves the card 50.000 in credit, which reaches Ready to
  // Assign, as does the 20.000 inflow. The cash advance only adds debt.
  const octoberPlan = await plan(october)
  assert.deepEqual(categoriesOf(octoberPlan), {
    'card-groceries': [60_000, -100_000, -40_000, 'credit_overspent', null],
    'mastercard-payment': [0, -90_000, -90_000, 'payment_overspent', -30_000],
  })
  assert.deepEqual(octoberPlan?.readyToAssign, {
    leftOverFromPreviousMonth: 0,
    inflow: 520_000,
    debtAccountInflow: 50_000,
    cashOverspendingPreviousMonth: 0,
    assignedThisMonth: 60_000,
    assignedInFuture: 0,
    total: 510_000,
    futureMonths: [],
  })
  assert.equal((await plan(november))?.readyToAssign.total, 420_000)

  const activity = await findCategoryActivityByPlanOwner({
    planId: 'card-plan',
    ownerId: 'owner',
    month: october,
    today,
    source: { kind: 'category', id: 'mastercard-payment' },
  })
  assert.deepEqual(
    activity?.map(({ accountId, payeeName, amount }) => [
      accountId,
      payeeName,
      amount,
    ]),
    [['mastercard', 'To/From Checking', -150_000]],
  )
})

// YNAB's Audit Card in October: 20.000 funds the 30.000 dinner, 50.000 the
// subscription, and a 30.000 payment leaves the payment Activity at +40.000.
test('summarizes a Credit Payment Category Activity like YNAB', async () => {
  db.insert(plans)
    .values({ id: 'audit-plan', ownerId: 'owner', name: 'Audit' })
    .run()
  db.insert(accounts)
    .values([
      {
        id: 'audit-checking',
        planId: 'audit-plan',
        name: 'Audit Checking',
        type: 'checking',
      },
      {
        id: 'audit-card',
        planId: 'audit-plan',
        name: 'Audit Card',
        type: 'credit_card',
      },
    ])
    .run()
  db.insert(categoryGroups)
    .values([
      { id: 'audit-wants', planId: 'audit-plan', name: 'Wants', position: 0 },
      {
        id: 'audit-experiments',
        planId: 'audit-plan',
        name: 'Audit Experiments',
        position: 1,
      },
      {
        id: 'audit-payments',
        planId: 'audit-plan',
        name: 'Credit Card Payments',
        kind: 'credit_card_payments',
        position: 2,
      },
    ])
    .run()
  db.insert(categories)
    .values([
      {
        id: 'audit-dining',
        categoryGroupId: 'audit-wants',
        name: 'Dining out',
        position: 0,
      },
      {
        id: 'audit-subscription',
        categoryGroupId: 'audit-experiments',
        name: 'Audit Subscription',
        position: 0,
      },
      {
        id: 'audit-card-payment',
        categoryGroupId: 'audit-payments',
        name: 'Audit Card',
        kind: 'credit_payment',
        creditAccountId: 'audit-card',
        position: 0,
      },
    ])
    .run()
  db.insert(payees)
    .values([
      {
        id: 'diner',
        planId: 'audit-plan',
        name: 'Parity Diner',
        nameKey: 'parity diner',
      },
      {
        id: 'service',
        planId: 'audit-plan',
        name: 'Parity Service',
        nameKey: 'parity service',
      },
    ])
    .run()
  db.insert(transfers)
    .values({ id: 'audit-payment', planId: 'audit-plan' })
    .run()
  db.insert(transactions)
    .values([
      {
        accountId: 'audit-card',
        date: '2026-10-11',
        amount: -30_000,
        categoryId: 'audit-dining',
        payeeId: 'diner',
      },
      {
        accountId: 'audit-card',
        date: '2026-10-12',
        amount: -50_000,
        categoryId: 'audit-subscription',
        payeeId: 'service',
      },
      {
        accountId: 'audit-checking',
        date: '2026-10-13',
        amount: -30_000,
        transferId: 'audit-payment',
        transferSide: 'outflow',
      },
      {
        accountId: 'audit-card',
        date: '2026-10-13',
        amount: 30_000,
        transferId: 'audit-payment',
        transferSide: 'inflow',
      },
      {
        accountId: 'audit-card',
        date: '2026-10-20',
        amount: -999_000,
        categoryId: 'audit-dining',
      },
    ])
    .run()
  await assign('audit-dining', october, 20_000)
  await assign('audit-subscription', october, 60_000)

  const activity = await findCreditPaymentActivityByPlanOwner({
    planId: 'audit-plan',
    ownerId: 'owner',
    month: october,
    today,
    categoryId: 'audit-card-payment',
  })
  assert.deepEqual(activity?.summary, {
    spending: -80_000,
    returns: 0,
    totalSpending: -80_000,
    fundedSpending: 70_000,
    paymentsAndReturns: -30_000,
    totalActivity: 40_000,
  })
  assert.deepEqual(
    activity.transactions.map(({ date, payeeName, categoryName, amount }) => [
      date,
      payeeName,
      categoryName,
      amount,
    ]),
    [
      [
        '2026-10-13',
        'To/From Audit Checking',
        'Credit Card Payments: Audit Card',
        30_000,
      ],
      [
        '2026-10-12',
        'Parity Service',
        'Audit Experiments: Audit Subscription',
        -50_000,
      ],
      ['2026-10-11', 'Parity Diner', 'Wants: Dining out', -30_000],
    ],
  )

  const payment = (
    await findCategoryHierarchyByPlanOwner({
      planId: 'audit-plan',
      ownerId: 'owner',
      month: october,
      today,
    })
  )?.groups
    .flatMap((group) => group.categories)
    .find((category) => category.id === 'audit-card-payment')
  assert.equal(payment?.activity, activity.summary.totalActivity)

  assert.equal(
    await findCreditPaymentActivityByPlanOwner({
      planId: 'audit-plan',
      ownerId: 'owner',
      month: october,
      today,
      categoryId: 'audit-dining',
    }),
    null,
  )
})

async function budgetByMonth(month: PlanMonth) {
  const groups = (
    await findCategoryHierarchyByPlanOwner({
      planId: 'plan',
      ownerId: 'owner',
      month,
      today,
    })
  )?.groups
  return Object.fromEntries(
    groups?.flatMap((group) => [
      [group.id, [group.assigned, group.activity, group.available]],
      ...group.categories.map((category) => [
        category.id,
        [
          category.assigned,
          category.activity,
          category.available,
          category.status,
          category.overspending.cash + category.overspending.credit,
        ],
      ]),
    ]) ?? [],
  )
}

function moneyMoveFixture(prefix: string) {
  const id = (name: string) => `${prefix}-${name}`
  const planId = id('plan')
  db.insert(plans).values({ id: planId, ownerId: 'owner', name: prefix }).run()
  db.insert(accounts)
    .values([
      { id: id('cash'), planId, name: 'Checking', type: 'checking' },
      { id: id('card'), planId, name: 'Card', type: 'credit_card' },
    ])
    .run()
  db.insert(categoryGroups)
    .values({ id: id('group'), planId, name: 'Categories', position: 0 })
    .run()
  db.insert(categories)
    .values([
      ...['source', 'target', 'carryover', 'hidden'].map((name, position) => ({
        id: id(name),
        categoryGroupId: id('group'),
        name,
        position,
        hidden: name === 'hidden',
      })),
      {
        id: id('payment'),
        categoryGroupId: id('group'),
        name: 'Card',
        position: 4,
        kind: 'credit_payment',
        creditAccountId: id('card'),
      },
      {
        id: id('rta'),
        categoryGroupId: id('group'),
        name: 'Ready to Assign',
        position: 5,
        kind: 'ready_to_assign',
      },
    ])
    .run()
  db.insert(transactions)
    .values({
      accountId: id('cash'),
      categoryId: id('rta'),
      date: '2026-09-01',
      amount: 1_000_000,
    })
    .run()
  return {
    id,
    planId,
    endpoint: (name: string | null, month = october) => ({
      categoryId: name === null ? null : id(name),
      month,
    }),
    assign: (name: string, month: PlanMonth, amount: number) =>
      assign(id(name), month, amount),
    budget: (month = october) => findPlanMonthBudget({ planId, month, today }),
    options: () =>
      findOwnedMoneyMoveOptions({
        ownerId: 'owner',
        planId,
        month: october,
        today,
      })!,
    move: (move: Omit<MoneyMove, 'planId' | 'today'> & { amount?: number }) =>
      moveOwnedMoney({
        ownerId: 'owner',
        planId,
        today,
        ...move,
      } as MoneyMove & { ownerId: string }),
  }
}

test('explicit moves apply deltas, can overdraw Available, and recompute credit funding', async () => {
  const f = moneyMoveFixture('explicit')
  await f.assign('source', september, 100_000)
  db.insert(transactions)
    .values({
      accountId: f.id('card'),
      categoryId: f.id('target'),
      date: '2026-10-02',
      amount: -40_000,
    })
    .run()
  const transactionsBefore = db.select().from(transactions).all()
  assert.equal(f.budget().readyToAssign.total, 900_000)
  assert.deepEqual(
    f.move({
      kind: 'move',
      source: f.endpoint('source'),
      destination: f.endpoint('target'),
      amount: 120_000,
    }),
    { status: 'ok', amount: 120_000 },
  )
  let budget = f.budget()
  assert.equal(budget.categories.get(f.id('source'))?.assigned, -120_000)
  assert.equal(budget.categories.get(f.id('source'))?.available, -20_000)
  assert.equal(budget.categories.get(f.id('target'))?.available, 80_000)
  assert.equal(budget.categories.get(f.id('payment'))?.available, 40_000)
  assert.equal(budget.readyToAssign.total, 900_000)
  assert.equal(f.budget(november).readyToAssign.total, 880_000)
  // A second move uses the new assignments, not values from an earlier form.
  assert.equal(
    f.move({
      kind: 'move',
      source: f.endpoint('target'),
      destination: f.endpoint('payment'),
      amount: 10_000,
    }).status,
    'ok',
  )
  assert.equal(f.budget().categories.get(f.id('payment'))?.available, 50_000)
  // Payment money can also be explicitly overdrawn.
  assert.equal(
    f.move({
      kind: 'move',
      source: f.endpoint('payment'),
      destination: f.endpoint('source'),
      amount: 60_000,
    }).status,
    'ok',
  )
  budget = f.budget()
  assert.equal(budget.categories.get(f.id('payment'))?.available, -10_000)
  assert.equal(budget.categories.get(f.id('source'))?.available, 40_000)
  assert.equal(budget.readyToAssign.total, 900_000)
  assert.deepEqual(db.select().from(transactions).all(), transactionsBefore)
})

test('coverage uses current Available, allows partial coverage, and targets zero payment Available', async () => {
  const f = moneyMoveFixture('cover')
  await f.assign('source', september, 30_000)
  await f.assign('target', october, -80_000)
  const options = f.options()
  assert.equal(
    options.categories.find((category) => category.id === f.id('source'))
      ?.available,
    30_000,
  )
  // Both balances change after the picker was read.
  await f.assign('source', october, -10_000)
  await f.assign('target', october, -50_000)
  const command = {
    kind: 'cover' as const,
    source: f.endpoint('source'),
    destination: f.endpoint('target'),
  }
  assert.deepEqual(f.move(command), { status: 'ok', amount: 20_000 })
  assert.equal(f.budget().categories.get(f.id('target'))?.available, -30_000)
  assert.deepEqual(f.move(command), { status: 'source_empty' })
  assert.deepEqual(f.move({ ...command, source: f.endpoint(null) }), {
    status: 'ok',
    amount: 30_000,
  })
  assert.deepEqual(f.move({ ...command, source: f.endpoint(null) }), {
    status: 'nothing_to_cover',
  })

  db.insert(transactions)
    .values({
      accountId: f.id('card'),
      categoryId: f.id('rta'),
      date: '2026-10-01',
      amount: -100_000,
    })
    .run()
  await f.assign('payment', october, -120_000)
  assert.equal(f.budget().categories.get(f.id('payment'))?.available, -20_000)
  assert.deepEqual(
    f.move({
      kind: 'cover',
      source: f.endpoint(null),
      destination: f.endpoint('payment'),
    }),
    { status: 'ok', amount: 20_000 },
  )
  const payment = f.budget().categories.get(f.id('payment'))
  assert.equal(payment?.available, 0)
  assert.equal(payment.cardBalance, -100_000)
  assert.equal(payment.status, 'payment_underfunded')
})

test('future coverage spends Assigned, excludes carryover and hidden sources, and updates future RTA', async () => {
  const f = moneyMoveFixture('future')
  await f.assign('source', september, 300_000)
  await f.assign('carryover', september, 100_000)
  await f.assign('target', october, -80_000)
  await f.assign('source', november, 30_000)
  await f.assign('target', november, 70_000)
  await f.assign('hidden', november, 200_000)
  let options = f.options()
  assert.deepEqual(options.futureAssignments, [
    { categoryId: f.id('source'), month: november, amount: 30_000 },
    { categoryId: f.id('target'), month: november, amount: 70_000 },
  ])
  assert.equal(
    options.categories.some((category) =>
      [f.id('hidden'), f.id('rta')].includes(category.id),
    ),
    false,
  )
  assert.equal(
    f.budget(november).categories.get(f.id('source'))?.available,
    330_000,
  )
  assert.equal(f.budget().readyToAssign.total, 380_000)
  assert.equal(f.budget(november).readyToAssign.total, 300_000)
  assert.deepEqual(
    f.move({
      kind: 'cover',
      source: f.endpoint('source', november),
      destination: f.endpoint('target'),
    }),
    { status: 'ok', amount: 30_000 },
  )
  options = f.options()
  assert.equal(
    options.futureAssignments.some(
      (item) => item.categoryId === f.id('source'),
    ),
    false,
  )
  assert.equal(
    f.budget(november).categories.get(f.id('source'))?.available,
    300_000,
  )
  // Same Category, distinct month endpoints.
  assert.deepEqual(
    f.move({
      kind: 'cover',
      source: f.endpoint('target', november),
      destination: f.endpoint('target'),
    }),
    { status: 'ok', amount: 50_000 },
  )
  assert.equal(f.budget().categories.get(f.id('target'))?.available, 0)
  assert.equal(
    f.budget(november).categories.get(f.id('target'))?.assigned,
    20_000,
  )
  assert.equal(f.budget().readyToAssign.total, 380_000)
  assert.equal(f.budget(november).readyToAssign.total, 380_000)
  assert.deepEqual(assignmentRow(f.id('source'), november), { amount: 0 })
  assert.equal(
    (await findPlanByOwner(f.planId, 'owner'))?.latestAssignedMonth,
    november,
  )
})

test('Ready to Assign supports carryover returns, capped coverage, overassigning, and partial Fix This', async () => {
  const f = moneyMoveFixture('rta-moves')
  await f.assign('source', september, 900_000)
  assert.deepEqual(
    f.move({
      kind: 'move',
      source: f.endpoint('source'),
      destination: f.endpoint(null),
      amount: 50_000,
    }),
    { status: 'ok', amount: 50_000 },
  )
  assert.equal(f.budget().readyToAssign.total, 150_000)
  assert.equal(f.budget().categories.get(f.id('source'))?.assigned, -50_000)
  await f.assign('target', october, -200_000)
  await f.assign('source', october, 150_000)
  assert.equal(f.budget().readyToAssign.total, 150_000)
  assert.deepEqual(
    f.move({
      kind: 'cover',
      source: f.endpoint(null),
      destination: f.endpoint('target'),
    }),
    { status: 'ok', amount: 150_000 },
  )
  assert.equal(f.budget().readyToAssign.total, 0)
  assert.equal(f.budget().categories.get(f.id('target'))?.available, -50_000)
  assert.equal(
    f.move({
      kind: 'cover',
      source: f.endpoint(null),
      destination: f.endpoint('target'),
    }).status,
    'source_empty',
  )
  assert.equal(
    f.move({
      kind: 'move',
      source: f.endpoint(null),
      destination: f.endpoint('target'),
      amount: 100_000,
    }).status,
    'ok',
  )
  assert.equal(f.budget().readyToAssign.total, -100_000)
  assert.deepEqual(
    f.move({
      kind: 'cover',
      source: f.endpoint('target'),
      destination: f.endpoint(null),
    }),
    { status: 'ok', amount: 50_000 },
  )
  assert.equal(f.budget().readyToAssign.total, -50_000)
  assert.deepEqual(
    f.move({
      kind: 'cover',
      source: f.endpoint('source'),
      destination: f.endpoint(null),
    }),
    { status: 'ok', amount: 50_000 },
  )
  assert.equal(f.budget().readyToAssign.total, 0)
  assert.equal(assignmentRow(f.id('rta'), october), undefined)
})

test('rejects unauthorized, hidden, cross-Plan, identical, and invalid-month-direction endpoints without writes', async () => {
  const f = moneyMoveFixture('validation')
  await f.assign('source', october, 100_000)
  const base = {
    ownerId: 'owner',
    planId: f.planId,
    today,
    kind: 'move' as const,
    source: f.endpoint('source'),
    destination: f.endpoint('target'),
    amount: 10_000,
  }
  const before = db.select().from(categoryAssignments).all()
  assert.equal(
    moveOwnedMoney({ ...base, ownerId: 'stranger' }).status,
    'not_found',
  )
  assert.equal(
    findOwnedMoneyMoveOptions({
      ownerId: 'stranger',
      planId: f.planId,
      month: october,
      today,
    }),
    null,
  )
  for (const endpoint of [
    f.endpoint('hidden'),
    f.endpoint('rta'),
    f.endpoint('missing'),
    { categoryId: 'rent', month: october },
  ]) {
    assert.equal(
      moveOwnedMoney({ ...base, source: endpoint }).status,
      'invalid_endpoint',
    )
    assert.equal(
      moveOwnedMoney({ ...base, destination: endpoint }).status,
      'invalid_endpoint',
    )
  }
  for (const command of [
    { ...base, destination: base.source },
    { ...base, source: f.endpoint(null), destination: f.endpoint(null) },
    { ...base, source: f.endpoint('source', november) },
    {
      ...base,
      kind: 'cover' as const,
      source: f.endpoint('source', september),
    },
    { ...base, kind: 'cover' as const, source: f.endpoint(null, november) },
    {
      ...base,
      kind: 'cover' as const,
      source: f.endpoint('source', november),
      destination: f.endpoint(null),
    },
  ])
    assert.equal(moveOwnedMoney(command).status, 'invalid_endpoint')
  for (const amount of [0, -10, 1_005, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(moveOwnedMoney({ ...base, amount }).status, 'invalid_amount')
  }
  assert.deepEqual(db.select().from(categoryAssignments).all(), before)
  await f.assign('target', october, Number.MAX_SAFE_INTEGER - 1)
  const overflowBefore = db.select().from(categoryAssignments).all()
  assert.equal(moveOwnedMoney(base).status, 'invalid_amount')
  assert.deepEqual(db.select().from(categoryAssignments).all(), overflowBefore)
  assert.equal(
    moveOwnedMoney({
      ...base,
      planId: 'guarani-plan',
      source: { categoryId: 'rent', month: october },
      destination: { categoryId: null, month: october },
      amount: 1_500,
    }).status,
    'invalid_amount',
  )
})

test('rolls back the source assignment if the destination write fails', async () => {
  const f = moneyMoveFixture('rollback')
  await f.assign('source', october, 50_000)
  const before = db.select().from(categoryAssignments).all()
  const connection = new Database(databasePath)
  connection.exec(
    `CREATE TRIGGER reject_test_move BEFORE INSERT ON category_assignments WHEN NEW.category_id = '${f.id('target')}' BEGIN SELECT RAISE(ABORT, 'test write failure'); END`,
  )
  try {
    assert.throws(() =>
      f.move({
        kind: 'move',
        source: f.endpoint('source'),
        destination: f.endpoint('target'),
        amount: 20_000,
      }),
    )
    assert.deepEqual(db.select().from(categoryAssignments).all(), before)
  } finally {
    connection.exec('DROP TRIGGER reject_test_move')
    connection.close()
  }
})
