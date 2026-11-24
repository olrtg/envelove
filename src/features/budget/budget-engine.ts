import { addMonths, monthOfDate } from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'

// Signed Activity on one Credit Account. In a Category's inputs it is the part
// that created card debt (negative) or repaid it (positive); in a budget it is
// the funded spending moved to that card's Credit Payment Category.
export type CreditActivity = { accountId: string; amount: number }

// One Category's inputs for one Plan Month, in milliunits. Spending that did
// not create card debt, such as a purchase from a positive card balance, is
// cash Activity. Credit Activity lists cards in the order they were first used.
export type CategoryMonthInput = {
  assigned: number
  cashActivity: number
  creditActivity: ReadonlyArray<CreditActivity>
}

export type AvailableStatus =
  | 'positive'
  | 'zero'
  | 'cash_overspent'
  | 'credit_overspent'
  | 'payment_underfunded'
  | 'payment_overspent'

export type CategoryMonthBudget = CategoryMonthInput & {
  activity: number
  carryover: number
  available: number
  overspending: { cash: number; credit: number }
  fundedCredit: Array<CreditActivity>
  // A Credit Payment Category's card balance at the end of the month; a
  // negative balance is debt.
  cardBalance: number | null
  status: AvailableStatus
}

export function budgetCategoryMonth(
  carryover: number,
  input: CategoryMonthInput,
  cardBalance: number | null = null,
): CategoryMonthBudget {
  const creditActivity = sumAmounts(input.creditActivity)
  const activity = input.cashActivity + creditActivity
  const available = carryover + input.assigned + activity
  // Cash spending consumes Available first, whatever the dates; credit spending
  // is funded from what remains. A net credit refund acts like cash.
  const afterCash =
    carryover +
    input.assigned +
    input.cashActivity +
    Math.max(0, creditActivity)
  const creditSpending = Math.max(0, -creditActivity)
  const funded = Math.min(Math.max(afterCash, 0), creditSpending)
  const overspending = {
    cash: Math.max(0, -afterCash),
    credit: creditSpending - funded,
  }

  return {
    ...input,
    activity,
    carryover,
    available,
    overspending,
    fundedCredit: fundCards(input.creditActivity, funded),
    cardBalance,
    status: availableStatus(available, overspending, cardBalance),
  }
}

// Splits funded credit spending by card. Refunds take their money back from
// their card in full and help fund spending, card by card in the order used.
function fundCards(
  creditActivity: ReadonlyArray<CreditActivity>,
  funded: number,
) {
  let left =
    funded + sumAmounts(creditActivity.filter((credit) => credit.amount > 0))
  return creditActivity.map(({ accountId, amount }) => {
    if (amount >= 0) return { accountId, amount: -amount }
    const moved = Math.min(left, -amount)
    left -= moved
    return { accountId, amount: moved }
  })
}

function sumAmounts(items: ReadonlyArray<{ amount: number }>) {
  return items.reduce((sum, item) => sum + item.amount, 0)
}

export const noCategoryMonthInput: CategoryMonthInput = {
  assigned: 0,
  cashActivity: 0,
  creditActivity: [],
}

export const emptyCategoryBudget = budgetCategoryMonth(0, noCategoryMonthInput)

// Budgets consecutive Plan Months of one Category, oldest first. Positive
// Available carries into the next month; a negative one resets to zero. A
// Credit Payment Category passes its card's balance at the end of the last
// month.
export function budgetCategoryMonths(
  months: Array<CategoryMonthInput>,
  cardBalance: number | null = null,
) {
  let carryover = 0
  return months.map((input, index) => {
    const budget = budgetCategoryMonth(
      carryover,
      input,
      index === months.length - 1 ? cardBalance : null,
    )
    carryover = Math.max(0, budget.available)
    return budget
  })
}

// A Credit Payment Category is green once it covers its card's debt, even at
// zero while the card is in credit.
function availableStatus(
  available: number,
  overspending: CategoryMonthBudget['overspending'],
  cardBalance: number | null,
): AvailableStatus {
  if (cardBalance !== null) {
    if (available < 0) return 'payment_overspent'
    if (available < -cardBalance) return 'payment_underfunded'
    return available > 0 || cardBalance > 0 ? 'positive' : 'zero'
  }
  if (overspending.cash > 0) return 'cash_overspent'
  if (overspending.credit > 0) return 'credit_overspent'
  return available > 0 ? 'positive' : 'zero'
}

export type CardTransactionKind =
  | { kind: 'category'; categoryId: string }
  // A Transfer into the card from a Cash Account.
  | { kind: 'credit_payment' }
  | { kind: 'ready_to_assign' }
  | { kind: 'starting_balance' }
  | { kind: 'reconciliation_adjustment' }
  // Uncategorized Transactions, cash advances, and Balance Transfers only move
  // the card balance.
  | { kind: 'balance' }

export type CardTransaction = {
  accountId: string
  date: string
  amount: number
} & CardTransactionKind

// What makes up a Credit Payment Category's Activity in a month: spending
// funded on its card, including debt from an Inflow: Ready to Assign outflow,
// less the Credit Payments into it.
export type PaymentActivity = { fundedSpending: number; payments: number }

type CardLedger = {
  categories: Map<
    string,
    Map<
      PlanMonth,
      { cashActivity: number; creditActivity: Array<CreditActivity> }
    >
  >
  cards: Map<
    string,
    { balance: number; months: Map<PlanMonth, PaymentActivity> }
  >
  readyToAssign: Map<PlanMonth, { inflow: number; debtAccountInflow: number }>
}

// Walks Credit Account Transactions oldest first, keeping each card's balance,
// and splits every Transaction into the part that changed card debt and the
// part that did not. Within a day outflows go first, so a payment never lifts
// the card above zero before the purchase it pays; otherwise entry order holds.
function ledgerCardTransactions(
  transactions: ReadonlyArray<CardTransaction>,
): CardLedger {
  const ledger: CardLedger = {
    categories: new Map(),
    cards: new Map(),
    readyToAssign: new Map(),
  }
  const ordered = [...transactions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(b.kind === 'starting_balance') -
        Number(a.kind === 'starting_balance') ||
      // Reconcile against the day's ordinary ledger, including pending entries.
      Number(a.kind === 'reconciliation_adjustment') -
        Number(b.kind === 'reconciliation_adjustment') ||
      (a.kind === 'reconciliation_adjustment'
        ? 0
        : Number(a.amount >= 0) - Number(b.amount >= 0)),
  )
  for (const transaction of ordered) {
    const { accountId, amount } = transaction
    const month = monthOfDate(transaction.date)
    const card = cardOf(ledger, accountId)
    // Positive when the Transaction added card debt, negative when it repaid.
    const debtChange =
      Math.max(0, -(card.balance + amount)) - Math.max(0, -card.balance)
    card.balance += amount
    const readyToAssign = () =>
      getOrInsert(ledger.readyToAssign, month, () => ({
        inflow: 0,
        debtAccountInflow: 0,
      }))

    switch (transaction.kind) {
      case 'category': {
        const input = getOrInsert(
          getOrInsert(
            ledger.categories,
            transaction.categoryId,
            () => new Map(),
          ),
          month,
          () => ({ cashActivity: 0, creditActivity: [] }),
        )
        input.cashActivity += amount + debtChange
        if (debtChange === 0) break
        const credit = input.creditActivity.find(
          (item) => item.accountId === accountId,
        )
        if (credit) credit.amount -= debtChange
        else input.creditActivity.push({ accountId, amount: -debtChange })
        break
      }
      case 'credit_payment':
        paymentMonth(ledger, accountId, month).payments += amount
        readyToAssign().debtAccountInflow += amount + debtChange
        break
      case 'reconciliation_adjustment':
      case 'starting_balance':
        readyToAssign().inflow += amount + debtChange
        break
      case 'ready_to_assign':
        // Money that only repays debt never reaches Ready to Assign. An outflow
        // takes all of it, and the debt it creates is set aside for payment.
        if (amount > 0) {
          readyToAssign().inflow += amount + debtChange
        } else {
          readyToAssign().inflow += amount
          paymentMonth(ledger, accountId, month).fundedSpending += debtChange
        }
        break
      case 'balance':
        break
    }
  }
  return ledger
}

function cardOf(ledger: CardLedger, accountId: string) {
  return getOrInsert(ledger.cards, accountId, () => ({
    balance: 0,
    months: new Map<PlanMonth, PaymentActivity>(),
  }))
}

function paymentMonth(ledger: CardLedger, accountId: string, month: PlanMonth) {
  return getOrInsert(cardOf(ledger, accountId).months, month, () => ({
    fundedSpending: 0,
    payments: 0,
  }))
}

function getOrInsert<TKey, TValue>(
  map: Map<TKey, TValue>,
  key: TKey,
  create: () => NoInfer<TValue>,
) {
  const value = map.get(key) ?? create()
  map.set(key, value)
  return value
}

export type ReadyToAssignMonthInput = {
  inflow: number
  debtAccountInflow: number
  assigned: number
  cashOverspending: number
}

export type ReadyToAssign = {
  leftOverFromPreviousMonth: number
  inflow: number
  debtAccountInflow: number
  cashOverspendingPreviousMonth: number
  assignedThisMonth: number
  assignedInFuture: number
  total: number
  futureMonths: Array<{ month: PlanMonth; assigned: number }>
}

const noReadyToAssignMonthInput: ReadyToAssignMonthInput = {
  inflow: 0,
  debtAccountInflow: 0,
  assigned: 0,
  cashOverspending: 0,
}

// R(m) = R(m − 1) + inflows(m) − cash overspending(m − 1) − assigned(m), from
// R = 0 before any money. A month shows R less what later months assigned,
// though later assignments never take it below zero.
export function budgetReadyToAssign(
  months: ReadonlyMap<PlanMonth, ReadyToAssignMonthInput>,
  month: PlanMonth,
): ReadyToAssign {
  const previousMonth = addMonths(month, -1)
  let leftOverFromPreviousMonth = 0
  const futureMonths: ReadyToAssign['futureMonths'] = []
  for (const [inputMonth, input] of [...months].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    if (inputMonth < month) {
      leftOverFromPreviousMonth +=
        input.inflow + input.debtAccountInflow - input.assigned
      if (inputMonth < previousMonth) {
        leftOverFromPreviousMonth -= input.cashOverspending
      }
    } else if (inputMonth > month && input.assigned !== 0) {
      futureMonths.push({ month: inputMonth, assigned: input.assigned })
    }
  }

  const current = months.get(month) ?? noReadyToAssignMonthInput
  const cashOverspendingPreviousMonth = (
    months.get(previousMonth) ?? noReadyToAssignMonthInput
  ).cashOverspending
  const readyToAssign =
    leftOverFromPreviousMonth +
    current.inflow +
    current.debtAccountInflow -
    cashOverspendingPreviousMonth -
    current.assigned
  const assignedLater = futureMonths.reduce(
    (sum, future) => sum + future.assigned,
    0,
  )
  const assignedInFuture = Math.min(
    Math.max(readyToAssign, 0),
    Math.max(assignedLater, 0),
  )

  return {
    leftOverFromPreviousMonth,
    inflow: current.inflow,
    debtAccountInflow: current.debtAccountInflow,
    cashOverspendingPreviousMonth,
    assignedThisMonth: current.assigned,
    assignedInFuture,
    total: readyToAssign - assignedInFuture,
    futureMonths,
  }
}

export type PlanBudgetInputs = {
  // Assigned, and Activity on Accounts that are not Credit Accounts.
  categories: ReadonlyMap<
    string,
    ReadonlyMap<PlanMonth, { assigned: number; cashActivity: number }>
  >
  // Inflow: Ready to Assign on Accounts that are not Credit Accounts.
  readyToAssignInflows: ReadonlyMap<PlanMonth, number>
  // Every Credit Account Transaction up to the Current Day, in entry order.
  cardTransactions: ReadonlyArray<CardTransaction>
  // Each Credit Account's paired Credit Payment Category.
  creditPaymentCategories: ReadonlyMap<string, string>
}

// Budgets every Category for one month and the Plan's Ready to Assign. Every
// Category's Assigned and Cash Overspending count, hidden or internal. Funded
// credit spending becomes Activity of the card's Credit Payment Category, so
// those are budgeted last.
export function budgetPlanMonth(
  inputs: PlanBudgetInputs,
  month: PlanMonth,
  historyFor?: ReadonlySet<string>,
) {
  const ledger = ledgerCardTransactions(
    inputs.cardTransactions.filter(
      (transaction) => monthOfDate(transaction.date) <= month,
    ),
  )

  const readyToAssignMonths = new Map<PlanMonth, ReadyToAssignMonthInput>()
  const readyToAssignMonth = (inputMonth: PlanMonth) =>
    getOrInsert(readyToAssignMonths, inputMonth, () => ({
      ...noReadyToAssignMonthInput,
    }))
  for (const [inputMonth, inflow] of inputs.readyToAssignInflows) {
    readyToAssignMonth(inputMonth).inflow += inflow
  }
  for (const [inputMonth, card] of ledger.readyToAssign) {
    readyToAssignMonth(inputMonth).inflow += card.inflow
    readyToAssignMonth(inputMonth).debtAccountInflow += card.debtAccountInflow
  }

  const categoryInputs = new Map<string, Map<PlanMonth, CategoryMonthInput>>()
  const inputFor = (categoryId: string, inputMonth: PlanMonth) =>
    getOrInsert(
      getOrInsert(categoryInputs, categoryId, () => new Map()),
      inputMonth,
      () => ({ ...noCategoryMonthInput }),
    )
  for (const [categoryId, months] of inputs.categories) {
    for (const [inputMonth, input] of months) {
      inputFor(categoryId, inputMonth).assigned += input.assigned
      inputFor(categoryId, inputMonth).cashActivity += input.cashActivity
    }
  }
  for (const [categoryId, months] of ledger.categories) {
    for (const [inputMonth, input] of months) {
      inputFor(categoryId, inputMonth).cashActivity += input.cashActivity
      inputFor(categoryId, inputMonth).creditActivity = input.creditActivity
    }
  }

  const categories = new Map<string, CategoryMonthBudget>()
  const history = new Map<string, Map<PlanMonth, CategoryMonthBudget>>()
  function budgetCategory(categoryId: string, cardBalance: number | null) {
    const months =
      categoryInputs.get(categoryId) ?? new Map<PlanMonth, CategoryMonthInput>()
    for (const [inputMonth, input] of months) {
      readyToAssignMonth(inputMonth).assigned += input.assigned
    }

    // A Credit Payment Category shows its card's debt even with no Activity.
    const series: Array<PlanMonth> = []
    for (
      let current = [...months.keys()].reduce(
        (first, item) => (item < first ? item : first),
        month,
      );
      current <= month;
      current = addMonths(current, 1)
    ) {
      series.push(current)
    }
    const budgets = budgetCategoryMonths(
      series.map((item) => months.get(item) ?? noCategoryMonthInput),
      cardBalance,
    )
    if (historyFor?.has(categoryId))
      history.set(categoryId, new Map(budgets.map((b, i) => [series[i], b])))
    budgets.forEach((monthBudget, index) => {
      readyToAssignMonth(series[index]).cashOverspending +=
        monthBudget.overspending.cash
      for (const funded of monthBudget.fundedCredit) {
        paymentMonth(ledger, funded.accountId, series[index]).fundedSpending +=
          funded.amount
      }
    })
    const budget = budgets.at(-1)
    if (budget) categories.set(categoryId, budget)
  }

  const paymentCategoryIds = new Set(inputs.creditPaymentCategories.values())
  for (const categoryId of [...categoryInputs.keys()]) {
    if (!paymentCategoryIds.has(categoryId)) budgetCategory(categoryId, null)
  }
  const paymentActivity = new Map<string, PaymentActivity>()
  for (const [accountId, categoryId] of inputs.creditPaymentCategories) {
    const card = cardOf(ledger, accountId)
    for (const [inputMonth, activity] of card.months) {
      inputFor(categoryId, inputMonth).cashActivity +=
        activity.fundedSpending - activity.payments
    }
    budgetCategory(categoryId, card.balance)
    paymentActivity.set(
      categoryId,
      card.months.get(month) ?? { fundedSpending: 0, payments: 0 },
    )
  }

  return {
    categories,
    history,
    paymentActivity,
    readyToAssign: budgetReadyToAssign(readyToAssignMonths, month),
  }
}
