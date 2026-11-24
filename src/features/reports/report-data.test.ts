import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { monthOfDate } from '#/features/plans/plan-month'

process.env.DATABASE_URL = ':memory:'
const { db } = await import('#/db')
const { spendingTotals, spendingRows, netWorth, reportOptions } =
  await import('./reports.server')
for (const file of readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  db.$client.exec(readFileSync(`drizzle/${file}`, 'utf8'))
db.$client.exec(`
insert into user(id,name,email,email_verified) values('owner','Test','fixture@example.invalid',1);
insert into plans(id,owner_id,name) values ('p','owner','Test');
insert into accounts(id,plan_id,name,type) values ('cash','p','Cash','cash'),('card','p','Card','credit_card'),('tracking','p','Tracking','asset');
insert into category_groups(id,plan_id,name,position) values ('needs','p','Needs',0);
insert into categories(id,category_group_id,name,position) values ('food','needs','Food',0),('travel','needs','Travel',1);
insert into transactions(id,account_id,date,amount,starting_balance) values ('open','cash','2026-01-01',100,1),('debt','card','2026-02-01',-35,1);
insert into transactions(id,account_id,category_id,date,amount) values ('purchase','cash','food','2026-04-07',-150),('refund','cash','food','2026-04-08',23),('inflow','cash','travel','2026-04-08',14),('future','cash','food','2026-04-09',99);
insert into transfers(id,plan_id) values ('internal','p'),('external','p');
insert into transactions(id,account_id,date,amount,transfer_id,transfer_side) values ('i1','cash','2026-04-05',-3,'internal','outflow'),('i2','card','2026-04-05',3,'internal','inflow'),('e1','cash','2026-04-08',-8,'external','outflow'),('e2','tracking','2026-04-08',8,'external','inflow');`)

const today = '2026-04-08',
  from = monthOfDate('2026-03-01'),
  to = monthOfDate(today)
const range = {
  planId: 'p',
  today,
  from,
  to,
  excludedAccounts: [],
  excludedCategories: [],
  byGroup: false,
}

test('monthly net worth carries opening balances over quiet months and reclassifies overdrawn accounts, excluding future entries', () => {
  assert.deepEqual(netWorth('owner', range), [
    { month: from, assets: 100, debts: 35, net: 65 },
    { month: to, assets: 8, debts: 56, net: -48 },
  ])
})

test('spending summaries and drilldowns use the same account, category, transfer and date rules', () => {
  const filtered = { ...range, excludedAccounts: ['card'] }
  assert.deepEqual(
    spendingTotals('owner', filtered).map((b) => [b.id, b.value, b.count]),
    [
      ['food', 127, 2],
      ['uncategorized', 8, 1],
      ['travel', -14, 1],
    ],
  )
  assert.deepEqual(spendingTotals('owner', { ...filtered, byGroup: true })[0], {
    id: 'needs',
    name: 'Needs',
    value: 113,
    count: 3,
  })
  const drill = {
    ...filtered,
    byGroup: true,
    bucketId: 'needs',
    excludedCategories: ['travel'],
  }
  assert.deepEqual(
    spendingRows('owner', drill).map((r) => r.id),
    ['refund', 'purchase'],
  )
  assert.deepEqual(spendingRows('another-owner', drill), [])
  assert.deepEqual(spendingTotals('another-owner', filtered), [])
  assert.equal(reportOptions('p', 'another-owner'), null)
})
