import { evaluateSignedCurrencyToMilliunits } from '#/features/transactions/transaction-money'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'

// Reads what a user typed into an Assigned cell. A leading "+" adds to the
// current amount, a leading "-" sets a negative one, and "x" multiplies. An
// expression is anything beyond a plain, possibly negative, number.
export function parseAssignedInput(
  text: string,
  current: number,
  countryCode: CountryCode,
  currencyCode: CurrencyCode,
) {
  const normalized = text.trim().replaceAll(/[x×]/giu, '*')
  if (!normalized) return { amount: 0, isExpression: false }

  const adds = normalized.startsWith('+')
  const value = evaluateSignedCurrencyToMilliunits(
    adds ? normalized.slice(1) : normalized,
    countryCode,
    currencyCode,
  )
  if (value === null) return null

  const amount = adds ? current + value : value
  return Number.isSafeInteger(amount)
    ? { amount, isExpression: /[+*/()]|.-/u.test(normalized) }
    : null
}
