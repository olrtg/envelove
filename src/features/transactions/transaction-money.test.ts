import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateCurrencyToMilliunits } from './transaction-money'

test('evaluates arithmetic in amounts', () => {
  const evaluate = (value: string) =>
    evaluateCurrencyToMilliunits(value, 'US', 'USD')

  assert.equal(evaluate('12'), 12_000)
  assert.equal(evaluate('+12.5'), 12_500)
  assert.equal(evaluate('12+3.5'), 15_500)
  assert.equal(evaluate('1,000 + 1'), 1_001_000)
  assert.equal(evaluate('10*3'), 30_000)
  assert.equal(evaluate('(10+5)/3'), 5_000)
  assert.equal(evaluate('10/3'), 3_330)
  assert.equal(evaluate('20-5'), 15_000)
})

test('rejects arithmetic that is not a positive amount', () => {
  const evaluate = (value: string) =>
    evaluateCurrencyToMilliunits(value, 'US', 'USD')

  assert.equal(evaluate('5-10'), null)
  assert.equal(evaluate('5-5'), null)
  assert.equal(evaluate('1/0'), null)
  assert.equal(evaluate('(1+2'), null)
  assert.equal(evaluate('2*'), null)
  assert.equal(evaluate('abc'), null)
  assert.equal(evaluate(''), null)
})

test('uses the Plan locale for each number', () => {
  assert.equal(
    evaluateCurrencyToMilliunits('12.000+3.500', 'PY', 'PYG'),
    15_500_000,
  )
  assert.equal(evaluateCurrencyToMilliunits('1,5*2', 'DE', 'EUR'), 3_000)
  assert.equal(
    evaluateCurrencyToMilliunits('১২,৩৪,৫৬৭.৮৯', 'BD', 'BDT'),
    1_234_567_890,
  )
  assert.equal(evaluateCurrencyToMilliunits('123,456.78', 'IN', 'INR'), null)
})

test('bank balances accept zero and distinguish signed credit from debt at Plan precision', async () => {
  const { parseBankBalance } = await import('./transaction-money')
  for (const [text, expected] of [
    ['300', -300000],
    ['-300', -300000],
    ['+300', 300000],
    ['0', 0],
    ['1,23', null],
    ['1.000', -1000000],
  ] as const)
    assert.equal(parseBankBalance(text, 'PY', 'PYG', true), expected)
  assert.equal(parseBankBalance('-2.10', 'US', 'USD', false), -2100)
  assert.equal(parseBankBalance('0.001', 'US', 'USD', false), null)
  assert.equal(parseBankBalance('-١٢٫٣٤٥', 'KW', 'KWD', false), -12_345)
})
