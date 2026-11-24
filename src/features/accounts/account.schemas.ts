import { z } from 'zod'

import { transactionDateSchema } from '#/features/transactions/transaction.schemas'

export const accountTypes = [
  'checking',
  'savings',
  'cash',
  'credit_card',
  'line_of_credit',
  'mortgage',
  'auto_loan',
  'student_loan',
  'personal_loan',
  'medical_debt',
  'other_debt',
  'asset',
  'liability',
] as const

export const accountTypeSchema = z.enum(accountTypes)

export type AccountType = z.infer<typeof accountTypeSchema>

export const accountPlanIdSchema = z.object({
  planId: z.string().min(1),
})

export const listAccountsSchema = accountPlanIdSchema.extend({
  today: transactionDateSchema,
})

export const createAccountSchema = accountPlanIdSchema.extend({
  name: z.string().trim().min(1).max(80),
  type: accountTypeSchema,
  startingBalance: z.number().int().safe().optional(),
  timeZone: z.string().min(1).max(100).optional(),
})

export const updateAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  closed: z.boolean(),
})
