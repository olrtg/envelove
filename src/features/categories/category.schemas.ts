import { z } from 'zod'

import { planMonthSchema } from '#/features/plans/plan-month'
import { transactionDateSchema } from '#/features/transactions/transaction.schemas'
import { targetSchema } from './category-target'

export const changeTargetSchema = z.object({
  categoryId: z.string().min(1),
  change: z.union([
    z.object({ target: targetSchema.nullable() }),
    z.object({ month: planMonthSchema, snooze: z.boolean() }),
    z.object({
      month: planMonthSchema,
      today: transactionDateSchema,
      fund: z.literal(true),
    }),
  ]),
})
export type TargetChange = z.infer<typeof changeTargetSchema>['change']

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(80, 'Use 80 characters or fewer.')

export const categoryPlanIdSchema = z.object({
  planId: z.string().min(1),
})

export const categoryHierarchySchema = categoryPlanIdSchema.extend({
  month: planMonthSchema,
  today: transactionDateSchema,
})

export const categoryActivitySchema = categoryHierarchySchema.extend({
  source: z.object({
    kind: z.enum(['category', 'group']),
    id: z.string().min(1),
  }),
})

export const creditPaymentActivitySchema = categoryHierarchySchema.extend({
  categoryId: z.string().min(1),
})

export const createCategoryGroupSchema = categoryPlanIdSchema.extend({
  name: categoryNameSchema,
})

export const updateCategoryGroupNameSchema = z.object({
  id: z.string().min(1),
  name: categoryNameSchema,
})

export const createCategorySchema = z.object({
  categoryGroupId: z.string().min(1),
  name: categoryNameSchema,
})

export const updateCategoryNameSchema = z.object({
  id: z.string().min(1),
  name: categoryNameSchema,
})

export const updateCategoryHiddenSchema = z.object({
  id: z.string().min(1),
  hidden: z.boolean(),
})

export const deleteCategorySchema = z.object({
  id: z.string().min(1),
  targetCategoryId: z.string().min(1).nullable(),
})

const orderedIdsSchema = z.array(z.string().min(1).max(128)).max(10_000)

export const reorderCategoryGroupsSchema = categoryPlanIdSchema.extend({
  expectedIds: orderedIdsSchema,
  orderedIds: orderedIdsSchema,
})

export const moveCategorySchema = categoryPlanIdSchema.extend({
  categoryId: z.string().min(1),
  fromGroupId: z.string().min(1),
  toGroupId: z.string().min(1),
  expectedSourceIds: orderedIdsSchema,
  expectedTargetIds: orderedIdsSchema,
  sourceIds: orderedIdsSchema,
  targetIds: orderedIdsSchema,
})
