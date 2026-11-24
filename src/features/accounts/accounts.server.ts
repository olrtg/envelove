import { and, asc, eq, lte, max, sql } from 'drizzle-orm'

import { db } from '#/db'
import {
  amountMatchesCurrency,
  currentDayInZone,
} from '#/features/transactions/transaction-money'
import { resolveOrdinaryPayee } from '#/features/transactions/transactions.server'
import {
  accounts,
  categories,
  categoryGroups,
  plans,
  transactions,
} from '#/db/schema'

import type { AccountType } from './account.schemas'
import { accountTypeDetails } from './account-types'

export type Account = typeof accounts.$inferSelect

export function findAccountsByPlanOwner({
  planId,
  ownerId,
  today,
}: {
  planId: string
  ownerId: string
  today: string
}) {
  return db
    .select({
      id: accounts.id,
      planId: accounts.planId,
      name: accounts.name,
      type: accounts.type,
      closed: accounts.closed,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
      clearedBalance: sql<number>`coalesce(sum(case when ${transactions.cleared} then ${transactions.amount} end), 0)`,
      unclearedBalance: sql<number>`coalesce(sum(case when not ${transactions.cleared} then ${transactions.amount} end), 0)`,
      workingBalance: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(accounts)
    .innerJoin(plans, eq(accounts.planId, plans.id))
    .leftJoin(
      transactions,
      and(
        eq(transactions.accountId, accounts.id),
        lte(transactions.date, today),
      ),
    )
    .where(and(eq(accounts.planId, planId), eq(plans.ownerId, ownerId)))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.createdAt))
}

export function insertOwnedAccount({
  planId,
  ownerId,
  name,
  type,
  startingBalance = 0,
  timeZone,
}: {
  planId: string
  ownerId: string
  name: string
  type: AccountType
  startingBalance?: number
  timeZone?: string
}) {
  return db.transaction(
    (tx) => {
      const ownedPlan = tx
        .select({ currencyCode: plans.currencyCode })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
        .limit(1)
        .all()
        .at(0)

      if (!ownedPlan) return null
      if (
        !Number.isSafeInteger(startingBalance) ||
        !amountMatchesCurrency(startingBalance, ownedPlan.currencyCode)
      ) {
        throw new Error('Enter a valid starting balance in the plan currency.')
      }

      let paymentGroupId: string | null = null
      if (accountTypeDetails[type].group === 'credit') {
        const existingGroup = tx
          .select({ id: categoryGroups.id })
          .from(categoryGroups)
          .where(
            and(
              eq(categoryGroups.planId, planId),
              eq(categoryGroups.kind, 'credit_card_payments'),
            ),
          )
          .limit(1)
          .all()
          .at(0)

        if (existingGroup) {
          paymentGroupId = existingGroup.id
        } else {
          const groupPosition = tx
            .select({ position: max(categoryGroups.position) })
            .from(categoryGroups)
            .where(eq(categoryGroups.planId, planId))
            .all()
            .at(0)?.position
          paymentGroupId =
            tx
              .insert(categoryGroups)
              .values({
                planId,
                name: 'Credit Card Payments',
                kind: 'credit_card_payments',
                position: (groupPosition ?? -1) + 1,
              })
              .returning({ id: categoryGroups.id })
              .all()
              .at(0)?.id ?? null
        }
      }

      const account = tx
        .insert(accounts)
        .values({ planId, name, type })
        .returning()
        .all()
        .at(0)

      if (!account) throw new Error('Could not create Account')

      if (paymentGroupId) {
        const categoryPosition = tx
          .select({ position: max(categories.position) })
          .from(categories)
          .where(eq(categories.categoryGroupId, paymentGroupId))
          .all()
          .at(0)?.position

        tx.insert(categories)
          .values({
            categoryGroupId: paymentGroupId,
            name,
            kind: 'credit_payment',
            creditAccountId: account.id,
            position: (categoryPosition ?? -1) + 1,
          })
          .run()
      } else if (accountTypeDetails[type].group === 'credit') {
        throw new Error('Could not create Credit Card Payments group')
      }

      if (startingBalance !== 0) {
        const group = accountTypeDetails[type].group
        let categoryId: string | null = null
        if (group === 'cash' || group === 'credit') {
          const inflow = tx
            .select({ id: categories.id })
            .from(categories)
            .innerJoin(
              categoryGroups,
              eq(categories.categoryGroupId, categoryGroups.id),
            )
            .where(
              and(
                eq(categoryGroups.planId, planId),
                eq(categories.kind, 'ready_to_assign'),
              ),
            )
            .get()
          if (!inflow) throw new Error('Ready to Assign is unavailable.')
          categoryId = inflow.id
        }
        const payee = resolveOrdinaryPayee(
          tx,
          { kind: 'create', name: 'Starting Balance' },
          planId,
        )
        if (!payee) throw new Error('Starting Balance payee is unavailable.')
        tx.insert(transactions)
          .values({
            accountId: account.id,
            amount: startingBalance,
            categoryId,
            payeeId: payee.payeeId,
            date: currentDayInZone(timeZone),
            cleared: true,
            startingBalance: true,
          })
          .run()
      }
      return account
    },
    { behavior: 'immediate' },
  )
}

export function updateOwnedAccount({
  id,
  ownerId,
  name,
  closed,
}: {
  id: string
  ownerId: string
  name: string
  closed: boolean
}) {
  return db.transaction(
    (tx) => {
      const ownedAccount = tx
        .select({ id: accounts.id, type: accounts.type })
        .from(accounts)
        .innerJoin(plans, eq(accounts.planId, plans.id))
        .where(and(eq(accounts.id, id), eq(plans.ownerId, ownerId)))
        .limit(1)
        .all()
        .at(0)

      if (!ownedAccount) return null

      const account = tx
        .update(accounts)
        .set({ name, closed, updatedAt: new Date() })
        .where(eq(accounts.id, id))
        .returning()
        .all()
        .at(0)

      if (accountTypeDetails[ownedAccount.type].group === 'credit') {
        const paymentCategory = tx
          .update(categories)
          .set({ name, updatedAt: new Date() })
          .where(
            and(
              eq(categories.creditAccountId, id),
              eq(categories.kind, 'credit_payment'),
            ),
          )
          .returning({ id: categories.id })
          .all()
          .at(0)
        if (!paymentCategory) throw new Error('Credit Payment Category missing')
      }

      return account ?? null
    },
    { behavior: 'immediate' },
  )
}
