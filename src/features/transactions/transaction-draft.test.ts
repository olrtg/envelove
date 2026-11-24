import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getClearedAfterDraftAccountChange,
  getClearedAfterDraftDateChange,
} from './transaction-draft'

test('future dates uncheck Cleared without restoring it later', () => {
  const futureCleared = getClearedAfterDraftDateChange({
    cleared: true,
    date: '2026-08-05',
    today: '2026-08-04',
  })
  assert.equal(futureCleared, false)

  const returnedToToday = getClearedAfterDraftDateChange({
    cleared: futureCleared,
    date: '2026-08-04',
    today: '2026-08-04',
  })
  assert.equal(returnedToToday, false)
})

test('current and past dates preserve Cleared', () => {
  assert.equal(
    getClearedAfterDraftDateChange({
      cleared: true,
      date: '2026-08-03',
      today: '2026-08-04',
    }),
    true,
  )
})

test('creation drafts preserve Cleared when their Account changes', () => {
  assert.equal(
    getClearedAfterDraftAccountChange({
      cleared: true,
      currentAccountId: '',
      draftId: null,
      nextAccountId: 'checking',
    }),
    true,
  )
  assert.equal(
    getClearedAfterDraftAccountChange({
      cleared: true,
      currentAccountId: 'checking',
      draftId: null,
      nextAccountId: 'savings',
    }),
    true,
  )
})

test('edit drafts reset Cleared only when their Account changes', () => {
  assert.equal(
    getClearedAfterDraftAccountChange({
      cleared: true,
      currentAccountId: 'checking',
      draftId: 'transaction',
      nextAccountId: 'savings',
    }),
    false,
  )
  assert.equal(
    getClearedAfterDraftAccountChange({
      cleared: true,
      currentAccountId: 'checking',
      draftId: 'transaction',
      nextAccountId: 'checking',
    }),
    true,
  )
})
