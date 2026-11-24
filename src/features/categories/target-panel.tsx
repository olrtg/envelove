import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { useIsMobile } from '#/hooks/use-mobile'
import type { ReactNode } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Field, FieldLabel, FieldGroup } from '#/components/ui/field'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '#/components/ui/sheet'
import { useMoney, useAmountsHidden } from '#/hooks/use-amount-privacy'
import {
  evaluateCurrencyToMilliunits,
  formatMilliunitsForInput,
} from '#/features/transactions/transaction-money'
import {
  formatPlanMonth,
  lastDayOfMonth,
  monthOfDate,
} from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'
import { changeTarget } from './categories.functions'
import { targetSchema } from './category-target'
import type { CategoryTarget } from './category-target'
import type { TargetChange } from './category.schemas'
import type { Category } from './category-ordering'
import type { PlanCurrency } from './activity-cell'

const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
const frequencies = ['Weekly', 'Monthly', 'Yearly', 'Custom'] as const
export function progressLabel(
  p: NonNullable<Category['progress']>,
  money: (value: number) => string,
) {
  if (p.snoozed) return 'Snoozed'
  if (p.optional && p.remaining) return 'Saving over time'
  return p.remaining ? `${money(p.remaining)} underfunded` : 'Target met'
}

export function TargetPanel({
  category,
  currency,
  month,
  today,
  onClose,
  onSaved,
  readyToAssign,
}: {
  category: Category
  currency: PlanCurrency
  month: PlanMonth
  today: string
  onClose: () => void
  onSaved: () => Promise<void>
  readyToAssign: number
}) {
  const save = useServerFn(changeTarget)
  const hidden = useAmountsHidden()
  const money = useMoney(currency)
  const mobile = useIsMobile()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { target, progress: p } = category
  const assignable = Math.max(0, Math.min(p?.underfunded ?? 0, readyToAssign))
  async function persist(change: TargetChange) {
    setBusy(true)
    setError('')
    try {
      await save({ data: { categoryId: category.id, change } })
      await onSaved()
      setEditing(false)
    } catch {
      setError('Could not save the target. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const subtitle = `${formatPlanMonth(month)} · Category target`
  const body = (
    <div className="flex flex-col gap-5 px-4 pb-5">
      {editing && !hidden ? (
        <TargetEditor
          target={target}
          month={month}
          today={today}
          currency={currency}
          busy={busy}
          onSave={(t) => void persist({ target: t })}
          onCancel={() => setEditing(false)}
        />
      ) : !target ? (
        <>
          <p className="text-muted-foreground">
            Choose how much to set aside and when you need it.
          </p>
          <Button disabled={hidden} onClick={() => setEditing(true)}>
            Create target
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {target.frequency} target
            </p>
            <h3 className="font-heading text-xl font-semibold">
              {target.behavior} {money(target.amount)}
            </h3>
            <p className="text-muted-foreground">
              {target.frequency === 'Weekly'
                ? `Every ${weekdays[target.day]}`
                : target.frequency === 'Monthly'
                  ? target.day
                    ? `By day ${target.day} of each month`
                    : 'By the last day of each month'
                  : target.due
                    ? `By ${p?.due ?? target.due}${target.repeatMonths ? ` · Every ${target.repeatMonths} month${target.repeatMonths === 1 ? '' : 's'}` : ''}`
                    : 'No due date'}
            </p>
          </div>
          {p ? (
            <>
              <div className="flex flex-col gap-2">
                <strong>{progressLabel(p, money)}</strong>
                {!p.snoozed && (
                  <progress
                    aria-label="Monthly target progress"
                    className="h-2 w-full accent-primary"
                    max={1}
                    value={
                      p.monthly ? Math.max(0, 1 - p.remaining / p.monthly) : 1
                    }
                  />
                )}
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-2">
                <dt>This month’s target</dt>
                <dd>{money(p.monthly)}</dd>
                <dt>Assigned</dt>
                <dd>{money(category.assigned)}</dd>
                {!p.snoozed && (
                  <>
                    <dt>To go</dt>
                    <dd>{money(p.remaining)}</dd>
                  </>
                )}
              </dl>
              {p.underfunded > 0 && (
                <Button
                  disabled={hidden || busy || !assignable}
                  onClick={() => void persist({ month, today, fund: true })}
                >
                  {assignable
                    ? `Assign ${money(assignable)}`
                    : 'No money ready to assign'}
                </Button>
              )}
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void persist({ month, snooze: !p.snoozed })}
              >
                {p.snoozed ? 'Unsnooze target' : 'Snooze for this month'}
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              This target is not active this month.
            </p>
          )}
          <div className="flex justify-between">
            <Button
              variant="outline"
              disabled={hidden || busy}
              onClick={() => setEditing(true)}
            >
              Edit target
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void persist({ target: null })}
            >
              Delete target
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
  if (mobile)
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <SheetContent className="overflow-y-auto data-[side=right]:w-[min(100%,24rem)]">
          <SheetHeader>
            <SheetDescription>{subtitle}</SheetDescription>
            <SheetTitle>{category.name}</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    )
  return (
    <aside
      aria-label="Category target"
      className="sticky top-0 flex max-h-screen w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-background text-sm xl:w-80"
    >
      <header className="flex items-start justify-between gap-2 border-b p-4">
        <div>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          <h2 className="mt-1 font-heading text-lg font-semibold">
            {category.name}
          </h2>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Close category target"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      {body}
    </aside>
  )
}

function Choice({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string | number
  onChange: (v: string) => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        className="h-9 w-full rounded-md border bg-background px-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </Field>
  )
}

function TargetEditor({
  target,
  month,
  today,
  currency,
  busy,
  onSave,
  onCancel,
}: {
  target: CategoryTarget | null
  month: PlanMonth
  today: string
  currency: PlanCurrency
  busy: boolean
  onSave: (t: CategoryTarget) => void
  onCancel: () => void
}) {
  const start =
    target?.start ?? (monthOfDate(today) === month ? today : `${month}-01`)
  const [frequency, setFrequency] = useState<CategoryTarget['frequency']>(
    target?.frequency ?? 'Monthly',
  )
  const [behavior, setBehavior] = useState<CategoryTarget['behavior']>(
    target?.behavior ?? 'Set aside',
  )
  const [amount, setAmount] = useState(
    target
      ? formatMilliunitsForInput(
          target.amount,
          currency.countryCode,
          currency.currencyCode,
        )
      : '',
  )
  const [day, setDay] = useState(target?.day ?? 0)
  const [date, setDate] = useState(target?.due ?? lastDayOfMonth(month))
  const [dated, setDated] = useState(target ? !!target.due : false)
  const [repeat, setRepeat] = useState(Boolean(target?.repeatMonths))
  const [unit, setUnit] = useState((target?.repeatMonths ?? 0) >= 12 ? 12 : 1)
  const [interval, setInterval] = useState(
    (target?.repeatMonths ?? 0) / unit || 1,
  )
  const [error, setError] = useState('')
  const long = frequency === 'Yearly' || frequency === 'Custom'
  const balance = behavior === 'Have a balance of'
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const result = targetSchema.safeParse({
          frequency,
          behavior,
          start,
          amount: evaluateCurrencyToMilliunits(
            amount,
            currency.countryCode,
            currency.currencyCode,
          ),
          day,
          due: long && (!balance || dated) ? date : null,
          repeatMonths:
            frequency === 'Yearly'
              ? 12
              : frequency === 'Custom' && repeat && !balance
                ? interval * unit
                : 0,
        })
        if (!result.success) {
          setError('Enter a positive amount and a valid target date.')
          return
        }
        onSave(result.data)
      }}
    >
      <FieldGroup>
        <Choice
          label="Frequency"
          value={frequency}
          onChange={(v) => {
            const next = frequencies.find((f) => f === v)!
            setFrequency(next)
            setDay(0)
            if (next !== 'Custom' && balance) setBehavior('Set aside')
          }}
        >
          {frequencies.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </Choice>
        <Field>
          <FieldLabel htmlFor="target-amount">
            Amount ({currency.currencyCode})
          </FieldLabel>
          <Input
            id="target-amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Choice
          label="I want to"
          value={behavior}
          onChange={(v) => setBehavior(v as CategoryTarget['behavior'])}
        >
          <option>Set aside</option>
          <option>Fill up to</option>
          {frequency === 'Custom' && <option>Have a balance of</option>}
        </Choice>
        {frequency === 'Weekly' && (
          <Choice label="Every" value={day} onChange={(v) => setDay(Number(v))}>
            {weekdays.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Choice>
        )}
        {frequency === 'Monthly' && (
          <Choice label="By" value={day} onChange={(v) => setDay(Number(v))}>
            <option value={0}>Last day of month</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option value={i + 1} key={i}>
                Day {i + 1}
              </option>
            ))}
          </Choice>
        )}
        {balance && (
          <FieldLabel>
            <input
              type="checkbox"
              checked={dated}
              onChange={(e) => setDated(e.target.checked)}
            />{' '}
            Due by date
          </FieldLabel>
        )}
        {long && (!balance || dated) && (
          <Field>
            <FieldLabel htmlFor="target-due">Due on</FieldLabel>
            <Input
              type="date"
              id="target-due"
              value={date}
              required
              min={`${start.slice(0, 7)}-01`}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        )}
        {frequency === 'Custom' && !balance && (
          <>
            <FieldLabel>
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
              />{' '}
              Repeat
            </FieldLabel>
            {repeat && (
              <div className="flex gap-2">
                <Choice
                  label="Every"
                  value={interval}
                  onChange={(v) => setInterval(Number(v))}
                >
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i}>{i + 1}</option>
                  ))}
                </Choice>
                <Choice
                  label="Unit"
                  value={unit}
                  onChange={(v) => setUnit(Number(v))}
                >
                  <option value={1}>Months</option>
                  <option value={12}>Years</option>
                </Choice>
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            disabled={busy}
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button disabled={busy} type="submit">
            Save target
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
