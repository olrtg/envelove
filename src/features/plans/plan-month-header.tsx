import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'

import {
  addMonths,
  formatPlanMonth,
  isPlanMonthInBounds,
  monthOfDate,
  planMonthOf,
  planMonthParts,
} from './plan-month'
import type { PlanMonth, PlanMonthBounds } from './plan-month'

const longMonth = { month: 'long', year: 'numeric' } as const

export function PlanMonthHeader({
  bounds,
  month,
  planId,
  today,
}: {
  bounds: PlanMonthBounds
  month: PlanMonth
  planId: string
  today: string
}) {
  const currentMonth = monthOfDate(today)

  return (
    <div className="flex items-center gap-2">
      <MonthLink
        className="rounded-full"
        disabled={!isPlanMonthInBounds(addMonths(month, -1), bounds)}
        label="Previous month"
        month={addMonths(month, -1)}
        planId={planId}
        size="icon-sm"
        variant="outline"
      >
        <ChevronLeft />
      </MonthLink>
      <MonthPicker
        bounds={bounds}
        currentMonth={currentMonth}
        month={month}
        planId={planId}
      />
      <MonthLink
        className="rounded-full"
        disabled={!isPlanMonthInBounds(addMonths(month, 1), bounds)}
        disabledReason="Before you can move to next month, you need to assign money this month."
        label="Next month"
        month={addMonths(month, 1)}
        planId={planId}
        size="icon-sm"
        variant="outline"
      >
        <ChevronRight />
      </MonthLink>
      {month !== currentMonth && (
        <MonthLink
          className="ml-2"
          label="Go to the current month"
          month={currentMonth}
          planId={planId}
          size="sm"
          variant="secondary"
        >
          Today
        </MonthLink>
      )}
    </div>
  )
}

function MonthPicker({
  bounds,
  currentMonth,
  month,
  planId,
}: {
  bounds: PlanMonthBounds
  currentMonth: PlanMonth
  month: PlanMonth
  planId: string
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(planMonthParts(month).year)
  const months = Array.from({ length: 12 }, (_, index) =>
    planMonthOf(year, index + 1),
  )

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setYear(planMonthParts(month).year)
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={`Choose month, ${formatPlanMonth(month, longMonth)} selected`}
          className="h-auto px-2 py-1 font-heading text-2xl font-semibold"
          type="button"
          variant="ghost"
        >
          {formatPlanMonth(month)}
          <ChevronDown className="size-5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex items-center justify-between">
          <Button
            aria-label="Previous year"
            onClick={() => setYear(year - 1)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          <span className="font-medium tabular-nums">{year}</span>
          <Button
            aria-label="Next year"
            onClick={() => setYear(year + 1)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {months.map((option) => (
            <MonthLink
              className={cn(
                'w-full',
                option === currentMonth &&
                  option !== month &&
                  'text-primary ring-1 ring-primary/40',
              )}
              current={option === month}
              disabled={!isPlanMonthInBounds(option, bounds)}
              key={option}
              label={formatPlanMonth(option, longMonth)}
              month={option}
              onNavigate={() => setOpen(false)}
              planId={planId}
              size="sm"
              variant={option === month ? 'default' : 'ghost'}
            >
              {formatPlanMonth(option, { month: 'short' })}
            </MonthLink>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MonthLink({
  children,
  className,
  current = false,
  disabled = false,
  disabledReason,
  label,
  month,
  onNavigate,
  planId,
  size,
  variant,
}: {
  children: ReactNode
  className?: string
  current?: boolean
  disabled?: boolean
  disabledReason?: string
  label: string
  month: PlanMonth
  onNavigate?: () => void
  planId: string
  size: 'icon-sm' | 'sm'
  variant: 'default' | 'ghost' | 'outline' | 'secondary'
}) {
  if (disabled && disabledReason) {
    // aria-disabled keeps the button hoverable and focusable for its tooltip.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-disabled
            aria-label={label}
            className={cn('cursor-not-allowed opacity-50', className)}
            size={size}
            type="button"
            variant={variant}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    )
  }

  if (disabled) {
    return (
      <Button
        aria-label={label}
        className={className}
        disabled
        size={size}
        type="button"
        variant={variant}
      >
        {children}
      </Button>
    )
  }

  return (
    <Button asChild className={className} size={size} variant={variant}>
      <Link
        aria-current={current ? 'date' : undefined}
        aria-label={label}
        onClick={onNavigate}
        params={{ planId }}
        search={{ month }}
        title={label}
        to="/plans/$planId"
      >
        {children}
      </Link>
    </Button>
  )
}
