import { createFileRoute } from '@tanstack/react-router'

import { auth } from '#/lib/auth'

export const Route = createFileRoute('/api/dev/sign-in')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!import.meta.env.DEV) {
          return new Response('Not found', { status: 404 })
        }

        const email = process.env.SEED_EMAIL

        if (!email) {
          return new Response(null, {
            status: 302,
            headers: { Location: '/login' },
          })
        }

        const otp = await auth.api.createVerificationOTP({
          body: { email, type: 'sign-in' },
        })
        await auth.api.signInEmailOTP({
          body: { email, otp },
          headers: request.headers,
        })

        return new Response(null, { status: 302, headers: { Location: '/' } })
      },
    },
  },
})
