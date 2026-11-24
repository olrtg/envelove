import { createServerFn } from '@tanstack/react-start'
import {
  getRequestHeaders,
  setResponseHeader,
} from '@tanstack/react-start/server'

import { auth } from '#/lib/auth'

export const getAuthSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    })

    setResponseHeader('Cache-Control', 'no-store')
    return session
  },
)
