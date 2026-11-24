import assert from 'node:assert/strict'
import test from 'node:test'

// The router reads NODE_ENV when loaded to decide whether it runs on a server.
process.env.NODE_ENV = 'test'
const { createMemoryHistory, createRootRoute, createRoute, createRouter } =
  await import('@tanstack/react-router')
const { discardCachedPlanMonths, planMonthCaching } =
  await import('./plan-month-cache')

// A Plan route whose loader reports which budget edit it saw. Loads take a
// moment, as requests do, so a reload in the background lands after the
// navigation that started it.
function planRouter() {
  const budget = { edits: 0 }
  const rootRoute = createRootRoute()
  const planRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => ({
      month: String(search.month),
    }),
    loaderDeps: ({ search }) => ({ month: search.month }),
    loader: async ({ deps }) => {
      const edits = budget.edits
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { month: deps.month, edits }
    },
    ...planMonthCaching,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([planRoute]),
    history: createMemoryHistory({ initialEntries: ['/?month=2026-10'] }),
    isServer: false,
    origin: 'http://localhost',
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
  const edit = () => {
    budget.edits += 1
    discardCachedPlanMonths(router, planRoute.id)
  }
  // What the workspace mounts with: the loader data when navigation resolves.
  const open = async (month: string) => {
    await router.navigate({ to: '/', search: { month } })
    return router.state.matches.at(-1)?.loaderData
  }
  return { router, edit, open }
}

test('months visited before an edit load afresh afterwards', async () => {
  const { router, edit, open } = planRouter()
  await router.load()
  await open('2026-11')
  edit()

  assert.deepEqual(await open('2026-09'), { month: '2026-09', edits: 1 })
  assert.deepEqual(await open('2026-10'), { month: '2026-10', edits: 1 })
  assert.deepEqual(await open('2026-11'), { month: '2026-11', edits: 1 })
})

test('a preload from before an edit never serves the month', async () => {
  const { router, edit, open } = planRouter()
  await router.load()
  await router.preloadRoute({ to: '/', search: { month: '2026-11' } })
  const inFlight = router.preloadRoute({
    to: '/',
    search: { month: '2026-12' },
  })
  edit()
  await inFlight

  assert.deepEqual(await open('2026-11'), { month: '2026-11', edits: 1 })
  assert.deepEqual(await open('2026-12'), { month: '2026-12', edits: 1 })
})
