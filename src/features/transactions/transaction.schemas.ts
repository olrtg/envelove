import { z } from 'zod'

import { payeeNameSchema } from '#/features/payees/payee.schemas'

export const transactionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  }, 'Enter a valid date.')

const nullableTrimmedText = (maximum: number, message: string) =>
  z.union([
    z
      .string()
      .trim()
      .max(maximum, message)
      .transform((value) => value || null),
    z.null(),
  ])

export const transactionMemoSchema = nullableTrimmedText(
  200,
  'Use 200 characters or fewer for the Memo.',
)

export const transactionPayeeInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ordinary'),
    payeeId: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal('create'),
    name: payeeNameSchema,
  }),
  z.object({
    kind: z.literal('transfer'),
    accountId: z.string().min(1, 'Select a Transfer Account.'),
  }),
])

export const transactionAmountSchema = z
  .number()
  .int('Enter a valid amount.')
  .safe('The amount is too large.')
  .refine((amount) => amount !== 0, 'Enter a nonzero amount.')

export const transactionRegisterSchema = z.object({
  planId: z.string().min(1),
  accountId: z.string().min(1),
})

export const planTransactionRegisterSchema = z.object({
  planId: z.string().min(1),
})

export const registerScopeSchema = planTransactionRegisterSchema.extend({
  accountId: z.string().min(1).optional(),
  today: transactionDateSchema,
  selectedId: z.string().min(1).optional(),
})

export const registerPageSchema = registerScopeSchema.extend({
  after: z
    .object({
      date: transactionDateSchema,
      createdAt: z.number().int(),
      group: z.string(),
      outflow: z.number().int(),
      id: z.string(),
    })
    .optional(),
  hideReconciled: z.boolean().optional(),
  search: z.string().max(200).optional(),
})
export type RegisterPageInput = z.infer<typeof registerPageSchema>

const transactionFieldsSchema = z
  .object({
    categoryId: z.string().min(1).nullable(),
    date: transactionDateSchema,
    payee: transactionPayeeInputSchema,
    memo: transactionMemoSchema,
    amount: transactionAmountSchema,
    cleared: z.boolean(),
    reconciled: z.literal(false).optional(),
    today: transactionDateSchema,
    timeZone: z.string().min(1).max(100).optional(),
  })
  .superRefine((transaction, context) => {
    if (transaction.payee.kind === 'transfer' && transaction.categoryId) {
      context.addIssue({
        code: 'custom',
        message: 'A Transfer does not use a Category.',
        path: ['categoryId'],
      })
    }

    if (transaction.cleared && transaction.date > transaction.today) {
      context.addIssue({
        code: 'custom',
        message: 'A future Transaction cannot be Cleared.',
        path: ['cleared'],
      })
    }
  })

export const createTransactionSchema = transactionFieldsSchema.safeExtend({
  accountId: z.string().min(1, 'Select an Account.'),
})

export const updateTransactionSchema = transactionFieldsSchema.safeExtend({
  id: z.string().min(1),
  accountId: z.string().min(1, 'Select an Account.'),
  confirmation: z.string().optional(),
  futureDraftDate: transactionDateSchema.optional(),
  confirmUnlink: z.boolean().optional().default(false),
})

export const deleteTransactionSchema = z.object({
  confirmation: z.string().optional(),
  id: z.string().min(1),
})

export const bulkTransactionSchema = z.object({
  planId: z.string().min(1),
  accountId: z.string().min(1).optional(),
  timeZone: z.string().max(100),
  rows: z
    .array(z.object({ id: z.string().min(1), confirmation: z.string() }))
    .min(1),
  action: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('category'),
      categoryId: z.string().min(1).nullable(),
    }),
    z.object({ kind: z.literal('memo'), memo: transactionMemoSchema }),
    z.object({ kind: z.literal('cleared'), cleared: z.boolean() }),
    z.object({ kind: z.literal('delete') }),
  ]),
})
export type BulkTransactionInput = z.infer<typeof bulkTransactionSchema>

export type TransactionMutationFields = Omit<
  z.infer<typeof transactionFieldsSchema>,
  'today' | 'timeZone' | 'reconciled'
>
