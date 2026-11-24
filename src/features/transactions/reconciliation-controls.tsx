import { useRef, useState } from 'react'
import { CheckCheck, Scale, X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { formatCurrencyForCountry } from '#/lib/country-profiles'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'
import { InterruptedSaveError } from '../history/history-state'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { parseBankBalance } from './transaction-money'

type PlanCurrency = { countryCode: CountryCode; currencyCode: CurrencyCode }

function BankBalanceInput({
  credit,
  plan,
  onNext,
}: {
  credit: boolean
  plan: PlanCurrency
  onNext: (target: number) => void
}) {
  const [input, setInput] = useState('')
  const [invalid, setInvalid] = useState(false)
  function next() {
    const value = parseBankBalance(
      input,
      plan.countryCode,
      plan.currencyCode,
      credit,
    )
    if (value === null) {
      setInvalid(true)
      return
    }
    onNext(value)
  }
  return (
    <>
      <Field data-invalid={invalid}>
        <FieldLabel htmlFor="bank-balance">
          Current balance at your bank
        </FieldLabel>
        <Input
          id="bank-balance"
          autoFocus
          aria-invalid={invalid}
          value={input}
          onChange={(event) => {
            setInput(event.target.value)
            setInvalid(false)
          }}
        />
        {invalid && (
          <FieldError>Enter a valid balance for the Plan currency.</FieldError>
        )}
      </Field>
      {credit && (
        <p>
          Enter debt with or without a minus sign. Use + for a positive balance.
        </p>
      )}
      <BalanceHelp />
      <Button onClick={next}>Next</Button>
    </>
  )
}

function BalanceHelp() {
  return (
    <details className="text-center text-sm">
      <summary className="cursor-pointer font-medium text-primary">
        How do I find my account balance?
      </summary>
      <p className="mt-2 text-muted-foreground">
        Use your bank’s current posted balance, excluding pending transactions.
      </p>
    </details>
  )
}

async function completionError(cause: unknown, refresh: () => Promise<void>) {
  if (cause instanceof InterruptedSaveError)
    return 'The result is unknown. Retry the same reconciliation to recover it.'
  try {
    await refresh()
  } catch {
    return 'Could not refresh the register. Please try again.'
  }
  return cause instanceof Error
    ? cause.message
    : 'Could not finish reconciliation. Please try again.'
}

export function ReconciliationControls({
  balance,
  credit,
  plan,
  finish,
  refresh,
  review,
}: {
  balance: number
  credit: boolean
  plan: PlanCurrency
  finish: (target: number, adjust: boolean) => Promise<void>
  refresh: () => Promise<void>
  review: () => Promise<void>
}) {
  const [step, setStep] = useState<
    'idle' | 'review' | 'match' | 'input' | 'explain' | 'investigate'
  >('idle')
  const [target, setTarget] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const format = (amount: number) =>
    formatCurrencyForCountry(amount / 1000, plan.countryCode, plan.currencyCode)
  const trigger = useRef<HTMLButtonElement>(null)
  const continueButton = useRef<HTMLButtonElement>(null)
  const popup = step === 'review' || step === 'match' || step === 'input'
  const signed = (amount: number) => (amount > 0 ? '+' : '') + format(amount)
  function cancel() {
    setStep('idle')
    setError('')
  }
  const difference = target - balance
  async function complete(value: number, adjust: boolean) {
    setBusy(true)
    setError('')
    try {
      await finish(value, adjust)
      setStep('idle')
    } catch (cause) {
      setError(await completionError(cause, refresh))
    }
    setBusy(false)
  }
  return (
    <section aria-label="Account reconciliation" className="contents">
      <div className="col-start-1 row-start-2 self-center justify-self-start sm:col-start-2 sm:row-start-1 sm:justify-self-end">
        <Popover
          open={popup}
          onOpenChange={(open) => {
            if (busy) return
            if (open) {
              setError('')
              setStep('review')
              setBusy(true)
              void review()
                .then(() => setStep('match'))
                .catch(() =>
                  setError(
                    'Could not load the current balance. Close and try again.',
                  ),
                )
                .finally(() => setBusy(false))
            } else cancel()
          }}
        >
          <PopoverTrigger asChild>
            <Button
              ref={trigger}
              disabled={step === 'investigate' || step === 'explain'}
            >
              Reconcile
            </Button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Reconcile account"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="w-72 max-w-[calc(100vw-1.5rem)] gap-4 p-4 shadow-xl"
          >
            <fieldset disabled={busy} className="flex flex-col gap-4">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Cancel"
                onClick={cancel}
                className="absolute right-1 top-1"
              >
                <X />
              </Button>
              {step === 'review' ? (
                busy && <p role="status">Checking cleared transactions…</p>
              ) : step === 'match' ? (
                <>
                  <p className="rounded-md bg-muted px-3 py-4 text-center text-sm">
                    Is your current balance{' '}
                    <strong className="block break-words font-heading text-2xl tabular-nums">
                      {format(balance)}?
                    </strong>
                  </p>
                  <BalanceHelp />
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => setStep('input')}>No</Button>
                    <Button onClick={() => void complete(balance, false)}>
                      Yes
                    </Button>
                  </div>
                </>
              ) : (
                <BankBalanceInput
                  credit={credit}
                  plan={plan}
                  onNext={(value) => {
                    setTarget(value)
                    setStep(value === balance ? 'investigate' : 'explain')
                  }}
                />
              )}
              {error && (
                <p className="text-destructive" role="alert">
                  {error}
                </p>
              )}
            </fieldset>
          </PopoverContent>
        </Popover>
      </div>
      <Dialog
        open={step === 'explain'}
        onOpenChange={(open) => {
          if (!open) cancel()
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            ;(continueButton.current ?? trigger.current)?.focus()
          }}
        >
          <div className="rounded-lg bg-muted p-5 text-center">
            <DialogTitle>Difference</DialogTitle>
            <div className="mt-2 font-heading text-3xl font-semibold tabular-nums">
              {signed(difference)}
            </div>
          </div>
          <DialogDescription>
            Bank balance {signed(target)}. Compare each unlocked transaction
            with your bank records. The register will show the remaining
            difference as you make corrections.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
            <Button onClick={() => setStep('investigate')}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {step === 'investigate' && (
        <div className="col-span-full flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-accent px-4 py-3 text-sm">
          {difference ? (
            <Scale aria-hidden className="size-5 text-primary" />
          ) : (
            <CheckCheck aria-hidden className="size-5 text-primary" />
          )}
          <div role="status" className="min-w-36 flex-1">
            <p className="font-medium">
              {difference ? (
                <>
                  This account's cleared balance in Envelove is{' '}
                  <strong>
                    {format(Math.abs(difference))}{' '}
                    {difference > 0 ? 'lower' : 'higher'}
                  </strong>{' '}
                  than your actual account.
                </>
              ) : (
                'The balances match.'
              )}
            </p>
            <p className="text-muted-foreground">
              Bank balance {signed(target)}.
            </p>
          </div>
          <fieldset disabled={busy} className="flex flex-wrap gap-2">
            <Button ref={continueButton} variant="outline" onClick={cancel}>
              Cancel
            </Button>
            <Button onClick={() => void complete(target, difference !== 0)}>
              {difference
                ? 'Create Adjustment & Finish'
                : 'Finish Reconciliation'}
            </Button>
          </fieldset>
          {error && (
            <p className="w-full text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
