import type { AnyRouter } from '@tanstack/react-router'

// The Plan workspace keeps its own amounts once mounted and never takes
// reloaded loader data, so a cached Plan Month would show amounts as of its
// load. A month the user leaves is dropped at once and loads afresh when
// revisited.
export const planMonthCaching = { gcTime: 0 }

// After a budget edit every other month is out of date, including months a
// link preloaded. The open month is an active match, not a cached one, so its
// workspace stays mounted.
export function discardCachedPlanMonths(router: AnyRouter, routeId: string) {
  router.clearCache({ filter: (match) => match.routeId === routeId })
}
