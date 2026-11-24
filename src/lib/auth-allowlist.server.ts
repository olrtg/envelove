import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { session, user } from '#/db/auth-schema'

export function emailAllowed(email: unknown) {
  return (
    typeof email === 'string' &&
    !!email &&
    (process.env.AUTH_ALLOWED_EMAILS ?? '')
      .split(',')
      .some((entry) => entry.trim().toLowerCase() === email.toLowerCase())
  )
}

export function revokeSessions(userId: string) {
  db.delete(session).where(eq(session.userId, userId)).run()
}

// The allowlist is applied on restart. Revoke even if none of the removed
// user's devices make a request before that address is allowed again.
export default function revokeDisallowedSessions() {
  db.transaction(() => {
    for (const row of db
      .select({ id: user.id, email: user.email })
      .from(user)
      .all()) {
      if (!emailAllowed(row.email)) revokeSessions(row.id)
    }
  })
}
