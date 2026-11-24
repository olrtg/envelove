import assert from 'node:assert/strict'
import test from 'node:test'

import { firstDayOfMonth } from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'

import {
  budgetCategoryMonth,
  budgetCategoryMonths,
  budgetPlanMonth,
  budgetReadyToAssign,
} from './budget-engine'
import type {
  CardTransaction,
  CategoryMonthBudget,
  CategoryMonthInput,
  ReadyToAssignMonthInput,
} from './budget-engine'

function month(
  input: Partial<Omit<CategoryMonthInput, 'creditActivity'>> & {
    creditActivity?: number
  },
): CategoryMonthInput {
  const { creditActivity = 0, ...rest } = input
  return {
    assigned: 0,
    cashActivity: 0,
    ...rest,
    creditActivity: creditActivity
      ? [{ accountId: 'visa', amount: creditActivity }]
      : [],
  }
}

function fromTransactions(
  assigned: number,
  transactions: Array<{ amount: number; credit: boolean }>,
) {
  return month({
    assigned,
    cashActivity: transactions
      .filter((transaction) => !transaction.credit)
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    creditActivity: transactions
      .filter((transaction) => transaction.credit)
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  })
}

test('cash spending beyond the base is cash overspending', () => {
  // Base 10, cash −25, credit −15: Available −30, red.
  const budget = budgetCategoryMonth(
    0,
    month({ assigned: 10_000, cashActivity: -25_000, creditActivity: -15_000 }),
  )
  assert.equal(budget.activity, -40_000)
  assert.equal(budget.available, -30_000)
  assert.deepEqual(budget.overspending, { cash: 15_000, credit: 15_000 })
  assert.equal(budget.status, 'cash_overspent')
})

test('credit spending beyond what cash left is credit overspending', () => {
  // Base 30, cash −25, credit −15: Available −10, yellow, 5 funded.
  const budget = budgetCategoryMonth(
    0,
    month({ assigned: 30_000, cashActivity: -25_000, creditActivity: -15_000 }),
  )
  assert.equal(budget.available, -10_000)
  assert.deepEqual(budget.overspending, { cash: 0, credit: 10_000 })
  assert.equal(budget.status, 'credit_overspent')
})

test('the order of cash and credit spending does not matter', () => {
  const cash = { amount: -25_000, credit: false }
  const credit = { amount: -15_000, credit: true }
  for (const assigned of [10_000, 30_000]) {
    assert.deepEqual(
      budgetCategoryMonth(0, fromTransactions(assigned, [credit, cash])),
      budgetCategoryMonth(0, fromTransactions(assigned, [cash, credit])),
    )
  }
})

test('credit refunds reduce credit spending', () => {
  const budget = budgetCategoryMonth(
    0,
    fromTransactions(5_000, [
      { amount: -20_000, credit: true },
      { amount: 8_000, credit: true },
    ]),
  )
  assert.deepEqual(budget.creditActivity, [
    { accountId: 'visa', amount: -12_000 },
  ])
  assert.equal(budget.available, -7_000)
  assert.deepEqual(budget.overspending, { cash: 0, credit: 7_000 })
  assert.equal(budget.status, 'credit_overspent')
})

test('a net credit refund covers cash spending', () => {
  const budget = budgetCategoryMonth(
    0,
    month({ cashActivity: -10_000, creditActivity: 4_000 }),
  )
  assert.equal(budget.available, -6_000)
  assert.deepEqual(budget.overspending, { cash: 6_000, credit: 0 })
})

test('classifies positive and zero Available', () => {
  assert.equal(
    budgetCategoryMonth(0, month({ assigned: 1_000 })).status,
    'positive',
  )
  assert.equal(budgetCategoryMonth(0, month({})).status, 'zero')
  assert.equal(
    budgetCategoryMonth(
      5_000,
      month({ assigned: -2_000, creditActivity: -3_000 }),
    ).status,
    'zero',
  )
  const negativeAssigned = budgetCategoryMonth(0, month({ assigned: -4_000 }))
  assert.equal(negativeAssigned.available, -4_000)
  assert.equal(negativeAssigned.status, 'cash_overspent')
})

test('carries positive Available and resets negative Available', () => {
  const months = budgetCategoryMonths([
    month({ assigned: 100_000, cashActivity: -40_000 }),
    month({ cashActivity: -80_000 }),
    month({ assigned: 10_000 }),
    month({}),
    month({ creditActivity: -3_000 }),
  ])
  assert.deepEqual(
    months.map((budget) => [budget.carryover, budget.available]),
    [
      [0, 60_000],
      [60_000, -20_000],
      [0, 10_000],
      [10_000, 10_000],
      [10_000, 7_000],
    ],
  )
  assert.deepEqual(
    months.map((budget) => budget.status),
    ['positive', 'cash_overspent', 'positive', 'positive', 'positive'],
  )
})

test('carryover funds credit spending in a later month', () => {
  const [, october] = budgetCategoryMonths([
    month({ assigned: 20_000 }),
    month({ cashActivity: -15_000, creditActivity: -15_000 }),
  ])
  assert.equal(october.carryover, 20_000)
  assert.equal(october.available, -10_000)
  assert.deepEqual(october.overspending, { cash: 0, credit: 10_000 })
})

const september = '2026-09' as PlanMonth
const october = '2026-10' as PlanMonth
const november = '2026-11' as PlanMonth

function readyToAssignMonths(
  months: Record<string, Partial<ReadyToAssignMonthInput>>,
) {
  return new Map(
    Object.entries(months).map(([key, input]) => [
      key as PlanMonth,
      {
        inflow: 0,
        debtAccountInflow: 0,
        assigned: 0,
        cashOverspending: 0,
        ...input,
      },
    ]),
  )
}

// YNAB's sandbox: Sep leaves 4.100.000, Oct takes 100.000 in and assigns
// 110.000 with 15.000 cash overspent, Nov assigns 50.000.
const sandbox = readyToAssignMonths({
  [september]: { inflow: 5_000_000, assigned: 900_000 },
  [october]: { inflow: 100_000, assigned: 110_000, cashOverspending: 15_000 },
  [november]: { assigned: 50_000 },
})

test('Ready to Assign differs per month and subtracts future assignments', () => {
  assert.deepEqual(budgetReadyToAssign(sandbox, september), {
    leftOverFromPreviousMonth: 0,
    inflow: 5_000_000,
    debtAccountInflow: 0,
    cashOverspendingPreviousMonth: 0,
    assignedThisMonth: 900_000,
    assignedInFuture: 160_000,
    total: 3_940_000,
    futureMonths: [
      { month: october, assigned: 110_000 },
      { month: november, assigned: 50_000 },
    ],
  })
  assert.deepEqual(budgetReadyToAssign(sandbox, october), {
    leftOverFromPreviousMonth: 4_100_000,
    inflow: 100_000,
    debtAccountInflow: 0,
    cashOverspendingPreviousMonth: 0,
    assignedThisMonth: 110_000,
    assignedInFuture: 50_000,
    total: 4_040_000,
    futureMonths: [{ month: november, assigned: 50_000 }],
  })
  assert.deepEqual(budgetReadyToAssign(sandbox, november), {
    leftOverFromPreviousMonth: 4_090_000,
    inflow: 0,
    debtAccountInflow: 0,
    cashOverspendingPreviousMonth: 15_000,
    assignedThisMonth: 50_000,
    assignedInFuture: 0,
    total: 4_025_000,
    futureMonths: [],
  })
  // Cash overspending counts against the following month only.
  assert.equal(
    budgetReadyToAssign(sandbox, '2026-12' as PlanMonth).total,
    4_025_000,
  )
})

test('negative Ready to Assign is not capped by future assignments', () => {
  const overassigned = readyToAssignMonths({
    ...Object.fromEntries(sandbox),
    [october]: { inflow: 100_000, assigned: 5_110_000 },
  })
  const readyToAssign = budgetReadyToAssign(overassigned, october)
  assert.equal(readyToAssign.assignedInFuture, 0)
  assert.equal(readyToAssign.total, -910_000)
  assert.equal(budgetReadyToAssign(overassigned, november).total, -960_000)
})

test('later assignments take an earlier month only down to zero', () => {
  const months = readyToAssignMonths({
    [september]: { inflow: 100_000 },
    [october]: { assigned: 300_000 },
  })
  assert.equal(budgetReadyToAssign(months, september).total, 0)
  assert.equal(budgetReadyToAssign(months, september).assignedInFuture, 100_000)
  assert.equal(budgetReadyToAssign(months, october).total, -200_000)
})

test('an outflow from Ready to Assign lowers it', () => {
  const months = readyToAssignMonths({
    [october]: { inflow: 100_000 - 30_000 },
  })
  assert.equal(budgetReadyToAssign(months, october).total, 70_000)
})

type CashMonth = { assigned?: number; cashActivity?: number }

// Plans a month for Categories and cards. The Visa and Amex Credit Payment
// Categories are `visa-payment` and `amex-payment`.
function planMonth(
  inputMonth: PlanMonth,
  {
    categories = {},
    inflows = {},
    card = [],
  }: {
    categories?: Record<string, Partial<Record<PlanMonth, CashMonth>>>
    inflows?: Record<string, number>
    card?: Array<CardTransaction>
  },
) {
  return budgetPlanMonth(
    {
      categories: new Map(
        Object.entries(categories).map(([categoryId, months]) => [
          categoryId,
          new Map(
            Object.entries(months).map(([key, input]) => [
              key as PlanMonth,
              { assigned: 0, cashActivity: 0, ...input },
            ]),
          ),
        ]),
      ),
      readyToAssignInflows: new Map(
        Object.entries(inflows).map(([key, inflow]) => [
          key as PlanMonth,
          inflow,
        ]),
      ),
      cardTransactions: card,
      creditPaymentCategories: new Map([
        ['visa', 'visa-payment'],
        ['amex', 'amex-payment'],
      ]),
    },
    inputMonth,
  )
}

function onCard(
  kind: 'credit_payment' | 'ready_to_assign' | 'balance',
  amount: number,
  inputMonth = october,
  accountId = 'visa',
): CardTransaction {
  return { kind, amount, date: firstDayOfMonth(inputMonth), accountId }
}

function purchase(
  categoryId: string,
  amount: number,
  inputMonth = october,
  accountId = 'visa',
): CardTransaction {
  return {
    kind: 'category',
    categoryId,
    amount,
    date: firstDayOfMonth(inputMonth),
    accountId,
  }
}

function amounts(budget: CategoryMonthBudget | undefined) {
  return budget && [budget.assigned, budget.activity, budget.available]
}

test('the Plan month deducts cash but not credit overspending', () => {
  const plan = planMonth(october, {
    categories: {
      groceries: {
        [september]: { assigned: 10_000, cashActivity: -25_000 },
        [november]: { assigned: 5_000 },
      },
    },
    inflows: { [september]: 100_000 },
    card: [purchase('dining', -40_000, september)],
  })
  assert.deepEqual(plan.readyToAssign, {
    leftOverFromPreviousMonth: 90_000,
    inflow: 0,
    debtAccountInflow: 0,
    cashOverspendingPreviousMonth: 15_000,
    assignedThisMonth: 0,
    assignedInFuture: 5_000,
    total: 70_000,
    futureMonths: [{ month: november, assigned: 5_000 }],
  })
  assert.equal(plan.categories.get('groceries')?.available, 0)
  assert.equal(plan.categories.get('dining')?.carryover, 0)
})

// YNAB: base 10, cash −25, credit −15 gives Available −30, red, whichever
// Transaction comes first.
test('cash overspending moves nothing to the card payment', () => {
  const inputs = {
    categories: {
      groceries: { [october]: { assigned: 10_000, cashActivity: -25_000 } },
    },
    card: [purchase('groceries', -15_000)],
  }
  const plan = planMonth(october, inputs)
  const groceries = plan.categories.get('groceries')
  assert.equal(groceries?.available, -30_000)
  assert.equal(groceries.status, 'cash_overspent')
  assert.equal(groceries.overspending.cash, 15_000)
  const payment = plan.categories.get('visa-payment')
  assert.deepEqual(amounts(payment), [0, 0, 0])
  assert.equal(payment?.status, 'payment_underfunded')
  assert.equal(
    planMonth(november, inputs).readyToAssign.cashOverspendingPreviousMonth,
    15_000,
  )
})

// YNAB: base 30, cash −25, credit −15 gives Available −10, yellow, with 5
// funded.
test('funded credit spending moves to the card payment Activity', () => {
  const inputs = {
    categories: {
      groceries: { [october]: { assigned: 30_000, cashActivity: -25_000 } },
    },
    card: [purchase('groceries', -15_000)],
  }
  const plan = planMonth(october, inputs)
  const groceries = plan.categories.get('groceries')
  assert.equal(groceries?.available, -10_000)
  assert.equal(groceries.status, 'credit_overspent')
  assert.deepEqual(groceries.overspending, { cash: 0, credit: 10_000 })
  assert.deepEqual(
    amounts(plan.categories.get('visa-payment')),
    [0, 5_000, 5_000],
  )
  assert.equal(plan.readyToAssign.total, -30_000)
  assert.equal(
    planMonth(november, inputs).readyToAssign.cashOverspendingPreviousMonth,
    0,
  )
})

// YNAB's Audit Card in October: Funded Spending +70.000 and Payments & Returns
// −30.000 make Total Activity +40.000.
test('payment Activity is funded spending less payments', () => {
  const plan = planMonth(october, {
    categories: {
      dining: { [october]: { assigned: 20_000 } },
      subscription: { [october]: { assigned: 60_000 } },
    },
    card: [
      purchase('dining', -30_000),
      purchase('subscription', -50_000),
      onCard('credit_payment', 30_000),
      onCard('ready_to_assign', -5_000, october, 'amex'),
    ],
  })
  assert.deepEqual(plan.paymentActivity.get('visa-payment'), {
    fundedSpending: 70_000,
    payments: 30_000,
  })
  assert.equal(plan.categories.get('visa-payment')?.activity, 40_000)
  assert.deepEqual(plan.paymentActivity.get('amex-payment'), {
    fundedSpending: 5_000,
    payments: 0,
  })
  assert.equal(plan.categories.get('amex-payment')?.activity, 5_000)
})

test('assigning more later in the month moves more to the payment', () => {
  const plan = planMonth(october, {
    categories: {
      groceries: { [october]: { assigned: 40_000, cashActivity: -25_000 } },
    },
    card: [purchase('groceries', -15_000)],
  })
  assert.equal(plan.categories.get('groceries')?.status, 'zero')
  const payment = plan.categories.get('visa-payment')
  assert.deepEqual(amounts(payment), [0, 15_000, 15_000])
  assert.equal(payment?.cardBalance, -15_000)
  assert.equal(payment.status, 'positive')
})

test('a payment from cash lowers the payment Activity, not Ready to Assign', () => {
  const plan = planMonth(october, {
    categories: { groceries: { [october]: { assigned: 100_000 } } },
    card: [purchase('groceries', -100_000), onCard('credit_payment', 60_000)],
  })
  const payment = plan.categories.get('visa-payment')
  assert.deepEqual(amounts(payment), [0, 40_000, 40_000])
  assert.equal(payment?.cardBalance, -40_000)
  assert.equal(payment.status, 'positive')
  assert.equal(plan.readyToAssign.debtAccountInflow, 0)
  assert.equal(plan.readyToAssign.total, -100_000)
})

// A 50.000 purchase on a card 30.000 in credit reserves 20.000.
test('spending from a positive card balance acts like cash', () => {
  const plan = planMonth(october, {
    categories: { groceries: { [october]: { assigned: 50_000 } } },
    card: [
      onCard('balance', 30_000, september),
      purchase('groceries', -50_000),
    ],
  })
  const groceries = plan.categories.get('groceries')
  assert.equal(groceries?.cashActivity, -30_000)
  assert.deepEqual(groceries.creditActivity, [
    { accountId: 'visa', amount: -20_000 },
  ])
  assert.equal(groceries.activity, -50_000)
  assert.deepEqual(
    amounts(plan.categories.get('visa-payment')),
    [0, 20_000, 20_000],
  )

  const inCredit = planMonth(october, {
    categories: { groceries: { [october]: { assigned: 50_000 } } },
    card: [
      onCard('balance', 60_000, september),
      purchase('groceries', -50_000),
    ],
  })
  assert.deepEqual(amounts(inCredit.categories.get('visa-payment')), [0, 0, 0])
  assert.equal(inCredit.categories.get('visa-payment')?.status, 'positive')
})

test('an overpayment is an Inflow from Debt Account and red next month', () => {
  const inputs = {
    categories: { groceries: { [october]: { assigned: 100_000 } } },
    card: [purchase('groceries', -100_000), onCard('credit_payment', 150_000)],
  }
  const plan = planMonth(october, inputs)
  const payment = plan.categories.get('visa-payment')
  assert.deepEqual(amounts(payment), [0, -50_000, -50_000])
  assert.equal(payment?.status, 'payment_overspent')
  assert.equal(plan.readyToAssign.debtAccountInflow, 50_000)
  assert.equal(plan.readyToAssign.total, -50_000)

  const later = planMonth(november, inputs)
  assert.equal(later.categories.get('visa-payment')?.carryover, 0)
  assert.equal(later.categories.get('visa-payment')?.status, 'positive')
  assert.deepEqual(later.readyToAssign, {
    leftOverFromPreviousMonth: -50_000,
    inflow: 0,
    debtAccountInflow: 0,
    cashOverspendingPreviousMonth: 50_000,
    assignedThisMonth: 0,
    assignedInFuture: 0,
    total: -100_000,
    futureMonths: [],
  })
})

test('Ready to Assign on a card in debt only reaches it above zero', () => {
  const inDebt = planMonth(october, {
    card: [purchase('groceries', -100_000), onCard('ready_to_assign', 40_000)],
  })
  assert.equal(inDebt.readyToAssign.inflow, 0)
  assert.equal(inDebt.categories.get('visa-payment')?.cardBalance, -60_000)

  const crossing = planMonth(october, {
    card: [purchase('groceries', -100_000), onCard('ready_to_assign', 150_000)],
  })
  assert.equal(crossing.readyToAssign.inflow, 50_000)
  assert.equal(crossing.readyToAssign.debtAccountInflow, 0)
  assert.equal(crossing.categories.get('visa-payment')?.cardBalance, 50_000)
})

test('a Ready to Assign outflow on a card sets its debt aside for payment', () => {
  const plan = planMonth(october, {
    card: [
      onCard('balance', 10_000, september),
      onCard('ready_to_assign', -30_000),
    ],
  })
  assert.equal(plan.readyToAssign.inflow, -30_000)
  const payment = plan.categories.get('visa-payment')
  assert.deepEqual(amounts(payment), [0, 20_000, 20_000])
  assert.equal(payment?.status, 'positive')
})

test('a card refund moves money back from the payment', () => {
  const plan = planMonth(october, {
    categories: { groceries: { [october]: { assigned: 100_000 } } },
    card: [purchase('groceries', -100_000), purchase('groceries', 40_000)],
  })
  assert.deepEqual(
    amounts(plan.categories.get('groceries')),
    [100_000, -60_000, 40_000],
  )
  assert.deepEqual(
    amounts(plan.categories.get('visa-payment')),
    [0, 60_000, 60_000],
  )

  const later = planMonth(november, {
    categories: { groceries: { [october]: { assigned: 100_000 } } },
    card: [
      purchase('groceries', -100_000),
      purchase('groceries', 40_000, november),
    ],
  })
  assert.deepEqual(
    amounts(later.categories.get('groceries')),
    [0, 40_000, 40_000],
  )
  assert.deepEqual(
    amounts(later.categories.get('visa-payment')),
    [0, -40_000, 60_000],
  )
  assert.equal(later.categories.get('visa-payment')?.status, 'positive')
})

// YNAB: 40.000 funds a 100.000 purchase ("You've overspent this category by
// −60.000 with credit"), then 40.000 assigned to the payment leaves "You have
// 80.000 set aside for payment".
test('assigning to the payment lowers Ready to Assign', () => {
  const plan = planMonth(october, {
    categories: {
      groceries: { [october]: { assigned: 40_000 } },
      'visa-payment': { [october]: { assigned: 40_000 } },
    },
    inflows: { [october]: 200_000 },
    card: [purchase('groceries', -100_000)],
  })
  assert.equal(plan.categories.get('groceries')?.overspending.credit, 60_000)
  const payment = plan.categories.get('visa-payment')
  assert.deepEqual(amounts(payment), [40_000, 40_000, 80_000])
  assert.equal(payment?.cardBalance, -100_000)
  assert.equal(payment.status, 'payment_underfunded')
  assert.equal(plan.readyToAssign.total, 120_000)
})

test('funding spans cards in the order they were used', () => {
  const plan = planMonth(october, {
    categories: { groceries: { [october]: { assigned: 30_000 } } },
    card: [
      purchase('groceries', -20_000, october, 'amex'),
      purchase('groceries', -20_000),
      purchase('groceries', -5_000, october, 'amex'),
    ],
  })
  assert.deepEqual(plan.categories.get('groceries')?.fundedCredit, [
    { accountId: 'amex', amount: 25_000 },
    { accountId: 'visa', amount: 5_000 },
  ])
  assert.equal(plan.categories.get('amex-payment')?.activity, 25_000)
  assert.equal(plan.categories.get('visa-payment')?.activity, 5_000)
})

test('a refund on one card funds spending on another', () => {
  const budget = budgetCategoryMonth(0, {
    assigned: 0,
    cashActivity: 0,
    creditActivity: [
      { accountId: 'amex', amount: 10_000 },
      { accountId: 'visa', amount: -30_000 },
    ],
  })
  assert.deepEqual(budget.fundedCredit, [
    { accountId: 'amex', amount: -10_000 },
    { accountId: 'visa', amount: 10_000 },
  ])
  assert.deepEqual(budget.overspending, { cash: 0, credit: 20_000 })
})

// YNAB: a funded 200.000 purchase and its 200.000 payment on 09/09 leave the
// payment Category at 0/0/0 with no Inflow from Debt Account, whichever was
// entered first.
test('a same-day payment never goes before the purchase it pays', () => {
  const onSeptember9 = { accountId: 'visa', date: '2026-09-09' }
  const plan = planMonth(september, {
    categories: { subscription: { [september]: { assigned: 200_000 } } },
    inflows: { [september]: 4_000_000 },
    card: [
      { ...onSeptember9, kind: 'credit_payment', amount: 200_000 },
      {
        ...onSeptember9,
        kind: 'category',
        categoryId: 'subscription',
        amount: -200_000,
      },
    ],
  })
  assert.deepEqual(
    amounts(plan.categories.get('subscription')),
    [200_000, -200_000, 0],
  )
  assert.equal(plan.categories.get('subscription')?.status, 'zero')
  assert.deepEqual(amounts(plan.categories.get('visa-payment')), [0, 0, 0])
  assert.equal(plan.categories.get('visa-payment')?.status, 'zero')
  assert.equal(plan.readyToAssign.debtAccountInflow, 0)
  assert.equal(plan.readyToAssign.total, 3_800_000)
})

test('cash advances and Balance Transfers only move card debt', () => {
  const plan = planMonth(october, {
    categories: { groceries: { [october]: { assigned: 50_000 } } },
    card: [
      purchase('groceries', -50_000),
      onCard('balance', -30_000),
      onCard('balance', 20_000),
      onCard('balance', -20_000, october, 'amex'),
    ],
  })
  const visa = plan.categories.get('visa-payment')
  assert.deepEqual(amounts(visa), [0, 50_000, 50_000])
  assert.equal(visa?.cardBalance, -60_000)
  assert.equal(visa.status, 'payment_underfunded')
  assert.deepEqual(amounts(plan.categories.get('amex-payment')), [0, 0, 0])
  assert.equal(plan.readyToAssign.total, -50_000)
})

test('card Transactions after the month do not count', () => {
  const plan = planMonth(september, {
    card: [purchase('groceries', -50_000, october)],
  })
  assert.equal(plan.categories.get('visa-payment')?.cardBalance, 0)
})

test('the payment pill compares Available with the card debt', () => {
  const status = (carryover: number, debt: number) =>
    budgetCategoryMonth(carryover, month({}), -debt).status
  assert.equal(status(100_000, 100_000), 'positive')
  assert.equal(status(120_000, 100_000), 'positive')
  assert.equal(status(80_000, 100_000), 'payment_underfunded')
  assert.equal(status(0, 100_000), 'payment_underfunded')
  assert.equal(status(0, 0), 'zero')
  assert.equal(
    budgetCategoryMonth(0, month({ cashActivity: -1_000 }), 0).status,
    'payment_overspent',
  )
})

// YNAB: a card holding a 5.000 cashback with no debt shows a green 0, and a
// card at exactly zero a beige one.
test('a payment Category is green while its card is in credit', () => {
  const travel = planMonth(october, {
    card: [onCard('ready_to_assign', 5_000)],
  }).categories.get('visa-payment')
  assert.deepEqual(amounts(travel), [0, 0, 0])
  assert.equal(travel?.cardBalance, 5_000)
  assert.equal(travel.status, 'positive')

  const line = planMonth(october, {
    card: [onCard('balance', -20_000), onCard('balance', 20_000)],
  }).categories.get('visa-payment')
  assert.deepEqual(amounts(line), [0, 0, 0])
  assert.equal(line?.cardBalance, 0)
  assert.equal(line.status, 'zero')
})

test('payment Available carries over like any Category', () => {
  const [first, second] = budgetCategoryMonths(
    [month({ assigned: 100_000 }), month({ cashActivity: -30_000 })],
    -100_000,
  )
  assert.equal(first.available, 100_000)
  assert.equal(second.carryover, 100_000)
  assert.equal(second.available, 70_000)
  assert.equal(second.status, 'payment_underfunded')
})

test('adjustments budget only the change in positive card balance and leave payment money alone', () => {
  for (const [start, target, delta] of [
    [-1000, -1300, 0],
    [-1000, -700, 0],
    [-1000, 300, 300],
    [300, -200, -300],
    [300, 600, 300],
  ]) {
    const result = planMonth(october, {
      categories: { 'visa-payment': { [october]: { assigned: 400000 } } },
      card: [
        onCard('balance', start * 1000),
        {
          ...onCard('balance', (target - start) * 1000),
          kind: 'reconciliation_adjustment',
        },
      ],
    })
    assert.equal(result.readyToAssign.inflow, delta * 1000)
    assert.deepEqual(
      amounts(result.categories.get('visa-payment')),
      [400000, 0, 400000],
    )
  }
})
