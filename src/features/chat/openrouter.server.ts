import { createHash, randomBytes } from 'node:crypto'
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { db } from '#/db'
import { openRouterConnections as connections } from '#/db/schema'

const byOwner = (owner: string) => eq(connections.ownerId, owner)
function encryptionKey(owner: string) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32)
    throw new Error(
      'Configure a strong BETTER_AUTH_SECRET to connect OpenRouter.',
    )
  return `${secret}:envelove:openrouter:${owner}`
}

export function isConnected(owner: string) {
  return Boolean(
    db
      .select({ key: connections.encryptedKey })
      .from(connections)
      .where(byOwner(owner))
      .get()?.key,
  )
}

export function disconnect(owner: string) {
  db.delete(connections).where(byOwner(owner)).run()
}

export function beginConnection(owner: string, planId?: string) {
  encryptionKey(owner)
  const callback = new URL(
    '/api/openrouter/callback',
    process.env.BETTER_AUTH_URL,
  )
  if (
    callback.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname)
  )
    throw new Error('Use HTTPS or localhost to connect OpenRouter.')
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(24).toString('base64url')
  const pending = {
    state,
    verifier,
    returnPlan: planId ?? null,
    expiresAt: Date.now() + 600_000,
  }
  db.insert(connections)
    .values({ ownerId: owner, ...pending })
    .onConflictDoUpdate({ target: connections.ownerId, set: pending })
    .run()
  callback.searchParams.set('state', state)
  const url = new URL('https://openrouter.ai/auth')
  url.searchParams.set('callback_url', callback.href)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set(
    'code_challenge',
    createHash('sha256').update(verifier).digest('base64url'),
  )
  return url.href
}

export async function finishConnection(owner: string, params: URLSearchParams) {
  const attempt = and(
    byOwner(owner),
    eq(connections.state, params.get('state') ?? ''),
  )
  const pending = db.select().from(connections).where(attempt).get()
  if (
    !pending?.verifier ||
    !pending.expiresAt ||
    pending.expiresAt <= Date.now()
  )
    return '/'
  db.update(connections).set({ verifier: null }).where(attempt).run()
  const back = pending.returnPlan
    ? `/plans/${encodeURIComponent(pending.returnPlan)}/chat`
    : '/settings'
  try {
    const code = params.get('code')
    if (!code) return `${back}?connection=failed`
    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        code,
        code_verifier: pending.verifier,
        code_challenge_method: 'S256',
      }),
    })
    if (!response.ok) return `${back}?connection=failed`
    const { key } = z
      .object({ key: z.string().min(1) })
      .parse(await response.json())
    const encryptedKey = await symmetricEncrypt({
      key: encryptionKey(owner),
      data: key,
    })
    // A disconnect or a newer authorization while exchanging must win.
    const saved = db
      .update(connections)
      .set({ encryptedKey, state: null, returnPlan: null, expiresAt: null })
      .where(attempt)
      .run()
    return saved.changes ? back : `${back}?connection=failed`
  } catch {
    return `${back}?connection=failed`
  }
}

export async function budgetChatAdapter(owner: string) {
  const row = db.select().from(connections).where(byOwner(owner)).get()
  if (!row?.encryptedKey)
    throw new Error('Connect OpenRouter before sending a question.')
  const key = await symmetricDecrypt({
    key: encryptionKey(owner),
    data: row.encryptedKey,
  })
  return createOpenRouterText('openai/gpt-4.1-mini', key, { timeoutMs: 45_000 })
}
