import type { TransferSide } from '#/lib/transfer'

export type TransferPairRow = {
  accountId: string
  amount: number
  categoryId: string | null
  date: string
  memo: string | null
  payeeId: string | null
  transferId: string | null
  transferSide: TransferSide | null
}

export function getTransferSide(amount: number): TransferSide {
  return amount < 0 ? 'outflow' : 'inflow'
}

export function getOppositeTransferSide(side: TransferSide): TransferSide {
  return side === 'outflow' ? 'inflow' : 'outflow'
}

export function isValidTransferPair(rows: Array<TransferPairRow>) {
  if (rows.length !== 2) return false

  const [left, right] = rows
  if (!left.transferId || left.transferId !== right.transferId) return false
  if (!left.transferSide || !right.transferSide) return false
  if (left.transferSide === right.transferSide) return false
  if (left.accountId === right.accountId) return false
  if (left.categoryId || right.categoryId || left.payeeId || right.payeeId) {
    return false
  }
  if (left.date !== right.date || left.memo !== right.memo) return false
  if (left.amount !== -right.amount) return false

  return (
    getTransferSide(left.amount) === left.transferSide &&
    getTransferSide(right.amount) === right.transferSide
  )
}

export function sortRegisterTransactions<
  TTransaction extends {
    createdAt: Date
    date: string
    id: string
    transferId: string | null
    transferSide: TransferSide | null
  },
>(transactionRows: Array<TTransaction>) {
  return [...transactionRows].sort((left, right) => {
    const dateComparison = right.date.localeCompare(left.date)
    if (dateComparison !== 0) return dateComparison

    const creationComparison =
      new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf()
    if (creationComparison !== 0) return creationComparison

    const leftGroup = left.transferId ?? left.id
    const rightGroup = right.transferId ?? right.id
    // Match SQLite's binary keyset order, including mixed-case IDs.
    const groupComparison =
      leftGroup < rightGroup ? 1 : leftGroup > rightGroup ? -1 : 0
    if (groupComparison !== 0) return groupComparison

    if (left.transferId && right.transferId) {
      if (left.transferSide === 'outflow') return -1
      if (right.transferSide === 'outflow') return 1
    }

    return left.id < right.id ? 1 : left.id > right.id ? -1 : 0
  })
}
