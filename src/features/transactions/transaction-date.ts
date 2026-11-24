import { getCountryProfile } from '#/lib/country-profiles'
import type { CountryCode } from '#/lib/country-profiles'
import { getDateTimeFormat, normalizeLocaleDigits } from '#/lib/intl-formats'

type DatePart = 'day' | 'month' | 'year'

function getDateFormatter(locale: string) {
  return getDateTimeFormat(locale, {
    calendar: 'gregory',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function toUtcDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`)
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function formatTransactionDate(date: string, countryCode: CountryCode) {
  return getDateTimeFormat(getCountryProfile(countryCode).locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(toUtcDate(date))
}

// Formats a calendar date the way the Plan's locale writes it, e.g. 10/02/2026.
export function formatDateInput(date: string, locale: string) {
  return getDateFormatter(locale).format(toUtcDate(date))
}

// Reads a full or partial date in the Plan's locale order. A lone day uses
// today's month and year, and a day with a month uses today's year.
export function parseDateInput(text: string, locale: string, today: string) {
  const numbers = normalizeLocaleDigits(text, locale).match(/\d+/g)?.map(Number)
  if (!numbers || numbers.length > 3) return null

  const order = getDateFormatter(locale)
    .formatToParts(toUtcDate(today))
    .map((part) => part.type)
    .filter(
      (type): type is DatePart =>
        type === 'day' || type === 'month' || type === 'year',
    )
  const parts = numbers.length === 3 ? order : order.filter((p) => p !== 'year')
  const values = new Map<DatePart, number>(
    numbers.length === 1
      ? [['day', numbers[0]]]
      : parts.map((part, index) => [part, numbers[index]]),
  )

  const [todayYear, todayMonth] = today.split('-').map(Number)
  const day = values.get('day')
  const month = values.get('month') ?? todayMonth
  let year = values.get('year') ?? todayYear
  if (year < 100) year += 2000
  if (day === undefined) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return toIsoDate(date)
}

export function addDays(date: string, days: number) {
  const next = toUtcDate(date)
  next.setUTCDate(next.getUTCDate() + days)
  return toIsoDate(next)
}
