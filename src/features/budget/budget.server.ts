import {
  and,
  asc,
  between,
  eq,
  gt,
  inArray,
  lte,
  ne,
  not,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { db } from '#/db'
import {
  accounts,
  categories,
  categoryAssignments,
  categoryGroups,
  plans,
  transactions,
} from '#/db/schema'
import { accountTypeDetails } from '#/features/accounts/account-types'
import type { AccountGroup } from '#/features/accounts/account-types'
import type { AccountType } from '#/features/accounts/account.schemas'
import { firstDayOfMonth, lastDayOfMonth } from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'
import { amountMatchesCurrency } from '#/features/transactions/transaction-money'

import { budgetPlanMonth } from './budget-engine'
import type { CardTransaction, CardTransactionKind } from './budget-engine'
import type { MoneyMove } from './budget.schemas'

const accountTypesIn = (group: AccountGroup) =>
  (Object.keys(accountTypeDetails) as Array<AccountType>).filter(
    (type) => accountTypeDetails[type].group === group,
  )
const creditAccountTypes = accountTypesIn('credit')
export const cashAccountTypes = accountTypesIn('cash')

export const counterpart = alias(transactions, 'counterpart')
export const counterpartAccount = alias(accounts, 'counterpart_account')
export const counterpartOn = and(
  eq(counterpart.transferId, transactions.transferId),
  ne(counterpart.id, transactions.id),
)

// Transactions dated after the Current Day never count toward Activity.
function activityCutoff(month: PlanMonth, today: string) {
  const lastDay = lastDayOfMonth(month)
  return today < lastDay ? today : lastDay
}

// The one definition of which Transactions count toward Category Activity in a
// month.
export function countsTowardActivity(month: PlanMonth, today: string) {
  return between(
    transactions.date,
    firstDayOfMonth(month),
    activityCutoff(month, today),
  )
}

// Classifies a Credit Account Transaction by its Category, or by the Account a
// Transfer came from.
export function cardTransactionKind({
  amount,
  categoryId,
  categoryKind,
  reconciliationAdjustment,
  startingBalance,
  fromCash,
}: {
  amount: number
  categoryId: string | null
  categoryKind: (typeof categories.$inferSelect)['kind'] | null
  reconciliationAdjustment?: boolean
  startingBalance?: boolean
  fromCash: boolean
}): CardTransactionKind {
  if (categoryKind === 'ordinary' && categoryId) {
    return { kind: 'category', categoryId }
  }
  if (categoryKind === 'ready_to_assign' && reconciliationAdjustment)
    return { kind: 'reconciliation_adjustment' }
  if (categoryKind === 'ready_to_assign' && startingBalance)
    return { kind: 'starting_balance' }
  if (categoryKind === 'ready_to_assign') return { kind: 'ready_to_assign' }
  return fromCash && amount > 0
    ? { kind: 'credit_payment' }
    : { kind: 'balance' }
}

// Budgets every Category of a Plan and its Ready to Assign for one month.
// Categories with no assignments or Activity yet are absent.
// Reads synchronously so capped money moves can budget inside their transaction.
export function findPlanMonthBudget({
  planId,
  month,
  today,
  historyFor,
}: {
  planId: string
  month: PlanMonth
  today: string
  historyFor?: ReadonlySet<string>
}) {
  const activityMonth = sql<PlanMonth>`substr(${transactions.date}, 1, 7)`
  const inPlanThroughMonth = and(
    eq(accounts.planId, planId),
    lte(transactions.date, activityCutoff(month, today)),
  )
  const [activityRows, cardRows, assignmentRows, paymentCategoryRows] = [
    db
      .select({
        categoryId: sql<string>`${transactions.categoryId}`,
        readyToAssign:
          sql<boolean>`${eq(categories.kind, 'ready_to_assign')}`.mapWith(
            Boolean,
          ),
        month: activityMonth,
        amount: sql<number>`sum(${transactions.amount})`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          inPlanThroughMonth,
          not(inArray(accounts.type, creditAccountTypes)),
        ),
      )
      .groupBy(transactions.categoryId, activityMonth)
      .all(),
    // Card balances depend on order, so card Transactions come one by one.
    db
      .select({
        accountId: transactions.accountId,
        date: transactions.date,
        amount: transactions.amount,
        categoryId: transactions.categoryId,
        reconciliationAdjustment: transactions.reconciliationAdjustment,
        startingBalance: transactions.startingBalance,
        categoryKind: categories.kind,
        fromCash:
          sql<boolean>`coalesce(${inArray(counterpartAccount.type, cashAccountTypes)}, 0)`.mapWith(
            Boolean,
          ),
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(counterpart, counterpartOn)
      .leftJoin(
        counterpartAccount,
        eq(counterpart.accountId, counterpartAccount.id),
      )
      .where(
        and(inPlanThroughMonth, inArray(accounts.type, creditAccountTypes)),
      )
      .orderBy(
        asc(transactions.date),
        asc(transactions.createdAt),
        asc(transactions.id),
      )
      .all(),
    db
      .select({
        categoryId: categoryAssignments.categoryId,
        month: sql<PlanMonth>`${categoryAssignments.month}`,
        amount: categoryAssignments.amount,
      })
      .from(categoryAssignments)
      .innerJoin(categories, eq(categoryAssignments.categoryId, categories.id))
      .innerJoin(
        categoryGroups,
        eq(categories.categoryGroupId, categoryGroups.id),
      )
      .where(eq(categoryGroups.planId, planId))
      .all(),
    db
      .select({
        categoryId: categories.id,
        accountId: sql<string>`${categories.creditAccountId}`,
      })
      .from(categories)
      .innerJoin(
        categoryGroups,
        eq(categories.categoryGroupId, categoryGroups.id),
      )
      .where(
        and(
          eq(categoryGroups.planId, planId),
          eq(categories.kind, 'credit_payment'),
        ),
      )
      .all(),
  ] as const

  const categoryInputs = new Map<
    string,
    Map<PlanMonth, { assigned: number; cashActivity: number }>
  >()
  const readyToAssignInflows = new Map<PlanMonth, number>()
  function inputFor(categoryId: string, inputMonth: PlanMonth) {
    const months = categoryInputs.get(categoryId) ?? new Map()
    categoryInputs.set(categoryId, months)
    const input = months.get(inputMonth) ?? { assigned: 0, cashActivity: 0 }
    months.set(inputMonth, input)
    return input
  }
  for (const row of activityRows) {
    if (row.readyToAssign) {
      readyToAssignInflows.set(
        row.month,
        (readyToAssignInflows.get(row.month) ?? 0) + row.amount,
      )
    } else {
      inputFor(row.categoryId, row.month).cashActivity += row.amount
    }
  }
  for (const row of assignmentRows) {
    inputFor(row.categoryId, row.month).assigned = row.amount
  }

  return budgetPlanMonth(
    {
      categories: categoryInputs,
      readyToAssignInflows,
      cardTransactions: cardRows.map((row): CardTransaction => ({
        accountId: row.accountId,
        date: row.date,
        amount: row.amount,
        ...cardTransactionKind(row),
      })),
      creditPaymentCategories: new Map(
        paymentCategoryRows.map((row) => [row.accountId, row.categoryId]),
      ),
    },
    month,
    historyFor,
  )
}

export type SetCategoryAssignedResult =
  | { status: 'ok'; categoryId: string; month: PlanMonth; amount: number }
  | { status: 'invalid_amount' }

export function setOwnedCategoryAssigned({
  ownerId,
  categoryId,
  month,
  amount,
}: {
  ownerId: string
  categoryId: string
  month: PlanMonth
  amount: number
}): SetCategoryAssignedResult | null {
  const ownedCategory = db
    .select({ currencyCode: plans.currencyCode })
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
        ne(categories.kind, 'ready_to_assign'),
      ),
    )
    .limit(1)
    .all()
    .at(0)
  if (!ownedCategory) return null

  if (
    !Number.isSafeInteger(amount) ||
    !amountMatchesCurrency(amount, ownedCategory.currencyCode)
  ) {
    return { status: 'invalid_amount' }
  }

  // A month opens the next one once it has had money assigned, and stays open
  // after it is unassigned. Zero alone never opens a month.
  if (amount === 0) {
    db.update(categoryAssignments)
      .set({ amount, updatedAt: new Date() })
      .where(
        and(
          eq(categoryAssignments.categoryId, categoryId),
          eq(categoryAssignments.month, month),
        ),
      )
      .run()
  } else {
    db.insert(categoryAssignments)
      .values({ categoryId, month, amount })
      .onConflictDoUpdate({
        target: [categoryAssignments.categoryId, categoryAssignments.month],
        set: { amount, updatedAt: new Date() },
      })
      .run()
  }

  return { status: 'ok', categoryId, month, amount }
}

export function findOwnedMoneyMoveOptions({
  ownerId,
  planId,
  month,
  today,
}: {
  ownerId: string
  planId: string
  month: PlanMonth
  today: string
}) {
  const ownedPlan = db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
    .get()
  if (!ownedPlan) return null

  const visibleCategories = db
    .select({
      id: categories.id,
      name: categories.name,
      groupId: categoryGroups.id,
      groupName: categoryGroups.name,
    })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .where(
      and(
        eq(categoryGroups.planId, planId),
        eq(categories.hidden, false),
        ne(categories.kind, 'ready_to_assign'),
      ),
    )
    .orderBy(
      asc(categoryGroups.position),
      asc(categoryGroups.createdAt),
      asc(categories.position),
      asc(categories.createdAt),
    )
    .all()
  const futureAssignments = db
    .select({
      categoryId: categories.id,
      month: sql<PlanMonth>`${categoryAssignments.month}`,
      amount: categoryAssignments.amount,
    })
    .from(categoryAssignments)
    .innerJoin(categories, eq(categoryAssignments.categoryId, categories.id))
    .innerJoin(
      categoryGroups,
      eq(categories.categoryGroupId, categoryGroups.id),
    )
    .where(
      and(
        eq(categoryGroups.planId, planId),
        eq(categories.hidden, false),
        ne(categories.kind, 'ready_to_assign'),
        gt(categoryAssignments.month, month),
        gt(categoryAssignments.amount, 0),
      ),
    )
    .orderBy(asc(categoryAssignments.month))
    .all()
  const budget = findPlanMonthBudget({ planId, month, today })
  return {
    categories: visibleCategories.map((category) => ({
      ...category,
      available: budget.categories.get(category.id)?.available ?? 0,
    })),
    readyToAssign: budget.readyToAssign.total,
    futureAssignments,
  }
}

export type MoneyMoveResult =
  | { status: 'ok'; amount: number }
  | {
      status:
        | 'not_found'
        | 'invalid_endpoint'
        | 'invalid_amount'
        | 'nothing_to_cover'
        | 'source_empty'
    }

export function moveOwnedMoney({
  ownerId,
  ...move
}: MoneyMove & { ownerId: string }): MoneyMoveResult {
  // Lock before reading: a second writer must not spend the same surplus or
  // overwrite the assignments used to calculate this move.
  return db.transaction(
    (tx): MoneyMoveResult => {
      const { planId, source, destination, today } = move
      const plan = tx
        .select({ currencyCode: plans.currencyCode })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
        .get()
      if (!plan) return { status: 'not_found' }

      const sameMonth = source.month === destination.month
      if (
        (source.categoryId === destination.categoryId && sameMonth) ||
        (!sameMonth &&
          (move.kind !== 'cover' ||
            source.month < destination.month ||
            source.categoryId === null ||
            destination.categoryId === null))
      )
        return { status: 'invalid_endpoint' }

      const endpoints = [source, destination]
      for (const endpoint of endpoints) {
        if (endpoint.categoryId === null) continue
        const category = tx
          .select({ id: categories.id })
          .from(categories)
          .innerJoin(
            categoryGroups,
            eq(categories.categoryGroupId, categoryGroups.id),
          )
          .where(
            and(
              eq(categories.id, endpoint.categoryId),
              eq(categoryGroups.planId, planId),
              eq(categories.hidden, false),
              ne(categories.kind, 'ready_to_assign'),
            ),
          )
          .get()
        if (!category) return { status: 'invalid_endpoint' }
      }

      const assigned = endpoints.map((endpoint) =>
        endpoint.categoryId === null
          ? 0
          : (tx
              .select({ amount: categoryAssignments.amount })
              .from(categoryAssignments)
              .where(
                and(
                  eq(categoryAssignments.categoryId, endpoint.categoryId),
                  eq(categoryAssignments.month, endpoint.month),
                ),
              )
              .get()?.amount ?? 0),
      )
      let amount: number
      if (move.kind === 'move') {
        // Explicit moves are intentionally not capped by Available.
        amount = move.amount
      } else {
        const budget = findPlanMonthBudget({
          planId,
          month: destination.month,
          today,
        })
        const available = (categoryId: string | null) =>
          categoryId === null
            ? budget.readyToAssign.total
            : (budget.categories.get(categoryId)?.available ?? 0)
        const shortfall = -available(destination.categoryId)
        const surplus = sameMonth ? available(source.categoryId) : assigned[0]
        if (shortfall <= 0) return { status: 'nothing_to_cover' }
        if (surplus <= 0) return { status: 'source_empty' }
        amount = Math.min(shortfall, surplus)
      }

      const amounts = [assigned[0] - amount, assigned[1] + amount]
      if (
        amount <= 0 ||
        ![amount, ...amounts].every(
          (value) =>
            Number.isSafeInteger(value) &&
            amountMatchesCurrency(value, plan.currencyCode),
        )
      )
        return { status: 'invalid_amount' }

      endpoints.forEach((endpoint, index) => {
        if (endpoint.categoryId === null) return
        // Keep zeroed rows so an already opened month stays open.
        tx.insert(categoryAssignments)
          .values({
            categoryId: endpoint.categoryId,
            month: endpoint.month,
            amount: amounts[index],
          })
          .onConflictDoUpdate({
            target: [categoryAssignments.categoryId, categoryAssignments.month],
            set: { amount: amounts[index], updatedAt: new Date() },
          })
          .run()
      })
      return { status: 'ok', amount }
    },
    { behavior: 'immediate' },
  )
}
