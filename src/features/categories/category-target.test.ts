import assert from 'node:assert/strict'
import test from 'node:test'
import { monthOfDate } from '#/features/plans/plan-month'
import { targetProgress } from './category-target'
import type { CategoryTarget } from './category-target'

const today = '2026-11-20'
const nov = monthOfDate(today)
const dec = monthOfDate('2026-12-01')
const base: CategoryTarget = {
  frequency: 'Monthly',
  amount: 100_000,
  behavior: 'Set aside',
  start: today,
  due: null,
  repeatMonths: 0,
  day: 0,
}

test('weekly funding counts only remaining weekdays in the first month, then the whole month', () => {
  const t = { ...base, frequency: 'Weekly' as const, day: 6 }
  assert.equal(
    targetProgress(t, nov, today, new Map(), 10, false)?.monthly,
    200_000,
  )
  assert.equal(
    targetProgress(t, dec, today, new Map(), 10, false)?.monthly,
    400_000,
  )
  assert.equal(
    targetProgress({ ...t, day: 1 }, nov, '2026-11-30', new Map(), 10, false)
      ?.monthly,
    200_000,
  )
})

test('refill credits opening cash, not spending; set aside only credits assignments', () => {
  const history = new Map([
    [nov, { carryover: 35_000, assigned: 10_000, available: 5_000 }],
  ])
  const amount = (t: CategoryTarget) =>
    targetProgress(t, nov, today, history, 10, false)?.underfunded
  assert.equal(amount(base), 90_000)
  assert.equal(amount({ ...base, behavior: 'Fill up to' }), 55_000)
  assert.equal(
    amount({
      ...base,
      frequency: 'Custom',
      behavior: 'Have a balance of',
      due: '2026-11-30',
    }),
    95_000,
  )
})

test('by-date funding rounds up to spendable units, catches up after a snooze and resets on repeat', () => {
  const t = {
    ...base,
    frequency: 'Custom' as const,
    due: '2027-01-15',
    repeatMonths: 3,
  }
  const history = new Map([
    [nov, { carryover: 0, assigned: 10_000, available: 6_000 }],
  ])
  assert.equal(
    targetProgress(t, nov, today, history, 10, false)?.underfunded,
    23_340,
  )
  assert.equal(targetProgress(t, nov, today, history, 10, true)?.underfunded, 0)
  assert.equal(
    targetProgress(t, dec, today, history, 10, false)?.underfunded,
    45_000,
  )
  const feb = monthOfDate('2027-02-01')
  assert.equal(
    targetProgress(t, feb, today, history, 10, false)?.due,
    '2027-04-15',
  )
  assert.equal(
    targetProgress(t, feb, today, history, 10, false)?.underfunded,
    33_340,
  )
  assert.equal(
    targetProgress({ ...t, repeatMonths: 0 }, feb, today, history, 10, false),
    null,
  )
})
