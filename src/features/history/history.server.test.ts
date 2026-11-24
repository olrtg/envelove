import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import Database from 'better-sqlite3'
import { parsePlanMonth } from '#/features/plans/plan-month'

const directory = mkdtempSync(join(tmpdir(), 'envelove-history-'))
const path = join(directory, 'fixture.sqlite')
const connection = new Database(path)
for (const file of readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  connection.exec(readFileSync(join('drizzle', file), 'utf8'))
connection.close()
process.env.DATABASE_URL = path
const { db } = await import('#/db')
const sql = db.$client
const { captureAction, reverseAction } = await import('./history.server')
const { insertPlan } = await import('#/features/plans/plans.server')
const { insertOwnedAccount, updateOwnedAccount } =
  await import('#/features/accounts/accounts.server')
const {
  insertOwnedCategoryGroup,
  insertOwnedCategory,
  deleteOwnedCategoryGroup,
  updateOwnedCategoryName,
} = await import('#/features/categories/categories.server')
const { setOwnedCategoryAssigned } =
  await import('#/features/budget/budget.server')
const { insertOwnedTransaction } =
  await import('#/features/transactions/transactions.server')
const { user } = await import('#/db/schema')
const owner = 'history-owner',
  tabId = randomUUID()
db.insert(user)
  .values({
    id: owner,
    name: 'Fixture',
    email: 'history@example.test',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run()
after(() => {
  sql.close()
  rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const plan = insertPlan({
    ownerId: owner,
    name: 'Fixture',
    countryCode: 'US',
  })
  const group = insertOwnedCategoryGroup({
    ownerId: owner,
    planId: plan.id,
    name: 'Living',
  })!
  const category = insertOwnedCategory({
    ownerId: owner,
    categoryGroupId: group.id,
    name: 'Food',
  })!
  const account = insertOwnedAccount({
    ownerId: owner,
    planId: plan.id,
    name: 'Checking',
    type: 'checking',
  })!
  return { plan, group, category, account }
}
function action<T>(name: string, data: Record<string, unknown>, run: () => T) {
  return captureAction(
    owner,
    { tabId, requestId: randomUUID() },
    name,
    data,
    run,
  )
}
function reverse(
  entry: NonNullable<ReturnType<typeof action>['receipt']>,
  direction: 'undo' | 'redo' = 'undo',
  requestId = randomUUID(),
) {
  return reverseAction(owner, {
    tabId,
    requestId,
    receiptId: entry.id,
    generation: entry.generation,
    direction,
  })
}

test('field restoration preserves unrelated edits and protects overlapping undo and redo', () => {
  const { category } = fixture()
  const result = action('updateCategoryName', { id: category.id }, () =>
    updateOwnedCategoryName({
      id: category.id,
      ownerId: owner,
      name: 'Groceries',
    }),
  )
  sql.prepare('UPDATE categories SET hidden=1 WHERE id=?').run(category.id)
  const undone = reverse(result.receipt!)
  assert.deepEqual(
    sql
      .prepare('SELECT name,hidden FROM categories WHERE id=?')
      .get(category.id),
    { name: 'Food', hidden: 1 },
  )
  sql
    .prepare('UPDATE categories SET name=? WHERE id=?')
    .run('Other tab', category.id)
  assert.throws(() => reverse(undone, 'redo'), /changed in another session/)
  assert.equal(
    (
      sql
        .prepare('SELECT name FROM categories WHERE id=?')
        .get(category.id) as { name: string }
    ).name,
    'Other tab',
  )
})
test('no-op edits do not create history; errors roll back all changes', () => {
  const { category } = fixture()
  assert.equal(
    action('updateCategoryName', { id: category.id }, () =>
      updateOwnedCategoryName({
        ownerId: owner,
        id: category.id,
        name: 'Food',
      }),
    ).receipt,
    null,
  )
  assert.throws(
    () =>
      action('updateCategoryName', { id: category.id }, () => {
        sql
          .prepare('UPDATE categories SET name=? WHERE id=?')
          .run('Bad', category.id)
        throw new Error('failed')
      }),
    /failed/,
  )
  assert.equal(
    (
      sql
        .prepare('SELECT name FROM categories WHERE id=?')
        .get(category.id) as { name: string }
    ).name,
    'Food',
  )
})
test('hard-deleted group restores original IDs, assignments and reassigned references atomically', () => {
  const { plan, group, category, account } = fixture()
  const targetGroup = insertOwnedCategoryGroup({
    ownerId: owner,
    planId: plan.id,
    name: 'Other',
  })!
  const target = insertOwnedCategory({
    ownerId: owner,
    categoryGroupId: targetGroup.id,
    name: 'Other',
  })!
  setOwnedCategoryAssigned({
    ownerId: owner,
    categoryId: category.id,
    month: parsePlanMonth('2026-11')!,
    amount: 1000,
  })
  const transaction = insertOwnedTransaction({
    ownerId: owner,
    accountId: account.id,
    categoryId: category.id,
    date: '2026-11-01',
    today: '2026-11-13',
    payee: { kind: 'ordinary', payeeId: null },
    memo: null,
    amount: -1000,
    cleared: false,
  })
  assert.equal(transaction.status, 'ok')
  const entry = action(
    'deleteCategoryGroup',
    { id: group.id, targetCategoryId: target.id },
    () =>
      deleteOwnedCategoryGroup({
        ownerId: owner,
        id: group.id,
        targetCategoryId: target.id,
      }),
  )
  assert.ok(entry.receipt)
  const restored = reverse(entry.receipt)
  assert.ok(
    sql.prepare('SELECT id FROM categories WHERE id=?').get(category.id),
  )
  assert.equal(
    (
      sql
        .prepare('SELECT amount FROM category_assignments WHERE category_id=?')
        .get(category.id) as { amount: number }
    ).amount,
    1000,
  )
  assert.ok(
    sql
      .prepare('SELECT id FROM transactions WHERE category_id=?')
      .get(category.id),
  )
  const redone = reverse(restored, 'redo')
  sql
    .prepare('UPDATE transactions SET category_id=NULL WHERE account_id=?')
    .run(account.id)
  assert.throws(() => reverse(redone), /changed in another session/)
  assert.equal(
    sql.prepare('SELECT id FROM category_groups WHERE id=?').get(group.id),
    undefined,
  )
  assert.equal(
    sql
      .prepare('SELECT * FROM category_assignments WHERE category_id=?')
      .get(category.id),
    undefined,
  )
})
test('Account creation protects new dependent Transactions and credit categories', () => {
  const { plan, category } = fixture()
  const created = action('createAccount', { planId: plan.id }, () =>
    insertOwnedAccount({
      ownerId: owner,
      planId: plan.id,
      name: 'Visa',
      type: 'credit_card',
    }),
  )
  const id = created.value!.id
  const categoryRow = sql
    .prepare('SELECT * FROM categories WHERE credit_account_id=?')
    .get(id)
  assert.ok(categoryRow)
  const undone = reverse(created.receipt!)
  reverse(undone, 'redo')
  assert.deepEqual(
    sql.prepare('SELECT * FROM categories WHERE credit_account_id=?').get(id),
    categoryRow,
  )
  insertOwnedTransaction({
    ownerId: owner,
    accountId: id,
    categoryId: category.id,
    date: '2026-11-01',
    today: '2026-11-13',
    payee: { kind: 'ordinary', payeeId: null },
    memo: null,
    amount: -1000,
    cleared: false,
  })
  assert.throws(
    () => reverse({ ...created.receipt!, generation: 2 }),
    /changed in another session/,
  )
  assert.ok(sql.prepare('SELECT id FROM accounts WHERE id=?').get(id))
})
test('durable idempotency rejects forged, stale, cross-tab and foreign-owner requests', () => {
  const { plan, account } = fixture()
  const request = { tabId, requestId: randomUUID() },
    data = { id: account.id }
  let calls = 0
  const run = () => {
    calls++
    return updateOwnedAccount({
      ownerId: owner,
      id: account.id,
      name: 'Renamed',
      closed: false,
    })
  }
  const saved = captureAction(owner, request, 'updateAccount', data, run)
  assert.deepEqual(
    captureAction(owner, request, 'updateAccount', data, run),
    saved,
  )
  assert.equal(calls, 1)
  assert.throws(
    () => captureAction(owner, request, 'updateAccount', { id: 'forged' }, run),
    /Invalid retry/,
  )
  const requestId = randomUUID(),
    input = {
      tabId,
      requestId,
      receiptId: saved.receipt!.id,
      generation: 0,
      direction: 'undo' as const,
    }
  const undone = reverseAction(owner, input)
  assert.deepEqual(reverseAction(owner, input), undone)
  assert.throws(() => reverse(saved.receipt!), /changed in another session/)
  assert.throws(
    () => reverseAction('foreign', { ...input, requestId: randomUUID() }),
    /unavailable/,
  )
  assert.throws(
    () =>
      reverseAction(owner, {
        ...input,
        tabId: randomUUID(),
        requestId: randomUUID(),
      }),
    /unavailable/,
  )
  assert.throws(
    () =>
      reverseAction(owner, {
        ...input,
        receiptId: randomUUID(),
        requestId: randomUUID(),
      }),
    /unavailable/,
  )
  assert.ok(sql.prepare('SELECT id FROM plans WHERE id=?').get(plan.id))
})

test('transfer pair creation, edit, cleared state, deletion and credit payments reverse as one action', async () => {
  const { plan, account } = fixture()
  const other = insertOwnedAccount({
    ownerId: owner,
    planId: plan.id,
    name: 'Card',
    type: 'credit_card',
  })!
  const { updateOwnedTransaction, deleteOwnedTransaction } =
    await import('#/features/transactions/transactions.server')
  const fields = {
    ownerId: owner,
    accountId: account.id,
    categoryId: null,
    date: '2026-11-01',
    today: '2026-11-13',
    payee: { kind: 'transfer' as const, accountId: other.id },
    memo: 'Payment',
    amount: -1000,
    cleared: false,
  }
  const saved = action('createTransaction', { accountId: account.id }, () =>
    insertOwnedTransaction(fields),
  )
  assert.equal(saved.value.status, 'ok')
  const rows = sql
    .prepare(
      'SELECT * FROM transactions WHERE account_id=? OR account_id=? ORDER BY id',
    )
    .all(account.id, other.id) as { id: string; account_id: string }[]
  assert.equal(rows.length, 2)
  const undone = reverse(saved.receipt!)
  assert.equal(
    sql
      .prepare('SELECT id FROM transactions WHERE account_id=?')
      .get(account.id),
    undefined,
  )
  reverse(undone, 'redo')
  assert.deepEqual(
    sql
      .prepare(
        'SELECT * FROM transactions WHERE account_id=? OR account_id=? ORDER BY id',
      )
      .all(account.id, other.id),
    rows,
  )
  const id = rows.find((t) => t.account_id === account.id)!.id
  const edited = action(
    'updateTransaction',
    { id, accountId: account.id },
    () =>
      updateOwnedTransaction({
        ...fields,
        id,
        amount: -2000,
        cleared: true,
        confirmUnlink: false,
      }),
  )
  reverse(edited.receipt!)
  assert.deepEqual(
    sql
      .prepare(
        'SELECT id,amount,cleared FROM transactions WHERE account_id=? OR account_id=? ORDER BY id',
      )
      .all(account.id, other.id),
    (rows as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      amount: r.amount,
      cleared: r.cleared,
    })),
  )
  const beforeDeletion = sql
    .prepare(
      'SELECT * FROM transactions WHERE account_id=? OR account_id=? ORDER BY id',
    )
    .all(account.id, other.id)
  const deleted = action('deleteTransaction', { id }, () =>
    deleteOwnedTransaction({ ownerId: owner, id }),
  )
  reverse(deleted.receipt!)
  assert.deepEqual(
    sql
      .prepare(
        'SELECT * FROM transactions WHERE account_id=? OR account_id=? ORDER BY id',
      )
      .all(account.id, other.id),
    beforeDeletion,
  )
})
test('Payee merge restores both stable identity and Transaction references', async () => {
  const { plan, account, category } = fixture()
  const { insertOwnedPayee, deleteOwnedPayee } =
    await import('#/features/payees/payees.server')
  const first = insertOwnedPayee({
    ownerId: owner,
    planId: plan.id,
    name: 'First',
  })
  const second = insertOwnedPayee({
    ownerId: owner,
    planId: plan.id,
    name: 'Second',
  })
  assert.equal(first.status, 'ok')
  assert.equal(second.status, 'ok')
  insertOwnedTransaction({
    ownerId: owner,
    accountId: account.id,
    categoryId: category.id,
    date: '2026-11-01',
    today: '2026-11-13',
    payee: { kind: 'ordinary', payeeId: first.payee.id },
    memo: null,
    amount: -1000,
    cleared: false,
  })
  const merged = action(
    'deletePayee',
    { id: first.payee.id, destinationPayeeId: second.payee.id },
    () =>
      deleteOwnedPayee({
        ownerId: owner,
        id: first.payee.id,
        destinationPayeeId: second.payee.id,
      }),
  )
  const undone = reverse(merged.receipt!)
  assert.ok(
    sql
      .prepare('SELECT id FROM transactions WHERE payee_id=?')
      .get(first.payee.id),
  )
  const redone = reverse(undone, 'redo')
  sql
    .prepare('UPDATE transactions SET payee_id=NULL WHERE account_id=?')
    .run(account.id)
  assert.throws(() => reverse(redone), /changed in another session/)
  assert.equal(
    sql.prepare('SELECT id FROM payees WHERE id=?').get(first.payee.id),
    undefined,
  )
})
test('Money Moves reverse both assignments and protect the complete operation', async () => {
  const { plan, group, category } = fixture()
  const second = insertOwnedCategory({
    ownerId: owner,
    categoryGroupId: group.id,
    name: 'Vacation',
  })!
  const month = parsePlanMonth('2026-11')!
  setOwnedCategoryAssigned({
    ownerId: owner,
    categoryId: category.id,
    month,
    amount: 10000,
  })
  const { moveOwnedMoney } = await import('#/features/budget/budget.server')
  const move = {
    ownerId: owner,
    planId: plan.id,
    today: '2026-11-13',
    kind: 'move' as const,
    source: { categoryId: category.id, month },
    destination: { categoryId: second.id, month },
    amount: 3000,
  }
  const saved = action('moveMoney', move, () => moveOwnedMoney(move))
  assert.equal(saved.value.status, 'ok')
  const undone = reverse(saved.receipt!)
  assert.equal(
    sql
      .prepare('SELECT * FROM category_assignments WHERE category_id=?')
      .get(second.id),
    undefined,
  )
  assert.equal(
    (
      sql
        .prepare('SELECT amount FROM category_assignments WHERE category_id=?')
        .get(category.id) as { amount: number }
    ).amount,
    10000,
  )
  const redone = reverse(undone, 'redo')
  sql
    .prepare('UPDATE category_assignments SET amount=4000 WHERE category_id=?')
    .run(second.id)
  assert.throws(() => reverse(redone), /changed in another session/)
  assert.equal(
    (
      sql
        .prepare('SELECT amount FROM category_assignments WHERE category_id=?')
        .get(category.id) as { amount: number }
    ).amount,
    7000,
  )
})
test('Account close/reopen and Plan settings preserve independent fields', async () => {
  const { plan, account } = fixture()
  const closed = action('updateAccount', { id: account.id }, () =>
    updateOwnedAccount({
      ownerId: owner,
      id: account.id,
      name: account.name,
      closed: true,
    }),
  )
  sql
    .prepare('UPDATE accounts SET name=? WHERE id=?')
    .run('Other tab name', account.id)
  const undone = reverse(closed.receipt!)
  assert.deepEqual(
    sql.prepare('SELECT name,closed FROM accounts WHERE id=?').get(account.id),
    { name: 'Other tab name', closed: 0 },
  )
  reverse(undone, 'redo')
  const { updateOwnedPlan } = await import('#/features/plans/plans.server')
  const setting = action('updatePlanSettings', { id: plan.id }, () =>
    updateOwnedPlan({
      id: plan.id,
      ownerId: owner,
      name: 'New name',
      countryCode: 'US',
      defaultTransactionCleared: false,
    }),
  )
  sql
    .prepare('UPDATE plans SET default_transaction_cleared=1 WHERE id=?')
    .run(plan.id)
  reverse(setting.receipt!)
  assert.deepEqual(
    sql
      .prepare('SELECT name,default_transaction_cleared FROM plans WHERE id=?')
      .get(plan.id),
    { name: 'Fixture', default_transaction_cleared: 1 },
  )
})
test('ordering detects a newly inserted sibling without reversing partially', async () => {
  const { plan, group } = fixture()
  const { reorderOwnedCategoryGroups } =
    await import('#/features/categories/categories.server')
  const second = insertOwnedCategoryGroup({
    ownerId: owner,
    planId: plan.id,
    name: 'Second',
  })!
  const ids = (
    sql
      .prepare(
        "SELECT id FROM category_groups WHERE plan_id=? AND kind='ordinary' ORDER BY position",
      )
      .all(plan.id) as { id: string }[]
  ).map((g) => g.id)
  const reordered = action('reorderCategoryGroups', { planId: plan.id }, () =>
    reorderOwnedCategoryGroups({
      ownerId: owner,
      planId: plan.id,
      expectedIds: ids,
      orderedIds: [second.id, group.id],
    }),
  )
  assert.ok(reordered.value)
  insertOwnedCategoryGroup({
    ownerId: owner,
    planId: plan.id,
    name: 'Other tab group',
  })
  assert.throws(() => reverse(reordered.receipt!), /changed in another session/)
})

test('Category and Group create, rename, hide, move and delete round trips retain IDs', async () => {
  const { plan, group, category } = fixture()
  const {
    updateOwnedCategoryGroupName,
    updateOwnedCategoryHidden,
    moveOwnedCategory,
    deleteOwnedCategory,
  } = await import('#/features/categories/categories.server')
  const roundTrip = <T>(
    name: string,
    data: Record<string, unknown>,
    run: () => T,
  ) => {
    const entry = action(name, data, run)
    assert.ok(entry.receipt)
    const undone = reverse(entry.receipt)
    return reverse(undone, 'redo')
  }
  const created = action('createCategoryGroup', { planId: plan.id }, () =>
    insertOwnedCategoryGroup({
      ownerId: owner,
      planId: plan.id,
      name: 'New group',
    }),
  )
  const second = created.value!
  reverse(reverse(created.receipt!), 'redo')
  roundTrip('updateCategoryGroupName', { id: second.id }, () =>
    updateOwnedCategoryGroupName({
      ownerId: owner,
      id: second.id,
      name: 'Renamed group',
    }),
  )
  const newCategory = action(
    'createCategory',
    { categoryGroupId: second.id },
    () =>
      insertOwnedCategory({
        ownerId: owner,
        categoryGroupId: second.id,
        name: 'New category',
      }),
  )
  reverse(reverse(newCategory.receipt!), 'redo')
  roundTrip('updateCategoryHidden', { id: category.id }, () =>
    updateOwnedCategoryHidden({
      ownerId: owner,
      id: category.id,
      hidden: true,
    }),
  )
  roundTrip('updateCategoryHidden', { id: category.id }, () =>
    updateOwnedCategoryHidden({
      ownerId: owner,
      id: category.id,
      hidden: false,
    }),
  )
  roundTrip('moveCategory', { planId: plan.id }, () =>
    moveOwnedCategory({
      ownerId: owner,
      planId: plan.id,
      categoryId: category.id,
      fromGroupId: group.id,
      toGroupId: second.id,
      expectedSourceIds: [category.id],
      expectedTargetIds: [newCategory.value!.id],
      sourceIds: [],
      targetIds: [newCategory.value!.id, category.id],
    }),
  )
  roundTrip('deleteCategory', { id: category.id }, () =>
    deleteOwnedCategory({
      ownerId: owner,
      id: category.id,
      targetCategoryId: null,
    }),
  )
})
test('Cover Overspending restores source and destination assignments', async () => {
  const { plan, group, category, account } = fixture(),
    month = parsePlanMonth('2026-11')!
  const other = insertOwnedCategory({
    ownerId: owner,
    categoryGroupId: group.id,
    name: 'Shortfall',
  })!
  setOwnedCategoryAssigned({
    ownerId: owner,
    categoryId: category.id,
    month,
    amount: 10000,
  })
  insertOwnedTransaction({
    ownerId: owner,
    accountId: account.id,
    categoryId: other.id,
    date: '2026-11-01',
    today: '2026-11-13',
    payee: { kind: 'ordinary', payeeId: null },
    memo: null,
    amount: -5000,
    cleared: false,
  })
  const { moveOwnedMoney } = await import('#/features/budget/budget.server')
  const move = {
    ownerId: owner,
    planId: plan.id,
    today: '2026-11-13',
    kind: 'cover' as const,
    source: { categoryId: category.id, month },
    destination: { categoryId: other.id, month },
  }
  const covered = action('moveMoney', move, () => moveOwnedMoney(move))
  assert.equal(covered.value.status, 'ok')
  reverse(covered.receipt!)
  assert.equal(
    sql
      .prepare('SELECT * FROM category_assignments WHERE category_id=?')
      .get(other.id),
    undefined,
  )
  assert.equal(
    (
      sql
        .prepare('SELECT amount FROM category_assignments WHERE category_id=?')
        .get(category.id) as { amount: number }
    ).amount,
    10000,
  )
})

test('currency reversal rejects newer amounts that violate restored precision', async () => {
  const { plan, category } = fixture()
  const { updateOwnedPlan } = await import('#/features/plans/plans.server')
  updateOwnedPlan({
    ownerId: owner,
    id: plan.id,
    name: plan.name,
    countryCode: 'PY',
    defaultTransactionCleared: false,
  })
  const changed = action('updatePlanSettings', { id: plan.id }, () =>
    updateOwnedPlan({
      ownerId: owner,
      id: plan.id,
      name: plan.name,
      countryCode: 'US',
      defaultTransactionCleared: false,
    }),
  )
  setOwnedCategoryAssigned({
    ownerId: owner,
    categoryId: category.id,
    month: parsePlanMonth('2026-11')!,
    amount: 1230,
  })
  assert.throws(() => reverse(changed.receipt!), /changed in another session/)
  assert.equal(
    (
      sql
        .prepare('SELECT currency_code FROM plans WHERE id=?')
        .get(plan.id) as { currency_code: string }
    ).currency_code,
    'USD',
  )
})

test('unrelated Plan settings do not block a Category name reversal', () => {
  const { plan, category } = fixture()
  const renamed = action('updateCategoryName', { id: category.id }, () =>
    updateOwnedCategoryName({
      ownerId: owner,
      id: category.id,
      name: 'New name',
    }),
  )
  sql
    .prepare(
      "UPDATE plans SET country_code='PY',currency_code='PYG' WHERE id=?",
    )
    .run(plan.id)
  reverse(renamed.receipt!)
  assert.equal(
    (
      sql
        .prepare('SELECT name FROM categories WHERE id=?')
        .get(category.id) as { name: string }
    ).name,
    'Food',
  )
  assert.equal(
    (
      sql
        .prepare('SELECT currency_code FROM plans WHERE id=?')
        .get(plan.id) as { currency_code: string }
    ).currency_code,
    'PYG',
  )
})
test('Payee creation, rename and deletion without a destination retain original identity', async () => {
  const { plan } = fixture()
  const { insertOwnedPayee, renameOwnedPayee, deleteOwnedPayee } =
    await import('#/features/payees/payees.server')
  const created = action('createPayee', { planId: plan.id }, () =>
    insertOwnedPayee({ ownerId: owner, planId: plan.id, name: 'New Payee' }),
  )
  assert.equal(created.value.status, 'ok')
  const id = sql
    .prepare('SELECT id FROM payees WHERE plan_id=?')
    .get(plan.id) as { id: string }
  reverse(reverse(created.receipt!), 'redo')
  const renamed = action('renamePayee', { id: id.id }, () =>
    renameOwnedPayee({ ownerId: owner, id: id.id, name: 'Renamed Payee' }),
  )
  reverse(reverse(renamed.receipt!), 'redo')
  const deleted = action('deletePayee', { id: id.id }, () =>
    deleteOwnedPayee({ ownerId: owner, id: id.id, destinationPayeeId: null }),
  )
  reverse(deleted.receipt!)
  assert.equal(
    (
      sql.prepare('SELECT name FROM payees WHERE id=?').get(id.id) as {
        name: string
      }
    ).name,
    'Renamed Payee',
  )
})

test('reconciliation rechecks eligibility and ledger, rolls back failures, and reverses as one conflict-protected action', async () => {
  const { plan, account } = fixture()
  const { findTransactionRegisterByOwner, reconcileOwnedAccount } =
    await import('../transactions/transactions.server')
  const { reconciliationVersion } =
    await import('../transactions/reconciliation')
  const { getLocalDate } = await import('../transactions/transaction-money')
  const today = getLocalDate()
  const register = () =>
    findTransactionRegisterByOwner({
      today,
      ownerId: owner,
      planId: plan.id,
      accountId: account.id,
    })
  const add = sql.prepare(
    'INSERT INTO transactions (id,account_id,date,amount,cleared) VALUES (?,?,?,?,?)',
  )
  add.run('posted1', account.id, today, 700000, 1)
  add.run('posted2', account.id, today, 300000, 1)
  add.run('pending', account.id, today, -200000, 0)
  add.run('later', account.id, '2099-12-31', 400000, 0)
  const before = (await register())!
  const input = {
    ownerId: owner,
    accountId: account.id,
    planId: plan.id,
    target: 800000,
    adjust: true,
    today,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    version: await reconciliationVersion({
      rows: before.page.transactions,
      last: null,
      today,
      currency: plan.currencyCode,
      accountType: account.type,
    }),
  }
  const run = () => reconcileOwnedAccount(input)
  assert.throws(() =>
    reconcileOwnedAccount({ ...input, ownerId: 'another-user' }),
  )
  assert.throws(() => reconcileOwnedAccount({ ...input, target: 1001 }))
  assert.throws(() => reconcileOwnedAccount({ ...input, adjust: false }))
  sql.prepare('UPDATE accounts SET closed=1 WHERE id=?').run(account.id)
  assert.throws(run)
  sql
    .prepare("UPDATE accounts SET closed=0,type='personal_loan' WHERE id=?")
    .run(account.id)
  assert.throws(run)
  sql.prepare("UPDATE accounts SET type='checking' WHERE id=?").run(account.id)
  sql.exec(
    "UPDATE transactions SET amount=amount+1000 WHERE id='posted1';UPDATE transactions SET amount=amount-1000 WHERE id='posted2'",
  )
  assert.throws(run, /register changed/)
  const refreshed = (await register())!
  input.version = await reconciliationVersion({
    rows: refreshed.page.transactions,
    last: null,
    today,
    currency: plan.currencyCode,
    accountType: account.type,
  })
  sql.exec(
    "CREATE TEMP TRIGGER fail_completion BEFORE UPDATE OF last_reconciled_at ON accounts BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  )
  assert.throws(run, /fixture failure/)
  sql.exec('DROP TRIGGER fail_completion')
  assert.deepEqual(await register(), refreshed)
  const request = { requestId: randomUUID(), tabId }
  const save = () =>
    captureAction(owner, request, 'reconcileAccount', input, run)
  const result = save()
  assert.deepEqual(save(), result)
  const completed = (await register())!
  assert.equal(
    completed.account?.lastReconciledAt?.getTime(),
    result.value.completedAt.getTime(),
  )
  assert.equal(
    completed.page.transactions.filter((t) => t.reconciled).length,
    3,
  )
  assert.equal(
    completed.page.transactions
      .filter((t) => t.cleared)
      .reduce((sum, t) => sum + t.amount, 0),
    800000,
  )
  const adjustment = completed.page.transactions.find(
    (t) => t.reconciliationAdjustment,
  )!
  assert.equal(adjustment.amount, -200000)
  assert.equal(adjustment.payeeName, 'Reconciliation Balance Adjustment')
  assert.equal(adjustment.memo, 'Reconciliation balance adjustment')
  assert.equal(adjustment.date, today)
  assert.throws(run, /register changed/)
  const undone = reverse(result.receipt!)
  const restored = (await register())!
  assert.equal(restored.account?.lastReconciledAt, null)
  assert.equal(restored.page.transactions.length, 4)
  assert.ok(restored.page.transactions.every((t) => !t.reconciled))
  const redone = reverse(undone, 'redo')
  assert.deepEqual(
    (await register())!.page.transactions,
    completed.page.transactions,
  )
  sql.exec("UPDATE transactions SET amount=amount+1000 WHERE id='posted1'")
  assert.throws(() => reverse(redone), /changed in another session/)
  assert.equal(
    (await register())!.page.transactions.find((t) => t.id === adjustment.id)
      ?.amount,
    -200000,
  )
})

test('credit adjustment sizing excludes pending entries while budgeting the full dated ledger and preserving transaction identity', async () => {
  const { plan, account, category } = fixture()
  const card = insertOwnedAccount({
    ownerId: owner,
    planId: plan.id,
    name: 'Card',
    type: 'credit_card',
  })!
  const { findPlanMonthBudget } = await import('../budget/budget.server')
  const { monthOfDate } = await import('../plans/plan-month')
  const { getLocalDate } = await import('../transactions/transaction-money')
  const { reconciliationVersion, confirmationKey } =
    await import('../transactions/reconciliation')
  const {
    reconcileOwnedAccount,
    findTransactionRegisterByOwner,
    updateOwnedTransaction,
  } = await import('../transactions/transactions.server')
  const today = getLocalDate()
  const month = monthOfDate(today)
  const payment = sql
    .prepare('SELECT id FROM categories WHERE credit_account_id=?')
    .pluck()
    .get(card.id) as string
  setOwnedCategoryAssigned({
    ownerId: owner,
    categoryId: payment,
    month,
    amount: 400000,
  })
  const budget = () => findPlanMonthBudget({ planId: plan.id, month, today })
  const initial = {
    ownerId: owner,
    accountId: card.id,
    categoryId: null,
    payee: { kind: 'ordinary' as const, payeeId: null },
    memo: null,
    today,
    date: today,
  }
  assert.equal(
    insertOwnedTransaction({ ...initial, amount: -1000000, cleared: true })
      .status,
    'ok',
  )
  assert.equal(
    insertOwnedTransaction({ ...initial, amount: -500000, cleared: false })
      .status,
    'ok',
  )
  const before = budget().readyToAssign.total
  const register = async () =>
    (await findTransactionRegisterByOwner({
      today,
      ownerId: owner,
      planId: plan.id,
      accountId: card.id,
    }))!
  const input = {
    planId: plan.id,
    ownerId: owner,
    accountId: card.id,
    today,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    version: await reconciliationVersion({
      rows: (await register()).page.transactions,
      last: null,
      today,
      currency: plan.currencyCode,
      accountType: card.type,
    }),
    target: 300000,
    adjust: true,
  }
  const completion = reconcileOwnedAccount(input)
  const adjustment = completion.adjustment.transactions[0]
  assert.equal(adjustment.amount, 1300000)
  assert.equal(budget().readyToAssign.total, before)
  const state = budget().categories.get(payment)!
  assert.deepEqual(
    [state.assigned, state.activity, state.available, state.cardBalance],
    [400000, 0, 400000, -200000],
  )
  const edit = {
    ...initial,
    id: adjustment.id,
    categoryId: adjustment.categoryId,
    cleared: true,
    confirmUnlink: false,
    memo: 'Corrected',
    payee: { kind: 'create' as const, name: 'Corrected payee' },
    amount: 1600000,
  }
  const corrected = updateOwnedTransaction({
    ...edit,
    confirmation: confirmationKey(adjustment, edit),
  })
  assert.equal(corrected.status, 'ok')
  const row = corrected.payload.transactions[0]
  assert.equal(row.reconciliationAdjustment, true)
  assert.equal(budget().readyToAssign.total, before + 100000)
  const ordinary = {
    ...edit,
    payee: { kind: 'ordinary' as const, payeeId: row.payeeId },
    amount: -100000,
  }
  const sameText = insertOwnedTransaction(ordinary)
  assert.equal(sameText.status, 'ok')
  assert.equal(sameText.payload.transactions[0].reconciliationAdjustment, false)
  assert.equal(budget().categories.get(payment)?.activity, 100000)
  const categorized = updateOwnedTransaction({
    ...ordinary,
    amount: row.amount,
    categoryId: category.id,
  })
  assert.equal(categorized.status, 'ok')
  assert.equal(budget().categories.get(category.id)?.activity, row.amount)
  const transfer = {
    ...ordinary,
    amount: row.amount,
    categoryId: null,
    payee: { kind: 'transfer' as const, accountId: account.id },
  }
  const converted = updateOwnedTransaction({
    ...transfer,
    confirmation: confirmationKey(
      categorized.payload.transactions[0],
      transfer,
    ),
  })
  assert.equal(converted.status, 'ok')
  assert.ok(
    converted.payload.transactions.every((t) => !t.reconciliationAdjustment),
  )
  assert.equal(
    converted.payload.transactions.find((t) => t.accountId === account.id)
      ?.cleared,
    false,
  )
  assert.equal(budget().paymentActivity.get(payment)?.payments, row.amount)
})

test('Guaraní cash and tracking adjustments use the signed difference and only cash reaches Ready to Assign', async () => {
  const { findPlanMonthBudget } = await import('../budget/budget.server')
  const { monthOfDate } = await import('../plans/plan-month')
  const { getLocalDate } = await import('../transactions/transaction-money')
  const { reconciliationVersion } =
    await import('../transactions/reconciliation')
  const { findTransactionRegisterByOwner, reconcileOwnedAccount } =
    await import('../transactions/transactions.server')
  const today = getLocalDate()
  for (const [type, target, expectedBudgetChange] of [
    ['checking', 800000, -200000],
    ['cash', 1300000, 300000],
    ['asset', 800000, 0],
  ] as const) {
    const plan = insertPlan({
      ownerId: owner,
      name: 'Guaraní fixture',
      countryCode: 'PY',
    })
    const account = insertOwnedAccount({
      ownerId: owner,
      planId: plan.id,
      name: 'Fixture',
      type,
    })!
    const scope = { ownerId: owner, accountId: account.id, planId: plan.id }
    const opening = insertOwnedTransaction({
      ...scope,
      date: today,
      today,
      amount: 1000000,
      cleared: true,
      memo: null,
      categoryId: null,
      payee: { kind: 'ordinary', payeeId: null },
    })
    assert.equal(opening.status, 'ok')
    const register = (await findTransactionRegisterByOwner({
      ...scope,
      today,
    }))!
    const budget = () =>
      findPlanMonthBudget({ planId: plan.id, month: monthOfDate(today), today })
    const before = budget()
    const result = reconcileOwnedAccount({
      ...scope,
      today,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      version: await reconciliationVersion({
        rows: register.page.transactions,
        last: null,
        today,
        currency: 'PYG',
        accountType: type,
      }),
      target,
      adjust: true,
    })
    const adjustment = result.adjustment.transactions[0]
    assert.equal(adjustment.amount, target - 1000000)
    assert.equal(adjustment.reconciled, true)
    const updatedBudget = budget()
    assert.equal(
      updatedBudget.readyToAssign.total - before.readyToAssign.total,
      expectedBudgetChange,
    )
    assert.deepEqual(updatedBudget.categories, before.categories)
    if (type === 'asset') assert.equal(adjustment.categoryId, null)
    else
      assert.equal(
        sql
          .prepare('SELECT kind FROM categories WHERE id=?')
          .pluck()
          .get(adjustment.categoryId),
        'ready_to_assign',
      )
  }
})
