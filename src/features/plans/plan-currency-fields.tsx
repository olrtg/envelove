import { useRef } from 'react'
import { useAmountsHidden } from '#/hooks/use-amount-privacy'
import { SearchableSelect } from '#/components/searchable-select'
import { Field, FieldDescription, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  countryCodes,
  currencyCodes,
  formatCurrencyForCountry,
  getCountryProfile,
} from '#/lib/country-profiles'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'

let options: ReturnType<typeof buildCountryOptions> | undefined
function buildCountryOptions() {
  const names = new Intl.DisplayNames('en', { type: 'region' })
  const collator = new Intl.Collator('en')
  const items = countryCodes.map((value) => ({
    value,
    label: names.of(value) ?? value,
  }))
  items.sort((a, b) => collator.compare(a.label, b.label))
  return [{ id: 'countries', items }]
}

type Selection = { country: CountryCode; currency: CurrencyCode | '' }

export function PlanCurrencyFields({
  country,
  currency,
  onChange,
}: Selection & { onChange: (value: Selection) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const hidden = useAmountsHidden()
  const { currencies } = getCountryProfile(country)
  const choices = currencies.length ? currencies : currencyCodes
  return (
    <>
      <Field ref={container}>
        <FieldLabel htmlFor="plan-country">Country or territory</FieldLabel>
        <SearchableSelect
          id="plan-country"
          pageSize={24}
          container={container}
          groups={(options ??= buildCountryOptions())}
          value={country}
          emptyMessage="No matching countries"
          placeholder="Search countries and territories"
          onChange={(value) => {
            const next = value as CountryCode
            if (next !== country)
              onChange({
                country: next,
                currency: getCountryProfile(next).currencies.at(0) ?? '',
              })
          }}
        />
      </Field>
      {choices.length > 1 || (currency && currency !== choices[0]) ? (
        <Field>
          <FieldLabel htmlFor="plan-currency">Currency</FieldLabel>
          <Select
            value={currency}
            onValueChange={(value) =>
              onChange({ country, currency: value as CurrencyCode })
            }
          >
            <SelectTrigger id="plan-currency" className="w-full">
              <SelectValue placeholder="Choose a currency" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(currency && !choices.includes(currency)
                  ? [currency, ...choices]
                  : choices
                ).map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {!currencies.length && (
            <FieldDescription>
              This territory has no official currency. Choose one for your plan.
            </FieldDescription>
          )}
        </Field>
      ) : null}
      {currency && !hidden && (
        <div className="rounded-lg border bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            Local preview · {currency}
          </p>
          <p className="mt-1 font-medium">
            {formatCurrencyForCountry(123456.789, country, currency)}
          </p>
        </div>
      )}
    </>
  )
}
