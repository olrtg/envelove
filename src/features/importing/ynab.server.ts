import { db } from '#/db'
import * as tables from '#/db/schema'
import { planCurrency } from '#/lib/country-profiles'
import type { CountryCode } from '#/lib/country-profiles'
import { prepareYnabSnapshot } from './ynab-snapshot'

export function importYnabPlan(
  content: string,
  countryCode: CountryCode,
  ownerId: string,
) {
  const p = prepareYnabSnapshot(content)
  const currencyCode = planCurrency(countryCode, p.summary.currency)
  return db.transaction((tx) => {
    tx.insert(tables.plans)
      .values({
        id: p.planId,
        ownerId,
        name: p.summary.name,
        countryCode,
        currencyCode,
        createdAt: new Date(`${p.firstMonth}T12:00:00Z`),
      })
      .run()
    for (const a of p.accounts) tx.insert(tables.accounts).values(a).run()
    for (const g of p.groups) tx.insert(tables.categoryGroups).values(g).run()
    for (const c of p.categories) tx.insert(tables.categories).values(c).run()
    for (const a of p.assignments)
      tx.insert(tables.categoryAssignments).values(a).run()
    for (const payee of p.payees) tx.insert(tables.payees).values(payee).run()
    for (const t of p.transfers) tx.insert(tables.transfers).values(t).run()
    for (const t of p.transactions)
      tx.insert(tables.transactions).values(t).run()
    return p.planId
  })
}
