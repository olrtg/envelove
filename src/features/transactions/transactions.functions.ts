import { z } from 'zod'
import { historyInput } from '#/features/history/history.schemas'
import { captureAction } from '#/features/history/history.server'
import { savedAction } from '#/features/history/history-state'
import { createServerFn } from '@tanstack/react-start'
import {
  setResponseHeader,
  setResponseStatus,
} from '@tanstack/react-start/server'

import { requireUser } from '#/lib/auth-session.server'

import {
  bulkTransactionSchema,
  createTransactionSchema,
  deleteTransactionSchema,
  transactionDateSchema,
  registerPageSchema,
  transactionRegisterSchema,
  updateTransactionSchema,
} from './transaction.schemas'
import {
  applyBulkTransactionAction,
  deleteOwnedTransaction,
  reconcileOwnedAccount,
  findRegisterPage,
  findTransactionRegisterByOwner,
  insertOwnedTransaction,
  updateOwnedTransaction,
} from './transactions.server'
import { currentDayInZone } from './transaction-money'
import type { MutationPayload, MutationResult } from './transactions.server'

export const getTransactionRegister = createServerFn({ method: 'GET' })
  .validator(
    registerPageSchema
      .omit({ after: true })
      .extend({ review: z.boolean().optional() }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    const register = await findTransactionRegisterByOwner({
      ownerId: user.id,
      ...data,
    })

    if (!register) {
      setResponseStatus(404)
      throw new Error('Account not found')
    }

    return register
  })

export const getRegisterPage = createServerFn({ method: 'GET' })
  .validator(registerPageSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    return findRegisterPage({ ...data, ownerId: user.id })
  })

const createTransactionRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(createTransactionSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'createTransaction', data, () => {
      const result = insertOwnedTransaction({
        ownerId: user.id,
        ...data,
        today: currentDayInZone(data.timeZone),
      })

      return unwrapMutation(result)
    })
  })

const updateTransactionRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(updateTransactionSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'updateTransaction', data, () => {
      const result = updateOwnedTransaction({
        ownerId: user.id,
        ...data,
        today: currentDayInZone(data.timeZone),
      })

      return unwrapMutation(result)
    })
  })

const deleteTransactionRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(deleteTransactionSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'deleteTransaction', data, () => {
      const result = deleteOwnedTransaction({ ownerId: user.id, ...data })

      return unwrapMutation(result)
    })
  })

function unwrapMutation(result: MutationResult): MutationPayload {
  if (result.status === 'ok') return result.payload

  if (result.status === 'account_closed') {
    setResponseStatus(409)
    throw new Error('Account is closed')
  }

  if (result.status === 'invalid_category') {
    setResponseStatus(400)
    throw new Error('Category is not available for this Transaction')
  }

  if (result.status === 'invalid_payee') {
    setResponseStatus(400)
    throw new Error('Payee does not belong to this Plan')
  }

  if (result.status === 'invalid_account') {
    setResponseStatus(400)
    throw new Error('Account does not belong to this Plan')
  }

  if (result.status === 'invalid_amount') {
    setResponseStatus(400)
    throw new Error('Amount does not match the Plan currency precision')
  }

  if (result.status === 'invalid_cleared') {
    setResponseStatus(400)
    throw new Error('A future Transfer cannot have a Cleared side')
  }

  if (result.status === 'confirmation_required') {
    setResponseStatus(409)
    throw new Error(
      'The Transaction changed. Review it and confirm the proposed change.',
    )
  }

  if (result.status === 'integrity_error') {
    setResponseStatus(409)
    throw new Error('Transfer integrity check failed')
  }

  setResponseStatus(404)
  throw new Error('Transaction not found')
}

export const createTransaction = savedAction(createTransactionRequest)

export const updateTransaction = savedAction(updateTransactionRequest)

const bulkRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(bulkTransactionSchema))
  .handler(async ({ data: { value, ...request } }) => {
    const user = await requireUser()
    return captureAction(user.id, request, 'bulkTransactions', value, () =>
      applyBulkTransactionAction(user.id, value),
    )
  })
export const bulkTransactions = savedAction(bulkRequest, {
  retryFromForm: true,
})

export const deleteTransaction = savedAction(deleteTransactionRequest, {
  retryFromForm: true,
})

const reconcileRequest = createServerFn({ method: 'POST' })
  .validator(
    historyInput(
      transactionRegisterSchema.extend({
        target: z.number().int().safe(),
        adjust: z.boolean(),
        version: z.string(),
        today: transactionDateSchema,
        timeZone: z.string().max(100),
      }),
    ),
  )
  .handler(async ({ data: { value, ...request } }) => {
    const user = await requireUser()
    return captureAction(user.id, request, 'reconcileAccount', value, () =>
      reconcileOwnedAccount({ ...value, ownerId: user.id }),
    )
  })
export const reconcileAccount = savedAction(reconcileRequest, {
  retryFromForm: true,
})
