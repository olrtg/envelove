import {
  Outlet,
  createFileRoute,
  redirect,
  useMatches,
} from '@tanstack/react-router'

import { AppShell } from '#/components/app-shell'
import { getAuthSession } from '#/lib/auth.functions'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const session = await getAuthSession()

    if (!session?.user) {
      if (import.meta.env.DEV) {
        throw redirect({ href: '/api/dev/sign-in', reloadDocument: true })
      }

      throw redirect({ to: '/login' })
    }

    return { user: session.user }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext()
  const matches = useMatches()
  const planMatch = matches.find(
    (match) => match.routeId === '/_authenticated/plans/$planId',
  )
  const accountMatch = matches.find(
    (match) =>
      match.routeId === '/_authenticated/plans/$planId/accounts/$accountId',
  )

  return (
    <AppShell
      activeAccountId={accountMatch ? accountMatch.params.accountId : undefined}
      activeAllAccounts={matches.some(
        (match) => match.routeId === '/_authenticated/plans/$planId/accounts/',
      )}
      activePayees={matches.some(
        (match) => match.routeId === '/_authenticated/plans/$planId/payees',
      )}
      activeReflect={matches.some(
        (match) => match.routeId === '/_authenticated/plans/$planId/reflect',
      )}
      activeChat={matches.some(
        (match) => match.routeId === '/_authenticated/plans/$planId/chat',
      )}
      activePlanId={planMatch ? planMatch.params.planId : undefined}
      user={user}
    >
      <Outlet />
    </AppShell>
  )
}
