import { z } from 'zod'

import { planMonthSchema } from '#/features/plans/plan-month'
import { transactionDateSchema } from '#/features/transactions/transaction.schemas'

export const setCategoryAssignedSchema = z.object({
  categoryId: z.string().min(1),
  month: planMonthSchema,
  amount: z.number().int().safe(),
})

export const moneyMoveOptionsSchema = z.object({
  planId: z.string().min(1),
  month: planMonthSchema,
  today: transactionDateSchema,
})

// null denotes the derived Ready to Assign balance, never its inflow Category.
const moneyEndpointSchema = z.object({
  categoryId: z.string().min(1).nullable(),
  month: planMonthSchema,
})

const moneyMoveBaseSchema = z.object({
  planId: z.string().min(1),
  today: transactionDateSchema,
  source: moneyEndpointSchema,
  destination: moneyEndpointSchema,
})

export const moveMoneySchema = z.discriminatedUnion('kind', [
  moneyMoveBaseSchema.extend({
    kind: z.literal('move'),
    amount: z.number().int().safe().positive(),
  }),
  moneyMoveBaseSchema.extend({ kind: z.literal('cover') }),
])

export type MoneyMove = z.infer<typeof moveMoneySchema>
