import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import Database from 'better-sqlite3'

const testDirectory = mkdtempSync(join(tmpdir(), 'envelove-accounts-'))
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
const { accounts, categories, categoryGroups, plans, transactions } =
  await import('#/db/schema')
const { user } = await import('#/db/auth-schema')
const { findAccountsByPlanOwner, insertOwnedAccount } =
  await import('./accounts.server')
const { insertPlan } = await import('#/features/plans/plans.server')
const { findPlanMonthBudget, setOwnedCategoryAssigned } =
  await import('#/features/budget/budget.server')
const { monthOfDate } = await import('#/features/plans/plan-month')
const { currentDayInZone } =
  await import('#/features/transactions/transaction-money')

const now = new Date('2026-09-27T12:00:00.000Z')

db.insert(user)
  .values({
    id: 'balance-user',
    name: 'Balance User',
    email: 'balances@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  .run()
db.insert(plans)
  .values({
    id: 'balance-plan',
    ownerId: 'balance-user',
    name: 'Balance Plan',
    countryCode: 'US',
    currencyCode: 'USD',
    createdAt: now,
    updatedAt: now,
  })
  .run()
db.insert(accounts)
  .values([
    {
      id: 'checking',
      planId: 'balance-plan',
      name: 'Checking',
      type: 'checking',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: now,
    },
    {
      id: 'empty-savings',
      planId: 'balance-plan',
      name: 'Savings',
      type: 'savings',
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      updatedAt: now,
    },
  ])
  .run()
db.insert(transactions)
  .values([
    {
      accountId: 'checking',
      date: '2026-09-20',
      amount: 100_000,
      cleared: true,
    },
    { accountId: 'checking', date: '2026-09-27', amount: -30_000 },
    { accountId: 'checking', date: '2026-09-28', amount: -5_000 },
  ])
  .run()

after(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

test('derives Account balances from Transactions up to the Current Day', async () => {
  const rows = await findAccountsByPlanOwner({
    planId: 'balance-plan',
    ownerId: 'balance-user',
    today: '2026-09-27',
  })

  assert.deepEqual(
    rows.map(({ id, clearedBalance, unclearedBalance, workingBalance }) => ({
      id,
      clearedBalance,
      unclearedBalance,
      workingBalance,
    })),
    [
      {
        id: 'checking',
        clearedBalance: 100_000,
        unclearedBalance: -30_000,
        workingBalance: 70_000,
      },
      {
        id: 'empty-savings',
        clearedBalance: 0,
        unclearedBalance: 0,
        workingBalance: 0,
      },
    ],
  )
})

test('includes future-dated Transactions once their date arrives', async () => {
  const rows = await findAccountsByPlanOwner({
    planId: 'balance-plan',
    ownerId: 'balance-user',
    today: '2026-09-28',
  })

  assert.equal(
    rows.find((row) => row.id === 'checking')?.workingBalance,
    65_000,
  )
})

test('returns no Accounts for another owner', async () => {
  const rows = await findAccountsByPlanOwner({
    planId: 'balance-plan',
    ownerId: 'someone-else',
    today: '2026-09-27',
  })

  assert.deepEqual(rows, [])
})

test('opening cash funds the plan; existing debt and tracking balances do not', () => {
  const ownerId = 'balance-user'
  const { id: planId } = insertPlan({
    ownerId,
    name: 'Fresh plan',
    countryCode: 'US',
  })
  const timeZone = 'Pacific/Kiritimati'
  const today = currentDayInZone(timeZone)
  const month = monthOfDate(today)
  const plan = { ownerId, planId, timeZone }
  const checking = insertOwnedAccount({
    ...plan,
    type: 'checking',
    name: 'Checking',
    startingBalance: 1_000_000,
  })!
  const card = insertOwnedAccount({
    ...plan,
    type: 'credit_card',
    name: 'Visa',
    startingBalance: -350_000,
  })!
  insertOwnedAccount({
    ...plan,
    type: 'personal_loan',
    name: 'Loan',
    startingBalance: -400_000,
  })
  insertOwnedAccount({
    ...plan,
    type: 'asset',
    name: 'Investment',
    startingBalance: 600_000,
  })
  insertOwnedAccount({
    ...plan,
    type: 'cash',
    name: 'Wallet',
    startingBalance: 0,
  })
  const balances = () => findAccountsByPlanOwner({ ...plan, today }).all()
  assert.deepEqual(
    Object.fromEntries(
      balances().map((a) => [a.name, [a.clearedBalance, a.unclearedBalance]]),
    ),
    {
      Checking: [1_000_000, 0],
      Visa: [-350_000, 0],
      Loan: [-400_000, 0],
      Investment: [600_000, 0],
      Wallet: [0, 0],
    },
  )
  const group = db
    .insert(categoryGroups)
    .values({ planId, name: 'Food', position: 2 })
    .returning()
    .get()
  const groceries = db
    .insert(categories)
    .values({ categoryGroupId: group.id, name: 'Groceries', position: 0 })
    .returning()
    .get()
  setOwnedCategoryAssigned({
    ownerId,
    categoryId: groceries.id,
    month,
    amount: 200_000,
  })
  db.insert(transactions)
    .values({
      accountId: checking.id,
      categoryId: groceries.id,
      date: today,
      amount: -40_000,
    })
    .run()
  const budget = () => findPlanMonthBudget({ planId, month, today })
  assert.equal(budget().readyToAssign.total, 800_000)
  assert.equal(budget().categories.get(groceries.id)?.available, 160_000)
  assert.equal(
    balances().find((a) => a.id === checking.id)?.workingBalance,
    960_000,
  )
  const payment = db
    .select()
    .from(categories)
    .all()
    .find((c) => c.creditAccountId === card.id)!
  assert.equal(budget().categories.get(payment.id)?.available, 0)

  // Spend a positive card opening on the same day: it was cash, not debt.
  const prepaid = insertOwnedAccount({
    ...plan,
    type: 'credit_card',
    name: 'Overpaid card',
    startingBalance: 70_000,
  })!
  db.insert(transactions)
    .values({
      accountId: prepaid.id,
      categoryId: groceries.id,
      date: today,
      amount: -20_000,
    })
    .run()
  assert.equal(budget().readyToAssign.total, 870_000)
  assert.equal(budget().categories.get(groceries.id)?.available, 140_000)
})

function applyMigration(database: Database.Database, migrationFile: string) {
  const migration = readFileSync(
    join(migrationDirectory, migrationFile),
    'utf8',
  )
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) database.exec(statement)
  }
}
