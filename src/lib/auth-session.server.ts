import { getRequest, setResponseStatus } from '@tanstack/react-start/server'

import { auth } from '#/lib/auth'

export async function requireUser() {
  const request = getRequest()
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  if (!session?.user) {
    setResponseStatus(401)
    throw new Error('Unauthorized')
  }

  return session.user
}
