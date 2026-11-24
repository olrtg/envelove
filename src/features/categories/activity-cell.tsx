import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, getRouteApi } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Spinner } from '#/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { formatDateInput } from '#/features/transactions/transaction-date'
import { useMoney } from '#/hooks/use-amount-privacy'
import { getCountryProfile } from '#/lib/country-profiles'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'
import { cn } from '#/lib/utils'

import { amountColumnClassName } from './budget-cells'
import {
  getCategoryActivity,
  getCreditPaymentActivity,
} from './categories.functions'

export type PlanCurrency = {
  countryCode: CountryCode
  currencyCode: CurrencyCode
}

// Credit Payment Categories also have Activity from funded spending moved off
// other Categories, which no Transaction row shows. A Credit Payment Category
// breaks it down; the Credit Card Payments group shows it as one row.
type ActivitySource = {
  kind: 'category' | 'group'
  id: string
  name: string
  creditPayments?: boolean
}

const planRoute = getRouteApi('/_authenticated/plans/$planId/')

export function ActivityCell({
  amount,
  className,
  currency,
  source,
}: {
  amount: number
  className?: string
  currency: PlanCurrency
  source?: ActivitySource
}) {
  const money = useMoney(currency)
  const formatted = money(amount)

  if (!source || amount === 0) {
    return (
      <span
        className={cn(
          amountColumnClassName,
          'plan-activity text-sm tabular-nums',
          className,
        )}
      >
        {formatted}
      </span>
    )
  }

  return (
    <ActivityPopover amount={amount} currency={currency} source={source}>
      <Button
        aria-label={`Activity for ${source.name}, ${formatted}`}
        className={cn(
          amountColumnClassName,
          'plan-activity justify-end text-sm font-normal tabular-nums',
          className,
        )}
        size="sm"
        type="button"
        variant="ghost"
      >
        {formatted}
      </Button>
    </ActivityPopover>
  )
}

function ActivityPopover({
  amount,
  children,
  currency,
  source,
}: {
  amount: number
  children: ReactNode
  currency: PlanCurrency
  source: ActivitySource
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(44rem,calc(100vw-2rem))] gap-3 p-4 max-md:max-h-[80dvh] max-md:overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle className="font-heading text-lg font-semibold">
            Activity
          </PopoverTitle>
          <PopoverDescription>{source.name}</PopoverDescription>
        </PopoverHeader>

        {source.kind === 'category' && source.creditPayments ? (
          <CreditPaymentActivity
            categoryId={source.id}
            currency={currency}
            onNavigate={close}
          />
        ) : (
          <CategoryActivity
            amount={amount}
            currency={currency}
            onNavigate={close}
            source={source}
          />
        )}

        <div className="flex justify-end">
          <Button onClick={close} size="sm" type="button">
            Close
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function usePlanMonth() {
  const { planId } = planRoute.useParams()
  const { month } = planRoute.useLoaderData()
  const { today } = planRoute.useLoaderDeps()
  return { planId, month, today }
}

function useSignedMoney(currency: PlanCurrency) {
  const money = useMoney(currency)
  return (value: number) => `${value > 0 ? '+' : ''}${money(value)}`
}

function ActivityQueryFallback({ isError }: { isError: boolean }) {
  return isError ? (
    <p className="py-4 text-sm text-destructive" role="alert">
      Activity could not be loaded.
    </p>
  ) : (
    <div className="flex justify-center py-6">
      <Spinner />
    </div>
  )
}

function CategoryActivity({
  amount,
  currency,
  onNavigate,
  source,
}: {
  amount: number
  currency: PlanCurrency
  onNavigate: () => void
  source: ActivitySource
}) {
  const { planId, month, today } = usePlanMonth()
  const signedAmount = useSignedMoney(currency)
  const activityQuery = useQuery({
    queryKey: [
      'category-activity',
      planId,
      month,
      today,
      source.kind,
      source.id,
    ],
    queryFn: () =>
      getCategoryActivity({
        data: {
          planId,
          month,
          today,
          source: { kind: source.kind, id: source.id },
        },
      }),
    staleTime: 0,
  })
  if (!activityQuery.data) {
    return <ActivityQueryFallback isError={activityQuery.isError} />
  }
  const fundedSpending = source.creditPayments
    ? activityQuery.data.reduce((rest, row) => rest - row.amount, amount)
    : 0

  return (
    <Table className="activity-table table-fixed">
      <TableHeader>
        <TableRow className="text-xs uppercase tracking-wide hover:bg-transparent">
          <TableHead className="w-36">Account</TableHead>
          <TableHead className="w-32">Date</TableHead>
          <TableHead>Payee</TableHead>
          <TableHead>Memo</TableHead>
          <TableHead className="w-32 text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {fundedSpending !== 0 && (
          <TableRow>
            <TableCell colSpan={4}>
              Funded spending moved from categories
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {signedAmount(fundedSpending)}
            </TableCell>
          </TableRow>
        )}
        {activityQuery.data.map((transaction) => (
          <TableRow className="relative" key={transaction.id}>
            <TableCell className="truncate">
              <TransactionLink
                onNavigate={onNavigate}
                transaction={transaction}
              >
                {transaction.accountName}
              </TransactionLink>
            </TableCell>
            <TableCell>{formatDate(transaction.date, currency)}</TableCell>
            <TableCell className="truncate">
              {transaction.payeeName ?? '—'}
            </TableCell>
            <TableCell className="truncate text-muted-foreground">
              {transaction.memo || '—'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {signedAmount(transaction.amount)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function CreditPaymentActivity({
  categoryId,
  currency,
  onNavigate,
}: {
  categoryId: string
  currency: PlanCurrency
  onNavigate: () => void
}) {
  const { planId, month, today } = usePlanMonth()
  const signedAmount = useSignedMoney(currency)
  const activityQuery = useQuery({
    queryKey: ['credit-payment-activity', planId, month, today, categoryId],
    queryFn: () =>
      getCreditPaymentActivity({
        data: { planId, month, today, categoryId },
      }),
    staleTime: 0,
  })
  if (!activityQuery.data) {
    return <ActivityQueryFallback isError={activityQuery.isError} />
  }
  const { summary, transactions } = activityQuery.data
  const lines = [
    { label: 'Spending', amount: summary.spending },
    { label: 'Returns', amount: summary.returns },
    { label: 'Total Spending', amount: summary.totalSpending, total: true },
    { label: 'Funded Spending', amount: summary.fundedSpending },
    { label: 'Payments & Returns', amount: summary.paymentsAndReturns },
    { label: 'Total Activity', amount: summary.totalActivity, total: true },
  ]

  return (
    <>
      <dl className="grid w-72 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        {lines.map((line) => (
          <div className="contents" key={line.label}>
            <dt className={cn(line.total && 'font-semibold')}>{line.label}</dt>
            <dd
              className={cn(
                'text-right tabular-nums',
                line.total && 'font-semibold',
              )}
            >
              {signedAmount(line.amount)}
            </dd>
          </div>
        ))}
      </dl>
      <Table className="activity-table table-fixed">
        <TableHeader>
          <TableRow className="text-xs uppercase tracking-wide hover:bg-transparent">
            <TableHead className="w-28">Date</TableHead>
            <TableHead>Payee</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Memo</TableHead>
            <TableHead className="w-32 text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow className="relative" key={transaction.id}>
              <TableCell>
                <TransactionLink
                  onNavigate={onNavigate}
                  transaction={transaction}
                >
                  {formatDate(transaction.date, currency)}
                </TransactionLink>
              </TableCell>
              <TableCell className="truncate">
                {transaction.payeeName ?? '—'}
              </TableCell>
              <TableCell className="truncate">
                {transaction.categoryName ?? '—'}
              </TableCell>
              <TableCell className="truncate text-muted-foreground">
                {transaction.memo || '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {signedAmount(transaction.amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}

// Stretches over its row so the whole row opens the Transaction in its
// register.
function TransactionLink({
  children,
  onNavigate,
  transaction,
}: {
  children: ReactNode
  onNavigate: () => void
  transaction: { id: string; accountId: string }
}) {
  const { planId } = planRoute.useParams()
  return (
    <Link
      className="outline-none after:absolute after:inset-0 focus-visible:underline"
      onClick={onNavigate}
      params={{ planId, accountId: transaction.accountId }}
      search={{ transaction: transaction.id }}
      to="/plans/$planId/accounts/$accountId"
    >
      {children}
    </Link>
  )
}

function formatDate(date: string, currency: PlanCurrency) {
  return formatDateInput(date, getCountryProfile(currency.countryCode).locale)
}
