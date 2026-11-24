import { createHash, randomUUID } from 'node:crypto'
import { serialize, deserialize } from 'node:v8'
import { db } from '#/db'
import { getNumberFormat } from '#/lib/intl-formats'
import { amountMatchesCurrency } from '#/features/transactions/transaction-money'
import type { CurrencyCode } from '#/lib/country-profiles'
import type { HistoryReceipt } from './history.schemas'

const sqlite = db.$client
const tables = [
  'plans',
  'accounts',
  'payees',
  'category_groups',
  'categories',
  'category_assignments',
  'transfers',
  'transactions',
] as const
type Table = (typeof tables)[number]
type Row = Record<string, string | number | null>
type Change = {
  table: Table
  before: Row | null
  after: Row | null
  fields: string[]
}
type Request = { requestId: string; tabId: string }
type Guard = { table: Table; row: Row; fields: string[] }
type OrderGuard = { table: Table; column: string; parent: string; rows: Row[] }
type Journal = {
  planId: string
  reconciliation?: {
    accountId: string
    today: string
    before: string
    after: string
  }
  orderBefore: OrderGuard[]
  orderAfter: OrderGuard[]
  guardsBefore: Guard[]
  guardsAfter: Guard[]
  owner: string
  tab: string
  fingerprint: string
  result: string
  changes: Change[]
  receipt: HistoryReceipt | null
  undone: boolean
  generation: number
}
// Durable operation receipts provide retry safety across server restarts. They are
// never enumerated to rebuild a browser history.
const columns = Object.fromEntries(
  tables.map((table) => [
    table,
    (
      sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    ).map((c) => c.name),
  ]),
)
const keys = (table: Table) =>
  table === 'category_assignments' ? ['category_id', 'month'] : ['id']
const rowKey = (table: Table, row: Row) =>
  table + JSON.stringify(keys(table).map((k) => row[k]))
const encode = (value: unknown) => serialize(value).toString('base64')
const decode = <T>(value: string): T =>
  deserialize(Buffer.from(value, 'base64')) as T
function load(id: string) {
  const row = sqlite
    .prepare('SELECT payload FROM action_receipts WHERE id = ?')
    .get(id) as { payload: string } | undefined
  if (!row) return undefined
  const journal = decode<Journal>(row.payload)
  // Apply migration defaults to row images captured by older receipts.
  for (const change of journal.changes) {
    for (const image of [change.before, change.after]) {
      if (!image) continue
      if (change.table === 'transactions') {
        image.reconciled ??= 0
        image.reconciliation_adjustment ??= 0
        image.starting_balance ??= 0
      } else if (change.table === 'accounts') image.last_reconciled_at ??= null
      else if (change.table === 'plans') image.hide_after_reconciliation ??= 1
      else if (change.table === 'categories') {
        image.target ??= null
        image.snoozed_months ??= null
      }
    }
  }
  return journal
}
function save(id: string, journal: Journal) {
  sqlite
    .prepare('INSERT OR REPLACE INTO action_receipts VALUES (?, ?)')
    .run(id, encode(journal))
}
function owned(planId: string, owner: string) {
  if (
    !sqlite
      .prepare('SELECT id FROM plans WHERE id = ? AND owner_id = ?')
      .get(planId, owner)
  )
    throw new Error('Plan not found')
}
function planFor(action: string, data: Record<string, unknown>): string {
  if (typeof data.planId === 'string') return data.planId
  if (action === 'updatePlanSettings') return String(data.id)
  const table = action.includes('Transaction')
    ? 'transactions'
    : action.includes('Account')
      ? 'accounts'
      : action.includes('Payee')
        ? 'payees'
        : action.includes('Group')
          ? 'category_groups'
          : 'categories'
  const id =
    data.categoryGroupId ?? data.accountId ?? data.categoryId ?? data.id
  const actual = data.categoryGroupId
    ? 'category_groups'
    : data.accountId
      ? 'accounts'
      : table
  let query = `SELECT plan_id FROM ${actual} WHERE id = ?`
  if (actual === 'categories')
    query =
      'SELECT g.plan_id FROM categories c JOIN category_groups g ON g.id = c.category_group_id WHERE c.id = ?'
  if (actual === 'transactions')
    query =
      'SELECT a.plan_id FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?'
  const row = sqlite.prepare(query).get(id) as { plan_id: string } | undefined
  if (!row) throw new Error('Record not found')
  return row.plan_id
}
function read(table: Table, row: Row) {
  return (
    (sqlite
      .prepare(
        `SELECT * FROM ${table} WHERE ${keys(table)
          .map((k) => `${k} = ?`)
          .join(' AND ')}`,
      )
      .get(...keys(table).map((k) => row[k])) as Row | undefined) ?? null
  )
}
function capture<T>(run: () => T): { result: T; changes: Change[] } {
  sqlite.exec(
    'CREATE TEMP TABLE IF NOT EXISTS action_changes (seq INTEGER PRIMARY KEY, tab TEXT, old TEXT, new TEXT); DELETE FROM action_changes',
  )
  for (const table of tables) {
    const json = (prefix: string) =>
      `json_object(${columns[table].flatMap((c) => [`'${c}'`, `${prefix}.${c}`]).join(',')})`
    for (const [event, old, next] of [
      ['INSERT', 'NULL', json('NEW')],
      ['UPDATE', json('OLD'), json('NEW')],
      ['DELETE', json('OLD'), 'NULL'],
    ]) {
      sqlite.exec(
        `CREATE TEMP TRIGGER capture_${table}_${event} AFTER ${event} ON main.${table} BEGIN INSERT INTO action_changes(tab,old,new) VALUES ('${table}',${old},${next}); END`,
      )
    }
  }
  try {
    const result = run()
    if (result instanceof Promise)
      throw new Error('History mutations must be synchronous')
    const merged = new Map<string, Change>()
    for (const log of sqlite
      .prepare('SELECT * FROM action_changes ORDER BY seq')
      .all() as { tab: Table; old: string | null; new: string | null }[]) {
      const before: Row | null = log.old ? JSON.parse(log.old) : null
      const after: Row | null = log.new ? JSON.parse(log.new) : null
      const row = before ?? after!
      const key = rowKey(log.tab, row)
      const prior = merged.get(key)
      merged.set(key, {
        table: log.tab,
        before: prior ? prior.before : before,
        after,
        fields: [],
      })
    }
    const changes = [...merged.values()].filter((c) => {
      c.fields = columns[c.table].filter(
        (k) => k !== 'updated_at' && c.before?.[k] !== c.after?.[k],
      )
      return c.fields.length > 0
    })
    return { result, changes }
  } finally {
    for (const table of tables)
      for (const event of ['INSERT', 'UPDATE', 'DELETE'])
        sqlite.exec(`DROP TRIGGER IF EXISTS capture_${table}_${event}`)
  }
}
function orderingState(planId: string): OrderGuard[] {
  const groups = sqlite
    .prepare('SELECT id FROM category_groups WHERE plan_id=?')
    .all(planId) as { id: string }[]
  return [
    {
      table: 'category_groups',
      column: 'plan_id',
      parent: planId,
      rows: sqlite
        .prepare(
          'SELECT id,position FROM category_groups WHERE plan_id=? ORDER BY id',
        )
        .all(planId) as Row[],
    },
    ...groups.map((g) => ({
      table: 'categories' as const,
      column: 'category_group_id',
      parent: g.id,
      rows: sqlite
        .prepare(
          'SELECT id,position FROM categories WHERE category_group_id=? ORDER BY id',
        )
        .all(g.id) as Row[],
    })),
  ]
}
function affectedOrder(state: OrderGuard[], changes: Change[]) {
  return state.filter((g) =>
    changes.some(
      (c) =>
        c.table === g.table &&
        c.before &&
        c.after &&
        (c.fields.includes('position') ||
          c.fields.includes('category_group_id')) &&
        [c.before[g.column], c.after[g.column]].includes(g.parent),
    ),
  )
}
// Capture structural dependencies, then retain only parents of changed rows.
// Names and other independent fields are deliberately excluded.
function structuralState(planId: string): Guard[] {
  const fields: Partial<Record<Table, string[]>> = {
    plans: ['owner_id', 'currency_code'],
    accounts: ['plan_id', 'type', 'closed'],
    category_groups: ['plan_id', 'kind'],
    categories: ['category_group_id', 'kind', 'credit_account_id'],
    payees: ['plan_id'],
    transfers: ['plan_id'],
  }
  return Object.entries(fields).flatMap(([table, selected]) =>
    (
      sqlite
        .prepare(
          `SELECT id,${selected.join(',')} FROM ${table} WHERE ${table === 'plans' ? 'id' : table === 'categories' ? 'category_group_id IN (SELECT id FROM category_groups WHERE plan_id = ?)' : 'plan_id'}${table === 'categories' ? '' : ' = ?'}`,
        )
        .all(planId) as Row[]
    ).map((row) => ({ table: table as Table, row, fields: selected })),
  )
}
function dependencies(
  state: Guard[],
  changes: Change[],
  side: 'before' | 'after',
  planId: string,
): Guard[] {
  const references: Record<string, Table> = {
    account_id: 'accounts',
    credit_account_id: 'accounts',
    category_id: 'categories',
    category_group_id: 'category_groups',
    payee_id: 'payees',
    transfer_id: 'transfers',
    plan_id: 'plans',
  }
  const needed = new Set<string>(['plans:' + planId])
  for (const c of changes) {
    const row = c[side]
    if (!row) continue
    if (c.table === 'accounts' && c.fields.includes('last_reconciled_at'))
      needed.add('accounts:' + row.id)
    for (const [field, table] of Object.entries(references))
      if (row[field]) needed.add(table + ':' + row[field])
  }
  // Include the group of a referenced Category too.
  for (const guard of state)
    if (
      needed.has(guard.table + ':' + guard.row.id) &&
      guard.table === 'categories'
    )
      needed.add('category_groups:' + guard.row.category_group_id)
  const monetary = changes.some(
    (c) =>
      (c.table === 'accounts' && c.fields.includes('last_reconciled_at')) ||
      ((c.table === 'transactions' || c.table === 'category_assignments') &&
        c.fields.includes('amount')),
  )
  return state
    .filter((g) => needed.has(g.table + ':' + g.row.id))
    .map((g) =>
      g.table === 'plans' && !monetary ? { ...g, fields: ['owner_id'] } : g,
    )
}
function reconciliationLedger(accountId: string, today: string) {
  const rows = sqlite
    .prepare(
      `SELECT t.id,t.date,t.amount,t.category_id,t.payee_id,t.transfer_id,t.memo,t.reconciled,t.reconciliation_adjustment,other.account_id AS counterpart
       FROM transactions t LEFT JOIN transactions other ON other.transfer_id=t.transfer_id AND other.id!=t.id
       WHERE t.account_id=? AND t.date<=? AND t.cleared=1 ORDER BY t.id`,
    )
    .all(accountId, today)
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

export function captureAction<T>(
  owner: string,
  request: Request,
  action: string,
  data: Record<string, unknown>,
  run: () => T,
) {
  return sqlite
    .transaction(() => {
      const fingerprint = encode({ action, data })
      const prior = load(request.requestId)
      if (prior) {
        if (
          prior.owner !== owner ||
          prior.tab !== request.tabId ||
          prior.fingerprint !== fingerprint
        )
          throw new Error('Invalid retry')
        owned(prior.planId, owner)
        return decode<{ value: T; receipt: HistoryReceipt | null }>(
          prior.result,
        )
      }
      const planId = planFor(action, data)
      owned(planId, owner)
      const before = structuralState(planId)
      const orderingBefore = orderingState(planId)
      const reconciliation =
        action === 'reconcileAccount'
          ? {
              accountId: String(data.accountId),
              today: String(data.today),
              before: reconciliationLedger(
                String(data.accountId),
                String(data.today),
              ),
              after: '',
            }
          : undefined
      const { result, changes } = capture(run)
      if (reconciliation)
        reconciliation.after = reconciliationLedger(
          reconciliation.accountId,
          reconciliation.today,
        )

      const orderBefore = affectedOrder(orderingBefore, changes)
      const orderAfter = affectedOrder(orderingState(planId), changes)
      const guardsBefore = dependencies(before, changes, 'before', planId)
      const guardsAfter = dependencies(
        structuralState(planId),
        changes,
        'after',
        planId,
      )
      const labels: Record<string, string> = {
        setCategoryAssigned: 'changed assignment',
        changeTarget: 'changed Category target',
        fundTarget: 'assigned to target',
        moveMoney: 'moved money',
        createAccount: 'created Account',
        updateAccount: 'updated Account',
        createCategoryGroup: 'created Category Group',
        updateCategoryGroupName: 'renamed Category Group',
        createCategory: 'created Category',
        updateCategoryName: 'renamed Category',
        updateCategoryHidden: 'changed Category visibility',
        reorderCategoryGroups: 'reordered Category Groups',
        moveCategory: 'moved Category',
        deleteCategory: 'deleted Category',
        deleteCategoryGroup: 'deleted Category Group',
        createPayee: 'created Payee',
        renamePayee: 'renamed Payee',
        deletePayee: 'deleted Payee',
        updatePlanSettings: 'updated Plan settings',
        reconcileAccount: 'reconciled Account',
        createTransaction: 'created Transaction',
        updateTransaction: 'updated Transaction',
        deleteTransaction: 'deleted Transaction',
      }
      const label = labels[action] ?? action
      const names = changes
        .map((c) => c.after?.name ?? c.before?.name)
        .filter(Boolean)
      for (const change of action === 'combinePayees' ? [] : changes) {
        const row = change.after ?? change.before
        if (!row) continue
        const categoryId = row.category_id
        if (categoryId) {
          const category = sqlite
            .prepare('SELECT name FROM categories WHERE id=?')
            .get(categoryId) as { name: string } | undefined
          if (category) names.push(category.name)
        }
        if (change.table === 'transactions') names.push(String(row.date))
      }
      let description = `${label}${names.length ? ': ' + [...new Set(names)].join(', ') : ''}`
      if (action === 'combinePayees')
        description = `combined ${(data.ids as string[]).length} Payees into ${data.name}`
      if (action === 'bulkTransactions') {
        const count = Number(result)
        description = `${(data.action as { kind: string }).kind === 'delete' ? 'deleted' : 'updated'} ${count} Transaction${count === 1 ? '' : 's'}`
      }
      if (
        action === 'setCategoryAssigned' ||
        action === 'moveMoney' ||
        action === 'fundTarget'
      ) {
        const plan = sqlite
          .prepare('SELECT currency_code FROM plans WHERE id=?')
          .get(planId) as { currency_code: string }
        const money = (amount: unknown) =>
          getNumberFormat('en', {
            style: 'currency',
            currency: plan.currency_code,
          }).format(Number(amount ?? 0) / 1000)
        const assignments = changes.filter(
          (c) => c.table === 'category_assignments',
        )
        description += assignments
          .map(
            (c) =>
              ` (${money(c.before?.amount)} → ${money(c.after?.amount)} in ${(c.after ?? c.before)!.month})`,
          )
          .join('')
      }
      const accountId =
        typeof data.accountId === 'string'
          ? data.accountId
          : (changes.find((c) => c.table === 'transactions')?.before
              ?.account_id ??
            changes.find((c) => c.table === 'transactions')?.after?.account_id)
      const receipt: HistoryReceipt | null = changes.length
        ? {
            id: randomUUID(),
            planId,
            description,
            ...(action === 'combinePayees' && { payees: true }),
            generation: 0,
            accountId:
              action === 'bulkTransactions' && !data.accountId
                ? null
                : typeof accountId === 'string'
                  ? accountId
                  : undefined,
            month:
              typeof data.month === 'string'
                ? data.month
                : ((changes.find((c) => c.table === 'category_assignments')
                    ?.after?.month as string | undefined) ??
                  (changes.find((c) => c.table === 'category_assignments')
                    ?.before?.month as string | undefined)),
          }
        : null
      const response = { value: result, receipt }
      const journal: Journal = {
        reconciliation,
        planId,
        orderBefore,
        orderAfter,
        guardsBefore,
        guardsAfter,
        owner,
        tab: request.tabId,
        fingerprint,
        result: encode(response),
        changes,
        receipt,
        undone: false,
        generation: 0,
      }
      save(request.requestId, journal)
      if (receipt) save(receipt.id, journal)
      return response
    })
    .immediate()
}
function conflict(): never {
  throw new Error(
    'The affected data or its relationships changed in another session. Nothing was reversed.',
  )
}
// Check all incoming references before removing a record. Even an unchanged child
// would otherwise be lost through ON DELETE CASCADE.
function protectDelete(
  change: Change,
  expected: Row,
  affectedKeys: Set<string>,
) {
  const relationships: Partial<Record<Table, [Table, string][]>> = {
    accounts: [
      ['transactions', 'account_id'],
      ['categories', 'credit_account_id'],
    ],
    payees: [['transactions', 'payee_id']],
    category_groups: [['categories', 'category_group_id']],
    categories: [
      ['transactions', 'category_id'],
      ['category_assignments', 'category_id'],
    ],
    transfers: [['transactions', 'transfer_id']],
  }
  for (const [table, column] of relationships[change.table] ?? []) {
    for (const child of sqlite
      .prepare(`SELECT * FROM ${table} WHERE ${column} = ?`)
      .all(expected.id) as Row[]) {
      if (!affectedKeys.has(rowKey(table, child))) conflict()
    }
  }
}
function validatePlan(planId: string, changes: Change[]) {
  if (
    changes.some(
      (c) => c.table === 'plans' && c.fields.includes('currency_code'),
    )
  ) {
    const plan = sqlite
      .prepare('SELECT currency_code FROM plans WHERE id=?')
      .get(planId) as { currency_code: CurrencyCode }
    const amounts = sqlite
      .prepare(
        `SELECT t.amount FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.plan_id=? UNION ALL SELECT x.amount FROM category_assignments x JOIN categories c ON c.id=x.category_id JOIN category_groups g ON g.id=c.category_group_id WHERE g.plan_id=?`,
      )
      .all(planId, planId) as { amount: number }[]
    if (
      amounts.some(
        (row) => !amountMatchesCurrency(row.amount, plan.currency_code),
      )
    )
      conflict()
  }
  const bad = sqlite
    .prepare(
      `SELECT t.id FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN category_groups g ON g.id=c.category_group_id LEFT JOIN payees p ON p.id=t.payee_id LEFT JOIN transfers f ON f.id=t.transfer_id WHERE a.plan_id=? AND ((t.reconciled=1 AND t.cleared=0) OR (t.category_id IS NOT NULL AND (g.plan_id != a.plan_id OR c.kind='credit_payment')) OR (t.payee_id IS NOT NULL AND p.plan_id != a.plan_id) OR (t.transfer_id IS NOT NULL AND (f.plan_id != a.plan_id OR (SELECT count(*) FROM transactions x WHERE x.transfer_id=t.transfer_id)!=2 OR (SELECT sum(amount) FROM transactions x WHERE x.transfer_id=t.transfer_id)!=0 OR (SELECT count(DISTINCT account_id) FROM transactions x WHERE x.transfer_id=t.transfer_id)!=2))) LIMIT 1`,
    )
    .get(planId)
  if (bad) conflict()
}
export function reverseAction(
  owner: string,
  input: Request & {
    receiptId: string
    generation: number
    direction: 'undo' | 'redo'
  },
) {
  return sqlite
    .transaction(() => {
      const previous = load(input.requestId)
      const fingerprint = encode(input)
      if (previous) {
        if (
          previous.owner !== owner ||
          previous.tab !== input.tabId ||
          previous.fingerprint !== fingerprint
        )
          throw new Error('Invalid retry')
        owned(previous.receipt!.planId, owner)
        return decode<HistoryReceipt>(previous.result)
      }
      const journal = load(input.receiptId)
      if (
        !journal ||
        journal.owner !== owner ||
        journal.tab !== input.tabId ||
        !journal.receipt ||
        journal.receipt.id !== input.receiptId
      )
        throw new Error('History entry is unavailable')
      owned(journal.receipt.planId, owner)
      const undo = input.direction === 'undo'
      if (journal.generation !== input.generation || journal.undone === undo)
        conflict()
      const ledgerGuard = journal.reconciliation
      if (
        ledgerGuard &&
        (reconciliationLedger(ledgerGuard.accountId, ledgerGuard.today) !==
          (undo ? ledgerGuard.after : ledgerGuard.before) ||
          !sqlite
            .prepare('SELECT id FROM accounts WHERE id=? AND closed=0')
            .get(ledgerGuard.accountId))
      )
        conflict()
      const changes = journal.changes
      const affectedKeys = new Set(
        changes.flatMap((c) => {
          const row = undo ? c.after : c.before
          return row ? [rowKey(c.table, row)] : []
        }),
      )
      for (const guard of undo ? journal.orderAfter : journal.orderBefore) {
        const rows = sqlite
          .prepare(
            `SELECT id,position FROM ${guard.table} WHERE ${guard.column}=? ORDER BY id`,
          )
          .all(guard.parent)
        if (JSON.stringify(rows) !== JSON.stringify(guard.rows)) conflict()
      }
      for (const guard of undo ? journal.guardsAfter : journal.guardsBefore) {
        const current = read(guard.table, guard.row)
        if (!current || guard.fields.some((k) => current[k] !== guard.row[k]))
          conflict()
      }
      for (const guard of undo ? journal.guardsBefore : journal.guardsAfter) {
        if (
          changes.some(
            (c) =>
              c.table === guard.table &&
              (c.before?.id === guard.row.id || c.after?.id === guard.row.id),
          )
        )
          continue
        const current = read(guard.table, guard.row)
        if (!current || guard.fields.some((k) => current[k] !== guard.row[k]))
          conflict()
      }
      for (const c of changes) {
        const expected = undo ? c.after : c.before,
          target = undo ? c.before : c.after
        const current = read(c.table, (expected ?? target)!)
        if (!expected) {
          if (current) conflict()
          continue
        }
        if (
          !current ||
          (c.table === 'transactions' &&
            current.reconciled !== expected.reconciled) ||
          (target
            ? c.fields
            : columns[c.table].filter((k) => k !== 'updated_at')
          ).some((k) => current[k] !== expected[k])
        )
          conflict()
        if (!target) protectDelete(c, expected, affectedKeys)
        // Changes involving Transactions must not silently move money into an
        // Account that another session closed after the original action.
        // Reassigning only a Payee doesn't move money, even in a closed Account.
        if (
          c.table === 'transactions' &&
          target &&
          !(c.fields.length === 1 && c.fields[0] === 'payee_id')
        ) {
          const account = sqlite
            .prepare('SELECT closed FROM accounts WHERE id=?')
            .get(target.account_id) as { closed: number } | undefined
          if (
            account?.closed &&
            !changes.some(
              (x) =>
                x.table === 'accounts' &&
                (undo ? x.before : x.after)?.id === target.account_id,
            )
          )
            conflict()
        }
      }
      sqlite.pragma('defer_foreign_keys = ON')
      // Remove dependents first, then insert parents, then update references.
      // Defer FK constraints so category reassignment/restoration is atomic.
      for (const c of [...changes].sort(
        (a, b) => tables.indexOf(a.table) - tables.indexOf(b.table),
      )) {
        const expected = undo ? c.after : c.before,
          target = undo ? c.before : c.after
        if (!target) continue
        if (!expected)
          sqlite
            .prepare(
              `INSERT INTO ${c.table} (${columns[c.table].join(',')}) VALUES (${columns[c.table].map(() => '?').join(',')})`,
            )
            .run(...columns[c.table].map((k) => target[k]))
        else
          sqlite
            .prepare(
              `UPDATE ${c.table} SET ${c.fields.map((k) => `${k}=?`).join(',')} WHERE ${keys(
                c.table,
              )
                .map((k) => `${k}=?`)
                .join(' AND ')}`,
            )
            .run(
              ...c.fields.map((k) => target[k]),
              ...keys(c.table).map((k) => target[k]),
            )
      }
      for (const c of [...changes].sort(
        (a, b) => tables.indexOf(b.table) - tables.indexOf(a.table),
      )) {
        const expected = undo ? c.after : c.before,
          target = undo ? c.before : c.after
        if (expected && !target)
          sqlite
            .prepare(
              `DELETE FROM ${c.table} WHERE ${keys(c.table)
                .map((k) => `${k}=?`)
                .join(' AND ')}`,
            )
            .run(...keys(c.table).map((k) => expected[k]))
      }
      validatePlan(journal.receipt.planId, changes)
      journal.undone = undo
      journal.generation++
      journal.receipt.generation = journal.generation
      save(input.receiptId, journal)
      save(input.requestId, {
        ...journal,
        fingerprint,
        result: encode(journal.receipt),
      })
      return journal.receipt
    })
    .immediate()
}
