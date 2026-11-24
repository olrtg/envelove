import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMonths,
  firstDayOfMonth,
  formatPlanMonth,
  isPlanMonthInBounds,
  lastDayOfMonth,
  monthOfDate,
  parsePlanMonth,
  planMonthBounds,
  planMonthSchema,
} from './plan-month'
import type { PlanMonth } from './plan-month'

const october = '2026-10' as PlanMonth

test('parses months from search params', () => {
  assert.equal(parsePlanMonth('2026-10'), '2026-10')
  assert.equal(parsePlanMonth('2026-13'), null)
  assert.equal(parsePlanMonth('2026-00'), null)
  assert.equal(parsePlanMonth('2026-1'), null)
  assert.equal(parsePlanMonth('2026-10-15'), null)
  assert.equal(planMonthSchema.safeParse('2026-09').data, '2026-09')
  assert.equal(planMonthSchema.safeParse('Oct 2026').success, false)
})

test('takes the month of a calendar date', () => {
  assert.equal(monthOfDate('2026-10-15'), '2026-10')
  assert.equal(monthOfDate('2027-01-01'), '2027-01')
})

test('moves months across years', () => {
  assert.equal(addMonths(october, 1), '2026-11')
  assert.equal(addMonths(october, 3), '2027-01')
  assert.equal(addMonths(october, -10), '2025-12')
  assert.equal(addMonths(october, -22), '2024-12')
})

test('finds the first and last calendar days', () => {
  assert.equal(firstDayOfMonth(october), '2026-10-01')
  assert.equal(lastDayOfMonth(october), '2026-10-31')
  assert.equal(lastDayOfMonth('2026-09' as PlanMonth), '2026-09-30')
  assert.equal(lastDayOfMonth('2026-02' as PlanMonth), '2026-02-28')
  assert.equal(lastDayOfMonth('2028-02' as PlanMonth), '2028-02-29')
})

test('formats months in English', () => {
  assert.equal(formatPlanMonth(october), 'Oct 2026')
  assert.equal(formatPlanMonth(october, { month: 'short' }), 'Oct')
})

test('bounds months around the Plan start and the Current Day', () => {
  const createdAt = new Date(2026, 9, 3)
  assert.deepEqual(
    planMonthBounds({
      createdAt,
      firstTransactionDate: null,
      latestAssignedMonth: null,
      today: '2026-10-15',
    }),
    { min: '2026-09', max: '2026-11' },
  )
  assert.deepEqual(
    planMonthBounds({
      createdAt,
      firstTransactionDate: '2025-12-31',
      latestAssignedMonth: null,
      today: '2027-01-02',
    }),
    { min: '2025-11', max: '2027-02' },
  )
  assert.equal(
    planMonthBounds({
      createdAt,
      firstTransactionDate: '2026-12-01',
      latestAssignedMonth: null,
      today: '2026-10-15',
    }).min,
    '2026-09',
  )

  const bounds = planMonthBounds({
    createdAt,
    firstTransactionDate: null,
    latestAssignedMonth: null,
    today: '2026-10-15',
  })
  assert.equal(isPlanMonthInBounds('2026-08' as PlanMonth, bounds), false)
  assert.equal(isPlanMonthInBounds('2026-09' as PlanMonth, bounds), true)
  assert.equal(isPlanMonthInBounds('2026-11' as PlanMonth, bounds), true)
  assert.equal(isPlanMonthInBounds('2026-12' as PlanMonth, bounds), false)
})

test('opens one month past the latest month with money assigned', () => {
  const createdAt = new Date(2026, 9, 1)
  const maxWith = (latestAssignedMonth: string | null) =>
    planMonthBounds({
      createdAt,
      firstTransactionDate: null,
      latestAssignedMonth: latestAssignedMonth as PlanMonth | null,
      today: '2026-10-15',
    }).max

  assert.equal(maxWith(null), '2026-11')
  assert.equal(maxWith('2026-09'), '2026-11')
  assert.equal(maxWith('2026-10'), '2026-11')
  assert.equal(maxWith('2026-11'), '2026-12')
  assert.equal(maxWith('2027-03'), '2027-04')
})
