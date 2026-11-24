import { z } from 'zod'

import { getLocalDate } from '#/features/transactions/transaction-money'
import { getDateTimeFormat } from '#/lib/intl-formats'

export type PlanMonth = string & { readonly __brand: 'PlanMonth' }

export type PlanMonthBounds = { min: PlanMonth; max: PlanMonth }

// A Plan starts in the earlier of its creation month and its first
// Transaction's month. Users may look one month before that, and one month
// past the later of the current month and the latest month with money assigned.
export function planMonthBounds({
  createdAt,
  firstTransactionDate,
  latestAssignedMonth,
  today,
}: {
  createdAt: Date
  firstTransactionDate: string | null
  latestAssignedMonth: PlanMonth | null
  today: string
}): PlanMonthBounds {
  const createdMonth = monthOfDate(getLocalDate(createdAt))
  const transactionMonth = firstTransactionDate
    ? monthOfDate(firstTransactionDate)
    : createdMonth
  const firstMonth =
    transactionMonth < createdMonth ? transactionMonth : createdMonth
  const currentMonth = monthOfDate(today)

  return {
    min: addMonths(firstMonth, -1),
    max: addMonths(
      latestAssignedMonth && latestAssignedMonth > currentMonth
        ? latestAssignedMonth
        : currentMonth,
      1,
    ),
  }
}

export function isPlanMonthInBounds(
  month: PlanMonth,
  { min, max }: PlanMonthBounds,
) {
  return month >= min && month <= max
}

export function parsePlanMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? (value as PlanMonth) : null
}

export const planMonthSchema = z.string().transform((value, ctx) => {
  const month = parsePlanMonth(value)
  if (month) return month
  ctx.addIssue({ code: 'custom', message: 'Enter a valid month.' })
  return z.NEVER
})

export function monthOfDate(date: string) {
  return date.slice(0, 7) as PlanMonth
}

export function planMonthParts(month: PlanMonth) {
  const [year, monthNumber] = month.split('-').map(Number)
  return { year, monthNumber }
}

export function planMonthOf(year: number, monthNumber: number) {
  return `${String(year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}` as PlanMonth
}

export function addMonths(month: PlanMonth, count: number) {
  const { year, monthNumber } = planMonthParts(month)
  const index = year * 12 + monthNumber - 1 + count
  return planMonthOf(Math.floor(index / 12), (index % 12) + 1)
}

export function firstDayOfMonth(month: PlanMonth) {
  return `${month}-01`
}

export function lastDayOfMonth(month: PlanMonth) {
  const { year, monthNumber } = planMonthParts(month)
  const date = new Date(0)
  date.setUTCFullYear(year, monthNumber, 0)
  return `${month}-${String(date.getUTCDate()).padStart(2, '0')}`
}

// Month labels read like YNAB's "Oct 2026" in every Plan locale.
export function formatPlanMonth(
  month: PlanMonth,
  options: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' },
) {
  return getDateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
    new Date(`${firstDayOfMonth(month)}T00:00:00.000Z`),
  )
}
