import { and, asc, eq, getTableColumns, inArray, min, sql } from 'drizzle-orm'

import { db } from '#/db'
import {
  accounts,
  categories,
  categoryAssignments,
  categoryGroups,
  plans,
  transactions,
} from '#/db/schema'
import { deletePlanReceipts } from '#/features/history/history.server'
import { planCurrency } from '#/lib/country-profiles'
import type { PlanMonth } from './plan-month'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'

export type Plan = typeof plans.$inferSelect

export function deleteOwnedPlan(id: string, ownerId: string) {
  return db.transaction(
    (tx) => {
      const owned = and(eq(plans.id, id), eq(plans.ownerId, ownerId))
      if (!tx.select({ id: plans.id }).from(plans).where(owned).get())
        return false

      // Category and Payee references restrict deletion while transactions exist.
      const planAccounts = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.planId, id))
      tx.delete(transactions)
        .where(inArray(transactions.accountId, planAccounts))
        .run()
      deletePlanReceipts(id)
      tx.delete(plans).where(owned).run()
      return true
    },
    { behavior: 'immediate' },
  )
}

export function findPlansByOwner(ownerId: string) {
  return db
    .select()
    .from(plans)
    .where(eq(plans.ownerId, ownerId))
    .orderBy(asc(plans.createdAt))
}

export async function findPlanByOwner(id: string, ownerId: string) {
  const result = await db
    .select({
      ...getTableColumns(plans),
      firstTransactionDate: min(transactions.date),
      latestAssignedMonth: sql<PlanMonth | null>`(
        select max(${categoryAssignments.month}) from ${categoryAssignments}
        inner join ${categories} on ${categories.id} = ${categoryAssignments.categoryId}
        inner join ${categoryGroups} on ${categoryGroups.id} = ${categories.categoryGroupId}
        where ${categoryGroups.planId} = ${plans.id}
      )`,
    })
    .from(plans)
    .leftJoin(accounts, eq(accounts.planId, plans.id))
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(and(eq(plans.id, id), eq(plans.ownerId, ownerId)))
    .groupBy(plans.id)
    .limit(1)

  return result.at(0) ?? null
}

// Every Plan starts with its Inflow: Ready to Assign Category.
export function insertPlan({
  ownerId,
  name,
  countryCode,
  currencyCode,
}: {
  ownerId: string
  name: string
  countryCode: CountryCode
  currencyCode?: CurrencyCode
}) {
  return db.transaction((tx) => {
    const plan = tx
      .insert(plans)
      .values({
        ownerId,
        name,
        countryCode,
        currencyCode: planCurrency(countryCode, currencyCode),
      })
      .returning()
      .get()
    const inflowGroup = tx
      .insert(categoryGroups)
      .values({ planId: plan.id, name: 'Inflow', kind: 'inflow', position: 0 })
      .returning({ id: categoryGroups.id })
      .get()
    tx.insert(categories)
      .values({
        categoryGroupId: inflowGroup.id,
        name: 'Ready to Assign',
        kind: 'ready_to_assign',
        position: 0,
      })
      .run()
    return plan
  })
}

export function updateOwnedPlan({
  id,
  ownerId,
  name,
  countryCode,
  currencyCode,
  defaultTransactionCleared,
  hideAfterReconciliation,
}: {
  id: string
  ownerId: string
  name: string
  countryCode?: CountryCode
  currencyCode?: CurrencyCode
  defaultTransactionCleared: boolean
  hideAfterReconciliation?: boolean
}) {
  const result = db
    .update(plans)
    .set({
      name,
      countryCode,
      currencyCode: countryCode
        ? planCurrency(countryCode, currencyCode)
        : undefined,
      defaultTransactionCleared,
      hideAfterReconciliation,
      updatedAt: new Date(),
    })
    .where(and(eq(plans.id, id), eq(plans.ownerId, ownerId)))
    .returning()
    .all()

  return result.at(0) ?? null
}
