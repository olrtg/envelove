import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { CategoryWorkspace } from '#/features/categories/category-workspace'
import { getCategoryHierarchy } from '#/features/categories/categories.functions'
import {
  isPlanMonthInBounds,
  monthOfDate,
  planMonthBounds,
  planMonthSchema,
} from '#/features/plans/plan-month'
import {
  discardCachedPlanMonths,
  planMonthCaching,
} from '#/features/plans/plan-month-cache'
import { getPlan } from '#/features/plans/plans.functions'
import { getLocalDate } from '#/features/transactions/transaction-money'

export const Route = createFileRoute('/_authenticated/plans/$planId/')({
  validateSearch: z.object({
    month: planMonthSchema.optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ month: search.month, today: getLocalDate() }),
  loader: async ({ params, deps: { today, ...deps } }) => {
    const month = deps.month ?? monthOfDate(today)
    const [plan, { groups, readyToAssign }] = await Promise.all([
      getPlan({ data: { id: params.planId } }),
      getCategoryHierarchy({
        data: { planId: params.planId, month, today },
      }),
    ])
    const bounds = planMonthBounds({ ...plan, today })

    if (!isPlanMonthInBounds(month, bounds)) {
      throw redirect({
        to: '/plans/$planId',
        params,
        search: {},
        replace: true,
      })
    }

    return { plan, groups, readyToAssign, month, bounds }
  },
  // The default month and Activity cutoff follow the browser's Current Day,
  // which the server cannot know.
  ssr: false,
  ...planMonthCaching,
  pendingComponent: CategoryRoutePending,
  errorComponent: CategoryRouteError,
  component: CategoryRoute,
})

function CategoryRoute() {
  const router = useRouter()
  const { planId } = Route.useParams()
  const { today } = Route.useLoaderDeps()
  const { plan, groups, readyToAssign, month, bounds } = Route.useLoaderData()
  // Amounts stay out of the key: they refresh inside the workspace so an
  // Assigned edit never remounts it and loses focus.
  const revision = groups.map((group) => [
    group.id,
    group.updatedAt,
    group.categories.map((category) => [
      category.id,
      category.name,
      category.hidden,
      category.creditAccountClosed,
      category.transactionCount,
      category.updatedAt,
    ]),
  ])

  return (
    <CategoryWorkspace
      initialBounds={bounds}
      initialGroups={groups}
      initialReadyToAssign={readyToAssign}
      key={JSON.stringify([planId, month, today, revision])}
      month={month}
      onBudgetChange={() => discardCachedPlanMonths(router, Route.id)}
      plan={plan}
      today={today}
    />
  )
}

function CategoryRoutePending() {
  return (
    <main className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center gap-2 border-b py-3 pl-14 pr-6">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="ml-8 h-14 w-52 rounded-lg" />
      </header>
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </main>
  )
}

function CategoryRouteError() {
  const router = useRouter()

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="font-heading text-xl font-semibold">
          Categories could not be loaded
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
