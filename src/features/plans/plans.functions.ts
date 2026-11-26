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
  createPlanSchema,
  planIdSchema,
  updatePlanSchema,
} from './plan.schemas'
import {
  deleteOwnedPlan,
  findPlanByOwner,
  findPlansByOwner,
  insertPlan,
  updateOwnedPlan,
} from './plans.server'

export const listPlans = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  setResponseHeader('Cache-Control', 'no-store')
  return findPlansByOwner(user.id)
})

export const getPlan = createServerFn({ method: 'GET' })
  .validator(planIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    const plan = await findPlanByOwner(data.id, user.id)

    if (!plan) {
      setResponseStatus(404)
      throw new Error('Plan not found')
    }

    return plan
  })

export const createPlan = createServerFn({ method: 'POST' })
  .validator(createPlanSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    return insertPlan({ ownerId: user.id, ...data })
  })

const updatePlanSettingsRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(updatePlanSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'updatePlanSettings', data, () => {
      const plan = updateOwnedPlan({ ownerId: user.id, ...data })

      if (!plan) {
        setResponseStatus(404)
        throw new Error('Plan not found')
      }

      return plan
    })
  })

export const updatePlanSettings = savedAction(updatePlanSettingsRequest)

export const deletePlan = createServerFn({ method: 'POST' })
  .validator(planIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (!deleteOwnedPlan(data.id, user.id)) {
      setResponseStatus(404)
      throw new Error('Plan not found')
    }
    return findPlansByOwner(user.id)
  })
