import { historyInput } from '#/features/history/history.schemas'
import { captureAction } from '#/features/history/history.server'
import { savedAction } from '#/features/history/history-state'
import { createServerFn } from '@tanstack/react-start'
import {
  setResponseHeader,
  setResponseStatus,
} from '@tanstack/react-start/server'

import { emptyCategoryBudget } from '#/features/budget/budget-engine'
import { requireUser } from '#/lib/auth-session.server'

import {
  categoryActivitySchema,
  categoryHierarchySchema,
  changeTargetSchema,
  createCategoryGroupSchema,
  createCategorySchema,
  creditPaymentActivitySchema,
  deleteCategorySchema,
  moveCategorySchema,
  reorderCategoryGroupsSchema,
  updateCategoryGroupNameSchema,
  updateCategoryHiddenSchema,
  updateCategoryNameSchema,
} from './category.schemas'
import {
  changeOwnedTarget,
  deleteOwnedCategory,
  deleteOwnedCategoryGroup,
  findCategoryActivityByPlanOwner,
  findCategoryHierarchyByPlanOwner,
  findCreditPaymentActivityByPlanOwner,
  insertOwnedCategory,
  insertOwnedCategoryGroup,
  moveOwnedCategory,
  reorderOwnedCategoryGroups,
  updateOwnedCategoryGroupName,
  updateOwnedCategoryHidden,
  updateOwnedCategoryName,
} from './categories.server'
import type { DeleteCategoryResult } from './categories.server'

const changeTargetRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(changeTargetSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    const action = 'fund' in data.change ? 'fundTarget' : 'changeTarget'
    return captureAction(user.id, request, action, data, () => {
      changeOwnedTarget(user.id, data.categoryId, data.change)
      return true
    })
  })
export const changeTarget = savedAction(changeTargetRequest)

export const getCategoryHierarchy = createServerFn({ method: 'GET' })
  .validator(categoryHierarchySchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    const groups = await findCategoryHierarchyByPlanOwner({
      ...data,
      ownerId: user.id,
    })

    if (!groups) {
      setResponseStatus(404)
      throw new Error('Plan not found')
    }

    return groups
  })

export const getCategoryActivity = createServerFn({ method: 'GET' })
  .validator(categoryActivitySchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    const activity = await findCategoryActivityByPlanOwner({
      ...data,
      ownerId: user.id,
    })

    if (!activity) {
      setResponseStatus(404)
      throw new Error('Plan not found')
    }

    return activity
  })

export const getCreditPaymentActivity = createServerFn({ method: 'GET' })
  .validator(creditPaymentActivitySchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    setResponseHeader('Cache-Control', 'no-store')
    const activity = await findCreditPaymentActivityByPlanOwner({
      ...data,
      ownerId: user.id,
    })

    if (!activity) {
      setResponseStatus(404)
      throw new Error('Credit Payment Category not found')
    }

    return activity
  })

const createCategoryGroupRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(createCategoryGroupSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'createCategoryGroup', data, () => {
      const group = insertOwnedCategoryGroup({
        ownerId: user.id,
        ...data,
      })

      if (!group) {
        setResponseStatus(404)
        throw new Error('Plan not found')
      }

      return {
        ...group,
        assigned: 0,
        activity: 0,
        available: 0,
        internal: false,
        categories: [],
      }
    })
  })

const updateCategoryGroupNameRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(updateCategoryGroupNameSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(
      user.id,
      request,
      'updateCategoryGroupName',
      data,
      () => {
        const group = updateOwnedCategoryGroupName({
          ownerId: user.id,
          ...data,
        })

        if (!group) {
          setResponseStatus(404)
          throw new Error('Category Group not found')
        }

        return group
      },
    )
  })

const createCategoryRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(createCategorySchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'createCategory', data, () => {
      const category = insertOwnedCategory({
        ownerId: user.id,
        ...data,
      })

      if (!category) {
        setResponseStatus(404)
        throw new Error('Category Group not found')
      }

      return {
        ...category,
        creditAccountClosed: null,
        progress: null,
        internal: false,
        transactionCount: 0,
        ...emptyCategoryBudget,
      }
    })
  })

const updateCategoryNameRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(updateCategoryNameSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'updateCategoryName', data, () => {
      const category = updateOwnedCategoryName({
        ownerId: user.id,
        ...data,
      })

      if (!category) {
        setResponseStatus(404)
        throw new Error('Category not found')
      }

      return category
    })
  })

const updateCategoryHiddenRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(updateCategoryHiddenSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'updateCategoryHidden', data, () => {
      const category = updateOwnedCategoryHidden({
        ownerId: user.id,
        ...data,
      })

      if (!category) {
        setResponseStatus(404)
        throw new Error('Category not found')
      }

      return { ...category, internal: category.kind !== 'ordinary' }
    })
  })

const reorderCategoryGroupsRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(reorderCategoryGroupsSchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(
      user.id,
      request,
      'reorderCategoryGroups',
      data,
      () => {
        if (!reorderOwnedCategoryGroups({ ...data, ownerId: user.id })) {
          setResponseStatus(409)
          throw new Error('Category Groups changed. Reload and try again.')
        }
        return { success: true }
      },
    )
  })

const moveCategoryRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(moveCategorySchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'moveCategory', data, () => {
      if (!moveOwnedCategory({ ...data, ownerId: user.id })) {
        setResponseStatus(409)
        throw new Error('Categories changed. Reload and try again.')
      }
      return { success: true }
    })
  })

const deleteCategoryRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(deleteCategorySchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'deleteCategory', data, () => {
      return unwrapDeleteResult(
        deleteOwnedCategory({ ownerId: user.id, ...data }),
        'Category not found',
      )
    })
  })

const deleteCategoryGroupRequest = createServerFn({ method: 'POST' })
  .validator(historyInput(deleteCategorySchema))
  .handler(async ({ data: input }) => {
    const user = await requireUser()
    const { value: data, ...request } = input
    return captureAction(user.id, request, 'deleteCategoryGroup', data, () => {
      return unwrapDeleteResult(
        deleteOwnedCategoryGroup({ ownerId: user.id, ...data }),
        'Category Group not found',
      )
    })
  })

function unwrapDeleteResult(result: DeleteCategoryResult, notFound: string) {
  if (result.status === 'ok') return result

  if (result.status === 'not_found') {
    setResponseStatus(404)
    throw new Error(notFound)
  }

  setResponseStatus(409)
  throw new Error(
    result.status === 'target_required'
      ? 'Transactions now use this Category. Choose where they should move.'
      : 'Choose another visible Category for these Transactions.',
  )
}

export const createCategoryGroup = savedAction(createCategoryGroupRequest)

export const updateCategoryGroupName = savedAction(
  updateCategoryGroupNameRequest,
)

export const createCategory = savedAction(createCategoryRequest)

export const updateCategoryName = savedAction(updateCategoryNameRequest)

export const updateCategoryHidden = savedAction(updateCategoryHiddenRequest)

export const reorderCategoryGroups = savedAction(reorderCategoryGroupsRequest)

export const moveCategory = savedAction(moveCategoryRequest)

export const deleteCategory = savedAction(deleteCategoryRequest)

export const deleteCategoryGroup = savedAction(deleteCategoryGroupRequest)
