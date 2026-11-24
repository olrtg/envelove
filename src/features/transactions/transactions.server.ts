import { alias } from 'drizzle-orm/sqlite-core'
import { createHash } from 'node:crypto'
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  lte,
  ne,
  sql,
} from 'drizzle-orm'

import { db } from '#/db'
import {
  accounts,
  categories,
  categoryGroups,
  payees,
  plans,
  transactions,
  transfers,
} from '#/db/schema'
import { getPayeeNameKey } from '#/features/payees/payee.schemas'
import type { CurrencyCode } from '#/lib/country-profiles'
import { createId } from '#/lib/id'

import { accountTypeDetails } from '../accounts/account-types'
import {
  confirmationKey,
  reconciliationSnapshot,
  reconciliationWarning,
} from './reconciliation'
import { amountMatchesCurrency, currentDayInZone } from './transaction-money'
import {
  getOppositeTransferSide,
  getTransferSide,
  isValidTransferPair,
  sortRegisterTransactions,
} from './transfer-logic'
import type {
  BulkTransactionInput,
  RegisterPageInput,
  TransactionMutationFields,
} from './transaction.schemas'

type TransactionRow = typeof transactions.$inferSelect
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type OrdinaryPayeeInput = Exclude<
  TransactionMutationFields['payee'],
  { kind: 'transfer' }
>

export type RegisterTransaction = TransactionRow & {
  counterpartReconciled: boolean
  counterpartAccountId: string | null
  payeeName: string | null
}

export type PayeeOption = Pick<typeof payees.$inferSelect, 'id' | 'name'>

export type MutationFailure =
  | 'account_closed'
  | 'confirmation_required'
  | 'integrity_error'
  | 'invalid_account'
  | 'invalid_amount'
  | 'invalid_category'
  | 'invalid_cleared'
  | 'invalid_payee'
  | 'not_found'

export type MutationPayload = {
  transactions: Array<RegisterTransaction>
  removedTransactionIds: Array<string>
  payees: Array<PayeeOption>
}

export type MutationResult =
  { status: 'ok'; payload: MutationPayload } | { status: MutationFailure }

type OwnedAccount = {
  id: string
  planId: string
  closed: boolean
  currencyCode: CurrencyCode
}

type OwnedTransaction = TransactionRow & {
  planId: string
  closed: boolean
  currencyCode: CurrencyCode
}

type OwnedTransferRow = TransactionRow & {
  accountClosed: boolean
  accountPlanId: string
  transferPlanId: string
  currencyCode: CurrencyCode
}

async function findRegisterOptions({
  ownerId,
  planId,
}: {
  ownerId: string
  planId: string
}) {
  const planRows = await db
    .select({
      id: plans.id,
      countryCode: plans.countryCode,
      currencyCode: plans.currencyCode,
      defaultTransactionCleared: plans.defaultTransactionCleared,
      hideAfterReconciliation: plans.hideAfterReconciliation,
    })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
    .limit(1)

  const plan = planRows.at(0)
  if (!plan) return null

  const accountsQuery = db
    .select({
      id: accounts.id,
      lastReconciledAt: accounts.lastReconciledAt,
      name: accounts.name,
      type: accounts.type,
      closed: accounts.closed,
    })
    .from(accounts)
    .where(eq(accounts.planId, planId))
    .orderBy(asc(accounts.createdAt), asc(accounts.id))

  const groupsQuery = db
    .select()
    .from(categoryGroups)
    .where(eq(categoryGroups.planId, planId))
    .orderBy(asc(categoryGroups.position), asc(categoryGroups.createdAt))

  const categoryRowsQuery = db
    .select({
      id: categories.id,
      categoryGroupId: categories.categoryGroupId,
      name: categories.name,
      kind: categories.kind,
      hidden: categories.hidden,
      position: categories.position,
    })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .where(eq(categoryGroups.planId, planId))
    .orderBy(asc(categories.position), asc(categories.createdAt))

  const payeeRowsQuery = findPlanPayeeOptions(planId)

  const [accountRows, groups, categoryRows, payeeRows] = await Promise.all([
    accountsQuery,
    groupsQuery,
    categoryRowsQuery,
    payeeRowsQuery,
  ])

  return {
    accounts: accountRows,
    plan,
    categoryGroups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      kind: group.kind,
      categories: categoryRows.filter(
        (category) => category.categoryGroupId === group.id,
      ),
    })),
    payees: payeeRows,
  }
}

type OwnedPage = RegisterPageInput & { ownerId: string }

function registerScope(input: OwnedPage) {
  return and(
    eq(accounts.planId, input.planId),
    eq(plans.ownerId, input.ownerId),
    input.accountId ? eq(accounts.id, input.accountId) : undefined,
  )
}

export async function findRegisterPage(input: OwnedPage) {
  const { after, search, hideReconciled, selectedId } = input
  const group = sql`coalesce(${transactions.transferId},${transactions.id})`
  const outflow = sql`coalesce(${transactions.transferSide} = 'outflow',0)`
  const scope = registerScope(input)
  const query = () =>
    db
      .select({ ...getTableColumns(transactions) })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .innerJoin(plans, eq(plans.id, accounts.planId))
  const tuple = sql`(${transactions.date}, ${transactions.createdAt}, ${group}, ${outflow}, ${transactions.id})`
  const read = (boundary?: ReturnType<typeof sql>) =>
    query()
      .leftJoin(payees, eq(payees.id, transactions.payeeId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          scope,
          hideReconciled ? eq(transactions.reconciled, false) : undefined,
          search
            ? sql`instr(lower(coalesce(${transactions.memo},'') || char(10) || coalesce(${payees.name},'') || char(10) || coalesce(${categories.name},'') || char(10) || ${accounts.name} || char(10) || ${transactions.date}),lower(${search})) > 0`
            : undefined,
          boundary,
        ),
      )
      .orderBy(
        desc(transactions.date),
        desc(transactions.createdAt),
        desc(group),
        desc(outflow),
        desc(transactions.id),
      )
      .limit(101)
      .all()
  let rows = read(
    after
      ? sql`${tuple} < (${after.date},${after.createdAt},${after.group},${after.outflow},${after.id})`
      : undefined,
  )
  // Open an old link in chronological context without fetching intervening pages.
  const anchor =
    selectedId &&
    !after &&
    !search &&
    !hideReconciled &&
    !rows.slice(0, 100).some((r) => r.id === selectedId)
      ? query()
          .where(and(scope, eq(transactions.id, selectedId)))
          .get()
      : undefined
  if (anchor)
    rows = read(
      sql`${tuple} <= (${anchor.date},${anchor.createdAt.getTime()},${anchor.transferId ?? anchor.id},${Number(anchor.transferSide === 'outflow')},${anchor.id})`,
    )
  const hasMore = rows.length > 100
  if (hasMore) rows.pop()
  const last = rows.at(-1)
  const next =
    hasMore && last
      ? {
          date: last.date,
          createdAt: last.createdAt.getTime(),
          group: last.transferId ?? last.id,
          outflow: Number(last.transferSide === 'outflow'),
          id: last.id,
        }
      : null
  return {
    anchored: !!anchor,
    transactions: await enrichRegisterTransactions(rows, input.planId),
    next,
  }
}

export async function findTransactionRegisterByOwner(
  input: OwnedPage & { review?: boolean },
) {
  const options = await findRegisterOptions(input)
  if (!options) return null
  const account = options.accounts.find((a) => a.id === input.accountId)
  if (input.accountId && !account) return null
  const summary = db
    .select({
      clearedBalance: sql<number>`coalesce(sum(case when ${transactions.cleared} and ${transactions.date} <= ${input.today} then ${transactions.amount} end),0)`,
      unclearedBalance: sql<number>`coalesce(sum(case when not ${transactions.cleared} and ${transactions.date} <= ${input.today} then ${transactions.amount} end),0)`,
      hasReconciled: sql`coalesce(max(${transactions.reconciled}),0)`.mapWith(
        Boolean,
      ),
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(plans, eq(plans.id, accounts.planId))
    .where(registerScope(input))
    .get()!
  const version =
    account && input.review
      ? createHash('sha256')
          .update(
            reconciliationSnapshot({
              rows: clearedRows(db, account.id, input.today),
              last: account.lastReconciledAt,
              today: input.today,
              currency: options.plan.currencyCode,
              accountType: account.type,
            }),
          )
          .digest('hex')
      : null
  return {
    ...options,
    account: account ?? null,
    summary: { ...summary, version, today: input.today },
    page: await findRegisterPage(input),
  }
}

export function insertOwnedTransaction({
  accountId,
  ownerId,
  today,
  ...fields
}: TransactionMutationFields & {
  accountId: string
  ownerId: string
  today: string
}): MutationResult {
  return db.transaction(
    (tx) => {
      const account = findOwnedAccount(tx, accountId, ownerId)
      if (!account) return { status: 'not_found' } as const
      if (account.closed) return { status: 'account_closed' } as const
      if (fields.date > today && fields.cleared)
        return { status: 'invalid_cleared' } as const
      if (!amountMatchesCurrency(fields.amount, account.currencyCode)) {
        return { status: 'invalid_amount' } as const
      }

      if (fields.payee.kind !== 'transfer') {
        if (
          fields.categoryId &&
          !categoryIsAssignable(tx, fields.categoryId, account.planId)
        ) {
          return { status: 'invalid_category' } as const
        }

        const resolvedPayee = resolveOrdinaryPayee(
          tx,
          fields.payee,
          account.planId,
        )
        if (!resolvedPayee) return { status: 'invalid_payee' } as const

        const transaction = tx
          .insert(transactions)
          .values({
            accountId,
            categoryId: fields.categoryId,
            payeeId: resolvedPayee.payeeId,
            date: fields.date,
            memo: fields.memo,
            amount: fields.amount,
            cleared: fields.cleared,
          })
          .returning()
          .all()
          .at(0)

        if (!transaction) return { status: 'not_found' } as const
        return success(
          [toOrdinaryRegisterTransaction(transaction, resolvedPayee.payeeName)],
          [],
          resolvedPayee.createdPayees,
        )
      }

      const counterpartAccount = findOwnedAccount(
        tx,
        fields.payee.accountId,
        ownerId,
      )
      if (!counterpartAccount) return { status: 'not_found' } as const
      const accountFailure = validateTransferAccounts(
        account,
        counterpartAccount,
      )
      if (accountFailure) return { status: accountFailure } as const
      if (fields.date > today && fields.cleared) {
        return { status: 'invalid_cleared' } as const
      }

      const now = new Date()
      const transferId = createId()
      const transactionId = createId()
      const counterpartId = createId()
      const side = getTransferSide(fields.amount)

      tx.insert(transfers)
        .values({
          id: transferId,
          planId: account.planId,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      const transactionRows = tx
        .insert(transactions)
        .values([
          {
            id: transactionId,
            accountId,
            categoryId: null,
            payeeId: null,
            transferId,
            transferSide: side,
            date: fields.date,
            memo: fields.memo,
            amount: fields.amount,
            cleared: fields.cleared,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: counterpartId,
            accountId: counterpartAccount.id,
            categoryId: null,
            payeeId: null,
            transferId,
            transferSide: getOppositeTransferSide(side),
            date: fields.date,
            memo: fields.memo,
            amount: -fields.amount,
            cleared: false,
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning()
        .all()

      return success(toTransferRegisterTransactions(transactionRows))
    },
    { behavior: 'immediate' },
  )
}

export function updateOwnedTransaction({
  id,
  accountId,
  ownerId,
  today,
  confirmation,
  futureDraftDate,
  confirmUnlink,
  ...fields
}: TransactionMutationFields & {
  id: string
  accountId: string
  ownerId: string
  today: string
  confirmation?: string
  futureDraftDate?: string
  confirmUnlink: boolean
}): MutationResult {
  return db.transaction(
    (tx) => {
      const ownedTransaction = findOwnedTransaction(tx, id, ownerId)
      if (!ownedTransaction) return { status: 'not_found' } as const
      if (ownedTransaction.closed) return { status: 'account_closed' } as const

      const destinationAccount = findOwnedAccount(tx, accountId, ownerId)
      if (!destinationAccount) return { status: 'not_found' } as const
      if (destinationAccount.closed)
        return { status: 'account_closed' } as const
      if (destinationAccount.planId !== ownedTransaction.planId) {
        return { status: 'invalid_account' } as const
      }
      if (
        !amountMatchesCurrency(fields.amount, ownedTransaction.currencyCode)
      ) {
        return { status: 'invalid_amount' } as const
      }

      if (fields.date > today && fields.cleared)
        return { status: 'invalid_cleared' } as const
      const crossedFuture =
        futureDraftDate !== undefined && futureDraftDate > today
      const retainVerified = !crossedFuture && fields.date <= today
      const proposed = { ...fields, accountId, futureDraftDate }
      if (!ownedTransaction.transferId) {
        if (fields.payee.kind === 'create' && ownedTransaction.payeeId) {
          const existing = tx
            .select({ key: payees.nameKey })
            .from(payees)
            .where(eq(payees.id, ownedTransaction.payeeId))
            .get()
          if (existing?.key === getPayeeNameKey(fields.payee.name))
            proposed.payee = {
              kind: 'ordinary',
              payeeId: ownedTransaction.payeeId,
            }
        }
        const row = {
          ...ownedTransaction,
          counterpartAccountId: null,
          counterpartReconciled: false,
        }
        if (
          reconciliationWarning(row, proposed) &&
          confirmation !== confirmationKey(row, proposed)
        )
          return { status: 'confirmation_required' } as const
        return updateOrdinaryTransaction({
          tx,
          retainVerified,
          ownedTransaction,
          destinationAccount,
          ownerId,
          today,
          fields,
        })
      }

      const pair = findOwnedTransferPair(
        tx,
        ownedTransaction.transferId,
        ownerId,
      )
      if (!pair) return { status: 'integrity_error' } as const
      if (pair.some((row) => row.accountClosed)) {
        return { status: 'account_closed' } as const
      }

      const edited = pair.find((row) => row.id === id)
      const counterpart = pair.find((row) => row.id !== id)
      if (!edited || !counterpart) return { status: 'integrity_error' } as const

      const row = {
        ...edited,
        counterpartAccountId: counterpart.accountId,
        counterpartReconciled: counterpart.reconciled,
      }
      if (
        reconciliationWarning(row, proposed) &&
        confirmation !== confirmationKey(row, proposed)
      )
        return { status: 'confirmation_required' } as const
      if (fields.payee.kind !== 'transfer') {
        if (!confirmUnlink) return { status: 'confirmation_required' } as const
        if (
          fields.categoryId &&
          !categoryIsAssignable(tx, fields.categoryId, ownedTransaction.planId)
        ) {
          return { status: 'invalid_category' } as const
        }

        const resolvedPayee = resolveOrdinaryPayee(
          tx,
          fields.payee,
          ownedTransaction.planId,
        )
        if (!resolvedPayee) return { status: 'invalid_payee' } as const

        const cleared =
          (edited.reconciled && retainVerified) ||
          (edited.accountId === destinationAccount.id && fields.cleared)
        if (fields.date > today && cleared) {
          return { status: 'invalid_cleared' } as const
        }

        const saved = tx
          .update(transactions)
          .set({
            accountId: destinationAccount.id,
            categoryId: fields.categoryId,
            payeeId: resolvedPayee.payeeId,
            transferId: null,
            transferSide: null,
            date: fields.date,
            memo: fields.memo,
            amount: fields.amount,
            reconciled: edited.reconciled && retainVerified,
            cleared,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, edited.id))
          .returning()
          .all()
          .at(0)

        if (!saved) return { status: 'not_found' } as const
        tx.delete(transfers).where(eq(transfers.id, edited.transferId!)).run()

        return success(
          [toOrdinaryRegisterTransaction(saved, resolvedPayee.payeeName)],
          [counterpart.id],
          resolvedPayee.createdPayees,
        )
      }

      const counterpartAccount = findOwnedAccount(
        tx,
        fields.payee.accountId,
        ownerId,
      )
      if (!counterpartAccount) return { status: 'not_found' } as const
      const accountFailure = validateTransferAccounts(
        destinationAccount,
        counterpartAccount,
      )
      if (accountFailure) return { status: accountFailure } as const

      const editedCleared =
        (edited.reconciled && retainVerified) ||
        (edited.accountId === destinationAccount.id && fields.cleared)
      const counterpartCleared =
        !crossedFuture &&
        counterpart.cleared &&
        (counterpart.reconciled ||
          counterpart.accountId === counterpartAccount.id)
      if (fields.date > today && (editedCleared || counterpartCleared)) {
        return { status: 'invalid_cleared' } as const
      }

      const side = getTransferSide(fields.amount)
      const now = new Date()
      const savedEdited = tx
        .update(transactions)
        .set({
          accountId: destinationAccount.id,
          categoryId: null,
          payeeId: null,
          transferSide: side,
          date: fields.date,
          memo: fields.memo,
          amount: fields.amount,
          reconciled: edited.reconciled && retainVerified,
          cleared: editedCleared,
          updatedAt: now,
        })
        .where(eq(transactions.id, edited.id))
        .returning()
        .all()
        .at(0)
      const savedCounterpart = tx
        .update(transactions)
        .set({
          accountId: counterpartAccount.id,
          categoryId: null,
          payeeId: null,
          transferSide: getOppositeTransferSide(side),
          date: fields.date,
          memo: fields.memo,
          amount: -fields.amount,
          reconciled: counterpart.reconciled && retainVerified,
          cleared: counterpartCleared,
          updatedAt: now,
        })
        .where(eq(transactions.id, counterpart.id))
        .returning()
        .all()
        .at(0)

      if (!savedEdited || !savedCounterpart) throw new TransferIntegrityError()

      tx.update(transfers)
        .set({ updatedAt: now })
        .where(eq(transfers.id, edited.transferId!))
        .run()

      return success(
        toTransferRegisterTransactions([savedEdited, savedCounterpart]),
      )
    },
    { behavior: 'immediate' },
  )
}

export function applyBulkTransactionAction(
  ownerId: string,
  { planId, accountId, rows, action, timeZone }: BulkTransactionInput,
) {
  const today = currentDayInZone(timeZone)
  return db.transaction(
    (tx) => {
      const selected = rows.map(({ id, confirmation }) => {
        const row = findOwnedTransaction(tx, id, ownerId)
        if (
          !row ||
          row.planId !== planId ||
          (accountId && row.accountId !== accountId)
        )
          throw new Error('Transaction not found')
        const pair = row.transferId
          ? findOwnedTransferPair(tx, row.transferId, ownerId)
          : null
        if (row.transferId && !pair)
          throw new Error('Transfer integrity check failed')
        if (row.closed || pair?.some((r) => r.accountClosed))
          throw new Error('Account is closed')
        const other = pair?.find((r) => r.id !== id)
        if (
          confirmation !==
          confirmationKey({
            ...row,
            counterpartAccountId: other?.accountId ?? null,
            counterpartReconciled: other?.reconciled ?? false,
          })
        )
          throw new Error(
            'The selection changed. Refresh the register and select the transactions again.',
          )
        return { row, other, confirmation }
      })
      const handled = new Set<string>()
      for (const { row, other, confirmation } of selected) {
        if (handled.has(row.id)) continue
        handled.add(row.id)
        if (action.kind === 'delete') {
          const result = deleteOwnedTransaction({
            ownerId,
            id: row.id,
            confirmation,
          })
          if (result.status !== 'ok')
            throw new Error('Could not delete the selection.')
          if (other) handled.add(other.id)
          continue
        }
        if (
          action.kind === 'category' &&
          (other ||
            (action.categoryId &&
              !categoryIsAssignable(tx, action.categoryId, planId)))
        )
          throw new Error('This category cannot be applied to the selection.')
        if (
          action.kind === 'cleared' &&
          (row.reconciled || (row.date > today && action.cleared))
        )
          throw new Error('Cannot change the cleared status of this selection.')
        const patch =
          action.kind === 'category'
            ? { categoryId: action.categoryId }
            : action.kind === 'memo'
              ? { memo: action.memo }
              : { cleared: action.cleared }
        if (
          (action.kind === 'category' &&
            row.categoryId === action.categoryId) ||
          (action.kind === 'memo' && row.memo === action.memo) ||
          (action.kind === 'cleared' && row.cleared === action.cleared)
        )
          continue
        const ids = [row.id]
        if (action.kind === 'memo' && other) {
          ids.push(other.id)
          handled.add(other.id)
        }
        tx.update(transactions)
          .set({ ...patch, updatedAt: new Date() })
          .where(inArray(transactions.id, ids))
          .run()
      }
      return selected.length
    },
    { behavior: 'immediate' },
  )
}

export function deleteOwnedTransaction({
  id,
  ownerId,
  confirmation,
}: {
  id: string
  confirmation?: string
  ownerId: string
}): MutationResult {
  return db.transaction(
    (tx) => {
      const ownedTransaction = findOwnedTransaction(tx, id, ownerId)
      if (!ownedTransaction) return { status: 'not_found' } as const
      if (ownedTransaction.closed) return { status: 'account_closed' } as const

      if (!ownedTransaction.transferId) {
        if (
          ownedTransaction.reconciled &&
          confirmation !==
            confirmationKey({
              ...ownedTransaction,
              counterpartAccountId: null,
              counterpartReconciled: false,
            })
        )
          return { status: 'confirmation_required' } as const
        const transaction = tx
          .delete(transactions)
          .where(eq(transactions.id, id))
          .returning()
          .all()
          .at(0)

        if (!transaction) return { status: 'not_found' } as const
        return success([], [transaction.id])
      }

      const pair = findOwnedTransferPair(
        tx,
        ownedTransaction.transferId,
        ownerId,
      )
      if (!pair) return { status: 'integrity_error' } as const
      if (pair.some((row) => row.accountClosed)) {
        return { status: 'account_closed' } as const
      }

      const other = pair.find((r) => r.id !== id)!
      if (
        (other.reconciled || ownedTransaction.reconciled) &&
        confirmation !==
          confirmationKey({
            ...ownedTransaction,
            counterpartAccountId: other.accountId,
            counterpartReconciled: other.reconciled,
          })
      )
        return { status: 'confirmation_required' } as const
      tx.delete(transfers)
        .where(eq(transfers.id, ownedTransaction.transferId))
        .run()

      return success(
        [],
        pair.map((transaction) => transaction.id),
      )
    },
    { behavior: 'immediate' },
  )
}

function updateOrdinaryTransaction({
  tx,
  ownedTransaction,
  retainVerified,
  destinationAccount,
  ownerId,
  today,
  fields,
}: {
  tx: DatabaseTransaction
  ownedTransaction: OwnedTransaction
  retainVerified: boolean
  destinationAccount: OwnedAccount
  ownerId: string
  today: string
  fields: TransactionMutationFields
}): MutationResult {
  if (fields.payee.kind !== 'transfer') {
    if (
      fields.categoryId &&
      !categoryIsAssignable(
        tx,
        fields.categoryId,
        ownedTransaction.planId,
        ownedTransaction.categoryId,
      )
    ) {
      return { status: 'invalid_category' }
    }

    const resolvedPayee = resolveOrdinaryPayee(
      tx,
      fields.payee,
      ownedTransaction.planId,
    )
    if (!resolvedPayee) return { status: 'invalid_payee' }

    const transaction = tx
      .update(transactions)
      .set({
        accountId: destinationAccount.id,
        categoryId: fields.categoryId,
        payeeId: resolvedPayee.payeeId,
        date: fields.date,
        memo: fields.memo,
        amount: fields.amount,
        reconciled: ownedTransaction.reconciled && retainVerified,
        cleared:
          (ownedTransaction.reconciled && retainVerified) || fields.cleared,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, ownedTransaction.id))
      .returning()
      .all()
      .at(0)

    if (!transaction) return { status: 'not_found' }
    return success(
      [toOrdinaryRegisterTransaction(transaction, resolvedPayee.payeeName)],
      [],
      resolvedPayee.createdPayees,
    )
  }

  const counterpartAccount = findOwnedAccount(
    tx,
    fields.payee.accountId,
    ownerId,
  )
  if (!counterpartAccount) return { status: 'not_found' }
  const accountFailure = validateTransferAccounts(
    destinationAccount,
    counterpartAccount,
  )
  if (accountFailure) return { status: accountFailure }

  const cleared =
    (ownedTransaction.reconciled && retainVerified) ||
    (ownedTransaction.accountId === destinationAccount.id && fields.cleared)
  if (fields.date > today && cleared) {
    return { status: 'invalid_cleared' }
  }

  const transferId = createId()
  const side = getTransferSide(fields.amount)
  const now = new Date()

  tx.insert(transfers)
    .values({
      id: transferId,
      planId: ownedTransaction.planId,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const edited = tx
    .update(transactions)
    .set({
      accountId: destinationAccount.id,
      categoryId: null,
      payeeId: null,
      transferId,
      transferSide: side,
      date: fields.date,
      memo: fields.memo,
      amount: fields.amount,
      reconciliationAdjustment: false,
      startingBalance: false,
      reconciled: ownedTransaction.reconciled && retainVerified,
      cleared,
      updatedAt: now,
    })
    .where(eq(transactions.id, ownedTransaction.id))
    .returning()
    .all()
    .at(0)

  if (!edited) return { status: 'not_found' }

  const counterpart = tx
    .insert(transactions)
    .values({
      id: createId(),
      accountId: counterpartAccount.id,
      categoryId: null,
      payeeId: null,
      transferId,
      transferSide: getOppositeTransferSide(side),
      date: fields.date,
      memo: fields.memo,
      amount: -fields.amount,
      cleared: false,
      createdAt: ownedTransaction.createdAt,
      updatedAt: now,
    })
    .returning()
    .all()
    .at(0)

  if (!counterpart) return { status: 'not_found' }
  return success(toTransferRegisterTransactions([edited, counterpart]))
}

async function enrichRegisterTransactions(
  transactionRows: Array<TransactionRow>,
  planId: string,
) {
  const payeeIds = [
    ...new Set(
      transactionRows.flatMap((transaction) =>
        transaction.payeeId ? [transaction.payeeId] : [],
      ),
    ),
  ]
  const transferIds = [
    ...new Set(
      transactionRows.flatMap((transaction) =>
        transaction.transferId ? [transaction.transferId] : [],
      ),
    ),
  ]

  const payeeRows =
    payeeIds.length > 0
      ? await db
          .select({ id: payees.id, name: payees.name })
          .from(payees)
          .where(and(eq(payees.planId, planId), inArray(payees.id, payeeIds)))
      : []
  const payeeNames = new Map(
    payeeRows.map((payee) => [payee.id, payee.name] as const),
  )

  if (transferIds.length === 0) {
    return sortRegisterTransactions(
      transactionRows.map((transaction) =>
        toOrdinaryRegisterTransaction(
          transaction,
          transaction.payeeId
            ? (payeeNames.get(transaction.payeeId) ?? null)
            : null,
        ),
      ),
    )
  }

  const linkedRows = await db
    .select({ ...getTableColumns(transactions) })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(transfers, eq(transactions.transferId, transfers.id))
    .where(
      and(
        inArray(transactions.transferId, transferIds),
        eq(accounts.planId, planId),
        eq(transfers.planId, planId),
      ),
    )

  const pairs = new Map<string, Array<TransactionRow>>()
  for (const row of linkedRows) {
    if (!row.transferId) throw new TransferIntegrityError()
    const pair = pairs.get(row.transferId) ?? []
    pair.push(row)
    pairs.set(row.transferId, pair)
  }

  const enriched = transactionRows.map((transaction) => {
    if (!transaction.transferId && !transaction.transferSide) {
      return toOrdinaryRegisterTransaction(
        transaction,
        transaction.payeeId
          ? (payeeNames.get(transaction.payeeId) ?? null)
          : null,
      )
    }
    if (!transaction.transferId || !transaction.transferSide) {
      throw new TransferIntegrityError()
    }

    const pair = pairs.get(transaction.transferId)
    if (!pair || !isValidTransferPair(pair)) {
      throw new TransferIntegrityError()
    }
    const counterpart = pair.find((row) => row.id !== transaction.id)
    if (!counterpart) throw new TransferIntegrityError()

    return {
      ...transaction,
      counterpartAccountId: counterpart.accountId,
      counterpartReconciled: counterpart.reconciled,
      payeeName: null,
    }
  })

  return sortRegisterTransactions(enriched)
}

function findOwnedAccount(
  tx: DatabaseTransaction,
  accountId: string,
  ownerId: string,
): OwnedAccount | null {
  return (
    tx
      .select({
        id: accounts.id,
        planId: accounts.planId,
        closed: accounts.closed,
        currencyCode: plans.currencyCode,
      })
      .from(accounts)
      .innerJoin(plans, eq(accounts.planId, plans.id))
      .where(and(eq(accounts.id, accountId), eq(plans.ownerId, ownerId)))
      .limit(1)
      .all()
      .at(0) ?? null
  )
}

function findOwnedTransaction(
  tx: DatabaseTransaction,
  id: string,
  ownerId: string,
): OwnedTransaction | null {
  return (
    tx
      .select({
        ...getTableColumns(transactions),
        planId: accounts.planId,
        closed: accounts.closed,
        currencyCode: plans.currencyCode,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(plans, eq(accounts.planId, plans.id))
      .where(and(eq(transactions.id, id), eq(plans.ownerId, ownerId)))
      .limit(1)
      .all()
      .at(0) ?? null
  )
}

function findOwnedTransferPair(
  tx: DatabaseTransaction,
  transferId: string,
  ownerId: string,
): Array<OwnedTransferRow> | null {
  const rows = tx
    .select({
      ...getTableColumns(transactions),
      accountClosed: accounts.closed,
      accountPlanId: accounts.planId,
      transferPlanId: transfers.planId,
      currencyCode: plans.currencyCode,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(transfers, eq(transactions.transferId, transfers.id))
    .innerJoin(plans, eq(transfers.planId, plans.id))
    .where(and(eq(transfers.id, transferId), eq(plans.ownerId, ownerId)))
    .all()

  if (
    !isValidTransferPair(rows) ||
    rows.some((row) => row.accountPlanId !== row.transferPlanId)
  ) {
    return null
  }

  return rows
}

function categoryIsAssignable(
  tx: DatabaseTransaction,
  categoryId: string,
  planId: string,
  retainedCategoryId: string | null = null,
) {
  const category = tx
    .select({
      id: categories.id,
      kind: categories.kind,
      hidden: categories.hidden,
      groupKind: categoryGroups.kind,
    })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .where(
      and(eq(categories.id, categoryId), eq(categoryGroups.planId, planId)),
    )
    .limit(1)
    .all()
    .at(0)

  return Boolean(
    category &&
    ((category.kind === 'ordinary' && category.groupKind === 'ordinary') ||
      category.kind === 'ready_to_assign') &&
    (!category.hidden || category.id === retainedCategoryId),
  )
}

export function resolveOrdinaryPayee(
  tx: DatabaseTransaction,
  input: OrdinaryPayeeInput,
  planId: string,
): {
  payeeId: string | null
  payeeName: string | null
  createdPayees: Array<PayeeOption>
} | null {
  if (input.kind === 'ordinary') {
    if (!input.payeeId) {
      return { payeeId: null, payeeName: null, createdPayees: [] }
    }

    const payee = tx
      .select({ id: payees.id, name: payees.name })
      .from(payees)
      .where(and(eq(payees.id, input.payeeId), eq(payees.planId, planId)))
      .limit(1)
      .all()
      .at(0)
    if (!payee) return null
    return { payeeId: payee.id, payeeName: payee.name, createdPayees: [] }
  }

  const nameKey = getPayeeNameKey(input.name)
  const inserted = tx
    .insert(payees)
    .values({ planId, name: input.name, nameKey })
    .onConflictDoNothing()
    .returning({ id: payees.id, name: payees.name })
    .all()
    .at(0)

  if (inserted) {
    return {
      payeeId: inserted.id,
      payeeName: inserted.name,
      createdPayees: [inserted],
    }
  }

  const existing = tx
    .select({ id: payees.id, name: payees.name })
    .from(payees)
    .where(and(eq(payees.planId, planId), eq(payees.nameKey, nameKey)))
    .limit(1)
    .all()
    .at(0)
  if (!existing) return null

  return {
    payeeId: existing.id,
    payeeName: existing.name,
    createdPayees: [existing],
  }
}

// Each Payee carries the Category of its most recently saved categorized
// Transaction so a new draft can prefill it.
function findPlanPayeeOptions(planId: string) {
  return db
    .select({
      id: payees.id,
      name: payees.name,
      lastCategoryId: sql<string | null>`(
        select used.category_id from transactions as used
        where used.payee_id = payees.id and used.category_id is not null
        order by used.updated_at desc, used.rowid desc
        limit 1
      )`,
    })
    .from(payees)
    .where(eq(payees.planId, planId))
    .orderBy(asc(payees.name), asc(payees.id))
}

function validateTransferAccounts(
  account: OwnedAccount,
  counterpartAccount: OwnedAccount,
): MutationFailure | null {
  if (account.closed || counterpartAccount.closed) return 'account_closed'
  if (
    account.id === counterpartAccount.id ||
    account.planId !== counterpartAccount.planId
  ) {
    return 'invalid_account'
  }
  return null
}

function toOrdinaryRegisterTransaction(
  transaction: TransactionRow,
  payeeName: string | null,
): RegisterTransaction {
  return {
    ...transaction,
    counterpartAccountId: null,
    counterpartReconciled: false,
    payeeName,
  }
}

function toTransferRegisterTransactions(
  rows: Array<TransactionRow>,
): Array<RegisterTransaction> {
  if (!isValidTransferPair(rows)) {
    throw new TransferIntegrityError()
  }

  return rows.map((transaction) => {
    const counterpart = rows.find((row) => row.id !== transaction.id)
    if (!counterpart) throw new TransferIntegrityError()
    return {
      ...transaction,
      counterpartAccountId: counterpart.accountId,
      counterpartReconciled: counterpart.reconciled,
      payeeName: null,
    }
  })
}

function success(
  transactionRows: Array<RegisterTransaction>,
  removedTransactionIds: Array<string> = [],
  createdPayees: Array<PayeeOption> = [],
): MutationResult {
  return {
    status: 'ok',
    payload: {
      transactions: sortRegisterTransactions(transactionRows),
      removedTransactionIds,
      payees: createdPayees,
    },
  }
}

class TransferIntegrityError extends Error {
  constructor() {
    super('Transfer integrity check failed')
  }
}

function clearedRows(
  tx: Pick<typeof db, 'select'>,
  accountId: string,
  today: string,
) {
  const opposite = alias(transactions, 'opposite')
  return tx
    .select({
      ...getTableColumns(transactions),
      counterpartAccountId: opposite.accountId,
    })
    .from(transactions)
    .leftJoin(
      opposite,
      and(
        eq(opposite.transferId, transactions.transferId),
        ne(opposite.id, transactions.id),
      ),
    )
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.cleared, true),
        lte(transactions.date, today),
      ),
    )
    .all()
}

export function reconcileOwnedAccount(input: {
  ownerId: string
  planId: string
  accountId: string
  target: number
  adjust: boolean
  version: string
  today: string
  timeZone: string
}) {
  return db.transaction(
    (tx) => {
      const account = tx
        .select({
          ...getTableColumns(accounts),
          currencyCode: plans.currencyCode,
        })
        .from(accounts)
        .innerJoin(plans, eq(accounts.planId, plans.id))
        .where(
          and(
            eq(accounts.id, input.accountId),
            eq(plans.id, input.planId),
            eq(plans.ownerId, input.ownerId),
          ),
        )
        .get()
      if (
        !account ||
        account.closed ||
        accountTypeDetails[account.type].group === 'loans'
      )
        throw new Error('Account is unavailable for reconciliation.')
      const today = currentDayInZone(input.timeZone)
      if (today !== input.today)
        throw new Error(
          'The current day changed. Review the register and try again.',
        )
      const eligible = and(
        eq(transactions.accountId, account.id),
        eq(transactions.cleared, true),
        lte(transactions.date, today),
      )
      const current = clearedRows(tx, account.id, today)
      const snapshot = reconciliationSnapshot({
        rows: current,
        last: account.lastReconciledAt,
        today,
        currency: account.currencyCode,
        accountType: account.type,
      })
      if (createHash('sha256').update(snapshot).digest('hex') !== input.version)
        throw new Error(
          'The register changed. Review the updated balance and try again.',
        )
      if (
        !Number.isSafeInteger(input.target) ||
        !amountMatchesCurrency(input.target, account.currencyCode)
      )
        throw new Error('Review the target balance and adjustment.')
      const difference = Number(
        BigInt(input.target) -
          current.reduce((sum, row) => sum + BigInt(row.amount), 0n),
      )
      if (
        !Number.isSafeInteger(difference) ||
        Boolean(difference) !== input.adjust
      )
        throw new Error('Review the target balance and adjustment.')
      const now = new Date(
        Math.max(Date.now(), (account.lastReconciledAt?.getTime() ?? 0) + 1),
      )
      const adjustment: MutationPayload = {
        transactions: [],
        removedTransactionIds: [],
        payees: [],
      }
      if (difference) {
        const tracking = accountTypeDetails[account.type].group === 'tracking'
        const category = tracking
          ? null
          : tx
              .select({ id: categories.id })
              .from(categories)
              .innerJoin(
                categoryGroups,
                eq(categories.categoryGroupId, categoryGroups.id),
              )
              .where(
                and(
                  eq(categoryGroups.planId, account.planId),
                  eq(categories.kind, 'ready_to_assign'),
                ),
              )
              .get()
        if (!tracking && !category)
          throw new Error('Ready to Assign is unavailable.')
        const payee = resolveOrdinaryPayee(
          tx,
          { kind: 'create', name: 'Reconciliation Balance Adjustment' },
          account.planId,
        )
        if (!payee) throw new Error('Adjustment Payee is unavailable.')
        const saved = tx
          .insert(transactions)
          .values({
            accountId: account.id,
            date: today,
            amount: difference,
            categoryId: category?.id ?? null,
            payeeId: payee.payeeId,
            memo: 'Reconciliation balance adjustment',
            cleared: true,
            reconciled: true,
            reconciliationAdjustment: true,
          })
          .returning()
          .get()
        adjustment.transactions.push(
          toOrdinaryRegisterTransaction(saved, payee.payeeName),
        )
        adjustment.payees = payee.createdPayees
      }
      const verifiedIds = current
        .filter((row) => !row.reconciled)
        .map((row) => row.id)
      const marked = tx
        .update(transactions)
        .set({ reconciled: true, updatedAt: now })
        .where(and(eligible, eq(transactions.reconciled, false)))
        .run()
      if (marked.changes !== verifiedIds.length)
        throw new Error(
          'Could not mark all reviewed entries. Please try again.',
        )
      const recorded = tx
        .update(accounts)
        .set({ lastReconciledAt: now })
        .where(eq(accounts.id, account.id))
        .run()
      if (recorded.changes !== 1)
        throw new Error('Could not record reconciliation. Please try again.')
      return {
        completedAt: now,
        adjustment,
        verifiedIds,
      }
    },
    { behavior: 'immediate' },
  )
}
