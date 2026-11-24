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
  createAccountSchema,
  listAccountsSchema,
  updateAccountSchema,
} from './account.schemas'
import {
  findAccountsByPlanOwner,
  insertOwnedAccount,
  updateOwnedAccount,
} from './accounts.server'

export const listAccounts = createServerFn({ method: 'GET' })
  .validator(listAccountsSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    return findAccountsByPlanOwner({ ...data, ownerId: user.id })
  })

const createAccountRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(createAccountSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'createAccount', data, () => {
      const account = insertOwnedAccount({ ownerId: user.id, ...data })

      if (!account) {
        setResponseStatus(404)
        throw new Error('Plan not found')
      }

      return account
    })
  })

const updateAccountRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(updateAccountSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'updateAccount', data, () => {
      const account = updateOwnedAccount({ ownerId: user.id, ...data })

      if (!account) {
        setResponseStatus(404)
        throw new Error('Account not found')
      }

      return account
    })
  })

export const createAccount = savedAction(createAccountRequest)

export const updateAccount = savedAction(updateAccountRequest)
