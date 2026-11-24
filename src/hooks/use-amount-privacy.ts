import { createContext, useContext, useSyncExternalStore } from 'react'
import { formatCurrencyForCountry } from '#/lib/country-profiles'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'

const key = 'envelove.hideAmounts'
let sessionHidden: boolean | undefined

function snapshot() {
  if (sessionHidden !== undefined) return sessionHidden
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

export function setAmountsHidden(hidden: boolean) {
  try {
    localStorage.setItem(key, String(hidden))
    sessionHidden = undefined
  } catch {
    // Browsers that block storage can still mask this session.
    sessionHidden = hidden
  }
  window.dispatchEvent(new Event(key))
}

function subscribe(notify: () => void) {
  window.addEventListener(key, notify)
  window.addEventListener('storage', notify)
  return () => {
    window.removeEventListener(key, notify)
    window.removeEventListener('storage', notify)
  }
}

export const AmountPrivacy = createContext(true)
export const useAmountsHidden = () => useContext(AmountPrivacy)
// Never send visible amounts in the initial markup before reading the device preference.
export const useDeviceAmountPrivacy = () =>
  useSyncExternalStore(subscribe, snapshot, () => true)

export function useMoney(currency: {
  countryCode: CountryCode
  currencyCode: CurrencyCode
}) {
  const hidden = useAmountsHidden()
  return (milliunits: number) =>
    hidden
      ? milliunits < 0
        ? '−••••'
        : '••••'
      : formatCurrencyForCountry(
          milliunits / 1000,
          currency.countryCode,
          currency.currencyCode,
        )
}
