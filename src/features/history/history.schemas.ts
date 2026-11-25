import { z } from 'zod'

export const requestSchema = z.object({
  requestId: z.nanoid(),
  tabId: z.nanoid(),
})
export function historyInput<T extends z.ZodType>(value: T) {
  return requestSchema.extend({ value })
}
export const reverseSchema = requestSchema.extend({
  receiptId: z.nanoid(),
  generation: z.number().int().nonnegative(),
  direction: z.enum(['undo', 'redo']),
})
export type HistoryReceipt = {
  id: string
  planId: string
  description: string
  generation: number
  payees?: boolean // Return to Manage Payees after a combine.
  accountId?: string | null // null opens All Accounts; absent opens the Plan.
  month?: string
}
