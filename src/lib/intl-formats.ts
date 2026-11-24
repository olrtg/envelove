// Intl formatters are expensive to construct, so each locale and option set is
// built once and reused.
const numberFormats = new Map<string, Intl.NumberFormat>()
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()

export function normalizeLocaleDigits(text: string, locale: string) {
  if (/^\p{ASCII}*$/u.test(text)) return text
  const digits = Array.from(
    getNumberFormat(locale, { useGrouping: false }).format(9876543210),
  ).reverse()
  return text.replace(/\p{Decimal_Number}/gu, (digit) => {
    const index = digits.indexOf(digit)
    return index < 0 ? digit : String(index)
  })
}

export function getNumberFormat(
  locale: string,
  options: Intl.NumberFormatOptions = {},
) {
  const key = `${locale} ${JSON.stringify(options)}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat([locale, 'en'], options)
    numberFormats.set(key, format)
  }
  return format
}

export function getDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  const key = `${locale} ${JSON.stringify(options)}`
  let format = dateTimeFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat([locale, 'en'], options)
    dateTimeFormats.set(key, format)
  }
  return format
}
