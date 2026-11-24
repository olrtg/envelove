import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db'
import * as schema from '#/db/schema'
import { insertPlan } from '#/features/plans/plans.server'
import { emailAllowed, revokeSessions } from '#/lib/auth-allowlist.server'
import { sendSignInCodeEmail } from '#/lib/email.server'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema,
  }),
  emailAndPassword: {
    enabled: false,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      switch (ctx.path) {
        case '/email-otp/send-verification-otp':
          // Give the same answer without storing or mailing a code.
          if (ctx.body.type !== 'sign-in' || !emailAllowed(ctx.body.email)) {
            return ctx.json({ success: true })
          }
          break
        case '/sign-in/email-otp':
          if (!emailAllowed(ctx.body.email)) {
            throw new APIError('BAD_REQUEST', { message: 'Invalid code' })
          }
          break
        case '/get-session':
        case '/sign-out':
          break
        default:
          // The app uses no other public account-management endpoints.
          if (ctx.request) throw new APIError('NOT_FOUND')
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path === '/get-session' &&
        ctx.context.session &&
        !emailAllowed(ctx.context.session.user.email)
      ) {
        revokeSessions(ctx.context.session.user.id)
        return ctx.json(null)
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          insertPlan({ ownerId: user.id, name: 'My plan', countryCode: 'US' })
        },
      },
    },
  },
  plugins: [
    emailOTP({
      allowedAttempts: 3,
      expiresIn: 60 * 10,
      otpLength: 6,
      rateLimit: {
        window: 60,
        max: 5,
      },
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== 'sign-in') {
          throw new Error(`Unsupported email OTP type: ${type}`)
        }

        await sendSignInCodeEmail({ email, otp })
      },
      storeOTP: 'hashed',
    }),
    tanstackStartCookies(),
  ],
})
