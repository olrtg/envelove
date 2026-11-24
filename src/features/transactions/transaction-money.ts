import { getCountryProfile } from '#/lib/country-profiles'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'
import {
  getNumberFormat,
  getDateTimeFormat,
  normalizeLocaleDigits,
} from '#/lib/intl-formats'

export function getCurrencyFractionDigits(currencyCode: CurrencyCode): number {
  const fractionDigits = getNumberFormat('en', {
    style: 'currency',
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits

  return fractionDigits ?? 2
}

export function amountMatchesCurrency(
  amount: number,
  currencyCode: CurrencyCode,
) {
  const fractionDigits = getCurrencyFractionDigits(currencyCode)
  const milliunitStep = 10 ** Math.max(0, 3 - fractionDigits)
  return amount % milliunitStep === 0
}

export function getLocalDate(today = new Date()) {
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function currentDayInZone(timeZone?: string) {
  return getDateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function parseCurrencyToMilliunits(
  value: string,
  countryCode: CountryCode,
  currencyCode: CurrencyCode,
) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const profile = getCountryProfile(countryCode)
  const parts = getNumberFormat(profile.locale).formatToParts(123456789.6)
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.'
  const group = parts.find((part) => part.type === 'group')?.value

  let normalized = normalizeLocaleDigits(trimmed, profile.locale)
  const [integer, fractionPart = ''] = normalized.split(decimal)
  if (group) {
    if (integer.includes(group)) {
      const groupedDigits = integer.replace(/^\+/, '').split(group)
      const lengths = parts
        .filter((part) => part.type === 'integer')
        .map((part) => Array.from(part.value).length)
      const primary = lengths.at(-1)!
      const secondary = lengths.at(-2)!
      const [firstGroup, ...remainingGroups] = groupedDigits
      if (
        !/^\d+$/.test(firstGroup) ||
        firstGroup.length > secondary ||
        remainingGroups.some(
          (digits, index) =>
            !/^\d+$/.test(digits) ||
            digits.length !==
              (index === remainingGroups.length - 1 ? primary : secondary),
        )
      ) {
        return null
      }
    }

    if (fractionPart.includes(group)) return null
    normalized = normalized.replaceAll(group, '')
  }
  normalized = normalized.replaceAll(/\s/gu, '')
  if (decimal !== '.') normalized = normalized.replace(decimal, '.')

  const fractionDigits = getCurrencyFractionDigits(currencyCode)
  const pattern =
    fractionDigits === 0
      ? /^\+?([0-9]+)$/
      : new RegExp(`^\\+?([0-9]+)(?:\\.([0-9]{1,${fractionDigits}}))?$`)
  const match = normalized.match(pattern)
  if (!match) return null

  const whole = BigInt(match[1])
  const fraction = (match.at(2) || '').padEnd(3, '0')
  const milliunits = whole * 1000n + BigInt(fraction || '0')

  if (milliunits > BigInt(Number.MAX_SAFE_INTEGER)) return null

  return Number(milliunits)
}

export function formatMilliunitsForInput(
  milliunits: number,
  countryCode: CountryCode,
  currencyCode: CurrencyCode,
) {
  const profile = getCountryProfile(countryCode)
  const fractionDigits = getCurrencyFractionDigits(currencyCode)

  return getNumberFormat(profile.locale, {
    useGrouping: false,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Math.abs(milliunits) / 1000)
}

// Evaluates simple arithmetic such as `12+3.50` or `(40-5)/2`, where each
// number is written in the Plan's locale, into a positive amount.
export function evaluateCurrencyToMilliunits(
  value: string,
  countryCode: CountryCode,
  currencyCode: CurrencyCode,
) {
  const milliunits = evaluateSignedCurrencyToMilliunits(
    value,
    countryCode,
    currencyCode,
  )
  return milliunits !== null && milliunits > 0 ? milliunits : null
}

export function evaluateSignedCurrencyToMilliunits(
  value: string,
  countryCode: CountryCode,
  currencyCode: CurrencyCode,
) {
  const tokens = value
    .trim()
    .match(/[+\-*/()]|[^+\-*/()]+/g)
    ?.map((token) => token.trim())
    .filter(Boolean)
  if (!tokens) return null
  if (tokens.length === 1) {
    return parseCurrencyToMilliunits(value, countryCode, currencyCode)
  }

  let position = 0
  const peek = () => tokens.at(position)
  const next = () => tokens.at(position++)

  function parseExpression(): number {
    let result = parseTerm()
    while (peek() === '+' || peek() === '-') {
      result = next() === '+' ? result + parseTerm() : result - parseTerm()
    }
    return result
  }

  function parseTerm(): number {
    let result = parseFactor()
    while (peek() === '*' || peek() === '/') {
      result = next() === '*' ? result * parseFactor() : result / parseFactor()
    }
    return result
  }

  function parseFactor(): number {
    const token = next()
    if (token === '+') return parseFactor()
    if (token === '-') return -parseFactor()
    if (token === '(') {
      const result = parseExpression()
      return next() === ')' ? result : Number.NaN
    }
    if (token === undefined || '*/)'.includes(token)) return Number.NaN

    const milliunits = parseCurrencyToMilliunits(
      token,
      countryCode,
      currencyCode,
    )
    return milliunits === null ? Number.NaN : milliunits / 1000
  }

  const units = parseExpression()
  if (position !== tokens.length || !Number.isFinite(units)) return null

  const scale = 10 ** getCurrencyFractionDigits(currencyCode)
  const milliunits = Math.round((Math.round(units * scale) / scale) * 1000)
  return Number.isSafeInteger(milliunits) ? milliunits : null
}

export function parseBankBalance(
  value: string,
  country: CountryCode,
  currency: CurrencyCode,
  credit: boolean,
) {
  const match = /^([+-]?)(\p{Decimal_Number}.*)$/u.exec(value.trim())
  if (!match) return null
  const amount = parseCurrencyToMilliunits(match[2], country, currency)
  if (amount === null || amount === 0) return amount
  return match[1] === '-' || (credit && match[1] !== '+') ? -amount : amount
}
