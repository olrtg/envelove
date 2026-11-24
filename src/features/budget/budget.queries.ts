import { queryOptions } from '@tanstack/react-query'

import { getCategoryHierarchy } from '#/features/categories/categories.functions'
import { monthOfDate } from '#/features/plans/plan-month'

// The current month's Ready to Assign, as the category picker shows it.
export function readyToAssignQueryOptions(planId: string, today: string) {
  return queryOptions({
    queryKey: ['ready-to-assign', planId, today],
    queryFn: () =>
      getCategoryHierarchy({
        data: { planId, month: monthOfDate(today), today },
      }),
    select: (hierarchy) => hierarchy.readyToAssign.total,
  })
}
