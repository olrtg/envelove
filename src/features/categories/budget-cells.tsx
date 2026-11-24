import { useRef, useState } from 'react'
import { CircleHelp, CreditCard } from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { parseAssignedInput } from '#/features/budget/assigned-input'
import { MoneyMovePopover } from '#/features/budget/money-move-popover'
import type {
  AvailableStatus,
  CategoryMonthBudget,
} from '#/features/budget/budget-engine'
import { formatMilliunitsForInput } from '#/features/transactions/transaction-money'
import { useMoney, useAmountsHidden } from '#/hooks/use-amount-privacy'
import { cn } from '#/lib/utils'

import type { PlanCurrency } from './activity-cell'

export const amountColumnClassName =
  'plan-amount shrink-0 px-2 text-right md:w-32'

function formatForInput(amount: number, currency: PlanCurrency) {
  const digits = formatMilliunitsForInput(
    amount,
    currency.countryCode,
    currency.currencyCode,
  )
  return amount < 0 ? `-${digits}` : digits
}

export function AmountCell({
  amount,
  className,
  currency,
}: {
  amount: number
  className?: string
  currency: PlanCurrency
}) {
  const money = useMoney(currency)
  return (
    <span
      className={cn(amountColumnClassName, 'text-sm tabular-nums', className)}
    >
      {money(amount)}
    </span>
  )
}

// Always an input, so moving between cells never remounts or loses focus.
// Arrow keys move between the cells inside the closest
// `data-assigned-scope` element.
export function AssignedCell({
  amount,
  currency,
  label,
  onCommit,
}: {
  amount: number
  currency: PlanCurrency
  label: string
  onCommit: (amount: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hidden = useAmountsHidden()
  const money = useMoney(currency)
  const skipBlurCommitRef = useRef(false)
  const keepSelectionRef = useRef(false)
  const [draft, setDraft] = useState<string | null>(null)

  function parseDraft() {
    return draft === null
      ? null
      : parseAssignedInput(
          draft,
          amount,
          currency.countryCode,
          currency.currencyCode,
        )
  }

  function save(parsed: ReturnType<typeof parseDraft>) {
    if (parsed && parsed.amount !== amount) onCommit(parsed.amount)
  }

  function selectAll() {
    requestAnimationFrame(() => inputRef.current?.select())
  }

  function moveTo(offset: number) {
    const input = inputRef.current
    if (!input) return
    const cells = Array.from(
      input
        .closest('[data-assigned-scope]')
        ?.querySelectorAll<HTMLInputElement>('[data-assigned-cell]') ?? [],
    )
    const index = cells.indexOf(input) + offset
    if (index >= 0) cells.at(index)?.focus()
  }

  return (
    <div className={cn(amountColumnClassName, 'plan-assigned w-28 px-0.5')}>
      <Input
        aria-label={`Assigned for ${label}`}
        className="h-8 border-transparent bg-transparent text-right tabular-nums shadow-none hover:border-input dark:bg-transparent"
        data-assigned-cell
        disabled={hidden}
        title={hidden ? 'Show amounts to edit' : undefined}
        inputMode="decimal"
        onBlur={() => {
          if (!skipBlurCommitRef.current) save(parseDraft())
          skipBlurCommitRef.current = false
          setDraft(null)
        }}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          setDraft(formatForInput(amount, currency))
          selectAll()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            const parsed = parseDraft()
            if (parsed?.isExpression) {
              save(parsed)
              setDraft(formatForInput(parsed.amount, currency))
              selectAll()
            } else {
              event.currentTarget.blur()
            }
          } else if (event.key === 'Escape') {
            event.preventDefault()
            skipBlurCommitRef.current = true
            event.currentTarget.blur()
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            moveTo(event.key === 'ArrowDown' ? 1 : -1)
          }
        }}
        onMouseDown={(event) => {
          keepSelectionRef.current =
            document.activeElement !== event.currentTarget
        }}
        onMouseUp={(event) => {
          // A click that focuses the cell keeps the whole value selected.
          if (keepSelectionRef.current) event.preventDefault()
          keepSelectionRef.current = false
        }}
        ref={inputRef}
        value={hidden ? money(amount) : (draft ?? money(amount))}
      />
    </div>
  )
}

const pillClassNames: Record<AvailableStatus, string> = {
  positive: 'bg-lime-300 text-lime-950 dark:bg-lime-400/80',
  zero: 'bg-stone-200/70 text-muted-foreground dark:bg-muted',
  cash_overspent: 'bg-red-300 text-red-950 dark:bg-red-400/80',
  credit_overspent: 'bg-yellow-300 text-yellow-950 dark:bg-yellow-400/80',
  payment_underfunded: 'bg-yellow-300 text-yellow-950 dark:bg-yellow-400/80',
  payment_overspent: 'bg-red-300 text-red-950 dark:bg-red-400/80',
}

export function AvailableCell({
  budget,
  currency,
  source,
}: {
  budget: Pick<CategoryMonthBudget, 'available' | 'overspending' | 'status'>
  currency: PlanCurrency
  source?: { id: string; name: string; onMoved: () => void }
}) {
  const hidden = useAmountsHidden()
  const money = useMoney(currency)
  const interactive = !hidden && source && budget.available !== 0
  const label = `${budget.available < 0 ? 'Cover overspending for' : 'Move money from'} ${source?.name}, ${money(budget.available)}`
  const contents = (
    <>
      {budget.status === 'credit_overspent' && (
        <CreditCard data-icon="inline-start" />
      )}
      {money(budget.available)}
    </>
  )
  const pill = (
    <Badge
      asChild={Boolean(interactive)}
      className={cn(
        'h-6 px-2.5 text-sm tabular-nums',
        pillClassNames[budget.status],
        interactive && 'outline-none hover:brightness-95',
      )}
    >
      {interactive ? (
        <button aria-label={label} type="button">
          {contents}
        </button>
      ) : (
        contents
      )}
    </Badge>
  )
  const tooltips: Record<AvailableStatus, string | null> = {
    positive: null,
    zero: null,
    cash_overspent:
      'A green category is a happy category. Make this category happy by adding funds from surplus categories.',
    credit_overspent: `You've overspent this category by ${money(-budget.overspending.credit)} with credit. Cover this overspending to avoid creating debt!`,
    payment_underfunded: `You have ${money(budget.available)} set aside for payment. (Want to send more? Add money to Assigned.)`,
    payment_overspent:
      'Red in your payment? Assign more (and cover overspending) to get back to green!',
  }
  const tooltip = tooltips[budget.status]
  const trigger = tooltip ? (
    <TooltipTrigger asChild>{pill}</TooltipTrigger>
  ) : (
    pill
  )
  const content = interactive ? (
    <MoneyMovePopover
      currency={currency}
      onMoved={source.onMoved}
      target={{
        categoryId: source.id,
        name: source.name,
        available: budget.available,
      }}
    >
      {trigger}
    </MoneyMovePopover>
  ) : (
    trigger
  )

  return (
    <span className={cn(amountColumnClassName, 'flex justify-end')}>
      {tooltip ? (
        <Tooltip>
          {content}
          {/* The positioning wrapper must also let clicks reach neighboring pills. */}
          <TooltipContent className="max-w-64 [[data-radix-popper-content-wrapper]:has(>&)]:pointer-events-none">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        content
      )}
    </span>
  )
}

export function CreditPaymentsAvailableCell({
  amount,
  currency,
}: {
  amount: number
  currency: PlanCurrency
}) {
  const money = useMoney(currency)
  return (
    <span
      className={cn(
        amountColumnClassName,
        'flex flex-col items-end text-sm leading-tight font-semibold tabular-nums',
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            className="h-5 gap-0.5 px-1 text-[10px] font-semibold tracking-wide text-muted-foreground"
            size="xs"
            type="button"
            variant="ghost"
          >
            <CircleHelp data-icon="inline-start" />
            PAYMENT
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <PopoverHeader>
            <PopoverTitle className="font-semibold">
              Using Credit Cards
            </PopoverTitle>
            <PopoverDescription>
              You assigned money to your categories, then charged a purchase on
              your card, so we moved the money from your categories to your
              credit card payment.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
      {money(amount)}
    </span>
  )
}
