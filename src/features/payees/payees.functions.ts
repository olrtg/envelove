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
  combinePayeesSchema,
  createPayeeSchema,
  deletePayeeSchema,
  payeePlanSchema,
  renamePayeeSchema,
} from './payee.schemas'
import {
  combineOwnedPayees,
  deleteOwnedPayee,
  findPayeesByPlanOwner,
  insertOwnedPayee,
  renameOwnedPayee,
} from './payees.server'
import type { DeletePayeeResult, PayeeMutationResult } from './payees.server'

export const getPayees = createServerFn({ method: 'GET' })
  .validator(payeePlanSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    const payees = await findPayeesByPlanOwner(data.planId, user.id)

    if (!payees) {
      setResponseStatus(404)
      throw new Error('Plan not found')
    }

    return payees
  })

const createPayeeRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(createPayeeSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'createPayee', data, () => {
      return unwrapPayeeMutation(
        insertOwnedPayee({ ownerId: user.id, ...data }),
      )
    })
  })

const renamePayeeRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(renamePayeeSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'renamePayee', data, () => {
      return unwrapPayeeMutation(
        renameOwnedPayee({ ownerId: user.id, ...data }),
      )
    })
  })

const deletePayeeRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(deletePayeeSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'deletePayee', data, () => {
      return unwrapDeleteMutation(
        deleteOwnedPayee({ ownerId: user.id, ...data }),
      )
    })
  })

function unwrapPayeeMutation(result: PayeeMutationResult) {
  if (result.status === 'ok') return result.payee

  if (result.status === 'duplicate') {
    setResponseStatus(409)
    throw new Error('A Payee with this name already exists')
  }

  setResponseStatus(404)
  throw new Error('Payee or Plan not found')
}

function unwrapDeleteMutation(result: DeletePayeeResult) {
  if (result.status === 'ok') return result

  if (result.status === 'invalid_destination') {
    setResponseStatus(400)
    throw new Error('Select another Payee from this Plan')
  }

  setResponseStatus(404)
  throw new Error('Payee not found')
}

export const createPayee = savedAction(createPayeeRequest)

const combinePayeesRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(combinePayeesSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'combinePayees', data, () =>
      combineOwnedPayees({ ownerId: user.id, ...data }),
    )
  })

export const combinePayees = savedAction(combinePayeesRequest)

export const renamePayee = savedAction(renamePayeeRequest)

export const deletePayee = savedAction(deletePayeeRequest)
