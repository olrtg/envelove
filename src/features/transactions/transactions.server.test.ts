import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'

const testDirectory = mkdtempSync(join(tmpdir(), 'envelove-transfers-'))
const databasePath = join(testDirectory, 'test.sqlite')
const migrationDirectory = join(process.cwd(), 'drizzle')
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort()

const migrationDatabase = new Database(databasePath)

for (const migrationFile of migrationFiles.slice(0, 5)) {
  applyMigration(migrationDatabase, migrationFile)
}

migrationDatabase
  .prepare(
    'insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
  )
  .run('legacy-user', 'Legacy User', 'legacy@example.com', 1, 1, 1)
migrationDatabase
  .prepare(
    'insert into plans (id, owner_id, name, country_code, currency_code, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
  )
  .run('legacy-plan', 'legacy-user', 'Legacy Plan', 'US', 'USD', 1, 1)
migrationDatabase
  .prepare(
    'insert into accounts (id, plan_id, name, type, closed, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
  )
  .run('legacy-account', 'legacy-plan', 'Legacy Checking', 'checking', 0, 1, 1)
migrationDatabase
  .prepare(
    'insert into transactions (id, account_id, date, payee, amount, cleared, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  .run(
    'legacy-transaction',
    'legacy-account',
    '2026-08-01',
    'To/From Savings',
    -1_000,
    0,
    1,
    1,
  )
migrationDatabase
  .prepare(
    'insert into transactions (id, account_id, date, payee, amount, cleared, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  .run(
    'legacy-amazon-old',
    'legacy-account',
    '2026-08-01',
    'Amazon',
    -2_000,
    0,
    2,
    2,
  )
migrationDatabase
  .prepare(
    'insert into transactions (id, account_id, date, payee, amount, cleared, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  .run(
    'legacy-amazon-new',
    'legacy-account',
    '2026-08-02',
    'AMAZON',
    -3_000,
    0,
    3,
    3,
  )

for (const migrationFile of migrationFiles.slice(5)) {
  applyMigration(migrationDatabase, migrationFile)
}

const migratedLegacyTransaction = migrationDatabase
  .prepare(
    'select transactions.transfer_id as transferId, transactions.transfer_side as transferSide, payees.name as payeeName from transactions left join payees on transactions.payee_id = payees.id where transactions.id = ?',
  )
  .get('legacy-transaction') as {
  transferId: string | null
  transferSide: string | null
  payeeName: string | null
}

assert.deepEqual(migratedLegacyTransaction, {
  transferId: null,
  transferSide: null,
  payeeName: 'To/From Savings',
})

const migratedAmazonPayees = migrationDatabase
  .prepare(
    "select payees.name, count(transactions.id) as transactionCount from payees inner join transactions on transactions.payee_id = payees.id where payees.plan_id = 'legacy-plan' and payees.name_key = 'amazon' group by payees.id",
  )
  .all() as Array<{ name: string; transactionCount: number }>
assert.deepEqual(migratedAmazonPayees, [
  { name: 'AMAZON', transactionCount: 2 },
])

const migratedLegacyPlan = migrationDatabase
  .prepare(
    'select default_transaction_cleared as defaultTransactionCleared from plans where id = ?',
  )
  .get('legacy-plan') as { defaultTransactionCleared: number }
assert.equal(migratedLegacyPlan.defaultTransactionCleared, 0)

assert.deepEqual(
  migrationDatabase
    .prepare(
      "select category_groups.name as groupName, category_groups.kind as groupKind, categories.name, categories.kind from categories inner join category_groups on categories.category_group_id = category_groups.id where category_groups.plan_id = 'legacy-plan'",
    )
    .all(),
  [
    {
      groupName: 'Inflow',
      groupKind: 'inflow',
      name: 'Ready to Assign',
      kind: 'ready_to_assign',
    },
  ],
)
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
  applyBulkTransactionAction,
  deleteOwnedTransaction,
  findRegisterPage,
  findTransactionRegisterByOwner,
  reconcileOwnedAccount,
  insertOwnedTransaction,
  updateOwnedTransaction,
} = await import('./transactions.server')
const { insertPlan, updateOwnedPlan } = await import('../plans/plans.server')

const now = new Date('2026-08-04T12:00:00.000Z')
const today = '2026-08-04'

db.insert(user)
  .values({
    id: 'user',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  .run()
db.insert(plans)
  .values({
    id: 'plan',
    ownerId: 'user',
    name: 'Test Plan',
    countryCode: 'US',
    currencyCode: 'USD',
    createdAt: now,
    updatedAt: now,
  })
  .run()
db.insert(accounts)
  .values([
    account('checking', 'Checking', 'checking'),
    account('savings', 'Savings', 'savings'),
    account('cash', 'Cash', 'cash'),
  ])
  .run()
db.insert(categoryGroups)
  .values({
    id: 'fees',
    planId: 'plan',
    name: 'Fees',
    position: 0,
    createdAt: now,
    updatedAt: now,
  })
  .run()
db.insert(categories)
  .values({
    id: 'bank-fees',
    categoryGroupId: 'fees',
    name: 'Bank Fees',
    position: 0,
    createdAt: now,
    updatedAt: now,
  })
  .run()

after(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

test('persists and loads the Plan Transaction cleared default', async () => {
  const initialRegister = await findTransactionRegisterByOwner({
    today,
    accountId: 'checking',
    ownerId: 'user',
    planId: 'plan',
  })
  assert.ok(initialRegister)
  assert.equal(initialRegister.plan.defaultTransactionCleared, false)

  const updatedPlan = await updateOwnedPlan({
    id: 'plan',
    ownerId: 'user',
    name: 'Test Plan',
    countryCode: 'US',
    defaultTransactionCleared: true,
  })
  assert.ok(updatedPlan)
  assert.equal(updatedPlan.defaultTransactionCleared, true)

  const allAccountsRegister = await findTransactionRegisterByOwner({
    today,
    ownerId: 'user',
    planId: 'plan',
  })
  assert.ok(allAccountsRegister)
  assert.equal(allAccountsRegister.plan.defaultTransactionCleared, true)
})

test('bulk actions reject a mixed ineligible selection atomically and preserve transfer pairing', async () => {
  const { confirmationKey } = await import('./reconciliation')
  const scope = {
    ownerId: 'user',
    planId: 'plan',
    today,
    search: 'batch fixture',
  }
  const fields = {
    ownerId: 'user',
    accountId: 'checking',
    date: today,
    today,
    cleared: false,
    amount: -1000,
    categoryId: null,
    memo: 'batch fixture',
  }
  const ordinary = insertOwnedTransaction({
    ...fields,
    payee: { kind: 'ordinary', payeeId: null },
  })
  const transfer = insertOwnedTransaction({
    ...fields,
    payee: { kind: 'transfer', accountId: 'savings' },
  })
  assert.equal(ordinary.status, 'ok')
  assert.equal(transfer.status, 'ok')
  const read = async () => (await findRegisterPage(scope)).transactions
  const entries = await read()
  const input = {
    planId: 'plan',
    timeZone: 'UTC',
    rows: [...entries]
      .sort((a, b) => Number(!!a.transferId) - Number(!!b.transferId))
      .map((r) => ({ id: r.id, confirmation: confirmationKey(r) })),
  }
  assert.equal(input.rows.length, 3)
  assert.throws(
    () =>
      applyBulkTransactionAction('user', {
        ...input,
        action: { kind: 'category', categoryId: 'bank-fees' },
      }),
    /category/,
  )
  assert.deepEqual(await read(), entries)
  assert.throws(
    () =>
      applyBulkTransactionAction('legacy-user', {
        ...input,
        action: { kind: 'delete' },
      }),
    /not found/,
  )
  assert.throws(
    () =>
      applyBulkTransactionAction('user', {
        ...input,
        accountId: 'checking',
        action: { kind: 'delete' },
      }),
    /not found/,
  )
  applyBulkTransactionAction('user', { ...input, action: { kind: 'delete' } })
  assert.deepEqual(await read(), [])
})

test('creates, edits, reassigns, and explicitly unlinks a Transfer', () => {
  const created = insertOwnedTransaction({
    accountId: 'checking',
    ownerId: 'user',
    today,
    categoryId: null,
    date: today,
    payee: { kind: 'transfer', accountId: 'savings' },
    memo: 'Emergency fund',
    amount: -100_000,
    cleared: true,
  })

  assert.equal(created.status, 'ok')
  assert.equal(created.payload.transactions.length, 2)

  const checkingSide = created.payload.transactions.find(
    (transaction) => transaction.accountId === 'checking',
  )
  const savingsSide = created.payload.transactions.find(
    (transaction) => transaction.accountId === 'savings',
  )
  assert.ok(checkingSide)
  assert.ok(savingsSide)
  assert.equal(checkingSide.amount, -100_000)
  assert.equal(checkingSide.cleared, true)
  assert.equal(savingsSide.amount, 100_000)
  assert.equal(savingsSide.cleared, false)
  assert.equal(checkingSide.counterpartAccountId, 'savings')
  assert.equal(savingsSide.counterpartAccountId, 'checking')

  const clearedSavings = updateOwnedTransaction({
    id: savingsSide.id,
    accountId: 'savings',
    ownerId: 'user',
    today,
    confirmUnlink: false,
    categoryId: null,
    date: today,
    payee: { kind: 'transfer', accountId: 'checking' },
    memo: 'Emergency fund',
    amount: 100_000,
    cleared: true,
  })
  assert.equal(clearedSavings.status, 'ok')

  const reassigned = updateOwnedTransaction({
    id: checkingSide.id,
    accountId: 'checking',
    ownerId: 'user',
    today,
    confirmUnlink: false,
    categoryId: null,
    date: today,
    payee: { kind: 'transfer', accountId: 'cash' },
    memo: 'Emergency fund',
    amount: -100_000,
    cleared: true,
  })
  assert.equal(reassigned.status, 'ok')

  const movedSide = reassigned.payload.transactions.find(
    (transaction) => transaction.accountId === 'cash',
  )
  assert.ok(movedSide)
  assert.equal(movedSide.id, savingsSide.id)
  assert.equal(movedSide.cleared, false)

  const clearedCash = updateOwnedTransaction({
    id: movedSide.id,
    accountId: 'cash',
    ownerId: 'user',
    today,
    confirmUnlink: false,
    categoryId: null,
    date: today,
    payee: { kind: 'transfer', accountId: 'checking' },
    memo: 'Emergency fund',
    amount: 100_000,
    cleared: true,
  })
  assert.equal(clearedCash.status, 'ok')

  const invalidFutureDate = updateOwnedTransaction({
    id: checkingSide.id,
    accountId: 'checking',
    ownerId: 'user',
    today,
    confirmUnlink: false,
    categoryId: null,
    date: '2026-08-05',
    payee: { kind: 'transfer', accountId: 'cash' },
    memo: 'Emergency fund',
    amount: -100_000,
    cleared: false,
  })
  assert.deepEqual(invalidFutureDate, { status: 'invalid_cleared' })

  const needsConfirmation = updateOwnedTransaction({
    id: checkingSide.id,
    accountId: 'checking',
    ownerId: 'user',
    today,
    confirmUnlink: false,
    categoryId: 'bank-fees',
    date: today,
    payee: { kind: 'create', name: 'Bank' },
    memo: 'Emergency fund',
    amount: -100_000,
    cleared: true,
  })
  assert.deepEqual(needsConfirmation, { status: 'confirmation_required' })

  const unlinked = updateOwnedTransaction({
    id: checkingSide.id,
    accountId: 'checking',
    ownerId: 'user',
    today,
    confirmUnlink: true,
    categoryId: 'bank-fees',
    date: today,
    payee: { kind: 'create', name: 'Bank' },
    memo: 'Emergency fund',
    amount: -100_000,
    cleared: true,
  })
  assert.equal(unlinked.status, 'ok')
  assert.deepEqual(unlinked.payload.removedTransactionIds, [savingsSide.id])
  assert.equal(unlinked.payload.transactions[0]?.transferId, null)
  assert.equal(unlinked.payload.transactions[0]?.categoryId, 'bank-fees')
  assert.equal(unlinked.payload.transactions[0]?.payeeName, 'Bank')
  assert.equal(db.select().from(payees).all().length, 3)
  assert.equal(
    db.select().from(transfers).where(eq(transfers.planId, 'plan')).all()
      .length,
    0,
  )
})

test('creates and reuses an Ordinary Payee by stable identity', () => {
  const first = insertOwnedTransaction({
    accountId: 'checking',
    ownerId: 'user',
    today,
    categoryId: null,
    date: today,
    payee: { kind: 'create', name: 'Corner Store' },
    memo: null,
    amount: -10_000,
    cleared: false,
  })
  assert.equal(first.status, 'ok')
  const createdPayee = first.payload.payees.at(0)
  assert.ok(createdPayee)
  assert.equal(first.payload.transactions[0]?.payeeName, 'Corner Store')

  const second = insertOwnedTransaction({
    accountId: 'cash',
    ownerId: 'user',
    today,
    categoryId: null,
    date: today,
    payee: { kind: 'ordinary', payeeId: createdPayee.id },
    memo: null,
    amount: -5_000,
    cleared: false,
  })
  assert.equal(second.status, 'ok')
  assert.equal(second.payload.payees.length, 0)
  assert.equal(second.payload.transactions[0]?.payeeId, createdPayee.id)
  assert.equal(second.payload.transactions[0]?.payeeName, 'Corner Store')
})

test('loads each Payee with its last used Category', async () => {
  db.insert(categories)
    .values({
      id: 'atm-fees',
      categoryGroupId: 'fees',
      name: 'ATM Fees',
      position: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const first = insertOwnedTransaction({
    accountId: 'checking',
    ownerId: 'user',
    today,
    categoryId: 'bank-fees',
    date: today,
    payee: { kind: 'create', name: 'Fee Collector' },
    memo: null,
    amount: -1_000,
    cleared: false,
  })
  assert.equal(first.status, 'ok')
  const payeeId = first.payload.transactions[0]?.payeeId
  assert.ok(payeeId)

  for (const categoryId of ['atm-fees', null]) {
    const result = insertOwnedTransaction({
      accountId: 'checking',
      ownerId: 'user',
      today,
      categoryId,
      date: '2026-08-01',
      payee: { kind: 'ordinary', payeeId },
      memo: null,
      amount: -1_000,
      cleared: false,
    })
    assert.equal(result.status, 'ok')
  }

  const register = await findTransactionRegisterByOwner({
    today,
    accountId: 'checking',
    ownerId: 'user',
    planId: 'plan',
  })
  assert.equal(
    register?.payees.find((payee) => payee.id === payeeId)?.lastCategoryId,
    'atm-fees',
  )
})

test('deleting either side cascades through the Transfer identity', () => {
  const created = insertOwnedTransaction({
    accountId: 'checking',
    ownerId: 'user',
    today,
    categoryId: null,
    date: today,
    payee: { kind: 'transfer', accountId: 'savings' },
    memo: null,
    amount: -25_000,
    cleared: false,
  })
  assert.equal(created.status, 'ok')

  const transferId = created.payload.transactions[0]?.transferId
  const transactionId = created.payload.transactions[0]?.id
  assert.ok(transferId)
  assert.ok(transactionId)

  const deleted = deleteOwnedTransaction({ id: transactionId, ownerId: 'user' })
  assert.equal(deleted.status, 'ok')
  assert.equal(deleted.payload.removedTransactionIds.length, 2)
  assert.equal(
    db
      .select()
      .from(transactions)
      .where(eq(transactions.transferId, transferId))
      .all().length,
    0,
  )
  assert.equal(
    db.select().from(transfers).where(eq(transfers.id, transferId)).all()
      .length,
    0,
  )
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

function account(
  id: string,
  name: string,
  type: 'checking' | 'savings' | 'cash' | 'credit_card',
) {
  return {
    id,
    planId: 'plan',
    name,
    type,
    closed: false,
    createdAt: now,
    updatedAt: now,
  }
}

test('a Plan keeps its chosen tender across unrelated settings changes', () => {
  const owner = { ownerId: 'user', name: 'Panama' }
  const plan = insertPlan({ ...owner, countryCode: 'PA', currencyCode: 'USD' })
  assert.equal(plan.currencyCode, 'USD')
  assert.equal(
    updateOwnedPlan({
      ...owner,
      id: plan.id,
      name: 'Renamed',
      defaultTransactionCleared: true,
    })?.currencyCode,
    'USD',
  )
  assert.throws(
    () => insertPlan({ ...owner, countryCode: 'PA', currencyCode: 'EUR' }),
    /currency/,
  )
  assert.throws(() => insertPlan({ ...owner, countryCode: 'AQ' }), /currency/)
  assert.equal(
    insertPlan({ ...owner, countryCode: 'AQ', currencyCode: 'EUR' })
      .currencyCode,
    'EUR',
  )
})

test('Ready to Assign takes inflows and outflows on any Account', () => {
  const plan = insertPlan({ ownerId: 'user', name: 'Fresh', countryCode: 'US' })
  const internal = db
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      groupName: categoryGroups.name,
      groupKind: categoryGroups.kind,
    })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .where(eq(categoryGroups.planId, plan.id))
    .all()
  assert.deepEqual(
    internal.map(({ id: _, ...category }) => category),
    [
      {
        name: 'Ready to Assign',
        kind: 'ready_to_assign',
        groupName: 'Inflow',
        groupKind: 'inflow',
      },
    ],
  )
  const readyToAssignId = internal[0].id

  db.insert(accounts)
    .values([
      { ...account('fresh-checking', 'Checking', 'checking'), planId: plan.id },
      { ...account('fresh-visa', 'Visa', 'credit_card'), planId: plan.id },
    ])
    .run()
  const fields = {
    ownerId: 'user',
    today,
    categoryId: readyToAssignId,
    date: today,
    payee: { kind: 'ordinary' as const, payeeId: null },
    memo: null,
    cleared: false,
  }
  for (const [accountId, amount] of [
    ['fresh-checking', 250_000],
    ['fresh-visa', -10_000],
  ] as const) {
    const result = insertOwnedTransaction({ ...fields, accountId, amount })
    assert.equal(result.status, 'ok')
    assert.equal(result.payload.transactions[0]?.categoryId, readyToAssignId)
  }

  assert.equal(
    insertOwnedTransaction({
      ...fields,
      accountId: 'checking',
      amount: 1_000,
    }).status,
    'invalid_category',
  )
  const transfer = insertOwnedTransaction({
    ...fields,
    accountId: 'fresh-checking',
    payee: { kind: 'transfer', accountId: 'fresh-visa' },
    amount: -5_000,
  })
  assert.equal(transfer.status, 'ok')
  assert.deepEqual(
    transfer.payload.transactions.map((transaction) => transaction.categoryId),
    [null, null],
  )
})

test('reverse-side Account moves require confirmation bound to the reconciled counterpart and proposal', async () => {
  const { confirmationKey, reconciliationWarning } =
    await import('./reconciliation')
  const fields = {
    ownerId: 'user',
    accountId: 'savings',
    date: today,
    today,
    amount: 1000,
    categoryId: null,
    memo: 'reverse move',
    cleared: false,
    payee: { kind: 'transfer' as const, accountId: 'checking' },
  }
  const pair = insertOwnedTransaction(fields)
  assert.equal(pair.status, 'ok')
  const other = pair.payload.transactions.find(
    (row) => row.accountId === 'checking',
  )!
  db.update(transactions)
    .set({ cleared: true, reconciled: true })
    .where(eq(transactions.id, other.id))
    .run()
  const register = await findRegisterPage({
    today,
    planId: 'plan',
    ownerId: 'user',
  })
  const row = register.transactions.find(
    (t) => t.transferId === other.transferId && t.id !== other.id,
  )!
  const edit = {
    ...fields,
    id: row.id,
    accountId: 'cash',
    confirmUnlink: false,
  }
  assert.equal(reconciliationWarning(row, edit), 'transfer')
  assert.equal(row.counterpartAccountId, 'checking')
  assert.equal(updateOwnedTransaction(edit).status, 'confirmation_required')
  const confirmation = confirmationKey(row, edit)
  assert.equal(
    updateOwnedTransaction({ ...edit, amount: 2000, confirmation }).status,
    'confirmation_required',
  )
  assert.equal(updateOwnedTransaction({ ...edit, confirmation }).status, 'ok')
  const saved = db
    .select()
    .from(transactions)
    .where(eq(transactions.transferId, other.transferId!))
    .all()
  assert.deepEqual(saved.map((t) => [t.accountId, t.reconciled]).sort(), [
    ['cash', false],
    ['checking', true],
  ])
})

test('safeguards use saved values on both sides through corrections, moves, unlinking and deletion', async () => {
  const { confirmationKey } = await import('./reconciliation')
  const args = { ...account('safety-a', 'Safety A', 'checking') }
  db.insert(accounts)
    .values([
      args,
      account('safety-b', 'Safety B', 'savings'),
      account('safety-c', 'Safety C', 'cash'),
    ])
    .run()
  const base = {
    ownerId: 'user',
    today,
    accountId: args.id,
    amount: 100000,
    categoryId: null,
    payee: { kind: 'ordinary' as const, payeeId: null },
    memo: null,
    date: today,
    cleared: true,
  }
  const initial = insertOwnedTransaction(base)
  assert.equal(initial.status, 'ok')
  const id = initial.payload.transactions[0].id
  db.update(transactions)
    .set({ reconciled: true })
    .where(eq(transactions.id, id))
    .run()
  const fields = { ...base, id, confirmUnlink: false }
  const save = (
    patch: Partial<Parameters<typeof updateOwnedTransaction>[0]>,
  ) => {
    const result = updateOwnedTransaction({ ...fields, ...patch })
    assert.equal(result.status, 'ok')
    return result.payload.transactions.find((t) => t.id === id)!
  }
  assert.equal(save({}).reconciled, true)
  assert.equal(
    save({ memo: 'Edited', date: '2026-07-01', categoryId: 'bank-fees' })
      .reconciled,
    true,
  )
  const moved = save({ accountId: 'safety-b', cleared: false })
  assert.ok(moved.reconciled && moved.cleared)
  assert.equal(
    db.select().from(accounts).where(eq(accounts.id, 'safety-b')).get()
      ?.lastReconciledAt,
    null,
  )
  const newPayee = {
    ...fields,
    payee: { kind: 'create' as const, name: 'A corrected payee' },
  }
  assert.equal(updateOwnedTransaction(newPayee).status, 'confirmation_required')
  const renamed = save({
    ...newPayee,
    confirmation: confirmationKey(moved, newPayee),
  })
  assert.ok(renamed.reconciled)
  const transfer = {
    ...fields,
    payee: { kind: 'transfer' as const, accountId: 'safety-b' },
  }
  const pair = save({
    ...transfer,
    confirmation: confirmationKey(renamed, transfer),
  })
  const load = async () =>
    (
      await findRegisterPage({
        today,
        planId: 'plan',
        ownerId: 'user',
      })
    ).transactions.filter((t) => t.transferId === pair.transferId)
  const reverse = (await load()).find((t) => t.id !== id)!
  assert.ok(reverse.counterpartReconciled && !reverse.cleared)
  const correction = {
    ...fields,
    id: reverse.id,
    accountId: reverse.accountId,
    payee: { kind: 'transfer' as const, accountId: args.id },
    amount: -200000,
    cleared: false,
  }
  assert.equal(
    updateOwnedTransaction(correction).status,
    'confirmation_required',
  )
  assert.equal(
    updateOwnedTransaction({
      ...correction,
      confirmation: confirmationKey(reverse, correction),
    }).status,
    'ok',
  )
  const corrected = (await load()).find((t) => t.id !== id)!
  assert.equal(
    deleteOwnedTransaction({ ownerId: 'user', id: corrected.id }).status,
    'confirmation_required',
  )
  const unlink = { ...correction, payee: base.payee, confirmUnlink: true }
  assert.equal(updateOwnedTransaction(unlink).status, 'confirmation_required')
  assert.equal((await load()).length, 2)
  db.update(accounts)
    .set({ closed: true })
    .where(eq(accounts.id, args.id))
    .run()
  assert.equal(
    updateOwnedTransaction({
      ...unlink,
      confirmation: confirmationKey(corrected, unlink),
    }).status,
    'account_closed',
  )
  assert.equal(
    deleteOwnedTransaction({
      id: corrected.id,
      ownerId: 'user',
      confirmation: confirmationKey(corrected),
    }).status,
    'account_closed',
  )
  db.update(accounts)
    .set({ closed: false })
    .where(eq(accounts.id, args.id))
    .run()
  db.update(transactions)
    .set({ reconciled: true, cleared: true })
    .where(eq(transactions.id, corrected.id))
    .run()
  const both = (await load()).find((t) => t.id === id)!
  const changePayee = {
    ...transfer,
    amount: both.amount,
    payee: { kind: 'transfer' as const, accountId: 'safety-c' },
  }
  assert.equal(
    updateOwnedTransaction(changePayee).status,
    'confirmation_required',
  )
  save({ ...changePayee, confirmation: confirmationKey(both, changePayee) })
  const movedPair = await load()
  assert.ok(movedPair.every((t) => t.reconciled && t.cleared))
  assert.equal(movedPair.find((t) => t.id !== id)?.accountId, 'safety-c')
  assert.equal(
    db.select().from(accounts).where(eq(accounts.id, 'safety-c')).get()
      ?.lastReconciledAt,
    null,
  )
  const current = movedPair.find((t) => t.id === id)!
  const kept = save({
    ...fields,
    amount: current.amount,
    confirmUnlink: true,
    confirmation: confirmationKey(current, {
      ...fields,
      amount: current.amount,
    }),
  })
  assert.ok(kept.reconciled && !kept.transferId)
  assert.equal((await load()).length, 0)
  assert.equal(
    deleteOwnedTransaction({ id, ownerId: 'user' }).status,
    'confirmation_required',
  )
  assert.equal(
    deleteOwnedTransaction({
      id,
      ownerId: 'user',
      confirmation: confirmationKey(kept),
    }).status,
    'ok',
  )
})

test('future dates clear verification without restoring it on return or accepting a forged cleared request', async () => {
  const { createTransactionSchema } = await import('./transaction.schemas')
  const base = {
    accountId: 'checking',
    ownerId: 'user',
    payee: { kind: 'ordinary' as const, payeeId: null },
    categoryId: null,
    memo: null,
    amount: 1000,
    date: today,
    today,
    cleared: true,
  }
  const result = insertOwnedTransaction(base)
  assert.equal(result.status, 'ok')
  const id = result.payload.transactions[0].id
  db.update(transactions)
    .set({ reconciled: true })
    .where(eq(transactions.id, id))
    .run()
  const future = { ...base, id, confirmUnlink: false, date: '2026-08-10' }
  assert.equal(updateOwnedTransaction(future).status, 'invalid_cleared')
  assert.equal(
    createTransactionSchema.safeParse({
      ...future,
      cleared: false,
      reconciled: true,
    }).success,
    false,
  )
  const changed = updateOwnedTransaction({
    ...future,
    cleared: false,
    futureDraftDate: future.date,
  })
  assert.equal(changed.status, 'ok')
  assert.equal(changed.payload.transactions[0].reconciled, false)
  const returned = updateOwnedTransaction({
    ...future,
    date: today,
    cleared: false,
  })
  assert.equal(returned.status, 'ok')
  assert.ok(
    !returned.payload.transactions[0].cleared &&
      !returned.payload.transactions[0].reconciled,
  )
  db.update(transactions)
    .set({ cleared: true, reconciled: true })
    .where(eq(transactions.id, id))
    .run()
  const roundtrip = updateOwnedTransaction({
    ...future,
    date: today,
    cleared: false,
    futureDraftDate: future.date,
  })
  assert.equal(roundtrip.status, 'ok')
  assert.ok(
    !roundtrip.payload.transactions[0].reconciled &&
      !roundtrip.payload.transactions[0].cleared,
  )
})

test('pages tied dates without losing rows, filtering away old matches, or truncating balances', async () => {
  const scope = {
    planId: 'plan',
    accountId: 'paged',
    ownerId: 'user',
    today: new Date().toISOString().slice(0, 10),
  }
  db.insert(accounts)
    .values(account('paged', 'Paged', 'checking'))
    .run()
  const ids = Array.from(
    { length: 205 },
    (_, i) => 'pg' + String(i).padStart(3, '0'),
  )
  db.transaction((tx) => {
    for (const [i, id] of ids.entries())
      tx.insert(transactions)
        .values({
          id,
          accountId: scope.accountId,
          date: scope.today,
          createdAt: now,
          amount: i === 0 ? 5000 : 1000,
          cleared: i !== 0,
          reconciled: i > 2,
          memo: i === 0 ? 'Old entry' : null,
        })
        .run()
  })
  const first = (await findTransactionRegisterByOwner(scope))!
  assert.deepEqual(
    [first.summary.clearedBalance, first.summary.unclearedBalance],
    [204000, 5000],
  )
  const second = await findRegisterPage({ ...scope, after: first.page.next! })
  const third = await findRegisterPage({ ...scope, after: second.next! })
  assert.deepEqual(
    [first.page, second, third].map((p) => p.transactions.length),
    [100, 100, 5],
  )
  assert.deepEqual(
    [first.page, second, third].flatMap((p) => p.transactions.map((r) => r.id)),
    [...ids].reverse(),
  )
  assert.equal(third.next, null)
  const linked = await findRegisterPage({ ...scope, selectedId: ids[102] })
  assert.deepEqual(
    linked.transactions.map((r) => r.id),
    ids.slice(3, 103).reverse(),
  )
  assert.deepEqual(
    (
      await findRegisterPage({ ...scope, after: linked.next! })
    ).transactions.map((r) => r.id),
    ids.slice(0, 3).reverse(),
  )
  assert.deepEqual(
    (
      await findRegisterPage({
        ...scope,
        search: 'old entry',
        hideReconciled: true,
      })
    ).transactions.map((r) => r.id),
    [ids[0]],
  )
  assert.deepEqual(
    (await findRegisterPage({ ...scope, ownerId: 'other', selectedId: ids[0] }))
      .transactions,
    [],
  )
  // The two cleared but unlocked entries are both outside the loaded page.
  const reviewed = async () =>
    (await findTransactionRegisterByOwner({ ...scope, review: true }))!.summary
      .version!
  const completion = {
    ...scope,
    target: 204000,
    adjust: false,
    timeZone: 'UTC',
    version: await reviewed(),
  }
  db.update(transactions)
    .set({ amount: 1100 })
    .where(eq(transactions.id, ids[1]))
    .run()
  db.update(transactions)
    .set({ amount: 900 })
    .where(eq(transactions.id, ids[2]))
    .run()
  assert.throws(() => reconcileOwnedAccount(completion), /register changed/)
  reconcileOwnedAccount({ ...completion, version: await reviewed() })
  assert.deepEqual(
    (
      await findRegisterPage({ ...scope, hideReconciled: true })
    ).transactions.map((r) => r.id),
    [ids[0]],
  )
})
