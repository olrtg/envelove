import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AmountPrivacy } from '#/hooks/use-amount-privacy'

test('hidden assigned cells never render an editable or copyable balance', async () => {
  process.env.DATABASE_URL = ':memory:'
  const { AssignedCell } = await import('../categories/budget-cells')
  const cell = h(AssignedCell, {
    amount: -1234560,
    currency: { countryCode: 'US', currencyCode: 'USD' },
    label: 'Food',
    onCommit: () => {},
  })
  for (const markup of [
    renderToStaticMarkup(cell),
    renderToStaticMarkup(h(AmountPrivacy, { value: true }, cell)),
  ]) {
    assert.match(markup, /value="−••••"/)
    assert.match(markup, /disabled=""/)
    assert.doesNotMatch(markup, /1,234|1234/)
  }
  const shown = renderToStaticMarkup(h(AmountPrivacy, { value: false }, cell))
  assert.match(shown, /value="-\$1,234\.56"/)
  assert.doesNotMatch(shown, /disabled=""/)
})
