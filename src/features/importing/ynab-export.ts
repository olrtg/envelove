import { parse } from 'csv-parse/browser/esm/sync'
import { unzipSync } from 'fflate'
import { transactionDateSchema } from '#/features/transactions/transaction.schemas'
import type { CurrencyCode } from '#/lib/country-profiles'
import type { AccountType } from '#/features/accounts/account.schemas'
import { maxImportRows, maxSnapshotBytes } from './ynab-limits'

const monthNames = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
function readTable(bytes: Uint8Array, delimiter: string, required: string[]) {
  const rows = parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
    bom: true,
    delimiter,
    skip_empty_lines: true,
    max_record_size: 32 * 1024,
    on_record(row, { records }) {
      if (records > maxImportRows + 1)
        throw new Error('This table exceeds the 150,000-row import limit.')
      return row
    },
  })
  const headers = rows.shift()
  if (
    !headers ||
    required.some((h) => !headers.includes(h)) ||
    new Set(headers).size !== headers.length
  )
    throw new Error(
      'Expected the English Plan and Register column headers from YNAB’s Export Plan.',
    )
  return rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]])),
  )
}

export function readYnabExport(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > maxSnapshotBytes)
    throw new Error('Choose a YNAB ZIP up to 32 MB.')
  let total = 0,
    entries = 0
  const files = unzipSync(bytes, {
    filter(entry) {
      if (
        !/(?:^| - )(?:Plan|Budget|Register)\.(?:csv|tsv)$/i.test(
          entry.name.split('/').pop()!,
        ) ||
        entry.name.startsWith('__MACOSX/')
      )
        return false
      total += Math.max(entry.originalSize, entry.size)
      if (++entries > 2 || total > maxSnapshotBytes)
        throw new Error(
          'Expected one Plan and one Register, up to 32 MB uncompressed.',
        )
      return true
    },
  })
  const tables = Object.entries(files).map(([path, data]) => ({
    name: path.split('/').pop()!,
    data,
  }))
  const p = tables.find((t) =>
      /(?:^| - )(?:Plan|Budget)\.(csv|tsv)$/i.test(t.name),
    ),
    r = tables.find((t) => /(?:^| - )Register\.(csv|tsv)$/i.test(t.name))
  if (
    !p ||
    !r ||
    p.name.replace(/(?:Plan|Budget)(\.(?:csv|tsv))$/i, 'Register$1') !== r.name
  )
    throw new Error(
      'Choose the original YNAB Export Plan ZIP containing a matching Plan and Register.',
    )
  const delimiter = p.name.toLowerCase().endsWith('.tsv') ? '\t' : ','
  const plan = readTable(p.data, delimiter, [
      'Month',
      'Category Group',
      'Category',
    ]),
    register = readTable(r.data, delimiter, [
      'Account',
      'Date',
      'Payee',
      'Category Group',
      'Category',
      'Memo',
      'Outflow',
      'Inflow',
      'Cleared',
    ])
  if (!plan.length || !('Assigned' in plan[0] || 'Budgeted' in plan[0]))
    throw new Error(
      'The export needs plan months with Assigned or Budgeted amounts.',
    )
  const name = p.name
    .replace(
      /(?: as of \d{4}-\d\d-\d\d.*?)? - (?:Plan|Budget)\.(?:csv|tsv)$/i,
      '',
    )
    .replace(/^(?:Plan|Budget)\.(?:csv|tsv)$/i, 'Imported plan')
  const cards = new Set(
    plan
      .filter((row) => row['Category Group'] === 'Credit Card Payments')
      .map((row) => row.Category),
  )
  const accounts = [
    ...new Set([...register.map((row) => row.Account), ...cards]),
  ]
  if (accounts.includes(''))
    throw new Error('A register entry has no account name.')
  return {
    name,
    plan,
    register,
    accounts,
    cards,
    decimal: delimiter === '\t' ? ',' : '.',
  }
}
export type NativeExport = ReturnType<typeof readYnabExport>
export type DateOrder = 'DMY' | 'MDY' | 'YMD'
function readDate(value: string, order: DateOrder) {
  const parts = value
    .trim()
    .match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/)
    ?.slice(1)
  if (parts) {
    const [y, m, d] =
      order === 'YMD'
        ? parts
        : order === 'DMY'
          ? [parts[2], parts[1], parts[0]]
          : [parts[2], parts[0], parts[1]]
    const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    if (transactionDateSchema.safeParse(date).success) return date
  }
  throw new Error(
    `Date “${value}” does not match ${order}. Check your YNAB date format.`,
  )
}
function readMonth(value: string) {
  const match = /^([A-Za-z]{3,9}) (\d{4})$/.exec(value)
  const m = monthNames.indexOf(match?.[1].slice(0, 3) ?? '') + 1
  if (!match || !m) throw new Error(`Unsupported plan month: ${value}.`)
  return `${match[2]}-${String(m).padStart(2, '0')}-01`
}
function amount(value: string, decimal: string) {
  if (!value.trim()) return 0
  // The symbol and grouping are display settings, not a currency identifier.
  const bracketed = value.trim().startsWith('(') && value.trim().endsWith(')')
  const input = bracketed ? value.trim().slice(1, -1) : value
  const match =
    /^\s*(-?)\s*(?:[\p{L}\p{Sc}]+\.?\s*)?(-?)(\d[\d.,'’\u00a0\u202f ]*)(?:\s*[\p{L}\p{Sc}]+\.?)?\s*$/u.exec(
      input,
    )
  if (!match || (match[1] && match[2]) || (bracketed && (match[1] || match[2])))
    throw new Error(`Unsupported amount: ${value}.`)
  const [integer, fraction = '', ...extra] = match[3].trim().split(decimal)
  const group = decimal === ',' ? '\\.' : ','
  if (
    extra.length > 0 ||
    !/^\d{0,3}$/.test(fraction) ||
    !new RegExp(
      `^(?:\\d+|\\d{1,3}(?:[${group}'’\\s]\\d{3})+|\\d{1,2}(?:[${group}]\\d{2})+[${group}]\\d{3})$`,
    ).test(integer)
  )
    throw new Error(
      `Amount “${value}” does not match the export number format.`,
    )
  const result = Number(
    BigInt(integer.replace(/\D/g, '')) * 1000n +
      BigInt(fraction.padEnd(3, '0')),
  )
  if (!Number.isSafeInteger(result))
    throw new Error('An amount is too large to import exactly.')
  return match[1] || match[2] || bracketed ? -result : result
}

// Translate the two YNAB files to the same input shape as a full-plan download.
// The file never leaves the browser; the server still validates all submitted data.
export function exportSnapshot(
  source: NativeExport,
  currency: CurrencyCode,
  order: DateOrder,
  types: ReadonlyMap<string, AccountType>,
) {
  const groups = new Map<
    string,
    { id: string; name: string; hidden: boolean; deleted: false }
  >()
  const cats = new Map<
    string,
    {
      id: string
      name: string
      category_group_id: string
      hidden: boolean
      deleted: false
    }
  >()
  const named = (name: string) => ({ id: name, name, deleted: false as const })
  function category(group: string, name: string) {
    if (!name) return null
    if (!group) throw new Error(`Missing category group for ${name}.`)
    if (
      group === 'Inflow' &&
      ['Ready to Assign', 'To be Budgeted'].includes(name)
    )
      group = 'Internal Master Category'
    const key = JSON.stringify([group, name])
    groups.set(group, { ...named(group), hidden: false })
    cats.set(key, {
      ...named(name),
      id: key,
      category_group_id: group,
      hidden: group === 'Hidden Categories',
    })
    return key
  }
  const accounts = new Map(
    source.accounts.map((name) => {
      const type = types.get(name)
      if (!type) throw new Error(`Choose an account type for ${name}.`)
      return [
        name,
        { ...named(name), type, closed: false, balance: 0, cleared_balance: 0 },
      ]
    }),
  )
  const monthsByDate = new Map<string, Map<string, number>>()
  for (const row of source.plan) {
    const date = readMonth(row.Month),
      id = category(row['Category Group'], row.Category)
    if (!id) throw new Error(`A plan category is missing in ${row.Month}.`)
    let assignments = monthsByDate.get(date)
    if (!assignments) {
      assignments = new Map()
      monthsByDate.set(date, assignments)
    }
    if (assignments.has(id))
      throw new Error(
        `Duplicate category in ${row.Month}: ${row.Category}. Use the full JSON snapshot to distinguish it.`,
      )
    assignments.set(
      id,
      amount('Assigned' in row ? row.Assigned : row.Budgeted, source.decimal),
    )
  }
  const payees = new Set<string>(),
    candidates = new Map<string, string[]>()
  const lines = source.register.map((row, i) => {
    const account = accounts.get(row.Account)!,
      date = readDate(row.Date, order),
      cleared = row.Cleared.trim().toLowerCase()
    if (!['uncleared', 'cleared', 'reconciled'].includes(cleared))
      throw new Error(`Unknown cleared status on register row ${i + 2}.`)
    const incoming = amount(row.Inflow, source.decimal),
      outgoing = amount(row.Outflow, source.decimal)
    if (incoming < 0 || outgoing < 0 || (incoming && outgoing))
      throw new Error(
        `Expected one inflow or outflow on register row ${i + 2}.`,
      )
    const net = incoming - outgoing,
      id = String(i),
      to = /^(?:Transfer|Payment)\s*:\s*(.+)$/i.exec(row.Payee)?.[1]
    const other = to && accounts.has(to) ? to : null
    if (other) {
      const key = JSON.stringify([date, row.Account, other, net])
      const ids = candidates.get(key) ?? []
      ids.push(id)
      candidates.set(key, ids)
    } else if (row.Payee) payees.add(row.Payee)
    account.balance += net
    if (cleared !== 'uncleared') account.cleared_balance += net
    return {
      id,
      date,
      amount: net,
      account_id: row.Account,
      transfer_account_id: other,
      transfer_transaction_id: null as string | null,
      payee_id: other ? null : row.Payee || null,
      category_id: category(row['Category Group'], row.Category),
      memo: row.Memo,
      cleared,
      deleted: false,
    }
  })
  for (const l of lines) {
    if (!l.transfer_account_id) continue
    const forward = candidates.get(
      JSON.stringify([l.date, l.account_id, l.transfer_account_id, l.amount]),
    )
    const reverse = candidates.get(
      JSON.stringify([l.date, l.transfer_account_id, l.account_id, -l.amount]),
    )
    if (forward?.length === 1 && reverse?.length === 1)
      l.transfer_transaction_id = reverse[0]
  }
  const months = [...monthsByDate].map(([month, rows]) => ({
    month,
    deleted: false,
    categories: [...rows].map(([id, budgeted]) => ({
      id,
      budgeted,
      deleted: false,
    })),
  }))
  return JSON.stringify({
    data: {
      plan: {
        name: source.name,
        currency_format: { iso_code: currency },
        first_month: [...monthsByDate.keys()].sort()[0],
        accounts: [...accounts.values()],
        category_groups: [...groups.values()],
        categories: [...cats.values()],
        months,
        payees: [...payees].map(named),
        transactions: lines,
        subtransactions: [],
        scheduled_transactions: [],
      },
    },
  })
}
