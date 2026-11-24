import { useState } from 'react'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '#/components/ui/popover'
import {
  addMonths,
  formatPlanMonth,
  monthOfDate,
  parsePlanMonth,
  planMonthOf,
} from '#/features/plans/plan-month'
import { useMoney } from '#/hooks/use-amount-privacy'
import { BalanceChart, seriesColor, SpendingRing } from './report-charts'
import {
  getNetWorth,
  getSpendingTotals,
  getSpendingRows,
} from './reports.functions'
import type { getReportWorkspace } from './reports.functions'

function MultiFilter({
  label,
  options,
  excluded,
  setExcluded,
}: {
  label: string
  options: Array<{ id: string; name: string }>
  excluded: Array<string>
  setExcluded: (ids: Array<string>) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {excluded.length ? options.length - excluded.length : 'All'} {label}
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 overflow-auto">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setExcluded(excluded.length ? [] : options.map((o) => o.id))
          }
        >
          {excluded.length ? 'Select all' : 'Deselect all'}
        </Button>
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 px-2 py-1">
            <input
              type="checkbox"
              checked={!excluded.includes(o.id)}
              onChange={() =>
                setExcluded(
                  excluded.includes(o.id)
                    ? excluded.filter((id) => id !== o.id)
                    : [...excluded, o.id],
                )
              }
            />
            {o.name}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function Reflect({
  workspace,
}: {
  workspace: Awaited<ReturnType<typeof getReportWorkspace>>
}) {
  const { accounts, categories, plan, today } = workspace
  // The route already carries the initial chart. Keep subsequent interactive
  // results local to this report rather than dehydrating the query cache.
  const [client] = useState(() => new QueryClient())
  const current = monthOfDate(today)
  const [report, setReport] = useState('Spending Breakdown'),
    spending = report === 'Spending Breakdown'
  const [preset, setPreset] = useState('6'),
    [customFrom, setFrom] = useState(addMonths(current, -5)),
    [customTo, setTo] = useState(current)
  const first =
    workspace.first && workspace.first < today ? workspace.first : today
  const january = planMonthOf(Number(current.slice(0, 4)), 1)
  const ranges = new Map([
    ['custom', [customFrom, customTo]],
    ['all', [monthOfDate(first), current]],
    ['ytd', [january, current]],
    ['lastYear', [addMonths(january, -12), addMonths(january, -1)]],
  ])
  const [from, to] = ranges.get(preset) ?? [
    addMonths(current, 1 - Number(preset)),
    current,
  ]
  const [excludedAccounts, setAccounts] = useState<Array<string>>([]),
    [excludedCategories, setCategories] = useState<Array<string>>([])
  const [byGroup, setByGroup] = useState(false),
    [detail, setDetail] = useState<string | null>(null)
  const period = { planId: plan.id, from, to, today, excludedAccounts }
  const filters = { ...period, byGroup, excludedCategories }
  const initial =
    from === addMonths(current, -5) &&
    to === current &&
    !byGroup &&
    !excludedAccounts.length &&
    !excludedCategories.length
  const spendingQuery = useQuery(
    {
      queryKey: ['spending-totals', filters],
      queryFn: () => getSpendingTotals({ data: filters }),
      enabled: spending && !initial,
    },
    client,
  )
  const worthQuery = useQuery(
    {
      queryKey: ['net-worth', period],
      queryFn: () => getNetWorth({ data: period }),
      enabled: !spending,
    },
    client,
  )
  const buckets = initial ? workspace.buckets : (spendingQuery.data ?? [])
  const slices = buckets.filter((b) => b.value > 0),
    total = slices.reduce((sum, b) => sum + b.value, 0),
    selected = buckets.find((b) => b.id === detail)
  const rows = useQuery(
    {
      queryKey: ['spending-rows', filters, detail],
      queryFn: () =>
        getSpendingRows({ data: { ...filters, bucketId: detail! } }),
      enabled: spending && !!selected,
    },
    client,
  )
  const balances = worthQuery.data ?? []
  const active = spending ? spendingQuery : worthQuery
  const money = useMoney(plan)
  const range =
    from === to
      ? formatPlanMonth(from)
      : `${formatPlanMonth(from)} – ${formatPlanMonth(to)}`
  return (
    <main className="min-w-0 flex-1">
      <header className="border-b px-4 py-4 md:pl-14 md:pr-24">
        <h1 className="font-heading text-xl font-semibold">Reflect</h1>
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:px-8">
        <nav
          aria-label="Reports"
          className="flex gap-1 self-start rounded-lg bg-muted p-1"
        >
          {['Spending Breakdown', 'Net Worth'].map((r) => (
            <Button
              key={r}
              size="sm"
              variant={r === report ? 'default' : 'ghost'}
              aria-pressed={r === report}
              onClick={() => setReport(r)}
            >
              {r}
            </Button>
          ))}
        </nav>
        <div>
          <h2 className="font-heading text-3xl font-semibold tracking-tight">
            {report}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {spending
              ? 'See where your money went and which transactions made up each share.'
              : 'Follow the value of your accounts after subtracting what you owe.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Date range"
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {[
              ['1', 'This month'],
              ['3', 'Last 3 months'],
              ['6', 'Last 6 months'],
              ['12', 'Last 12 months'],
              ['ytd', 'Year to date'],
              ['lastYear', 'Last year'],
              ['all', 'All dates'],
              ['custom', 'Custom dates'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {preset === 'custom' && (
            <>
              {[
                ['From', customFrom],
                ['Through', customTo],
              ].map(([label, value]) => (
                <label key={label} className="text-sm">
                  {label}{' '}
                  <input
                    type="month"
                    max={current}
                    value={value}
                    onChange={(e) => {
                      const m = parsePlanMonth(e.target.value)
                      if (!m || m > current || m < '1900-01') return
                      if (label === 'From') {
                        setFrom(m)
                        if (m > customTo) setTo(m)
                      } else {
                        setTo(m)
                        if (m < customFrom) setFrom(m)
                      }
                    }}
                  />
                </label>
              ))}
            </>
          )}
          <MultiFilter
            label="accounts"
            options={accounts}
            excluded={excludedAccounts}
            setExcluded={setAccounts}
          />
          {spending && (
            <MultiFilter
              label="categories"
              options={categories}
              excluded={excludedCategories}
              setExcluded={setCategories}
            />
          )}
        </div>
        {!(spending && initial) && !active.data ? (
          <p role="status">
            {active.isError ? 'Could not load report.' : 'Loading report…'}{' '}
            {active.isError && (
              <Button variant="link" onClick={() => active.refetch()}>
                Retry
              </Button>
            )}
          </p>
        ) : spending ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,0.8fr)_1.2fr]">
            <section className="rounded-xl border p-5">
              <p className="mb-5 text-sm text-muted-foreground">{range}</p>
              {slices.length ? (
                <SpendingRing
                  items={slices}
                  label={money(total)}
                  onSelect={setDetail}
                />
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground">
                    Total spending
                  </p>
                  <p className="font-heading text-2xl font-semibold">
                    {money(0)}
                  </p>
                </div>
              )}
            </section>
            <section className="rounded-xl border p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-heading text-lg font-semibold">
                  Spending by {byGroup ? 'group' : 'category'}
                </h3>
                <select
                  aria-label="Group spending by"
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                  value={byGroup ? 'groups' : 'categories'}
                  onChange={(e) => setByGroup(e.target.value === 'groups')}
                >
                  <option value="categories">Categories</option>
                  <option value="groups">Groups</option>
                </select>
              </div>
              {!buckets.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  No spending matches these filters.
                </p>
              )}
              {buckets.map((b, i) => (
                <div key={b.id}>
                  {b.value < 0 && (i === 0 || buckets[i - 1].value >= 0) ? (
                    <h4 className="my-3 text-sm font-semibold">
                      Positive inflows
                    </h4>
                  ) : null}
                  <button
                    className="flex w-full flex-col gap-1.5 rounded-md p-2 text-left hover:bg-muted"
                    onClick={() => setDetail(b.id)}
                  >
                    <span className="flex w-full items-center gap-2 text-sm">
                      <span className="flex-1 font-medium">{b.name}</span>
                      {b.value > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {Math.round((100 * b.value) / total)}%
                        </span>
                      )}
                      <span className="tabular-nums">
                        {money(Math.abs(b.value))}
                      </span>
                      <ChevronRight size={14} />
                    </span>
                    {b.value > 0 && (
                      <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            background: seriesColor(i),
                            width: `${(100 * b.value) / total}%`,
                          }}
                        />
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </section>
          </div>
        ) : (
          <section className="rounded-xl border p-4 md:p-6">
            <p className="text-sm text-muted-foreground">
              Net worth · {formatPlanMonth(to)}
            </p>
            <p className="my-1 font-heading text-3xl font-semibold">
              {money(balances.at(-1)?.net ?? 0)}
            </p>
            <div className="my-4 flex gap-4 text-xs">
              {['Assets', 'Debts', 'Net worth'].map((s, i) => (
                <span key={s} className="flex items-center gap-1.5">
                  <i
                    className="size-2 rounded-full"
                    style={{
                      background: i < 2 ? seriesColor(i) : 'currentColor',
                    }}
                  />
                  {s}
                </span>
              ))}
            </div>
            <BalanceChart points={balances} format={money} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatPlanMonth(from)}</span>
              <span>{formatPlanMonth(to)}</span>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-right text-xs tabular-nums sm:text-sm">
                <caption className="sr-only">Month-end balances</caption>
                <thead>
                  <tr>
                    {['Month', 'Assets', 'Debts', 'Net worth'].map((h) => (
                      <th
                        key={h}
                        className="px-0.5 py-2 first:text-left sm:px-2"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {balances
                    .slice()
                    .reverse()
                    .map((p) => (
                      <tr className="border-t" key={p.month}>
                        <th className="px-0.5 py-2 text-left font-normal sm:px-2">
                          {formatPlanMonth(p.month)}
                        </th>
                        {[p.assets, -p.debts || 0, p.net].map((n, i) => (
                          <td key={i} className="px-0.5 sm:px-2">
                            {money(n)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              {range} · {selected?.count} transactions
            </DialogDescription>
          </DialogHeader>
          {!rows.data && (
            <p role="status">
              {rows.isError
                ? 'Could not load transactions.'
                : 'Loading transactions…'}{' '}
              {rows.isError && (
                <Button variant="link" onClick={() => rows.refetch()}>
                  Retry
                </Button>
              )}
            </p>
          )}
          <ul className="max-h-[55vh] overflow-auto">
            {rows.data?.map((r) => (
              <li
                className="flex items-center justify-between gap-3 border-t py-2 text-sm"
                key={r.id}
              >
                <div>
                  <div className="font-medium">
                    {r.payeeName || r.memo || 'Transaction'}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {r.date} ·{' '}
                    <Link
                      to="/plans/$planId/accounts/$accountId"
                      params={{ planId: plan.id, accountId: r.accountId }}
                      className="underline"
                    >
                      {accounts.find((a) => a.id === r.accountId)?.name}
                    </Link>
                  </span>
                </div>
                <span className="tabular-nums">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </main>
  )
}
