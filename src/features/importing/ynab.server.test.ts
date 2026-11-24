import assert from 'node:assert/strict'
import test from 'node:test'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { monthOfDate } from '#/features/plans/plan-month'
import { prepareYnabSnapshot } from './ynab-snapshot'
import fixture from './testdata/plan.json' with { type: 'json' }

process.env.DATABASE_URL = ':memory:'
const { db } = await import('#/db')
const {
  plans,
  user,
  transactions,
  categories,
  categoryAssignments,
  payees,
  accounts,
} = await import('#/db/schema')
const { importYnabPlan } = await import('./ynab.server')
const { findPlanMonthBudget } = await import('#/features/budget/budget.server')
migrate(db, { migrationsFolder: 'drizzle' })
db.insert(user)
  .values({
    id: 'owner',
    email: 'test@example.test',
    name: 'Test',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run()
const file = JSON.stringify(fixture)

test('a preview does not write; importing a KWD plan preserves ledger and allocation history', () => {
  const preview = prepareYnabSnapshot(file)
  const { summary } = preview
  assert.equal(summary.targets, 1)
  assert.equal(summary.transfers, 1)
  assert.match(summary.warnings.join(' '), /Scheduled transactions skipped: 1/)
  assert.deepEqual(db.select().from(plans).all(), [])
  const id = importYnabPlan(file, 'KW', 'owner')
  assert.equal(
    db.select().from(plans).where(eq(plans.id, id)).get()?.currencyCode,
    'KWD',
  )
  const card = db
    .select()
    .from(accounts)
    .where(eq(accounts.type, 'credit_card'))
    .get()!
  const rows = db.select().from(transactions).all()
  assert.equal(rows.length, 6)
  assert.deepEqual(
    rows.filter((t) => t.startingBalance).map((t) => t.amount),
    [175000, -20000],
  )
  assert.deepEqual(
    rows.filter((t) => t.transferId).map((t) => [t.amount, t.cleared]),
    [
      [-11667, true],
      [11667, false],
    ],
  )
  assert.equal(
    new Set(rows.filter((t) => t.transferId).map((t) => t.transferId)).size,
    1,
  )
  assert.equal(
    rows
      .filter((t) => t.accountId === card.id)
      .reduce((s, t) => s + t.amount, 0),
    -8333,
  )
  assert.equal(
    rows
      .filter((t) => t.accountId !== card.id)
      .reduce((s, t) => s + t.amount, 0),
    146544,
  )
  const food = db
    .select()
    .from(categories)
    .where(eq(categories.name, 'Groceries'))
    .get()!
  assert.equal(food.target?.behavior, 'Fill up to')
  assert.equal(food.target.amount, 40123)
  assert.deepEqual(
    rows.filter((t) => t.categoryId === food.id).map((t) => [t.amount, t.memo]),
    [[-10001, 'Weekly shop · Bakery']],
  )
  assert.equal(db.select().from(payees).all().length, 3)
  assert.deepEqual(
    db
      .select()
      .from(categoryAssignments)
      .where(eq(categoryAssignments.categoryId, food.id))
      .all()
      .map((a) => [a.month, a.amount]),
    [
      ['2026-10', 40123],
      ['2026-11', -1250],
    ],
  )
  const payment = db
    .select()
    .from(categories)
    .where(eq(categories.creditAccountId, card.id))
    .get()!
  const today = '2026-10-31'
  const budget = findPlanMonthBudget({
    planId: id,
    month: monthOfDate(today),
    today,
  })
  assert.equal(budget.readyToAssign.total, 175000 - 40123 - 11667)
  assert.equal(budget.categories.get(payment.id)?.available, 11667)
  assert.equal(
    db
      .select()
      .from(categoryAssignments)
      .where(eq(categoryAssignments.categoryId, payment.id))
      .get()?.amount,
    11667,
  )
})

test('skips internal groups and preserves current and legacy hidden categories under their real group', () => {
  const plan = fixture.data.plan
  const result = prepareYnabSnapshot(
    JSON.stringify({
      plan: {
        ...plan,
        category_groups: [
          ...plan.category_groups,
          {
            id: 'hidden',
            name: 'Hidden Categories',
            hidden: false,
            deleted: false,
          },
          {
            id: 'system',
            name: 'System',
            internal: true,
            hidden: false,
            deleted: false,
          },
          { id: 'empty', name: 'Future bills', hidden: false, deleted: false },
        ],
        categories: plan.categories.map((c) =>
          c.id === 'food'
            ? {
                ...c,
                category_group_id: 'hidden',
                original_category_group_id: 'home',
              }
            : c,
        ),
      },
    }),
  )
  assert.deepEqual(
    result.groups.map((g) => g.name),
    ['Inflow', 'Credit Card Payments', 'Essentials', 'Future bills'],
  )
  const home = result.groups.find((g) => g.name === 'Essentials')!
  const household = result.categories.filter(
    (c) => c.categoryGroupId === home.id,
  )
  assert.deepEqual(
    household.map((c) => [c.name, c.hidden]),
    [
      ['Groceries', true],
      ['Household supplies', true],
    ],
  )
  assert.equal(
    result.assignments.find((a) => a.categoryId === household[0].id)?.amount,
    40123,
  )
  assert.equal(
    result.transactions.find((t) => t.categoryId === household[1].id)?.amount,
    -6788,
  )
})

test('imports legacy dated and monthly loan targets and identifies skipped targets in preview', () => {
  const plan = fixture.data.plan
  const base = plan.categories[1]
  const yearly = {
    ...base,
    goal_cadence: 13,
    goal_target_month: '2027-05-18',
  }
  const sourceCategories = [
    ...plan.categories,
    { ...yearly, id: 'annual', name: 'Annual renewal' },
    {
      ...yearly,
      goal_target_date: '2027-06-11',
      id: 'modern',
      name: 'Membership',
    },
    {
      ...base,
      id: 'debt',
      name: 'Installment',
      goal_type: 'DEBT',
      goal_day: 9,
      goal_needs_whole_amount: null,
    },
    { ...base, id: 'empty', name: 'Empty goal', goal_target: 0 },
  ]
  const { categories: rows, summary } = prepareYnabSnapshot(
    JSON.stringify({ plan: { ...plan, categories: sourceCategories } }),
  )
  const target = (name: string) => rows.find((c) => c.name === name)?.target
  assert.deepEqual(target('Annual renewal'), {
    amount: base.goal_target,
    start: base.goal_creation_month,
    frequency: 'Yearly',
    behavior: 'Fill up to',
    day: 0,
    due: '2027-05-18',
    repeatMonths: 12,
  })
  assert.equal(target('Membership')?.due, '2027-06-11')
  assert.deepEqual(target('Installment'), {
    amount: base.goal_target,
    start: base.goal_creation_month,
    frequency: 'Monthly',
    behavior: 'Set aside',
    day: 9,
    due: null,
    repeatMonths: 0,
  })
  assert.equal(summary.targets, 4)
  assert.equal(target('Empty goal'), null)
  assert.match(
    summary.warnings.join('\n'),
    /Target skipped — Essentials: Empty goal\. No positive target amount/,
  )
  assert.match(
    summary.warnings.join('\n'),
    /Installment.*Loan pairing and payoff calculations are not imported/,
  )
})

test('inconsistent balances, incomplete splits and a late write failure leave other plans untouched', () => {
  const before = db.select().from(plans).all()
  for (const [mutate, reason] of [
    [
      (p: typeof fixture.data.plan) => p.accounts[1].balance++,
      /exported balance/,
    ],
    [(p: typeof fixture.data.plan) => p.subtransactions.pop(), /Split amounts/],
    [(p: typeof fixture.data.plan) => p.months.push(p.months[0]), /UNIQUE/],
    [
      (p: typeof fixture.data.plan) => {
        p.transactions[0].memo = 'x'.repeat(4097)
      },
      /memo/,
    ],
    [
      (p: typeof fixture.data.plan) => {
        p.months[0].categories = Array(150_000).fill(p.months[0].categories[0])
      },
      /150,000-row/,
    ],
  ] as const) {
    const bad = structuredClone(fixture)
    mutate(bad.data.plan)
    assert.throws(
      () => importYnabPlan(JSON.stringify(bad), 'KW', 'owner'),
      reason,
    )
    assert.deepEqual(db.select().from(plans).all(), before)
  }
})
