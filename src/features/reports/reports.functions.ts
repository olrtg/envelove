import { createServerFn } from '@tanstack/react-start'
import {
  setResponseHeader,
  setResponseStatus,
} from '@tanstack/react-start/server'
import { z } from 'zod'
import {
  addMonths,
  monthOfDate,
  planMonthSchema,
} from '#/features/plans/plan-month'
import { transactionDateSchema } from '#/features/transactions/transaction.schemas'
import { requireUser } from '#/lib/auth-session.server'
import {
  netWorth,
  reportOptions,
  spendingRows,
  spendingTotals,
} from './reports.server'

const workspace = z.object({
  planId: z.string().min(1),
  today: transactionDateSchema,
})
const range = workspace.extend({
  from: planMonthSchema,
  to: planMonthSchema,
  excludedAccounts: z.array(z.string()),
})
const spending = range.extend({
  byGroup: z.boolean(),
  excludedCategories: z.array(z.string()),
})

async function reportOwner() {
  setResponseHeader('Cache-Control', 'no-store')
  return (await requireUser()).id
}

export const getReportWorkspace = createServerFn({ method: 'GET' })
  .validator(workspace)
  .handler(async ({ data }) => {
    const owner = await reportOwner()
    const options = reportOptions(data.planId, owner)
    if (!options) {
      setResponseStatus(404)
      throw new Error('Plan not found')
    }
    const to = monthOfDate(data.today)
    const buckets = spendingTotals(owner, {
      ...data,
      from: addMonths(to, -5),
      to,
      excludedAccounts: [],
      byGroup: false,
      excludedCategories: [],
    })
    return { ...options, today: data.today, buckets }
  })

export const getSpendingTotals = createServerFn({ method: 'POST' })
  .validator(spending)
  .handler(async ({ data }) => spendingTotals(await reportOwner(), data))
export const getNetWorth = createServerFn({ method: 'POST' })
  .validator(
    range.refine((r) => r.from <= r.to && r.to <= monthOfDate(r.today)),
  )
  .handler(async ({ data }) => netWorth(await reportOwner(), data))
export const getSpendingRows = createServerFn({ method: 'POST' })
  .validator(spending.extend({ bucketId: z.string() }))
  .handler(async ({ data }) => spendingRows(await reportOwner(), data))
