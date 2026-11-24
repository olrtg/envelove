import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { PayeeManager } from '#/features/payees/payee-manager'
import { getPayees } from '#/features/payees/payees.functions'

export const Route = createFileRoute('/_authenticated/plans/$planId/payees')({
  loader: ({ params }) => getPayees({ data: { planId: params.planId } }),
  pendingComponent: PayeesRoutePending,
  errorComponent: PayeesRouteError,
  component: PayeesRoute,
})

function PayeesRoute() {
  const { planId } = Route.useParams()
  const payees = Route.useLoaderData()

  return <PayeeManager payees={payees} key={planId} planId={planId} />
}

function PayeesRoutePending() {
  return (
    <main className="flex min-h-full flex-1 flex-col">
      <header className="border-b py-5 pl-14 pr-6">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="mt-2 h-4 w-80" />
      </header>
      <div className="flex flex-col gap-5 p-6">
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-80 w-full" />
      </div>
    </main>
  )
}

function PayeesRouteError() {
  const router = useRouter()

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-xl font-semibold">
          Payees could not be loaded
        </h1>
        <p className="text-sm text-muted-foreground">
          The Plan may not exist, or the request may have failed.
        </p>
        <Button
          onClick={() => {
            void router.invalidate()
          }}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    </main>
  )
}
