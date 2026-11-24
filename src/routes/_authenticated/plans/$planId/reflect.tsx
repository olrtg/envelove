import { createFileRoute } from '@tanstack/react-router'
import { Reflect } from '#/features/reports/reflect'
import { getReportWorkspace } from '#/features/reports/reports.functions'
import { getLocalDate } from '#/features/transactions/transaction-money'

export const Route = createFileRoute('/_authenticated/plans/$planId/reflect')({
  loaderDeps: () => ({ today: getLocalDate() }),
  loader: ({ params, deps }) =>
    getReportWorkspace({ data: { planId: params.planId, today: deps.today } }),
  component: ReflectRoute,
})

function ReflectRoute() {
  const workspace = Route.useLoaderData()
  return <Reflect key={workspace.plan.id} workspace={workspace} />
}
