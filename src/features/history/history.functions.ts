import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '#/lib/auth-session.server'
import { reverseSchema } from './history.schemas'
import { reverseAction } from './history.server'

export const reverseSavedAction = createServerFn({ method: 'POST' })
  .validator(reverseSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    return reverseAction(user.id, data)
  })
