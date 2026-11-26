import { createFileRoute } from '@tanstack/react-router'
import { finishConnection } from '#/features/chat/openrouter.server'
import { auth } from '#/lib/auth'

export const Route = createFileRoute('/api/openrouter/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        const location = session
          ? await finishConnection(
              session.user.id,
              new URL(request.url).searchParams,
            )
          : '/login'
        return new Response(null, {
          status: 303,
          headers: {
            Location: location,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          },
        })
      },
    },
  },
})
