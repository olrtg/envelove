import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAssignedInput } from './assigned-input'

const guaranies = (text: string, current = 30_000_000) =>
  parseAssignedInput(text, current, 'PY', 'PYG')
const dollars = (text: string, current = 0) =>
  parseAssignedInput(text, current, 'US', 'USD')

test('reads plain amounts in the Plan locale', () => {
  assert.deepEqual(guaranies('100.000'), {
    amount: 100_000_000,
    isExpression: false,
  })
  assert.deepEqual(dollars('12.34'), { amount: 12_340, isExpression: false })
  assert.deepEqual(dollars('1,000'), { amount: 1_000_000, isExpression: false })
  assert.deepEqual(dollars('0'), { amount: 0, isExpression: false })
  assert.deepEqual(dollars('  '), { amount: 0, isExpression: false })
})

test('evaluates math, with x as multiplication', () => {
  assert.deepEqual(guaranies('100000*2'), {
    amount: 200_000_000,
    isExpression: true,
  })
  assert.deepEqual(guaranies('100000x2'), {
    amount: 200_000_000,
    isExpression: true,
  })
  assert.equal(dollars('10/4')?.amount, 2_500)
  assert.equal(dollars('10/3')?.amount, 3_330)
  assert.deepEqual(dollars('5-8'), { amount: -3_000, isExpression: true })
  assert.deepEqual(dollars('(2+3)*4'), { amount: 20_000, isExpression: true })
})

test('adds to the current amount after a leading plus', () => {
  assert.deepEqual(guaranies('+5000'), {
    amount: 35_000_000,
    isExpression: true,
  })
  assert.equal(dollars('+2*3', 1_000)?.amount, 7_000)
})

test('sets a negative amount after a leading minus', () => {
  assert.deepEqual(guaranies('-50000'), {
    amount: -50_000_000,
    isExpression: false,
  })
  assert.deepEqual(dollars('-5+2', 9_000), {
    amount: -3_000,
    isExpression: true,
  })
})

test('rejects text that is not an amount', () => {
  for (const text of ['abc', '2*', '(1+2', '1/0', '12.345', '1,00']) {
    assert.equal(dollars(text), null, text)
  }
  assert.equal(guaranies('1,5'), null)
})
