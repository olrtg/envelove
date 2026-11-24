import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import Database from 'better-sqlite3'
import { eq, inArray } from 'drizzle-orm'

import type { PlanMonth } from '#/features/plans/plan-month'
import { reorderCategoryGroupsSchema } from './category.schemas'

const testDirectory = mkdtempSync(join(tmpdir(), 'envelove-categories-'))
const databasePath = join(testDirectory, 'test.sqlite')
const migrationDirectory = join(process.cwd(), 'drizzle')
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort()

const migrationDatabase = new Database(databasePath)
for (const migrationFile of migrationFiles) {
  applyMigration(migrationDatabase, migrationFile)
}
migrationDatabase.close()

process.env.DATABASE_URL = databasePath

const { db } = await import('#/db')
const {
  accounts,
  categories,
  categoryGroups,
  payees,
  plans,
  transactions,
  transfers,
} = await import('#/db/schema')
const { user } = await import('#/db/auth-schema')
const {
  changeOwnedTarget,
  deleteOwnedCategory,
  deleteOwnedCategoryGroup,
  findCategoryActivityByPlanOwner,
  findCategoryHierarchyByPlanOwner,
  insertOwnedCategory,
  moveOwnedCategory,
  reorderOwnedCategoryGroups,
  updateOwnedCategoryGroupName,
  updateOwnedCategoryHidden,
  updateOwnedCategoryName,
} = await import('./categories.server')
const { findPlanByOwner } = await import('#/features/plans/plans.server')

const now = new Date('2026-08-13T12:00:00.000Z')
const today = '2026-10-15'

db.insert(user)
  .values([
    {
      id: 'category-user',
      name: 'Category User',
      email: 'categories@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'other-user',
      name: 'Other User',
      email: 'other@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run()
db.insert(plans)
  .values([
    { id: 'plan', ownerId: 'category-user', name: 'Plan' },
    { id: 'other-plan', ownerId: 'category-user', name: 'Other Plan' },
  ])
  .run()
db.insert(accounts)
  .values([
    { id: 'open-account', planId: 'plan', name: 'Checking', type: 'checking' },
    {
      id: 'closed-account',
      planId: 'plan',
      name: 'Old Checking',
      type: 'checking',
      closed: true,
    },
    { id: 'credit-account', planId: 'plan', name: 'Visa', type: 'credit_card' },
  ])
  .run()
db.insert(categoryGroups)
  .values([
    { id: 'bills', planId: 'plan', name: 'Bills', position: 0 },
    { id: 'wants', planId: 'plan', name: 'Wants', position: 1 },
    {
      id: 'payments',
      planId: 'plan',
      name: 'Credit Card Payments',
      kind: 'credit_card_payments',
      position: 2,
    },
    { id: 'other-group', planId: 'other-plan', name: 'Other', position: 0 },
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
    { id: 'rent', categoryGroupId: 'bills', name: 'Rent', position: 0 },
    { id: 'power', categoryGroupId: 'bills', name: 'Power', position: 1 },
    {
      id: 'old-rent',
      categoryGroupId: 'bills',
      name: 'Old Rent',
      hidden: true,
      position: 2,
    },
    { id: 'dining', categoryGroupId: 'wants', name: 'Dining', position: 0 },
    { id: 'games', categoryGroupId: 'wants', name: 'Games', position: 1 },
    {
      id: 'hidden-want',
      categoryGroupId: 'wants',
      name: 'Hidden Want',
      hidden: true,
      position: 2,
    },
    {
      id: 'visa-payment',
      categoryGroupId: 'payments',
      name: 'Visa',
      kind: 'credit_payment',
      creditAccountId: 'credit-account',
      position: 0,
    },
    {
      id: 'other-plan-category',
      categoryGroupId: 'other-group',
      name: 'Other',
      position: 0,
    },
    {
      id: 'ready-to-assign',
      categoryGroupId: 'inflow',
      name: 'Ready to Assign',
      kind: 'ready_to_assign',
      position: 0,
    },
  ])
  .run()
db.insert(transactions)
  .values([
    {
      id: 'games-open',
      accountId: 'open-account',
      categoryId: 'games',
      date: '2026-08-01',
      amount: -1_000,
    },
    {
      id: 'games-closed',
      accountId: 'closed-account',
      categoryId: 'games',
      date: '2026-07-01',
      amount: -2_000,
    },
    {
      id: 'power-open',
      accountId: 'open-account',
      categoryId: 'power',
      date: '2026-08-02',
      amount: -3_000,
    },
    {
      id: 'old-rent-closed',
      accountId: 'closed-account',
      categoryId: 'old-rent',
      date: '2026-06-01',
      amount: -4_000,
    },
    {
      id: 'paycheck',
      accountId: 'open-account',
      categoryId: 'ready-to-assign',
      date: '2026-08-03',
      amount: 5_000,
    },
  ])
  .run()

after(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

test('counts Transactions per Category in the hierarchy', async () => {
  const groups = (
    await findCategoryHierarchyByPlanOwner({
      planId: 'plan',
      ownerId: 'category-user',
      month: '2026-08' as PlanMonth,
      today,
    })
  )?.groups
  const counts = Object.fromEntries(
    groups?.flatMap((group) =>
      group.categories.map((category) => [
        category.id,
        category.transactionCount,
      ]),
    ) ?? [],
  )
  assert.deepEqual(counts, {
    rent: 0,
    power: 1,
    'old-rent': 1,
    dining: 0,
    games: 2,
    'hidden-want': 0,
    'visa-payment': 0,
  })
})

test('sums Activity for the month through the Current Day', async () => {
  db.insert(plans)
    .values({ id: 'activity-plan', ownerId: 'category-user', name: 'Activity' })
    .run()
  db.insert(accounts)
    .values([
      {
        id: 'activity-checking',
        planId: 'activity-plan',
        name: 'Checking',
        type: 'checking',
      },
      {
        id: 'activity-savings',
        planId: 'activity-plan',
        name: 'Savings',
        type: 'savings',
      },
    ])
    .run()
  db.insert(categoryGroups)
    .values({
      id: 'living',
      planId: 'activity-plan',
      name: 'Living',
      position: 0,
    })
    .run()
  db.insert(categories)
    .values([
      {
        id: 'groceries',
        categoryGroupId: 'living',
        name: 'Groceries',
        position: 0,
      },
      { id: 'fuel', categoryGroupId: 'living', name: 'Fuel', position: 1 },
      {
        id: 'archived',
        categoryGroupId: 'living',
        name: 'Archived',
        hidden: true,
        position: 2,
      },
    ])
    .run()
  db.insert(transfers)
    .values({ id: 'activity-transfer', planId: 'activity-plan' })
    .run()
  db.insert(transactions)
    .values([
      checking('groceries', '2026-10-01', -10_000),
      checking('groceries', today, -2_500),
      checking('groceries', '2026-10-16', -99_000),
      checking('groceries', '2026-09-30', -50_000),
      checking('groceries', '2026-11-01', -70_000),
      checking('fuel', '2026-10-05', 4_000),
      checking('archived', '2026-10-03', -8_000),
      checking(null, '2026-10-04', -1_000),
    ])
    .run()
  db.insert(transactions)
    .values([
      {
        accountId: 'activity-checking',
        transferId: 'activity-transfer',
        transferSide: 'outflow',
        date: '2026-10-06',
        amount: -20_000,
      },
      {
        accountId: 'activity-savings',
        transferId: 'activity-transfer',
        transferSide: 'inflow',
        date: '2026-10-06',
        amount: 20_000,
      },
    ])
    .run()

  assert.deepEqual(await activityByMonth('2026-10'), {
    living: -8_500,
    groceries: -12_500,
    fuel: 4_000,
    archived: -8_000,
  })
  assert.deepEqual(await activityByMonth('2026-09'), {
    living: -50_000,
    groceries: -50_000,
    fuel: 0,
    archived: 0,
  })
  assert.deepEqual(await activityByMonth('2026-11'), {
    living: 0,
    groceries: 0,
    fuel: 0,
    archived: 0,
  })
  assert.equal(
    await findCategoryHierarchyByPlanOwner({
      planId: 'activity-plan',
      ownerId: 'other-user',
      month: '2026-10' as PlanMonth,
      today,
    }),
    null,
  )
})

test('lists exactly the Transactions counted in Activity', async () => {
  db.insert(payees)
    .values({
      id: 'grocer',
      planId: 'activity-plan',
      name: 'Grocer',
      nameKey: 'grocer',
    })
    .run()
  db.insert(transactions)
    .values([
      {
        ...checking('fuel', '2026-10-05', -1_500),
        id: 'fuel-later',
        payeeId: 'grocer',
        memo: 'Refill',
        createdAt: new Date('2030-01-01T00:00:00.000Z'),
      },
      {
        ...checking('fuel', '2026-10-05', -500),
        id: 'fuel-earlier',
        createdAt: new Date('2000-01-01T00:00:00.000Z'),
      },
    ])
    .run()

  for (const month of ['2026-09', '2026-10', '2026-11']) {
    const activity = await activityByMonth(month)
    for (const [kind, id] of [
      ['group', 'living'],
      ['category', 'groceries'],
      ['category', 'fuel'],
      ['category', 'archived'],
    ] as const) {
      const rows = await activityRows(month, { kind, id })
      assert.equal(
        rows?.reduce((sum, row) => sum + row.amount, 0),
        activity[id],
        `${kind} ${id} in ${month}`,
      )
    }
  }

  const groceries = await activityRows('2026-10', {
    kind: 'category',
    id: 'groceries',
  })
  assert.deepEqual(
    groceries?.map((row) => row.date),
    [today, '2026-10-01'],
  )
  const fuel = await activityRows('2026-10', { kind: 'category', id: 'fuel' })
  assert.deepEqual(
    fuel?.map((row) => row.amount),
    [-1_500, 4_000, -500],
  )
  assert.deepEqual(fuel.at(0), {
    id: 'fuel-later',
    accountId: 'activity-checking',
    accountName: 'Checking',
    date: '2026-10-05',
    payeeName: 'Grocer',
    memo: 'Refill',
    amount: -1_500,
  })

  assert.equal(
    await findCategoryActivityByPlanOwner({
      planId: 'activity-plan',
      ownerId: 'other-user',
      month: '2026-10' as PlanMonth,
      today,
      source: { kind: 'category', id: 'groceries' },
    }),
    null,
  )
})

test('reads the date of the first Transaction with the Plan', async () => {
  assert.equal(
    (await findPlanByOwner('activity-plan', 'category-user'))
      ?.firstTransactionDate,
    '2026-09-30',
  )
  assert.equal(
    (await findPlanByOwner('other-plan', 'category-user'))
      ?.firstTransactionDate,
    null,
  )
  assert.equal(await findPlanByOwner('activity-plan', 'other-user'), null)
})

test('protects internal and unowned Categories and groups', () => {
  for (const [id, ownerId] of [
    ['visa-payment', 'category-user'],
    ['ready-to-assign', 'category-user'],
    ['rent', 'other-user'],
    ['missing', 'category-user'],
  ] as const) {
    assert.deepEqual(
      deleteOwnedCategory({ id, ownerId, targetCategoryId: null }),
      { status: 'not_found' },
    )
  }
  for (const [id, ownerId] of [
    ['payments', 'category-user'],
    ['inflow', 'category-user'],
    ['bills', 'other-user'],
  ] as const) {
    assert.deepEqual(
      deleteOwnedCategoryGroup({ id, ownerId, targetCategoryId: null }),
      { status: 'not_found' },
    )
  }
})

test('keeps Ready to Assign out of the grid and its edits', async () => {
  const groups = (
    await findCategoryHierarchyByPlanOwner({
      planId: 'plan',
      ownerId: 'category-user',
      month: '2026-08' as PlanMonth,
      today,
    })
  )?.groups
  assert.deepEqual(
    groups?.map((group) => group.id),
    ['bills', 'wants', 'payments'],
  )
  assert.deepEqual(
    await findCategoryActivityByPlanOwner({
      planId: 'plan',
      ownerId: 'category-user',
      month: '2026-08' as PlanMonth,
      today,
      source: { kind: 'category', id: 'ready-to-assign' },
    }),
    [],
  )
  const owned = { ownerId: 'category-user' }
  assert.equal(
    await updateOwnedCategoryName({
      ...owned,
      id: 'ready-to-assign',
      name: 'Income',
    }),
    null,
  )
  assert.equal(
    await updateOwnedCategoryGroupName({ ...owned, id: 'inflow', name: 'In' }),
    null,
  )
  assert.equal(
    await updateOwnedCategoryHidden({
      ...owned,
      id: 'ready-to-assign',
      hidden: true,
    }),
    null,
  )
  assert.equal(
    await insertOwnedCategory({
      ...owned,
      categoryGroupId: 'inflow',
      name: 'Bonus',
    }),
    null,
  )
  assert.equal(
    reorderOwnedCategoryGroups({
      ...owned,
      planId: 'plan',
      expectedIds: ['bills', 'wants', 'payments'],
      orderedIds: ['wants', 'bills', 'payments'],
    }),
    true,
  )
  assert.equal(
    moveOwnedCategory({
      ...owned,
      planId: 'plan',
      categoryId: 'ready-to-assign',
      fromGroupId: 'inflow',
      toGroupId: 'bills',
      expectedSourceIds: ['ready-to-assign'],
      expectedTargetIds: ['rent', 'power', 'old-rent'],
      sourceIds: [],
      targetIds: ['rent', 'power', 'old-rent', 'ready-to-assign'],
    }),
    false,
  )
})

test('reorder requests reject oversized lists and IDs', () => {
  const input = {
    planId: 'plan',
    expectedIds: ['bills'],
    orderedIds: ['bills'],
  }
  assert.ok(reorderCategoryGroupsSchema.safeParse(input).success)
  for (const invalid of [
    { expectedIds: Array(10_001).fill('id') },
    { orderedIds: ['a'.repeat(129)] },
  ]) {
    assert.equal(
      reorderCategoryGroupsSchema.safeParse({ ...input, ...invalid }).success,
      false,
    )
  }
})

test('deletes an unused Category without a target', () => {
  assert.deepEqual(
    deleteOwnedCategory({
      id: 'hidden-want',
      ownerId: 'category-user',
      targetCategoryId: null,
    }),
    { status: 'ok', transactionCount: 0 },
  )
  assert.equal(categoryExists('hidden-want'), false)
})

test('requires a visible Ordinary Category target for a used Category', () => {
  assert.deepEqual(
    deleteOwnedCategory({
      id: 'games',
      ownerId: 'category-user',
      targetCategoryId: null,
    }),
    { status: 'target_required' },
  )
  for (const targetCategoryId of [
    'games',
    'old-rent',
    'visa-payment',
    'ready-to-assign',
    'other-plan-category',
    'missing',
  ]) {
    assert.deepEqual(
      deleteOwnedCategory({
        id: 'games',
        ownerId: 'category-user',
        targetCategoryId,
      }),
      { status: 'invalid_target' },
    )
  }
  assert.equal(categoryExists('games'), true)
  assert.deepEqual(categoryIdsOf(['games-open', 'games-closed']), [
    'games',
    'games',
  ])
})

test('reassigns Transactions, including in Closed Accounts, then deletes', () => {
  assert.deepEqual(
    deleteOwnedCategory({
      id: 'games',
      ownerId: 'category-user',
      targetCategoryId: 'dining',
    }),
    { status: 'ok', transactionCount: 2 },
  )
  assert.equal(categoryExists('games'), false)
  assert.deepEqual(categoryIdsOf(['games-open', 'games-closed']), [
    'dining',
    'dining',
  ])
})

test('deletes a group with its Hidden Categories into one outside target', () => {
  assert.deepEqual(
    deleteOwnedCategoryGroup({
      id: 'bills',
      ownerId: 'category-user',
      targetCategoryId: 'rent',
    }),
    { status: 'invalid_target' },
  )

  assert.deepEqual(
    deleteOwnedCategoryGroup({
      id: 'bills',
      ownerId: 'category-user',
      targetCategoryId: 'dining',
    }),
    { status: 'ok', transactionCount: 2 },
  )
  assert.deepEqual(categoryIdsOf(['power-open', 'old-rent-closed']), [
    'dining',
    'dining',
  ])
  for (const id of ['rent', 'power', 'old-rent']) {
    assert.equal(categoryExists(id), false)
  }
  assert.equal(
    db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.id, 'bills'))
      .get(),
    undefined,
  )
})

test('deletes an empty group without a target', () => {
  db.insert(categoryGroups)
    .values({ id: 'empty', planId: 'plan', name: 'Empty', position: 3 })
    .run()
  assert.deepEqual(
    deleteOwnedCategoryGroup({
      id: 'empty',
      ownerId: 'category-user',
      targetCategoryId: null,
    }),
    { status: 'ok', transactionCount: 0 },
  )
})

test('target assignment respects ownership, snoozing and the remaining Ready to Assign', async () => {
  const owner = 'category-user'
  const id = 'other-plan-category'
  const month = '2026-10' as PlanMonth
  const target = {
    frequency: 'Monthly' as const,
    behavior: 'Set aside' as const,
    amount: 100_000,
    start: today,
    day: 0,
    due: null,
    repeatMonths: 0,
  }
  assert.throws(
    () => changeOwnedTarget('other-user', id, { target }),
    /Category not found/,
  )
  db.insert(categoryGroups)
    .values({
      id: 'target-inflow',
      planId: 'other-plan',
      kind: 'inflow',
      name: 'Inflow',
      position: 1,
    })
    .run()
  db.insert(categories)
    .values({
      id: 'target-rta',
      categoryGroupId: 'target-inflow',
      kind: 'ready_to_assign',
      name: 'Inflow',
      position: 0,
    })
    .run()
  db.insert(accounts)
    .values({
      id: 'target-cash',
      planId: 'other-plan',
      name: 'Cash',
      type: 'cash',
    })
    .run()
  db.insert(transactions)
    .values({
      accountId: 'target-cash',
      categoryId: 'target-rta',
      date: today,
      amount: 70_000,
    })
    .run()
  const read = async () =>
    (await findCategoryHierarchyByPlanOwner({
      planId: 'other-plan',
      ownerId: owner,
      month,
      today,
    }))!
  changeOwnedTarget(owner, id, { target })
  changeOwnedTarget(owner, id, { month, snooze: true })
  changeOwnedTarget(owner, id, { month, today, fund: true })
  assert.equal((await read()).readyToAssign.total, 70_000)
  changeOwnedTarget(owner, id, { month, snooze: false })
  changeOwnedTarget(owner, id, { month, today, fund: true })
  const result = await read()
  assert.equal(result.readyToAssign.total, 0)
  assert.equal(result.groups[0].categories[0].assigned, 70_000)
  assert.equal(result.groups[0].categories[0].progress?.underfunded, 30_000)
})

function checking(categoryId: string | null, date: string, amount: number) {
  return { accountId: 'activity-checking', categoryId, date, amount }
}

async function activityByMonth(month: string) {
  const groups = (
    await findCategoryHierarchyByPlanOwner({
      planId: 'activity-plan',
      ownerId: 'category-user',
      month: month as PlanMonth,
      today,
    })
  )?.groups
  return Object.fromEntries(
    groups?.flatMap((group) => [
      [group.id, group.activity],
      ...group.categories.map((category) => [category.id, category.activity]),
    ]) ?? [],
  )
}

function activityRows(
  month: string,
  source: { kind: 'category' | 'group'; id: string },
) {
  return findCategoryActivityByPlanOwner({
    planId: 'activity-plan',
    ownerId: 'category-user',
    month: month as PlanMonth,
    today,
    source,
  })
}

function categoryExists(id: string) {
  return Boolean(
    db.select().from(categories).where(eq(categories.id, id)).get(),
  )
}

function categoryIdsOf(ids: Array<string>) {
  const rows = db
    .select({ id: transactions.id, categoryId: transactions.categoryId })
    .from(transactions)
    .where(inArray(transactions.id, ids))
    .all()
  return ids.map((id) => rows.find((row) => row.id === id)?.categoryId)
}

function applyMigration(database: Database.Database, migrationFile: string) {
  const migration = readFileSync(
    join(migrationDirectory, migrationFile),
    'utf8',
  )
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) database.exec(statement)
  }
}
