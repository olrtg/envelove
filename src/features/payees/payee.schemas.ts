import { z } from 'zod'

export const payeeNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a Payee name.')
  .max(100, 'Use 100 characters or fewer for the Payee.')

export const payeePlanSchema = z.object({
  planId: z.string().min(1),
})

export const createPayeeSchema = payeePlanSchema.extend({
  name: payeeNameSchema,
})

export const combinePayeesSchema = createPayeeSchema.extend({
  ids: z.array(z.string().min(1)).min(2),
})

export const renamePayeeSchema = z.object({
  id: z.string().min(1),
  name: payeeNameSchema,
})

export const deletePayeeSchema = z.object({
  id: z.string().min(1),
  destinationPayeeId: z.string().min(1).nullable(),
})

export function getPayeeNameKey(name: string) {
  return name.trim().toLowerCase()
}
