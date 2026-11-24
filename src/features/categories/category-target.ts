import { z } from 'zod'
import {
  addMonths,
  lastDayOfMonth,
  monthOfDate,
} from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'
import { transactionDateSchema } from '#/features/transactions/transaction.schemas'

export const targetSchema = z
  .object({
    amount: z.number().int().safe().positive(),
    start: transactionDateSchema,
    frequency: z.enum(['Weekly', 'Monthly', 'Yearly', 'Custom']),
    behavior: z.enum(['Set aside', 'Fill up to', 'Have a balance of']),
    day: z.number().int().min(0).max(31), // Sunday = 0 for weekly, last day = 0 for monthly
    due: transactionDateSchema.nullable(),
    repeatMonths: z.number().int().min(0).max(132),
  })
  .refine((t) => {
    if (
      t.behavior === 'Have a balance of' &&
      (t.frequency !== 'Custom' || t.repeatMonths !== 0)
    )
      return false
    if (t.frequency === 'Weekly' && t.day > 6) return false
    if (t.frequency === 'Weekly' || t.frequency === 'Monthly')
      return t.due === null && t.repeatMonths === 0
    if (!t.due) return t.behavior === 'Have a balance of'
    return (
      monthOfDate(t.due) >= monthOfDate(t.start) &&
      (t.frequency === 'Yearly'
        ? t.repeatMonths === 12
        : t.repeatMonths <= 11 || t.repeatMonths % 12 === 0)
    )
  }, 'Choose a valid target date and repeat interval.')

export type CategoryTarget = z.infer<typeof targetSchema>
type MonthAmounts = { assigned: number; carryover: number; available: number }

export function targetProgress(
  t: CategoryTarget,
  month: PlanMonth,
  today: string,
  history: ReadonlyMap<PlanMonth, MonthAmounts>,
  step: number,
  snoozed: boolean,
) {
  if (month < monthOfDate(t.start)) return null
  const current = history.get(month)
  const assigned = current?.assigned ?? 0
  let total = t.amount
  let start = month
  let monthsLeft = 1
  let due = t.due
  if (t.frequency === 'Weekly') {
    const first = month === monthOfDate(t.start) ? t.start : `${month}-01`
    const weekday = new Date(`${first}T00:00:00Z`).getUTCDay()
    const days =
      Number(lastDayOfMonth(month).slice(-2)) - Number(first.slice(-2))
    total *= 1 + Math.floor((days - ((7 + t.day - weekday) % 7)) / 7)
  } else if (t.due) {
    let end = monthOfDate(t.due)
    start = monthOfDate(t.start)
    if (month > end) {
      if (!t.repeatMonths) return null
      const periods = Math.ceil(monthDistance(end, month) / t.repeatMonths)
      end = addMonths(end, periods * t.repeatMonths)
      start = addMonths(end, 1 - t.repeatMonths)
      const day = Math.min(
        Number(t.due.slice(-2)),
        Number(lastDayOfMonth(end).slice(-2)),
      )
      due = `${end}-${String(day).padStart(2, '0')}`
    }
    monthsLeft = monthDistance(month, end) + 1
  }
  let prior = 0
  if (t.behavior === 'Have a balance of') {
    prior = (current?.available ?? 0) - assigned
  } else {
    if (t.behavior === 'Fill up to' && start <= monthOfDate(today))
      prior = history.get(start)?.carryover ?? 0
    for (const [m, b] of history)
      if (m >= start && m < month) prior += b.assigned
  }
  const needed = Math.max(0, total - prior)
  const monthly = Math.ceil(needed / monthsLeft / step) * step
  const optional = t.behavior === 'Have a balance of' && !t.due
  return {
    monthly,
    due,
    assigned,
    remaining: Math.max(0, monthly - assigned),
    underfunded: snoozed || optional ? 0 : Math.max(0, monthly - assigned),
    optional,
    snoozed,
  }
}

function monthDistance(from: PlanMonth, to: PlanMonth) {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5)) -
    Number(from.slice(5))
  )
}
