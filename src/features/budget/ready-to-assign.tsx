import { ChevronDown, CircleMinus, CirclePlus } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import type { PlanCurrency } from '#/features/categories/activity-cell'
import { addMonths, formatPlanMonth } from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'
import { useMoney, useAmountsHidden } from '#/hooks/use-amount-privacy'
import { cn } from '#/lib/utils'

import type { ReadyToAssign } from './budget-engine'
import { MoneyMovePopover } from './money-move-popover'

const states = {
  positive: {
    className: 'bg-lime-300 text-lime-950 dark:bg-lime-400/80',
    label: 'Ready to Assign',
    message:
      'Give these dollars a job by assigning them to one or more categories!',
  },
  zero: {
    className: 'bg-stone-200/70 text-muted-foreground dark:bg-muted',
    label: 'All Money Assigned',
    message: 'Nice work! Every dollar has a job.',
  },
  negative: {
    className: 'bg-red-300 text-red-950 dark:bg-red-400/80',
    label: 'You assigned more than you have',
    message: 'You have assigned more than you have.',
  },
}

export function ReadyToAssignBox({
  currency,
  month,
  onMoved,
  readyToAssign,
}: {
  currency: PlanCurrency
  month: PlanMonth
  onMoved: () => void
  readyToAssign: ReadyToAssign
}) {
  const { total } = readyToAssign
  const state = states[total > 0 ? 'positive' : total < 0 ? 'negative' : 'zero']
  const format = useMoney(currency)
  const hidden = useAmountsHidden()
  const signed = (amount: number) =>
    amount > 0 ? `+${format(amount)}` : format(amount)
  const monthName = formatPlanMonth(month, { month: 'long' })
  const previousMonthName = formatPlanMonth(addMonths(month, -1), {
    month: 'long',
  })
  const additions = withoutZeros([
    [
      `Ready to Assign left over from ${previousMonthName}`,
      readyToAssign.leftOverFromPreviousMonth,
    ],
    [
      `Inflow: Ready to Assign transactions in ${monthName}`,
      readyToAssign.inflow,
    ],
    ['Inflow from Debt Account', readyToAssign.debtAccountInflow],
  ])
  const subtractions = withoutZeros([
    [
      `Cash overspending in ${previousMonthName}`,
      -readyToAssign.cashOverspendingPreviousMonth,
    ],
    [`Assigned in ${monthName}`, -readyToAssign.assignedThisMonth],
    ['Assigned in Future', -readyToAssign.assignedInFuture],
  ])

  return (
    <div
      className={cn(
        'flex items-center rounded-lg pr-3 max-md:justify-between',
        state.className,
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-4 rounded-lg px-4 py-2 text-left outline-none transition-[filter] hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50',
              state.className,
            )}
            type="button"
          >
            <span className="flex flex-col">
              <span className="font-heading text-2xl font-semibold leading-tight tabular-nums">
                {format(total)}
              </span>
              <span className="text-sm">{state.label}</span>
            </span>
            <ChevronDown aria-hidden className="size-4 opacity-70" />
            <span className="sr-only">View Ready to Assign Breakdown</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(32rem,calc(100vw-2rem))] gap-3 p-4">
          <PopoverHeader>
            <PopoverTitle className="font-heading text-lg font-semibold">
              Ready to Assign Breakdown
            </PopoverTitle>
          </PopoverHeader>
          <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4">
            {additions.length > 0 && (
              <BreakdownSection
                icon={<CirclePlus className="size-4 text-lime-700" />}
                lines={additions}
                signed={signed}
                subtotalClassName="text-lime-700 dark:text-lime-400"
              />
            )}
            {subtractions.length > 0 && (
              <BreakdownSection
                icon={<CircleMinus className="size-4" />}
                lines={subtractions}
                signed={signed}
              />
            )}
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-heading text-base font-semibold">
                  Total Ready to Assign
                </span>
                <span className="tabular-nums">
                  ={' '}
                  <span
                    className={cn(
                      total > 0 && 'text-lime-700 dark:text-lime-400',
                      total < 0 && 'text-destructive',
                    )}
                  >
                    {signed(total)}
                  </span>
                </span>
              </div>
              <p className="text-muted-foreground">{state.message}</p>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {!hidden && total !== 0 && (
        <MoneyMovePopover
          currency={currency}
          onMoved={onMoved}
          target={{
            categoryId: null,
            name: 'Ready to Assign',
            available: total,
          }}
        >
          <Button size="sm" type="button" variant="outline">
            {total > 0 ? 'Assign' : 'Fix This'}
          </Button>
        </MoneyMovePopover>
      )}
    </div>
  )
}

type BreakdownLine = [label: string, amount: number]

function withoutZeros(lines: Array<BreakdownLine>) {
  return lines.filter(([, amount]) => amount !== 0)
}

function BreakdownSection({
  icon,
  lines,
  signed,
  subtotalClassName,
}: {
  icon: ReactNode
  lines: Array<BreakdownLine>
  signed: (amount: number) => string
  subtotalClassName?: string
}) {
  const subtotal = lines.reduce((sum, [, amount]) => sum + amount, 0)

  return (
    <div className="flex flex-col gap-1.5 border-b pb-3">
      <div className="flex items-center justify-between gap-4">
        {icon}
        <span className={cn('tabular-nums', subtotalClassName)}>
          {signed(subtotal)}
        </span>
      </div>
      {lines.map(([label, amount]) => (
        <div className="flex justify-between gap-4" key={label}>
          <span>{label}</span>
          <span className="tabular-nums">{signed(amount)}</span>
        </div>
      ))}
    </div>
  )
}
