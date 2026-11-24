import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getOppositeTransferSide,
  getTransferSide,
  isValidTransferPair,
  sortRegisterTransactions,
} from './transfer-logic'

const outflow = {
  id: 'outflow',
  accountId: 'checking',
  categoryId: null,
  transferId: 'transfer',
  transferSide: 'outflow' as const,
  date: '2026-08-04',
  payeeId: null,
  memo: 'Move money',
  amount: -25_000,
  createdAt: new Date('2026-08-04T12:00:00.000Z'),
}

const inflow = {
  ...outflow,
  id: 'inflow',
  accountId: 'savings',
  transferSide: 'inflow' as const,
  amount: 25_000,
}

test('derives opposite Transfer sides from signed Amounts', () => {
  assert.equal(getTransferSide(-1), 'outflow')
  assert.equal(getTransferSide(1), 'inflow')
  assert.equal(getOppositeTransferSide('outflow'), 'inflow')
  assert.equal(getOppositeTransferSide('inflow'), 'outflow')
})

test('validates exactly one equal-and-opposite row per Account', () => {
  assert.equal(isValidTransferPair([outflow, inflow]), true)
  assert.equal(isValidTransferPair([outflow]), false)
  assert.equal(
    isValidTransferPair([outflow, { ...inflow, accountId: 'checking' }]),
    false,
  )
  assert.equal(
    isValidTransferPair([outflow, { ...inflow, amount: 20_000 }]),
    false,
  )
  assert.equal(
    isValidTransferPair([outflow, { ...inflow, categoryId: 'fees' }]),
    false,
  )
})

test('keeps linked rows adjacent with Outflow before Inflow', () => {
  const ordinary = {
    ...inflow,
    id: 'ordinary',
    transferId: null,
    transferSide: null,
    createdAt: new Date('2026-08-03T12:00:00.000Z'),
  }

  assert.deepEqual(
    sortRegisterTransactions([inflow, ordinary, outflow]).map((row) => row.id),
    ['outflow', 'inflow', 'ordinary'],
  )
})
