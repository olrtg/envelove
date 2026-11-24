import { queryOptions } from '@tanstack/react-query'

import { listAccounts } from './accounts.functions'

export function planAccountsQueryKey(planId: string) {
  return ['accounts', planId] as const
}

export function planAccountsQueryOptions(planId: string, today: string) {
  return queryOptions({
    queryKey: [...planAccountsQueryKey(planId), today],
    queryFn: () => listAccounts({ data: { planId, today } }),
  })
}
