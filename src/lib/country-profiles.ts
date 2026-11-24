import { getNumberFormat } from './intl-formats'
import { countryData } from './country-data'

export type CountryCode = keyof typeof countryData
type Profile = (typeof countryData)[CountryCode]
type Tender<T> = T extends readonly [string, ...infer C] ? C[number] : never
export type CurrencyCode = Tender<Profile>

export const countryCodes = Object.keys(countryData) as [
  CountryCode,
  ...CountryCode[],
]
export const currencyCodes = [
  ...new Set(
    countryCodes.flatMap((code) => getCountryProfile(code).currencies),
  ),
].sort() as [CurrencyCode, ...CurrencyCode[]]

export function getCountryProfile(countryCode: CountryCode) {
  const [locale, ...currencies] = countryData[countryCode]
  return { locale, currencies: currencies as CurrencyCode[] }
}

export function planCurrency(country: CountryCode, selected?: CurrencyCode) {
  const { currencies } = getCountryProfile(country)
  const currency = selected ?? currencies.at(0)
  if (
    !currency ||
    !(currencies.length ? currencies : currencyCodes).includes(currency)
  ) {
    throw new Error('Choose a currency for this country.')
  }
  return currency
}

export function formatCurrencyForCountry(
  amount: number,
  countryCode: CountryCode,
  currencyCode: CurrencyCode,
) {
  return getNumberFormat(countryData[countryCode][0], {
    style: 'currency',
    currency: currencyCode,
  }).format(amount)
}
