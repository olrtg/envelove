import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { SearchableSelect } from '#/components/searchable-select'
import type { SearchableSelectGroup } from '#/components/searchable-select'
import { Button } from '#/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#/components/ui/field'
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Spinner } from '#/components/ui/spinner'
import type { PlanCurrency } from '#/features/categories/activity-cell'
import { formatPlanMonth } from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'
import {
  evaluateCurrencyToMilliunits,
  formatMilliunitsForInput,
} from '#/features/transactions/transaction-money'
import { formatCurrencyForCountry } from '#/lib/country-profiles'

import { getMoneyMoveOptions, moveMoney } from './budget.functions'

const planRoute = getRouteApi('/_authenticated/plans/$planId/')
const readyToAssignValue = 'ready-to-assign'

type MoneyMoveTarget = {
  categoryId: string | null
  name: string
  available: number
}

export function MoneyMovePopover({
  children,
  currency,
  onMoved,
  target,
}: {
  children: ReactNode
  currency: PlanCurrency
  onMoved: () => void
  target: MoneyMoveTarget
}) {
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!isSaving) setOpen(next)
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={`Manage money for ${target.name}`}
        className="w-[min(22rem,calc(100vw-2rem))] gap-4 p-4"
        onCloseAutoFocus={(event) => {
          // A new control may have focus before this popover finishes closing.
          if (document.activeElement !== document.body) event.preventDefault()
        }}
      >
        {open && (
          <MoneyMoveForm
            currency={currency}
            isSaving={isSaving}
            onClose={() => setOpen(false)}
            onMoved={onMoved}
            setIsSaving={setIsSaving}
            target={target}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function MoneyMoveForm({
  currency,
  isSaving,
  onClose,
  onMoved,
  setIsSaving,
  target,
}: {
  currency: PlanCurrency
  isSaving: boolean
  onClose: () => void
  onMoved: () => void
  setIsSaving: (saving: boolean) => void
  target: MoneyMoveTarget
}) {
  const { planId } = planRoute.useParams()
  const { month } = planRoute.useLoaderData()
  const { today } = planRoute.useLoaderDeps()
  const id = useId()
  const queryClient = useQueryClient()
  const moveMoneyFn = useServerFn(moveMoney)
  const options = useQuery({
    queryKey: ['money-move-options', planId, month, today],
    queryFn: () => getMoneyMoveOptions({ data: { planId, month, today } }),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const [sourceMonth, setSourceMonth] = useState(month)
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState(() =>
    formatMilliunitsForInput(
      target.available,
      currency.countryCode,
      currency.currencyCode,
    ),
  )
  const [error, setError] = useState<string | null>(null)
  const [amountInvalid, setAmountInvalid] = useState(false)
  const covering = target.available < 0
  const isReadyToAssign = target.categoryId === null
  const future = sourceMonth !== month
  const title = isReadyToAssign
    ? covering
      ? 'Fix Ready to Assign'
      : 'Assign Money'
    : covering
      ? 'Cover Overspending'
      : 'Move Money'
  const action = covering
    ? isReadyToAssign
      ? 'Un-assign'
      : 'Cover'
    : isReadyToAssign
      ? 'Assign'
      : 'Move'
  const format = (amount: number) =>
    formatCurrencyForCountry(
      amount / 1000,
      currency.countryCode,
      currency.currencyCode,
    )
  const { groups, futureMonths, amounts } = moneyMoveChoices({
    data: options.data,
    categoryId: target.categoryId,
    sourceMonth,
    future,
    covering,
    format,
  })
  const targetAvailable = isReadyToAssign
    ? (options.data?.readyToAssign ?? target.available)
    : (options.data?.categories.find(
        (category) => category.id === target.categoryId,
      )?.available ?? target.available)
  const coverage = Math.max(
    0,
    Math.min(-targetAvailable, amounts.get(selected) ?? 0),
  )

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (isSaving) return
    setError(null)
    const amount = evaluateCurrencyToMilliunits(
      draft,
      currency.countryCode,
      currency.currencyCode,
    )
    setAmountInvalid(!covering && amount === null)
    if (!covering && amount === null) return
    if (!selected) return
    const anchor = { categoryId: target.categoryId, month }
    const other = {
      categoryId: selected === readyToAssignValue ? null : selected,
      month: covering ? sourceMonth : month,
    }
    setIsSaving(true)
    try {
      await moveMoneyFn({
        data: {
          planId,
          today,
          source: covering ? other : anchor,
          destination: covering ? anchor : other,
          ...(covering ? { kind: 'cover' } : { kind: 'move', amount: amount! }),
        },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not move money. Try again.',
      )
      setIsSaving(false)
      return
    }
    // A successful write must never become a retryable form if refreshing fails.
    setIsSaving(false)
    onClose()
    void queryClient.invalidateQueries({
      queryKey: ['ready-to-assign', planId],
    })
    onMoved()
  }

  return (
    <>
      <PopoverHeader>
        <PopoverTitle>{title}</PopoverTitle>
        <PopoverDescription>
          {target.name} · {formatPlanMonth(month)}
        </PopoverDescription>
      </PopoverHeader>
      {options.isPending ? (
        <p
          role="status"
          className="flex items-center gap-2 text-muted-foreground"
        >
          <Spinner />
          Loading categories…
        </p>
      ) : options.isError ? (
        <>
          <FieldError>Could not load categories.</FieldError>
          <Button onClick={() => void options.refetch()} variant="outline">
            Try again
          </Button>
        </>
      ) : (
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={isSaving}>
            <FieldGroup className="gap-4">
              {covering ? (
                <p className="text-sm text-muted-foreground">
                  {format(Math.max(0, -targetAvailable))} to cover
                </p>
              ) : (
                <Field data-invalid={amountInvalid}>
                  <FieldLabel htmlFor={`${id}-amount`}>Amount</FieldLabel>
                  <Input
                    id={`${id}-amount`}
                    inputMode="decimal"
                    value={draft}
                    aria-invalid={amountInvalid}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      setAmountInvalid(false)
                    }}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  {amountInvalid && (
                    <FieldError>
                      Enter a positive amount in the Plan currency.
                    </FieldError>
                  )}
                </Field>
              )}
              {covering && !isReadyToAssign && futureMonths.length > 0 && (
                <Field>
                  <FieldLabel htmlFor={`${id}-month`}>From month</FieldLabel>
                  <Select
                    value={sourceMonth}
                    onValueChange={(value) => {
                      setSourceMonth(value as PlanMonth)
                      setSelected('')
                    }}
                  >
                    <SelectTrigger id={`${id}-month`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {[month, ...futureMonths].map((value) => (
                          <SelectItem key={value} value={value}>
                            {formatPlanMonth(value)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor={`${id}-category`}>
                  {covering
                    ? isReadyToAssign
                      ? 'Un-assign money from'
                      : 'Cover from'
                    : 'To'}
                </FieldLabel>
                <SearchableSelect
                  emptyMessage={
                    covering
                      ? 'No categories with money to cover this.'
                      : 'No matching categories.'
                  }
                  groups={groups}
                  id={`${id}-category`}
                  onChange={setSelected}
                  placeholder="Choose a category…"
                  value={selected}
                />
                <FieldDescription>
                  {future
                    ? 'Amounts show Assigned in this future month, not Available.'
                    : 'Amounts show Available in this month.'}
                </FieldDescription>
              </Field>
              {covering && selected && (
                <p className="text-sm" aria-live="polite">
                  {format(coverage)} will be{' '}
                  {isReadyToAssign ? 'unassigned' : 'moved'}.
                  {coverage < -targetAvailable && (
                    <>
                      {' '}
                      {format(-targetAvailable - coverage)} will remain to
                      cover.
                    </>
                  )}
                </p>
              )}
              {error && <FieldError>{error}</FieldError>}
              <div className="flex justify-end gap-2">
                <Button onClick={onClose} type="button" variant="outline">
                  Cancel
                </Button>
                <Button disabled={!selected || isSaving} type="submit">
                  {isSaving && <Spinner data-icon="inline-start" />}
                  {action}
                </Button>
              </div>
            </FieldGroup>
          </fieldset>
        </form>
      )}
    </>
  )
}

// Picker eligibility differs from the write: explicit destinations need no
// surplus, while cover sources use current Available or future Assigned.
function moneyMoveChoices({
  data,
  categoryId,
  sourceMonth,
  future,
  covering,
  format,
}: {
  data: Awaited<ReturnType<typeof getMoneyMoveOptions>> | undefined
  categoryId: string | null
  sourceMonth: PlanMonth
  future: boolean
  covering: boolean
  format: (amount: number) => string
}) {
  const futureMonths = [
    ...new Set(
      data?.futureAssignments.map((assignment) => assignment.month) ?? [],
    ),
  ]
  const groups: Array<SearchableSelectGroup> = []
  const amounts = new Map<string, number>()
  const futureAssigned = new Map(
    data?.futureAssignments
      .filter((assignment) => assignment.month === sourceMonth)
      .map((assignment) => [assignment.categoryId, assignment.amount]),
  )
  if (
    categoryId !== null &&
    !future &&
    (!covering || (data?.readyToAssign ?? 0) > 0)
  ) {
    const amount = data?.readyToAssign ?? 0
    amounts.set(readyToAssignValue, amount)
    groups.push({
      id: 'inflow',
      items: [
        {
          value: readyToAssignValue,
          label: 'Ready to Assign',
          detail: format(amount),
        },
      ],
    })
  }
  for (const category of data?.categories ?? []) {
    const amount = future
      ? (futureAssigned.get(category.id) ?? 0)
      : category.available
    if ((!future && category.id === categoryId) || (covering && amount <= 0))
      continue
    amounts.set(category.id, amount)
    let group = groups.find((item) => item.id === category.groupId)
    if (!group) {
      group = { id: category.groupId, label: category.groupName, items: [] }
      groups.push(group)
    }
    group.items.push({
      value: category.id,
      label: category.name,
      detail: format(amount),
    })
  }
  return { groups, futureMonths, amounts }
}
