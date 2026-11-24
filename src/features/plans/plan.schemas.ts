import { z } from 'zod'

import { countryCodes, currencyCodes } from '#/lib/country-profiles'

export const countryCodeSchema = z.enum(countryCodes)

export const planIdSchema = z.object({
  id: z.string().min(1),
})

export const createPlanSchema = z.object({
  name: z.string().trim().min(1).max(80),
  countryCode: countryCodeSchema,
  currencyCode: z.enum(currencyCodes).optional(),
})

export const updatePlanSchema = createPlanSchema
  .extend({
    id: z.string().min(1),
    countryCode: countryCodeSchema.optional(),
    defaultTransactionCleared: z.boolean(),
    hideAfterReconciliation: z.boolean().optional(),
  })
  .refine(
    ({ countryCode, currencyCode }) =>
      Boolean(countryCode) === Boolean(currencyCode),
    'Send both country and currency when changing the plan currency.',
  )
