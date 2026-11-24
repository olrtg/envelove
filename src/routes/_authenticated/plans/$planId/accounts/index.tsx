import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { TransactionRegister } from '#/features/transactions/transaction-register'
import { getTransactionRegister } from '#/features/transactions/transactions.functions'
import { getLocalDate } from '#/features/transactions/transaction-money'

export const Route = createFileRoute('/_authenticated/plans/$planId/accounts/')(
  {
    loaderDeps: () => ({ today: getLocalDate() }),
    loader: ({ params, deps }) =>
      getTransactionRegister({ data: { planId: params.planId, ...deps } }),
    pendingComponent: AllAccountsRoutePending,
    errorComponent: AllAccountsRouteError,
    component: AllAccountsRoute,
  },
)

function AllAccountsRoute() {
  const { planId } = Route.useParams()
  const register = Route.useLoaderData()

  return (
    <TransactionRegister
      accounts={register.accounts}
      categoryGroups={register.categoryGroups}
      initialPage={register.page}
      initialSummary={register.summary}
      key={planId}
      payees={register.payees}
      plan={register.plan}
      scope={{ kind: 'plan' }}
    />
  )
}

function AllAccountsRoutePending() {
  return (
    <main className="flex min-h-full flex-1 flex-col">
      <header className="border-b py-5 pl-14 pr-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-80" />
      </header>
      <div className="flex flex-col gap-5 p-6">
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    </main>
  )
}

function AllAccountsRouteError() {
  const router = useRouter()

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-xl font-semibold">
          All Accounts could not be loaded
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
