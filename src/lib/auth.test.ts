import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

test('only currently allowed addresses receive and redeem codes or access sessions', async (t) => {
  const origin = 'http://localhost:3000'
  const email = 'lee@example.test'
  process.env.DATABASE_URL = ':memory:'
  process.env.BETTER_AUTH_URL = origin
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex')
  process.env.RESEND_API_KEY = 'test-only'
  process.env.AUTH_EMAIL_FROM = 'auth@example.test'
  const { db } = await import('#/db')
  migrate(db, { migrationsFolder: './drizzle' })
  const { auth } = await import('./auth')
  const messages: Array<{ to: string[]; subject: string }> = []
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      assert.equal(url, 'https://api.resend.com/emails')
      messages.push(JSON.parse(String(options.body)))
      return Response.json({ id: 'message-id' })
    },
  )
  const post = (path: string, body: object) =>
    auth.handler(
      new Request(`${origin}/api/auth/${path}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  const send = (to: string) =>
    post('email-otp/send-verification-otp', { email: to, type: 'sign-in' })
  const redeem = (otp: string) => post('sign-in/email-otp', { email, otp })
  const allowed = 'other@example.test, LEE@Example.test '
  process.env.AUTH_ALLOWED_EMAILS = allowed
  const denied = await send(`not-${email}`)
  assert.deepEqual(await denied.json(), { success: true })
  assert.equal(messages.length, 0)
  assert.equal((await send(email)).status, 200)
  assert.deepEqual(messages[0].to, [email])
  const code = messages[0].subject.slice(0, 6)

  delete process.env.AUTH_ALLOWED_EMAILS
  assert.equal((await redeem(code)).status, 400) // No signup with an outstanding code.
  process.env.AUTH_ALLOWED_EMAILS = allowed
  const login = await redeem(code)
  assert.equal(login.status, 200)
  const cookieFrom = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
  const cookie = cookieFrom(login)
  const session = (deviceCookie = cookie) =>
    auth
      .handler(
        new Request(`${origin}/api/auth/get-session`, {
          headers: { cookie: deviceCookie },
        }),
      )
      .then((r) => r.json())
  assert.equal((await session()).user.email, email)

  assert.equal((await send(email)).status, 200)
  process.env.AUTH_ALLOWED_EMAILS = ''
  assert.equal((await redeem(messages[1].subject.slice(0, 6))).status, 400) // Existing account too.
  assert.equal(await session(), null)
  process.env.AUTH_ALLOWED_EMAILS = allowed
  assert.equal(await session(), null) // A session rejected on access stays revoked.

  await t.test(
    'applying a new allowlist revokes offline sessions without affecting allowed users',
    async () => {
      const { default: applyAllowlist } =
        await import('./auth-allowlist.server')
      const signIn = async (address: string) => {
        const otp = await auth.api.createVerificationOTP({
          body: { email: address, type: 'sign-in' },
        })
        const response = await auth.api.signInEmailOTP({
          asResponse: true,
          body: { email: address, otp },
        })
        assert.equal(response.status, 200)
        return cookieFrom(response)
      }
      const phone = await signIn(email),
        laptop = await signIn(email)
      const other = await signIn('other@example.test')
      assert.notEqual(phone, laptop)
      const userId = (await session(phone)).user.id
      assert.equal((await session(laptop)).user.id, userId)
      process.env.AUTH_ALLOWED_EMAILS = ' OTHER@Example.test '
      applyAllowlist()
      // Neither removed device made a request while the user was off the list.
      process.env.AUTH_ALLOWED_EMAILS = allowed
      applyAllowlist()
      assert.equal(await session(phone), null)
      assert.equal(await session(laptop), null)
      assert.equal((await session(other)).user.email, 'other@example.test')
      assert.equal((await session(await signIn(email))).user.id, userId)

      delete process.env.AUTH_ALLOWED_EMAILS
      applyAllowlist()
      process.env.AUTH_ALLOWED_EMAILS = allowed
      assert.equal(await session(other), null)
    },
  )
})
