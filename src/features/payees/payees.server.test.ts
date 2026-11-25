import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { createId } from '#/lib/id'

const testDirectory = mkdtempSync(join(tmpdir(), 'envelove-payees-'))
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
const { accounts, payees, plans, transactions } = await import('#/db/schema')
const { user } = await import('#/db/auth-schema')
const {
  combineOwnedPayees,
  deleteOwnedPayee,
  findPayeesByPlanOwner,
  insertOwnedPayee,
  renameOwnedPayee,
} = await import('./payees.server')

const now = new Date('2026-08-13T12:00:00.000Z')

db.insert(user)
  .values({
    id: 'payee-user',
    name: 'Payee User',
    email: 'payees@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  .run()
db.insert(plans)
  .values([
    {
      id: 'payee-plan',
      ownerId: 'payee-user',
      name: 'Payee Plan',
      countryCode: 'US',
      currencyCode: 'USD',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'other-plan',
      ownerId: 'payee-user',
      name: 'Other Plan',
      countryCode: 'US',
      currencyCode: 'USD',
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run()
db.insert(accounts)
  .values({
    id: 'closed-account',
    planId: 'payee-plan',
    name: 'Closed Checking',
    type: 'checking',
    closed: true,
    createdAt: now,
    updatedAt: now,
  })
  .run()

after(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

test('enforces case-insensitive Payee names and permits case-only rename', () => {
  const created = insertOwnedPayee({
    planId: 'payee-plan',
    ownerId: 'payee-user',
    name: 'Corner Store',
  })
  assert.equal(created.status, 'ok')

  const duplicate = insertOwnedPayee({
    planId: 'payee-plan',
    ownerId: 'payee-user',
    name: 'corner store',
  })
  assert.deepEqual(duplicate, { status: 'duplicate' })

  const renamed = renameOwnedPayee({
    id: created.payee.id,
    ownerId: 'payee-user',
    name: 'CORNER STORE',
  })
  assert.equal(renamed.status, 'ok')
  assert.equal(renamed.payee.name, 'CORNER STORE')
})

test('merges Payees across Closed Account history atomically', async () => {
  const source = insertOwnedPayee({
    planId: 'payee-plan',
    ownerId: 'payee-user',
    name: 'AMZN',
  })
  const destination = insertOwnedPayee({
    planId: 'payee-plan',
    ownerId: 'payee-user',
    name: 'Amazon',
  })
  const crossPlan = insertOwnedPayee({
    planId: 'other-plan',
    ownerId: 'payee-user',
    name: 'Amazon',
  })
  assert.equal(source.status, 'ok')
  assert.equal(destination.status, 'ok')
  assert.equal(crossPlan.status, 'ok')

  db.insert(transactions)
    .values({
      id: 'closed-transaction',
      accountId: 'closed-account',
      payeeId: source.payee.id,
      date: '2026-08-01',
      memo: null,
      amount: -10_000,
      cleared: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const invalidDestination = deleteOwnedPayee({
    id: source.payee.id,
    destinationPayeeId: crossPlan.payee.id,
    ownerId: 'payee-user',
  })
  assert.deepEqual(invalidDestination, { status: 'invalid_destination' })

  const merged = deleteOwnedPayee({
    id: source.payee.id,
    destinationPayeeId: destination.payee.id,
    ownerId: 'payee-user',
  })
  assert.equal(merged.status, 'ok')
  assert.equal(merged.transactionCount, 1)

  const transaction = db
    .select({ payeeId: transactions.payeeId })
    .from(transactions)
    .where(eq(transactions.id, 'closed-transaction'))
    .get()
  assert.equal(transaction?.payeeId, destination.payee.id)
  assert.equal(
    db.select().from(payees).where(eq(payees.id, source.payee.id)).get(),
    undefined,
  )

  const listed = await findPayeesByPlanOwner('payee-plan', 'payee-user')
  const savedDestination = listed?.find(
    (payee) => payee.id === destination.payee.id,
  )
  assert.equal(savedDestination?.transactionCount, 1)
})

test('combines closed-account history without changing category recency, and reverses it in one action', async () => {
  const { captureAction, reverseAction } =
    await import('#/features/history/history.server')
  const { findTransactionRegisterByOwner } =
    await import('#/features/transactions/transactions.server')
  const planId = 'payee-plan',
    ownerId = 'payee-user'
  const sql = db.$client
  sql.exec(`
    INSERT INTO category_groups(id,plan_id,name,position) VALUES ('shops','payee-plan','Shops',0);
    INSERT INTO categories(id,category_group_id,name,position) VALUES ('food','shops','Food',0), ('fuel','shops','Fuel',1);
    INSERT INTO payees(id,plan_id,name,name_key) VALUES ('one','payee-plan','One','one'),('two','payee-plan','Two','two'),('foreign','other-plan','Other','other');
    INSERT INTO transactions(id,account_id,date,amount,payee_id,category_id,updated_at,cleared,reconciled) VALUES
      ('recent','closed-account','2026-01-01',-800,'one','food',50,1,1),('older','closed-account','2026-01-02',-500,'two','fuel',30,0,0);
  `)
  for (const ids of [
    ['one', 'foreign'],
    ['one', 'one'],
    ['one', 'missing'],
  ]) {
    assert.throws(() =>
      combineOwnedPayees({ planId, ownerId, ids, name: 'New Shop' }),
    )
    assert.equal(
      sql.prepare("SELECT id FROM payees WHERE name='New Shop'").get(),
      undefined,
    )
  }
  const rows = () =>
    sql
      .prepare(
        "SELECT * FROM transactions WHERE id IN ('recent','older') ORDER BY id",
      )
      .all()
  const before = rows()
  for (const name of ['New Shop', 'tWo']) {
    const tabId = createId()
    const data = { planId, ids: ['one', 'two'], name }
    const { value, receipt } = captureAction(
      ownerId,
      { tabId, requestId: createId() },
      'combinePayees',
      data,
      () => combineOwnedPayees({ ...data, ownerId }),
    )
    assert.ok(receipt)
    assert.equal(value.transactionCount, 2)
    if (name === 'tWo') assert.equal(value.id, 'two')
    const register = await findTransactionRegisterByOwner({
      planId,
      ownerId,
      accountId: 'closed-account',
      today: '2026-08-13',
    })
    assert.equal(
      register?.payees.find((p) => p.id === value.id)?.lastCategoryId,
      'food',
    )
    const afterCombine = rows()
    for (const [generation, direction] of ['undo', 'redo', 'undo'].entries()) {
      reverseAction(ownerId, {
        tabId,
        requestId: createId(),
        receiptId: receipt.id,
        generation,
        direction: direction as 'undo' | 'redo',
      })
      assert.deepEqual(rows(), direction === 'undo' ? before : afterCombine)
    }
  }
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
