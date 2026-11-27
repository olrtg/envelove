import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { SpendingRing } from './report-charts'

test('the initial spending ring includes slice titles before hydration', () => {
  const html = renderToString(
    createElement(SpendingRing, {
      items: [
        { id: 'rent', name: 'Rent', value: 999 },
        { id: 'postage', name: 'Postage', value: 1 },
      ],
      label: '••••',
      onSelect: () => {},
    }),
  )
  assert.ok(html.includes('<title>Rent: 99.9%</title>'))
  assert.ok(html.includes('<title>Postage: 0.1%</title>'))
})
