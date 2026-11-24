import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { TransactionRegister } from '#/features/transactions/transaction-register'
import { getTransactionRegister } from '#/features/transactions/transactions.functions'
import { getLocalDate } from '#/features/transactions/transaction-money'

export const Route = createFileRoute(
  '/_authenticated/plans/$planId/accounts/$accountId',
)({
  validateSearch: z.object({
    transaction: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    selectedId: search.transaction,
    today: getLocalDate(),
  }),
  loader: ({ params, deps }) =>
    getTransactionRegister({ data: { ...params, ...deps } }),
  pendingComponent: TransactionRoutePending,
  errorComponent: TransactionRouteError,
  component: TransactionRoute,
})

function TransactionRoute() {
  const { accountId } = Route.useParams()
  const { transaction } = Route.useSearch()
  const register = Route.useLoaderData()

  return (
    <TransactionRegister
      accounts={register.accounts}
      categoryGroups={register.categoryGroups}
      initialPage={register.page}
      initialSummary={register.summary}
      key={`${accountId}:${transaction ?? ''}`}
      payees={register.payees}
      plan={register.plan}
      scope={{ kind: 'account', account: register.account! }}
      selectedTransactionId={transaction}
    />
  )
}

function TransactionRoutePending() {
  return (
    <main className="flex min-h-full flex-1 flex-col">
      <header className="border-b py-5 pl-14 pr-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
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

function TransactionRouteError() {
  const router = useRouter()

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-xl font-semibold">
          Transactions could not be loaded
        </h1>
        <p className="text-sm text-muted-foreground">
          The Account may not exist, or the request may have failed.
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
