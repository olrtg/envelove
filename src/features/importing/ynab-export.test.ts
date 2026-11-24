import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { readYnabExport, exportSnapshot } from './ynab-export'
import { prepareYnabSnapshot } from './ynab-snapshot'

for (const ext of ['csv', 'tsv'])
  test(`native ${ext} preserves monthly assignments, quoted register text and ambiguous transfer lines`, () => {
    const delimiter = ext === 'csv' ? ',' : '\t'
    const encode = (rows: string[][]) =>
      strToU8(
        '\uFEFF' +
          rows
            .map((row) =>
              row
                .map((cell) => '"' + cell.replaceAll('"', '""') + '"')
                .join(delimiter),
            )
            .join('\r\n'),
      )
    const entry = (account: string, to: string) => [
      account,
      '05/12/2026',
      'Transfer : ' + to,
      '',
      '',
      '',
      '',
      '1',
      'Cleared',
    ]
    const outbound = entry('Everyday', 'Savings')
    outbound[6] = '1'
    outbound[7] = ''
    const file = zipSync({
      ['Test - Plan.' + ext]: encode([
        ['Month', 'Category Group', 'Category', 'Assigned'],
        [
          'Dec 2026',
          'Home',
          'Heat',
          ext === 'csv' ? '($1,234.56)' : '(1.234,56 €)',
        ],
      ]),
      ['Test - Register.' + ext]: encode([
        [
          'Account',
          'Date',
          'Payee',
          'Category Group',
          'Category',
          'Memo',
          'Outflow',
          'Inflow',
          'Cleared',
        ],
        [
          'Everyday',
          '04/12/2026',
          'Shop',
          'Home',
          'Heat',
          'Memo, "quoted"\non two lines',
          '7',
          '',
          'Reconciled',
        ],
        outbound,
        outbound,
        entry('Savings', 'Everyday'),
        entry('Savings', 'Everyday'),
      ]),
    })
    const source = readYnabExport(file),
      types = new Map([
        ['Everyday', 'checking'],
        ['Savings', 'savings'],
      ] as const)
    const result = prepareYnabSnapshot(
      exportSnapshot(source, 'EUR', 'DMY', types),
    )
    assert.equal(result.summary.name, 'Test')
    assert.equal(result.assignments[0].amount, -1234560)
    assert.equal(result.summary.transfers, 0)
    assert.match(result.summary.warnings.join(' '), /4 transfer lines kept/)
    assert.deepEqual(
      result.transactions.map((t) => t.amount),
      [-7000, -1000, -1000, 1000, 1000],
    )
    assert.equal(result.transactions[0].date, '2026-12-04')
    assert.equal(result.transactions[0].memo, 'Memo, "quoted"\non two lines')
    assert.equal(result.transactions[0].reconciled, true)
    source.plan[0]['Category Group'] = 'Hidden Categories'
    source.register[0]['Category Group'] = 'Hidden Categories'
    const hidden = prepareYnabSnapshot(
      exportSnapshot(source, 'EUR', 'DMY', types),
    )
    assert.deepEqual(
      hidden.groups.map((g) => g.name),
      ['Inflow', 'Imported categories'],
    )
    const heat = hidden.categories.find((c) => c.name === 'Heat')!
    assert.equal(heat.hidden, true)
    assert.equal(heat.categoryGroupId, hidden.groups[1].id)
    assert.equal(hidden.assignments[0].categoryId, heat.id)
    assert.equal(hidden.transactions[0].categoryId, heat.id)
    assert.match(hidden.summary.warnings.join(' '), /original group/)
    source.plan[0].Assigned = '1,23.4.5'
    assert.throws(() => exportSnapshot(source, 'EUR', 'DMY', types), /format/)
  })
test('refuses mismatched plan and register files', () => {
  assert.throws(
    () =>
      readYnabExport(
        zipSync({
          'Alpha - Plan.csv': strToU8(''),
          'Beta - Register.csv': strToU8(''),
        }),
      ),
    /matching Plan and Register/,
  )
})
