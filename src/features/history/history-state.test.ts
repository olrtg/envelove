import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearHistory,
  exclusive,
  pendingRetry,
  requestWithRetry,
  savedAction,
  stackFor,
} from './history-state'
import type { HistoryReceipt } from './history.schemas'

test('memory stacks isolate Plans, preserve redo on failure/no-op, and serialize saves', async () => {
  clearHistory()
  const receipt: HistoryReceipt = {
    id: crypto.randomUUID(),
    planId: 'one',
    description: 'created category Food',
    generation: 0,
  }
  const save = savedAction(async () => ({ value: 1, receipt }))
  await save({ data: {} })
  assert.equal(stackFor('one').undo.length, 1)
  assert.equal(stackFor('two').undo.length, 0)
  stackFor('one').redo.push(receipt)
  await savedAction(async () => ({ value: 1, receipt: null }))({ data: {} })
  assert.equal(stackFor('one').redo.length, 1)
  await assert.rejects(
    savedAction(async () => {
      throw new Error('invalid')
    })({ data: {} }),
    /invalid/,
  )
  assert.equal(stackFor('one').redo.length, 1)
  await save({ data: {} })
  assert.equal(stackFor('one').redo.length, 0)
  let release!: () => void
  const waiting = exclusive(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  await assert.rejects(save({ data: {} }), /in progress/)
  release()
  await waiting
  clearHistory()
  assert.equal(stackFor('one').undo.length, 0)
})
test('ambiguous transport failure blocks new saves until retry resolves', async () => {
  clearHistory()
  let calls = 0
  const receipt: HistoryReceipt = {
    id: crypto.randomUUID(),
    planId: 'one',
    description: 'created category Food',
    generation: 0,
  }
  let requestId: string | undefined
  const save = savedAction(async ({ data }) => {
    assert.ok(!requestId || requestId === data.requestId)
    requestId = data.requestId
    calls++
    if (calls === 1) throw new TypeError('Failed to fetch')
    return { value: 1, receipt }
  })
  await assert.rejects(save({ data: {} }), /unknown/)
  assert.equal(stackFor('one').undo.length, 0)
  await assert.rejects(save({ data: {} }), /Retry/)
  const retry = pendingRetry()!
  await exclusive(() => requestWithRetry(retry))
  assert.equal(stackFor('one').undo.length, 1)
  assert.equal(calls, 2)
  clearHistory()
})

test('logout ignores a late successful response instead of rebuilding old history', async () => {
  clearHistory()
  let resolve!: (response: { value: number; receipt: HistoryReceipt }) => void
  const receipt: HistoryReceipt = {
    id: crypto.randomUUID(),
    planId: 'one',
    description: 'created category Food',
    generation: 0,
  }
  const save = savedAction(
    () =>
      new Promise<{ value: number; receipt: HistoryReceipt }>((done) => {
        resolve = done
      }),
  )
  const pending = save({ data: {} })
  clearHistory()
  resolve({ value: 1, receipt })
  await pending
  assert.equal(stackFor('one').undo.length, 0)
})

test('a retry from the same confirmation reuses its operation and blocks a different proposal', async () => {
  clearHistory()
  const ids: string[] = []
  const save = savedAction(
    async ({
      data,
    }: {
      data: { value: { id: string }; requestId: string; tabId: string }
    }) => {
      ids.push(data.requestId)
      if (ids.length < 3) throw new TypeError('Failed to fetch')
      return { value: 'saved', receipt: null }
    },
    { retryFromForm: true },
  )
  const original = { data: { id: 'one' } }
  await assert.rejects(save(original), /unknown/)
  await assert.rejects(save({ data: { id: 'two' } }), /Retry/)
  await assert.rejects(save(original), /unknown/)
  assert.equal(await save(original), 'saved')
  assert.equal(new Set(ids).size, 1)
  assert.equal(pendingRetry(), undefined)
})
