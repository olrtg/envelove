import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

process.env.DATABASE_URL = ':memory:'
process.env.BETTER_AUTH_URL = 'https://budget.example.test'
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex')
const { db } = await import('#/db')
const { beginConnection, finishConnection, disconnect, isConnected } =
  await import('./openrouter.server')
const { answerBudgetQuestion, spendingContext } = await import('./chat.server')
for (const file of readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  db.$client.exec(readFileSync(`drizzle/${file}`, 'utf8'))
db.$client
  .exec(`insert into user(id,name,email,email_verified) values ('a','A','a@example.test',1), ('b','B','b@example.test',1);
insert into plans(id,owner_id,name) values ('pa','a','First'), ('pb','b','Second');
insert into accounts(id,plan_id,name,type) values ('aa','pa','Cash','cash'), ('ab','pb','Other','cash');
insert into transactions(id,account_id,date,amount,memo) values ('t1','aa','2026-10-31',-12340,'private memo'),('t2','ab','2026-10-31',-900000,'other memo');`)

test('budget chat exposes only owned plan category totals, in currency units', () => {
  assert.throws(
    () => spendingContext('b', 'pa', '2026-11-15'),
    /Plan not found/,
  )
  assert.deepEqual(spendingContext('a', 'pa', '2026-11-15'), {
    today: '2026-11-15',
    currency: 'USD',
    months: [
      {
        month: '2026-10',
        categories: [{ category: 'Uncategorized', spent: 12.34 }],
      },
      { month: '2026-11', categories: [] },
    ],
  })
})

test('authorization is owner-bound and single use; only the connected owner can use the issued key', async (t) => {
  let start = new URL(beginConnection('a', 'pa'))
  const callback = new URL(start.searchParams.get('callback_url')!)
  assert.equal(callback.origin, 'https://budget.example.test')
  callback.searchParams.set('code', 'fixture-code')
  assert.equal(await finishConnection('b', callback.searchParams), '/')
  const fixtureKey = randomBytes(32).toString('hex')
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      if (req.url === 'https://openrouter.ai/api/v1/auth/keys') {
        const exchange = await req.json()
        assert.equal(exchange.code, 'fixture-code')
        assert.equal(
          createHash('sha256')
            .update(exchange.code_verifier)
            .digest('base64url'),
          start.searchParams.get('code_challenge'),
        )
        return Response.json({ key: fixtureKey })
      }
      assert.equal(req.url, 'https://openrouter.ai/api/v1/chat/completions')
      assert.equal(req.headers.get('authorization'), `Bearer ${fixtureKey}`)
      const body = await req.text()
      assert.match(body, /12\.34/)
      assert.doesNotMatch(body, /private memo|other memo/)
      const chunk = {
        id: 'fixture',
        model: 'openai/gpt-4.1-mini',
        object: 'chat.completion.chunk',
        created: 1,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: 'October spending was USD 12.34.',
            },
            finish_reason: 'stop',
          },
        ],
      }
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    },
  )
  assert.equal(
    await finishConnection('a', callback.searchParams),
    '/plans/pa/chat',
  )
  assert.equal(await finishConnection('a', callback.searchParams), '/')
  assert.equal(isConnected('a'), true)
  assert.equal(isConnected('b'), false)
  assert.ok(
    !JSON.stringify(
      db.$client.prepare('select * from openrouter_connections').all(),
    ).includes(fixtureKey),
  )
  const question = [
    { role: 'user' as const, content: 'What did I spend in October?' },
  ]
  assert.equal(
    await answerBudgetQuestion('a', 'pa', '2026-11-15', question),
    'October spending was USD 12.34.',
  )
  disconnect('b')
  assert.equal(isConnected('a'), true)
  disconnect('a')
  await assert.rejects(
    answerBudgetQuestion('a', 'pa', '2026-11-15', question),
    /Connect OpenRouter/,
  )
  start = new URL(beginConnection('a'))
  const accountCallback = new URL(start.searchParams.get('callback_url')!)
  accountCallback.searchParams.set('code', 'fixture-code')
  assert.equal(
    await finishConnection('a', accountCallback.searchParams),
    '/settings',
  )
  assert.equal(isConnected('a'), true)
})
