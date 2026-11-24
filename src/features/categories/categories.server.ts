import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  max,
  ne,
  sql,
} from 'drizzle-orm'

import { db } from '#/db'
import {
  accounts,
  categories,
  categoryGroups,
  payees,
  plans,
  transactions,
} from '#/db/schema'
import { emptyCategoryBudget } from '#/features/budget/budget-engine'
import {
  cardTransactionKind,
  cashAccountTypes,
  counterpart,
  counterpartAccount,
  counterpartOn,
  countsTowardActivity,
  findPlanMonthBudget,
  setOwnedCategoryAssigned,
} from '#/features/budget/budget.server'
import type { PlanMonth } from '#/features/plans/plan-month'
import {
  amountMatchesCurrency,
  getCurrencyFractionDigits,
} from '#/features/transactions/transaction-money'

import { sumVisibleAmounts } from './category-activity'
import { targetProgress } from './category-target'
import type { TargetChange } from './category.schemas'

export type DeleteCategoryResult =
  | { status: 'ok'; transactionCount: number }
  | { status: 'not_found' | 'target_required' | 'invalid_target' }

export function changeOwnedTarget(
  ownerId: string,
  categoryId: string,
  change: TargetChange,
) {
  const row = db
    .select({
      currency: plans.currencyCode,
      planId: plans.id,
      target: categories.target,
      months: categories.snoozedMonths,
    })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .innerJoin(plans, eq(categoryGroups.planId, plans.id))
    .where(
      and(
        eq(categories.id, categoryId),
        eq(plans.ownerId, ownerId),
        eq(categories.kind, 'ordinary'),
      ),
    )
    .get()
  if (!row) throw new Error('Category not found')
  if ('target' in change) {
    if (
      change.target &&
      !amountMatchesCurrency(change.target.amount, row.currency)
    )
      throw new Error('Invalid target amount')
    db.update(categories)
      .set({
        target: change.target,
        snoozedMonths: change.target ? undefined : null,
      })
      .where(eq(categories.id, categoryId))
      .run()
  } else if ('fund' in change) {
    if (!row.target) throw new Error('Target not found')
    const { month, today } = change
    const budget = findPlanMonthBudget({
      planId: row.planId,
      month,
      today,
      historyFor: new Set([categoryId]),
    })
    const progress = targetProgress(
      row.target,
      month,
      today,
      budget.history.get(categoryId) ?? new Map(),
      10 ** (3 - getCurrencyFractionDigits(row.currency)),
      row.months?.includes(month) ?? false,
    )
    const add = Math.min(progress?.underfunded ?? 0, budget.readyToAssign.total)
    if (add > 0) {
      const result = setOwnedCategoryAssigned({
        ownerId,
        categoryId,
        month,
        amount: (progress?.assigned ?? 0) + add,
      })
      if (result?.status !== 'ok') throw new Error('Could not assign to target')
    }
  } else {
    if (!row.target) throw new Error('Target not found')
    const months = new Set(row.months)
    if (change.snooze) months.add(change.month)
    else months.delete(change.month)
    db.update(categories)
      .set({ snoozedMonths: [...months] })
      .where(eq(categories.id, categoryId))
      .run()
  }
}

export type ActivitySource = { kind: 'category' | 'group'; id: string }

export async function findCategoryHierarchyByPlanOwner({
  planId,
  ownerId,
  month,
  today,
}: {
  planId: string
  ownerId: string
  month: PlanMonth
  today: string
}) {
  const ownedPlan = await db
    .select({ id: plans.id, currencyCode: plans.currencyCode })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
    .limit(1)

  const plan = ownedPlan.at(0)
  if (!plan) return null
  const step = 10 ** (3 - getCurrencyFractionDigits(plan.currencyCode))

  // Inflow: Ready to Assign never appears in the Plan grid.
  const groups = await db
    .select()
    .from(categoryGroups)
    .where(
      and(eq(categoryGroups.planId, planId), ne(categoryGroups.kind, 'inflow')),
    )
    .orderBy(asc(categoryGroups.position), asc(categoryGroups.createdAt))

  const categoryRows = await db
    .select({
      id: categories.id,
      categoryGroupId: categories.categoryGroupId,
      name: categories.name,
      kind: categories.kind,
      creditAccountId: categories.creditAccountId,
      creditAccountClosed: accounts.closed,
      target: categories.target,
      snoozedMonths: categories.snoozedMonths,
      hidden: categories.hidden,
      position: categories.position,
      createdAt: categories.createdAt,
      updatedAt: categories.updatedAt,
      transactionCount: count(transactions.id),
    })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .leftJoin(accounts, eq(categories.creditAccountId, accounts.id))
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(categoryGroups.planId, planId),
        ne(categories.kind, 'ready_to_assign'),
      ),
    )
    .groupBy(categories.id)
    .orderBy(asc(categories.position), asc(categories.createdAt))

  const budget = findPlanMonthBudget({
    planId,
    month,
    today,
    historyFor: new Set(categoryRows.filter((c) => c.target).map((c) => c.id)),
  })

  return {
    groups: groups.map((group) => {
      const groupCategories = categoryRows
        .filter((category) => category.categoryGroupId === group.id)
        .map((category) => ({
          ...category,
          progress: category.target
            ? targetProgress(
                category.target,
                month,
                today,
                budget.history.get(category.id) ?? new Map(),
                step,
                category.snoozedMonths?.includes(month) ?? false,
              )
            : null,
          ...(budget.categories.get(category.id) ?? emptyCategoryBudget),
          internal: category.kind !== 'ordinary',
        }))
      return {
        ...group,
        ...sumVisibleAmounts(groupCategories),
        internal: group.kind !== 'ordinary',
        categories: groupCategories,
      }
    }),
    readyToAssign: budget.readyToAssign,
  }
}

// Lists the Transactions behind a Category's Activity, or behind a group's
// Activity from its visible Categories.
export async function findCategoryActivityByPlanOwner({
  planId,
  ownerId,
  month,
  today,
  source,
}: {
  planId: string
  ownerId: string
  month: PlanMonth
  today: string
  source: ActivitySource
}) {
  const ownedPlan = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
    .limit(1)

  if (!ownedPlan.at(0)) return null

  const fromSource =
    source.kind === 'category'
      ? eq(categories.id, source.id)
      : and(eq(categoryGroups.id, source.id), eq(categories.hidden, false))
  const order = [
    desc(transactions.date),
    desc(transactions.createdAt),
    desc(transactions.id),
  ]
  const [categorized, payments] = await Promise.all([
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountName: accounts.name,
        date: transactions.date,
        payeeName: payees.name,
        memo: transactions.memo,
        amount: transactions.amount,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .innerJoin(
        categoryGroups,
        eq(categories.categoryGroupId, categoryGroups.id),
      )
      .leftJoin(payees, eq(transactions.payeeId, payees.id))
      .where(
        and(
          eq(categoryGroups.planId, planId),
          ne(categories.kind, 'ready_to_assign'),
          fromSource,
          countsTowardActivity(month, today),
        ),
      )
      .orderBy(...order),
    // Credit Payments into a card are its Credit Payment Category's Activity.
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountName: accounts.name,
        date: transactions.date,
        payeeName: sql<string>`'To/From ' || ${counterpartAccount.name}`,
        memo: transactions.memo,
        amount: sql<number>`-${transactions.amount}`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(categories, eq(categories.creditAccountId, accounts.id))
      .innerJoin(
        categoryGroups,
        eq(categories.categoryGroupId, categoryGroups.id),
      )
      .innerJoin(counterpart, counterpartOn)
      .innerJoin(
        counterpartAccount,
        eq(counterpart.accountId, counterpartAccount.id),
      )
      .where(
        and(
          eq(categoryGroups.planId, planId),
          fromSource,
          gt(transactions.amount, 0),
          inArray(counterpartAccount.type, cashAccountTypes),
          countsTowardActivity(month, today),
        ),
      )
      .orderBy(...order),
  ])

  // A source has categorized Transactions or Credit Payments, never both, so
  // each list keeps its own order.
  return [...categorized, ...payments]
}

// Lists every Transaction on a Credit Payment Category's card in the month, and
// sums them the way YNAB's Activity popover does. Total Activity is the
// Category's Activity: funded spending less Credit Payments.
export async function findCreditPaymentActivityByPlanOwner({
  planId,
  ownerId,
  month,
  today,
  categoryId,
}: {
  planId: string
  ownerId: string
  month: PlanMonth
  today: string
  categoryId: string
}) {
  const paymentCategory = (
    await db
      .select({
        creditAccountId: sql<string>`${categories.creditAccountId}`,
        name: sql<string>`${categoryGroups.name} || ': ' || ${categories.name}`,
      })
      .from(categories)
      .innerJoin(
        categoryGroups,
        eq(categories.categoryGroupId, categoryGroups.id),
      )
      .innerJoin(plans, eq(categoryGroups.planId, plans.id))
      .where(
        and(
          eq(categories.id, categoryId),
          eq(categories.kind, 'credit_payment'),
          eq(plans.id, planId),
          eq(plans.ownerId, ownerId),
        ),
      )
      .limit(1)
  ).at(0)
  if (!paymentCategory) return null

  const [rows, budget] = await Promise.all([
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        payeeName: sql<
          string | null
        >`coalesce(${payees.name}, 'To/From ' || ${counterpartAccount.name})`,
        memo: transactions.memo,
        amount: transactions.amount,
        categoryId: transactions.categoryId,
        categoryKind: categories.kind,
        categoryName: sql<
          string | null
        >`${categoryGroups.name} || ': ' || ${categories.name}`,
        fromCash:
          sql<boolean>`coalesce(${inArray(counterpartAccount.type, cashAccountTypes)}, 0)`.mapWith(
            Boolean,
          ),
      })
      .from(transactions)
      .leftJoin(payees, eq(transactions.payeeId, payees.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(
        categoryGroups,
        eq(categories.categoryGroupId, categoryGroups.id),
      )
      .leftJoin(counterpart, counterpartOn)
      .leftJoin(
        counterpartAccount,
        eq(counterpart.accountId, counterpartAccount.id),
      )
      .where(
        and(
          eq(transactions.accountId, paymentCategory.creditAccountId),
          countsTowardActivity(month, today),
        ),
      )
      .orderBy(
        desc(transactions.date),
        desc(transactions.createdAt),
        desc(transactions.id),
      ),
    findPlanMonthBudget({ planId, month, today }),
  ])

  let spending = 0
  let returns = 0
  let payments = 0
  const cardTransactions = rows.map(
    ({ categoryId: rowCategoryId, categoryKind, fromCash, ...row }) => {
      const { kind } = cardTransactionKind({
        amount: row.amount,
        categoryId: rowCategoryId,
        categoryKind,
        fromCash,
      })
      if (kind === 'category' && row.amount < 0) spending += row.amount
      if (kind === 'category' && row.amount > 0) returns += row.amount
      if (kind === 'credit_payment') payments += row.amount
      return {
        ...row,
        categoryName:
          kind === 'credit_payment' ? paymentCategory.name : row.categoryName,
      }
    },
  )
  const { fundedSpending } = budget.paymentActivity.get(categoryId) ?? {
    fundedSpending: 0,
  }

  return {
    summary: {
      spending,
      returns,
      totalSpending: spending + returns,
      fundedSpending,
      paymentsAndReturns: -payments,
      totalActivity: fundedSpending - payments,
    },
    transactions: cardTransactions,
  }
}

export function insertOwnedCategoryGroup({
  planId,
  ownerId,
  name,
}: {
  planId: string
  ownerId: string
  name: string
}) {
  const ownedPlan = db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
    .limit(1)
    .all()

  if (!ownedPlan.at(0)) return null

  const result = db
    .select({ position: max(categoryGroups.position) })
    .from(categoryGroups)
    .where(eq(categoryGroups.planId, planId))
    .all()

  const inserted = db
    .insert(categoryGroups)
    .values({
      planId,
      name,
      position: (result.at(0)?.position ?? -1) + 1,
    })
    .returning()
    .all()

  return inserted.at(0) ?? null
}

export function updateOwnedCategoryGroupName({
  id,
  ownerId,
  name,
}: {
  id: string
  ownerId: string
  name: string
}) {
  const ownedGroup = db
    .select({ id: categoryGroups.id, kind: categoryGroups.kind })
    .from(categoryGroups)
    .innerJoin(plans, eq(categoryGroups.planId, plans.id))
    .where(and(eq(categoryGroups.id, id), eq(plans.ownerId, ownerId)))
    .limit(1)
    .all()

  if (!ownedGroup.at(0) || ownedGroup.at(0)?.kind !== 'ordinary') return null

  const result = db
    .update(categoryGroups)
    .set({ name, updatedAt: new Date() })
    .where(eq(categoryGroups.id, id))
    .returning()
    .all()

  return result.at(0) ?? null
}

export function insertOwnedCategory({
  categoryGroupId,
  ownerId,
  name,
}: {
  categoryGroupId: string
  ownerId: string
  name: string
}) {
  const ownedGroup = db
    .select({ id: categoryGroups.id, kind: categoryGroups.kind })
    .from(categoryGroups)
    .innerJoin(plans, eq(categoryGroups.planId, plans.id))
    .where(
      and(eq(categoryGroups.id, categoryGroupId), eq(plans.ownerId, ownerId)),
    )
    .limit(1)
    .all()

  if (!ownedGroup.at(0) || ownedGroup.at(0)?.kind !== 'ordinary') return null

  const result = db
    .select({ position: max(categories.position) })
    .from(categories)
    .where(eq(categories.categoryGroupId, categoryGroupId))
    .all()

  const inserted = db
    .insert(categories)
    .values({
      categoryGroupId,
      name,
      position: (result.at(0)?.position ?? -1) + 1,
    })
    .returning()
    .all()

  return inserted.at(0) ?? null
}

export function updateOwnedCategoryName({
  id,
  ownerId,
  name,
}: {
  id: string
  ownerId: string
  name: string
}) {
  const ownedCategory = db
    .select({ id: categories.id, kind: categories.kind })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .innerJoin(plans, eq(categoryGroups.planId, plans.id))
    .where(and(eq(categories.id, id), eq(plans.ownerId, ownerId)))
    .limit(1)
    .all()

  if (!ownedCategory.at(0) || ownedCategory.at(0)?.kind !== 'ordinary')
    return null

  const result = db
    .update(categories)
    .set({ name, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning()
    .all()

  return result.at(0) ?? null
}

export function updateOwnedCategoryHidden({
  id,
  ownerId,
  hidden,
}: {
  id: string
  ownerId: string
  hidden: boolean
}) {
  const ownedCategory = db
    .select({ id: categories.id })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .innerJoin(plans, eq(categoryGroups.planId, plans.id))
    .where(
      and(
        eq(categories.id, id),
        eq(plans.ownerId, ownerId),
        ne(categories.kind, 'ready_to_assign'),
      ),
    )
    .limit(1)
    .all()

  if (!ownedCategory.at(0)) return null

  const result = db
    .update(categories)
    .set({ hidden, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning()
    .all()

  return result.at(0) ?? null
}

function sameIds(actual: Array<string>, expected: Array<string>) {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  )
}

export function reorderOwnedCategoryGroups({
  planId,
  ownerId,
  expectedIds,
  orderedIds,
}: {
  planId: string
  ownerId: string
  expectedIds: Array<string>
  orderedIds: Array<string>
}) {
  return db.transaction((tx) => {
    const ownedPlan = tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
      .get()
    if (!ownedPlan) return false

    const currentIds = tx
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(
        and(
          eq(categoryGroups.planId, planId),
          ne(categoryGroups.kind, 'inflow'),
        ),
      )
      .orderBy(asc(categoryGroups.position), asc(categoryGroups.createdAt))
      .all()
      .map((group) => group.id)

    const currentIdSet = new Set(currentIds)
    if (
      !sameIds(currentIds, expectedIds) ||
      orderedIds.length !== currentIds.length ||
      new Set(orderedIds).size !== currentIds.length ||
      orderedIds.some((id) => !currentIdSet.has(id))
    ) {
      return false
    }

    orderedIds.forEach((id, position) => {
      tx.update(categoryGroups)
        .set({ position, updatedAt: new Date() })
        .where(eq(categoryGroups.id, id))
        .run()
    })
    return true
  })
}

export function moveOwnedCategory({
  planId,
  ownerId,
  categoryId,
  fromGroupId,
  toGroupId,
  expectedSourceIds,
  expectedTargetIds,
  sourceIds,
  targetIds,
}: {
  planId: string
  ownerId: string
  categoryId: string
  fromGroupId: string
  toGroupId: string
  expectedSourceIds: Array<string>
  expectedTargetIds: Array<string>
  sourceIds: Array<string>
  targetIds: Array<string>
}) {
  return db.transaction((tx) => {
    const ownedPlan = tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
      .get()
    if (!ownedPlan) return false

    const groupIds = [...new Set([fromGroupId, toGroupId])]
    const ownedGroups = tx
      .select({ id: categoryGroups.id, kind: categoryGroups.kind })
      .from(categoryGroups)
      .where(
        and(
          eq(categoryGroups.planId, planId),
          inArray(categoryGroups.id, groupIds),
        ),
      )
      .all()
    // Internal Categories may be reordered within their internal group, but
    // moves between groups are limited to Ordinary Categories and groups.
    const sameGroup = fromGroupId === toGroupId
    if (
      ownedGroups.length !== groupIds.length ||
      (!sameGroup && ownedGroups.some((group) => group.kind !== 'ordinary'))
    ) {
      return false
    }

    const currentCategories = tx
      .select({
        id: categories.id,
        categoryGroupId: categories.categoryGroupId,
        kind: categories.kind,
        hidden: categories.hidden,
      })
      .from(categories)
      .where(inArray(categories.categoryGroupId, groupIds))
      .orderBy(asc(categories.position), asc(categories.createdAt))
      .all()
    const currentSourceIds = currentCategories
      .filter((category) => category.categoryGroupId === fromGroupId)
      .map((category) => category.id)
    const currentTargetIds =
      fromGroupId === toGroupId
        ? currentSourceIds
        : currentCategories
            .filter((category) => category.categoryGroupId === toGroupId)
            .map((category) => category.id)
    const movedCategory = currentCategories.find(
      (category) => category.id === categoryId,
    )

    if (
      !sameIds(currentSourceIds, expectedSourceIds) ||
      !sameIds(currentTargetIds, expectedTargetIds) ||
      movedCategory?.categoryGroupId !== fromGroupId ||
      (!sameGroup && movedCategory.kind !== 'ordinary') ||
      movedCategory.hidden
    ) {
      return false
    }

    const expectedAfterSource = currentSourceIds.filter(
      (id) => id !== categoryId,
    )
    const currentSourceIdSet = new Set(currentSourceIds)
    const expectedAfterSourceIdSet = new Set(expectedAfterSource)
    const currentTargetIdSet = new Set(currentTargetIds)
    const validOrders = sameGroup
      ? sameIds(sourceIds, targetIds) &&
        sourceIds.length === currentSourceIds.length &&
        new Set(sourceIds).size === currentSourceIds.length &&
        sourceIds.every((id) => currentSourceIdSet.has(id))
      : sourceIds.length === expectedAfterSource.length &&
        new Set(sourceIds).size === sourceIds.length &&
        sourceIds.every((id) => expectedAfterSourceIdSet.has(id)) &&
        targetIds.length === currentTargetIds.length + 1 &&
        new Set(targetIds).size === targetIds.length &&
        targetIds.every(
          (id) => id === categoryId || currentTargetIdSet.has(id),
        ) &&
        targetIds.includes(categoryId)

    if (!validOrders) return false

    for (const [groupId, ids] of [
      [fromGroupId, sourceIds],
      [toGroupId, targetIds],
    ] as const) {
      ids.forEach((id, position) => {
        tx.update(categories)
          .set({ categoryGroupId: groupId, position, updatedAt: new Date() })
          .where(eq(categories.id, id))
          .run()
      })
      if (sameGroup) break
    }
    return true
  })
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function isValidReassignmentTarget(
  tx: DatabaseTransaction,
  {
    planId,
    targetCategoryId,
    excludedGroupId,
  }: { planId: string; targetCategoryId: string; excludedGroupId?: string },
) {
  const target = tx
    .select({ id: categories.id })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .where(
      and(
        eq(categories.id, targetCategoryId),
        eq(categoryGroups.planId, planId),
        eq(categories.kind, 'ordinary'),
        eq(categories.hidden, false),
        excludedGroupId ? ne(categoryGroups.id, excludedGroupId) : undefined,
      ),
    )
    .get()
  return Boolean(target)
}

function reassignTransactions(
  tx: DatabaseTransaction,
  {
    categoryIds,
    planId,
    targetCategoryId,
    excludedGroupId,
  }: {
    categoryIds: Array<string>
    planId: string
    targetCategoryId: string | null
    excludedGroupId?: string
  },
): Exclude<DeleteCategoryResult, { status: 'ok' }> | number {
  if (categoryIds.length === 0) return 0

  const used = tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(inArray(transactions.categoryId, categoryIds))
    .limit(1)
    .get()
  if (!used) return 0
  if (!targetCategoryId) return { status: 'target_required' }
  if (
    categoryIds.includes(targetCategoryId) ||
    !isValidReassignmentTarget(tx, {
      planId,
      targetCategoryId,
      excludedGroupId,
    })
  ) {
    return { status: 'invalid_target' }
  }

  // Deleting a Category reassigns Transactions across the whole Plan,
  // including those in Closed Accounts.
  return tx
    .update(transactions)
    .set({ categoryId: targetCategoryId, updatedAt: new Date() })
    .where(inArray(transactions.categoryId, categoryIds))
    .returning({ id: transactions.id })
    .all().length
}

export function deleteOwnedCategory({
  id,
  ownerId,
  targetCategoryId,
}: {
  id: string
  ownerId: string
  targetCategoryId: string | null
}): DeleteCategoryResult {
  return db.transaction(
    (tx) => {
      const source = tx
        .select({ planId: plans.id, kind: categories.kind })
        .from(categories)
        .innerJoin(
          categoryGroups,
          eq(categories.categoryGroupId, categoryGroups.id),
        )
        .innerJoin(plans, eq(categoryGroups.planId, plans.id))
        .where(and(eq(categories.id, id), eq(plans.ownerId, ownerId)))
        .get()
      if (!source || source.kind !== 'ordinary') return { status: 'not_found' }

      const reassigned = reassignTransactions(tx, {
        categoryIds: [id],
        planId: source.planId,
        targetCategoryId,
      })
      if (typeof reassigned !== 'number') return reassigned

      tx.delete(categories).where(eq(categories.id, id)).run()
      return { status: 'ok', transactionCount: reassigned }
    },
    { behavior: 'immediate' },
  )
}

export function deleteOwnedCategoryGroup({
  id,
  ownerId,
  targetCategoryId,
}: {
  id: string
  ownerId: string
  targetCategoryId: string | null
}): DeleteCategoryResult {
  return db.transaction(
    (tx) => {
      const source = tx
        .select({ planId: plans.id, kind: categoryGroups.kind })
        .from(categoryGroups)
        .innerJoin(plans, eq(categoryGroups.planId, plans.id))
        .where(and(eq(categoryGroups.id, id), eq(plans.ownerId, ownerId)))
        .get()
      if (!source || source.kind !== 'ordinary') return { status: 'not_found' }

      const categoryIds = tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.categoryGroupId, id))
        .all()
        .map((category) => category.id)
      const reassigned = reassignTransactions(tx, {
        categoryIds,
        planId: source.planId,
        targetCategoryId,
        excludedGroupId: id,
      })
      if (typeof reassigned !== 'number') return reassigned

      tx.delete(categories).where(eq(categories.categoryGroupId, id)).run()
      tx.delete(categoryGroups).where(eq(categoryGroups.id, id)).run()
      return { status: 'ok', transactionCount: reassigned }
    },
    { behavior: 'immediate' },
  )
}
