import { useState } from 'react'
import { useAmountsHidden } from '#/hooks/use-amount-privacy'
import { Button } from '#/components/ui/button'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { accountTypeDetails } from '#/features/accounts/account-types'
import { accountTypes } from '#/features/accounts/account.schemas'
import type { AccountType } from '#/features/accounts/account.schemas'
import { currencyCodes } from '#/lib/country-profiles'
import type { CurrencyCode } from '#/lib/country-profiles'
import { exportSnapshot } from './ynab-export'
import type { NativeExport, DateOrder } from './ynab-export'

function Choice<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: T | ''
  options: readonly T[]
  onChange: (v: T) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {accountTypes.includes(option as AccountType)
                  ? accountTypeDetails[option as AccountType].label
                  : option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

export function ExportOptions({
  source,
  onPreview,
}: {
  source: NativeExport
  onPreview: (content: string) => void
}) {
  const hidden = useAmountsHidden()
  const [currency, setCurrency] = useState<CurrencyCode | ''>(''),
    [order, setOrder] = useState<DateOrder | ''>(''),
    [types, setTypes] = useState(() => new Map<string, AccountType>()),
    [error, setError] = useState('')
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3">
      <div>
        <h3 className="font-medium">Match your YNAB settings</h3>
        <p className="text-muted-foreground">
          The ZIP has no currency code or account types. Choose the settings
          used in {source.name}.
        </p>
      </div>
      <Choice
        id="export-currency"
        label="Plan currency"
        value={currency}
        options={currencyCodes}
        onChange={setCurrency}
      />
      {source.register.length > 0 && (
        <Choice
          id="export-dates"
          label={`Date order (file: ${source.register[0].Date})`}
          value={order}
          options={['DMY', 'MDY', 'YMD'] as const}
          onChange={setOrder}
        />
      )}
      {source.accounts.map((name, index) => (
        <Choice
          key={name}
          id={`export-account-${index}`}
          label={name}
          value={types.get(name) ?? ''}
          options={
            source.cards.has(name)
              ? ['credit_card', 'line_of_credit']
              : accountTypes
          }
          onChange={(v) => setTypes(new Map(types).set(name, v))}
        />
      ))}
      {error && (
        <FieldError>
          {hidden
            ? 'Cannot preview this ZIP. Show amounts to see the details.'
            : error}
        </FieldError>
      )}
      <Button
        variant="secondary"
        disabled={
          !currency ||
          (source.register.length > 0 && !order) ||
          types.size !== source.accounts.length
        }
        onClick={() => {
          if (!currency) return
          try {
            onPreview(exportSnapshot(source, currency, order || 'YMD', types))
            setError('')
          } catch (e) {
            setError(
              e instanceof Error ? e.message : 'Could not read the export.',
            )
          }
        }}
      >
        Preview ZIP import
      </Button>
    </section>
  )
}
