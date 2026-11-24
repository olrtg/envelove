import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm'

import { db } from '#/db'
import { payees, plans, transactions } from '#/db/schema'

import { getPayeeNameKey } from './payee.schemas'

export type PayeeSummary = typeof payees.$inferSelect & {
  transactionCount: number
}

export type PayeeMutationResult =
  { status: 'ok'; payee: PayeeSummary } | { status: 'duplicate' | 'not_found' }

export type DeletePayeeResult =
  | {
      status: 'ok'
      removedPayeeId: string
      destinationPayeeId: string | null
      transactionCount: number
    }
  | { status: 'invalid_destination' | 'not_found' }

export async function findPayeesByPlanOwner(planId: string, ownerId: string) {
  const ownedPlan = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
    .limit(1)

  if (!ownedPlan.at(0)) return null

  const rows = await db
    .select({
      id: payees.id,
      planId: payees.planId,
      name: payees.name,
      nameKey: payees.nameKey,
      createdAt: payees.createdAt,
      updatedAt: payees.updatedAt,
      transactionCount: count(transactions.id),
    })
    .from(payees)
    .leftJoin(transactions, eq(transactions.payeeId, payees.id))
    .where(eq(payees.planId, planId))
    .groupBy(payees.id)
    .orderBy(asc(payees.name), asc(payees.id))

  return sortPayees(rows)
}

export function insertOwnedPayee({
  planId,
  ownerId,
  name,
}: {
  planId: string
  ownerId: string
  name: string
}): PayeeMutationResult {
  return db.transaction(
    (tx) => {
      const ownedPlan = tx
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
        .limit(1)
        .all()
        .at(0)
      if (!ownedPlan) return { status: 'not_found' } as const

      const inserted = tx
        .insert(payees)
        .values({ planId, name, nameKey: getPayeeNameKey(name) })
        .onConflictDoNothing()
        .returning()
        .all()
        .at(0)

      if (!inserted) return { status: 'duplicate' } as const
      return {
        status: 'ok',
        payee: { ...inserted, transactionCount: 0 },
      } as const
    },
    { behavior: 'immediate' },
  )
}

export function renameOwnedPayee({
  id,
  ownerId,
  name,
}: {
  id: string
  ownerId: string
  name: string
}): PayeeMutationResult {
  return db.transaction(
    (tx) => {
      const ownedPayee = tx
        .select({ id: payees.id, planId: payees.planId })
        .from(payees)
        .innerJoin(plans, eq(payees.planId, plans.id))
        .where(and(eq(payees.id, id), eq(plans.ownerId, ownerId)))
        .limit(1)
        .all()
        .at(0)
      if (!ownedPayee) return { status: 'not_found' } as const

      const nameKey = getPayeeNameKey(name)
      const duplicate = tx
        .select({ id: payees.id })
        .from(payees)
        .where(
          and(
            eq(payees.planId, ownedPayee.planId),
            eq(payees.nameKey, nameKey),
            ne(payees.id, id),
          ),
        )
        .limit(1)
        .all()
        .at(0)
      if (duplicate) return { status: 'duplicate' } as const

      const transactionCount = tx
        .select({ value: count(transactions.id) })
        .from(transactions)
        .where(eq(transactions.payeeId, id))
        .all()
        .at(0)?.value

      const saved = tx
        .update(payees)
        .set({ name, nameKey, updatedAt: new Date() })
        .where(eq(payees.id, id))
        .returning()
        .all()
        .at(0)
      if (!saved) return { status: 'not_found' } as const

      return {
        status: 'ok',
        payee: { ...saved, transactionCount: transactionCount ?? 0 },
      } as const
    },
    { behavior: 'immediate' },
  )
}

export function deleteOwnedPayee({
  destinationPayeeId,
  id,
  ownerId,
}: {
  destinationPayeeId: string | null
  id: string
  ownerId: string
}): DeletePayeeResult {
  return db.transaction(
    (tx) => {
      const source = tx
        .select({ id: payees.id, planId: payees.planId })
        .from(payees)
        .innerJoin(plans, eq(payees.planId, plans.id))
        .where(and(eq(payees.id, id), eq(plans.ownerId, ownerId)))
        .limit(1)
        .all()
        .at(0)
      if (!source) return { status: 'not_found' } as const

      if (destinationPayeeId === id) {
        return { status: 'invalid_destination' } as const
      }

      if (destinationPayeeId) {
        const destination = tx
          .select({ id: payees.id })
          .from(payees)
          .where(
            and(
              eq(payees.id, destinationPayeeId),
              eq(payees.planId, source.planId),
            ),
          )
          .limit(1)
          .all()
          .at(0)
        if (!destination) return { status: 'invalid_destination' } as const
      }

      const reassigned = tx
        .update(transactions)
        .set({ payeeId: destinationPayeeId, updatedAt: new Date() })
        .where(eq(transactions.payeeId, id))
        .returning({ id: transactions.id })
        .all()

      const removed = tx
        .delete(payees)
        .where(eq(payees.id, id))
        .returning({ id: payees.id })
        .all()
        .at(0)
      if (!removed) return { status: 'not_found' } as const

      return {
        status: 'ok',
        removedPayeeId: removed.id,
        destinationPayeeId,
        transactionCount: reassigned.length,
      } as const
    },
    { behavior: 'immediate' },
  )
}

export function combineOwnedPayees({
  planId,
  ownerId,
  ids,
  name,
}: {
  planId: string
  ownerId: string
  ids: string[]
  name: string
}) {
  return db.transaction(
    (tx) => {
      const sources = tx
        .select({ id: payees.id })
        .from(payees)
        .innerJoin(plans, eq(payees.planId, plans.id))
        .where(
          and(
            eq(plans.ownerId, ownerId),
            eq(payees.planId, planId),
            inArray(payees.id, ids),
          ),
        )
        .all()
      if (ids.length < 2 || sources.length !== ids.length)
        throw new Error('Select at least two current Payees from this Plan.')

      const nameKey = getPayeeNameKey(name)
      const destination =
        tx
          .select()
          .from(payees)
          .where(and(eq(payees.planId, planId), eq(payees.nameKey, nameKey)))
          .get() ??
        tx.insert(payees).values({ planId, name, nameKey }).returning().get()
      const removed = ids.filter((id) => id !== destination.id)
      // Preserve the edit order used for the register's last-category suggestion.
      tx.update(transactions)
        .set({
          payeeId: destination.id,
          updatedAt: sql`${transactions.updatedAt}`,
        })
        .where(inArray(transactions.payeeId, removed))
        .run()
      tx.delete(payees).where(inArray(payees.id, removed)).run()
      const { value } = tx
        .select({ value: count() })
        .from(transactions)
        .where(eq(transactions.payeeId, destination.id))
        .get()!
      return { ...destination, transactionCount: value }
    },
    { behavior: 'immediate' },
  )
}

export function sortPayees<TPayee extends { id: string; name: string }>(
  rows: Array<TPayee>,
) {
  return [...rows].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: 'base',
      }) || left.id.localeCompare(right.id),
  )
}
