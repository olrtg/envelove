import type { TransactionMutationFields } from './transaction.schemas'

type Entry = {
  id: string
  accountId: string
  transferId: string | null
  payeeId: string | null
  categoryId: string | null
  amount: number
  date: string
  memo: string | null
  cleared: boolean
  reconciled: boolean
  updatedAt: Date
}

function entryState(row: Entry) {
  return [
    row.id,
    row.accountId,
    row.transferId,
    row.payeeId,
    row.categoryId,
    row.amount,
    row.date,
    row.memo,
    row.cleared,
    row.reconciled,
    row.updatedAt.getTime(),
  ]
}

type ReviewedBalance = {
  rows: Array<Entry & { counterpartAccountId: string | null }>
  last: Date | null
  today: string
  currency: string
  accountType: string
}

export function reconciliationSnapshot({
  rows,
  last,
  today,
  currency,
  accountType,
}: ReviewedBalance) {
  return JSON.stringify([
    today,
    currency,
    accountType,
    last?.getTime(),
    rows
      .filter((row) => row.date <= today && row.cleared)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => [...entryState(row), row.counterpartAccountId]),
  ])
}

// Only the digest travels with the completion request and its operation receipt.
export async function reconciliationVersion(balance: ReviewedBalance) {
  const bytes = new TextEncoder().encode(reconciliationSnapshot(balance))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

type EditableEntry = Entry & {
  counterpartAccountId: string | null
  counterpartReconciled: boolean
}
export function reconciliationWarning(
  row: EditableEntry,
  edit: TransactionMutationFields & { accountId: string },
) {
  const payeeChanged =
    edit.payee.kind === 'transfer'
      ? edit.payee.accountId !== row.counterpartAccountId
      : !!row.transferId ||
        edit.payee.kind === 'create' ||
        edit.payee.payeeId !== row.payeeId
  const amountChanged = row.amount !== edit.amount
  if (
    row.counterpartReconciled &&
    (amountChanged || payeeChanged || row.accountId !== edit.accountId)
  )
    return 'transfer'
  if (row.reconciled && (amountChanged || payeeChanged)) return 'transaction'
  return null
}

export function confirmationKey(
  row: EditableEntry,
  edit?: TransactionMutationFields & {
    accountId: string
    futureDraftDate?: string
  },
) {
  return JSON.stringify([
    entryState(row),
    row.counterpartAccountId,
    row.counterpartReconciled,
    edit && [
      edit.accountId,
      edit.amount,
      edit.categoryId,
      edit.date,
      edit.futureDraftDate,
      edit.memo,
      edit.cleared,
      edit.payee.kind,
      edit.payee.kind === 'transfer'
        ? edit.payee.accountId
        : edit.payee.kind === 'ordinary'
          ? edit.payee.payeeId
          : edit.payee.name,
    ],
  ])
}
