import assert from 'node:assert/strict'
import test from 'node:test'

import { addDays, formatDateInput, parseDateInput } from './transaction-date'

const today = '2026-10-02'

test('formats dates in the locale order', () => {
  assert.equal(formatDateInput('2026-09-05', 'en-US'), '09/05/2026')
  assert.equal(formatDateInput('2026-09-05', 'es-PY'), '05/09/2026')
  assert.equal(formatDateInput('2026-09-05', 'de-DE'), '05.09.2026')
})

test('parses full dates in the locale order', () => {
  assert.equal(parseDateInput('09/05/2026', 'en-US', today), '2026-09-05')
  assert.equal(parseDateInput('05/09/2026', 'es-PY', today), '2026-09-05')
  assert.equal(parseDateInput('5.9.26', 'de-DE', today), '2026-09-05')
  for (const locale of ['th-TH', 'bn-BD', 'fa-IR']) {
    assert.equal(
      parseDateInput(formatDateInput('2026-09-05', locale), locale, today),
      '2026-09-05',
    )
  }
})

test('fills missing parts from today', () => {
  assert.equal(parseDateInput('15', 'en-US', today), '2026-10-15')
  assert.equal(parseDateInput('9/5', 'en-US', today), '2026-09-05')
  assert.equal(parseDateInput('5/9', 'es-PY', today), '2026-09-05')
})

test('rejects impossible dates', () => {
  assert.equal(parseDateInput('31', 'en-US', '2026-09-10'), null)
  assert.equal(parseDateInput('02/30/2026', 'en-US', today), null)
  assert.equal(parseDateInput('zzz', 'en-US', today), null)
  assert.equal(parseDateInput('1/2/3/4', 'en-US', today), null)
})

test('moves dates by days across months', () => {
  assert.equal(addDays('2026-10-02', -7), '2026-09-25')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})
