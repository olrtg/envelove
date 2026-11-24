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
  moneyMoveOptionsSchema,
  moveMoneySchema,
  setCategoryAssignedSchema,
} from './budget.schemas'
import {
  findOwnedMoneyMoveOptions,
  moveOwnedMoney,
  setOwnedCategoryAssigned,
} from './budget.server'

const setCategoryAssignedRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(setCategoryAssignedSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'setCategoryAssigned', data, () => {
      const result = setOwnedCategoryAssigned({ ownerId: user.id, ...data })

      if (!result) {
        setResponseStatus(404)
        throw new Error('Category not found')
      }

      if (result.status === 'invalid_amount') {
        setResponseStatus(400)
        throw new Error('Amount does not match the Plan currency precision')
      }

      return result
    })
  })

export const getMoneyMoveOptions = createServerFn({ method: 'GET' })
  .validator(moneyMoveOptionsSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    const result = findOwnedMoneyMoveOptions({ ownerId: user.id, ...data })
    if (!result) {
      setResponseStatus(404)
      throw new Error('Plan not found')
    }
    return result
  })

const moveMoneyRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(moveMoneySchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'moveMoney', data, () => {
      const result = moveOwnedMoney({ ownerId: user.id, ...data })
      if (result.status === 'ok') return result

      const errors = {
        not_found: 'Plan not found',
        invalid_endpoint: 'Choose a different visible Category in this Plan.',
        invalid_amount:
          'Enter a positive amount within the Plan currency precision and supported range.',
        nothing_to_cover:
          'There is no longer a shortfall to cover. Reload to see the latest budget.',
        source_empty:
          'This source no longer has money to cover the shortfall. Choose another source.',
      }
      setResponseStatus(result.status === 'not_found' ? 404 : 400)
      throw new Error(errors[result.status])
    })
  })

export const setCategoryAssigned = savedAction(setCategoryAssignedRequest)

export const moveMoney = savedAction(moveMoneyRequest)
