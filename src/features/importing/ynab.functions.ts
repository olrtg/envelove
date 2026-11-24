import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '#/lib/auth-session.server'
import { countryCodeSchema } from '#/features/plans/plan.schemas'
import { maxSnapshotBytes, uploadTooLarge } from './ynab-limits'
import { importYnabPlan } from './ynab.server'

export const importYnab = createServerFn({ method: 'POST' })
  .validator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error('Choose a snapshot file.')
    return data
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    const file = data.get('snapshot')
    if (!(file instanceof File)) throw new Error('Choose a snapshot file.')
    if (file.size > maxSnapshotBytes)
      throw new Response(uploadTooLarge, { status: 413 })
    return importYnabPlan(
      await file.text(),
      countryCodeSchema.parse(data.get('country')),
      user.id,
    )
  })
