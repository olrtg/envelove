import { faker } from '@faker-js/faker'
import { addDays, format, subDays } from 'date-fns'
import { and, eq, inArray } from 'drizzle-orm'

import { getPayeeNameKey } from '#/features/payees/payee.schemas'
import { accountTypeDetails } from '#/features/accounts/account-types'
import type { AccountType } from '#/features/accounts/account.schemas'
import { createId } from '#/lib/id'

import { db } from './index.ts'
import {
  accounts,
  categories,
  categoryGroups,
  payees,
  plans,
  transactions,
  transfers,
  user,
} from './schema.ts'

const SEED_PLAN_NAME = 'Seed plan'
const HISTORY_DAYS = 90
const CLEARED_AFTER_DAYS = 4

const email = process.argv[2] ?? process.env.SEED_EMAIL

if (!email) {
  throw new Error('Usage: pnpm db:seed <email> (or set SEED_EMAIL)')
}

faker.seed(42)

const today = new Date()
const toDate = (date: Date) => format(date, 'yyyy-MM-dd')
const dollars = (amount: number) => Math.round(amount * 100) * 10

const accountSeeds: Array<{
  key: string
  name: string
  type: AccountType
  startingBalance: number
  closed?: boolean
}> = [
  {
    key: 'checking',
    name: 'Checking',
    type: 'checking',
    startingBalance: 2400,
  },
  { key: 'savings', name: 'Savings', type: 'savings', startingBalance: 8500 },
  { key: 'wallet', name: 'Wallet', type: 'cash', startingBalance: 60 },
  { key: 'visa', name: 'Visa', type: 'credit_card', startingBalance: -640 },
  { key: 'amex', name: 'Amex', type: 'credit_card', startingBalance: -1250 },
  {
    key: 'carLoan',
    name: 'Car Loan',
    type: 'auto_loan',
    startingBalance: -14200,
  },
  {
    key: 'brokerage',
    name: 'Brokerage',
    type: 'asset',
    startingBalance: 23000,
  },
  {
    key: 'oldChecking',
    name: 'Old Checking',
    type: 'checking',
    startingBalance: 35,
    closed: true,
  },
]

const categoryGroupSeeds: Array<{
  name: string
  categories: Array<{ name: string; emoji: string; hidden?: boolean }>
}> = [
  {
    name: 'Bills',
    categories: [
      { name: 'Rent', emoji: '🏠' },
      { name: 'Electric', emoji: '⚡' },
      { name: 'Internet', emoji: '🌐' },
      { name: 'Phone', emoji: '📱' },
      { name: 'Car Payment', emoji: '🚗' },
    ],
  },
  {
    name: 'Everyday',
    categories: [
      { name: 'Groceries', emoji: '🛒' },
      { name: 'Dining Out', emoji: '🍽️' },
      { name: 'Transportation', emoji: '🚌' },
      { name: 'Household', emoji: '🧺' },
    ],
  },
  {
    name: 'Fun',
    categories: [
      { name: 'Entertainment', emoji: '🎬' },
      { name: 'Hobbies', emoji: '🎨' },
      { name: 'Gym', emoji: '🏋️', hidden: true },
    ],
  },
  {
    name: 'Goals',
    categories: [
      { name: 'Emergency Fund', emoji: '🛟' },
      { name: 'Vacation', emoji: '🏖️' },
    ],
  },
  { name: 'Someday', categories: [] },
]

// Recurring and random spending, keyed by payee name.
const spendingSeeds: Array<{
  payee: string
  category: string
  accounts: Array<string>
  min: number
  max: number
  everyDays?: number
  perWeek?: number
}> = [
  {
    payee: 'Greenleaf Apartments',
    category: 'Rent',
    accounts: ['checking'],
    min: 1650,
    max: 1650,
    everyDays: 30,
  },
  {
    payee: 'City Power & Light',
    category: 'Electric',
    accounts: ['checking'],
    min: 70,
    max: 130,
    everyDays: 30,
  },
  {
    payee: 'Comcast',
    category: 'Internet',
    accounts: ['visa'],
    min: 65,
    max: 65,
    everyDays: 30,
  },
  {
    payee: 'Verizon',
    category: 'Phone',
    accounts: ['amex'],
    min: 55,
    max: 55,
    everyDays: 30,
  },
  {
    payee: 'Toyota Financial',
    category: 'Car Payment',
    accounts: ['checking'],
    min: 385,
    max: 385,
    everyDays: 30,
  },
  {
    payee: 'Trader Joe’s',
    category: 'Groceries',
    accounts: ['visa', 'checking'],
    min: 35,
    max: 140,
    perWeek: 1.5,
  },
  {
    payee: 'Whole Foods',
    category: 'Groceries',
    accounts: ['amex'],
    min: 20,
    max: 90,
    perWeek: 0.5,
  },
  {
    payee: 'Chipotle',
    category: 'Dining Out',
    accounts: ['visa', 'wallet'],
    min: 11,
    max: 28,
    perWeek: 1,
  },
  {
    payee: 'Blue Bottle Coffee',
    category: 'Dining Out',
    accounts: ['wallet', 'visa'],
    min: 4,
    max: 12,
    perWeek: 2,
  },
  {
    payee: 'Shell',
    category: 'Transportation',
    accounts: ['visa'],
    min: 35,
    max: 65,
    perWeek: 0.7,
  },
  {
    payee: 'Uber',
    category: 'Transportation',
    accounts: ['amex'],
    min: 9,
    max: 32,
    perWeek: 0.5,
  },
  {
    payee: 'Target',
    category: 'Household',
    accounts: ['visa', 'checking'],
    min: 15,
    max: 110,
    perWeek: 0.5,
  },
  {
    payee: 'Netflix',
    category: 'Entertainment',
    accounts: ['amex'],
    min: 15.49,
    max: 15.49,
    everyDays: 30,
  },
  {
    payee: 'AMC Theatres',
    category: 'Entertainment',
    accounts: ['visa'],
    min: 14,
    max: 40,
    perWeek: 0.25,
  },
  {
    payee: 'REI',
    category: 'Hobbies',
    accounts: ['amex'],
    min: 25,
    max: 180,
    perWeek: 0.2,
  },
  {
    payee: 'Planet Fitness',
    category: 'Gym',
    accounts: ['checking'],
    min: 25,
    max: 25,
    everyDays: 30,
  },
]

const existingUser = db
  .select()
  .from(user)
  .where(eq(user.email, email))
  .limit(1)
  .all()
  .at(0)

const ownerId = existingUser?.id ?? createId()

db.transaction(
  (tx) => {
    if (!existingUser) {
      tx.insert(user)
        .values({ id: ownerId, name: email, email, emailVerified: true })
        .run()
    }

    const previousPlanIds = tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.ownerId, ownerId), eq(plans.name, SEED_PLAN_NAME)))
      .all()
      .map((plan) => plan.id)

    if (previousPlanIds.length > 0) {
      // Transactions restrict Category and Payee deletes, so clear them first.
      const previousAccountIds = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(inArray(accounts.planId, previousPlanIds))
        .all()
        .map((account) => account.id)
      if (previousAccountIds.length > 0) {
        tx.delete(transactions)
          .where(inArray(transactions.accountId, previousAccountIds))
          .run()
      }
      tx.delete(plans).where(inArray(plans.id, previousPlanIds)).run()
    }

    const planId = createId()
    tx.insert(plans)
      .values({
        id: planId,
        ownerId,
        name: SEED_PLAN_NAME,
        countryCode: 'US',
        currencyCode: 'USD',
      })
      .run()

    const accountIds = new Map<string, string>()
    for (const [index, seed] of accountSeeds.entries()) {
      const id = createId()
      accountIds.set(seed.key, id)
      tx.insert(accounts)
        .values({
          id,
          planId,
          name: seed.name,
          type: seed.type,
          closed: seed.closed ?? false,
          // Keep sidebar order stable, since Accounts sort by creation time.
          createdAt: new Date(today.getTime() + index),
        })
        .run()
    }

    const inflowGroupId = createId()
    tx.insert(categoryGroups)
      .values({
        id: inflowGroupId,
        planId,
        name: 'Inflow',
        kind: 'inflow',
        position: 0,
      })
      .run()
    const readyToAssignId = createId()
    tx.insert(categories)
      .values({
        id: readyToAssignId,
        categoryGroupId: inflowGroupId,
        name: 'Ready to Assign',
        kind: 'ready_to_assign',
        position: 0,
      })
      .run()

    const categoryIds = new Map<string, string>()
    for (const [groupPosition, groupSeed] of categoryGroupSeeds.entries()) {
      const groupId = createId()
      tx.insert(categoryGroups)
        .values({
          id: groupId,
          planId,
          name: groupSeed.name,
          position: groupPosition,
        })
        .run()

      for (const [position, categorySeed] of groupSeed.categories.entries()) {
        const id = createId()
        categoryIds.set(categorySeed.name, id)
        tx.insert(categories)
          .values({
            id,
            categoryGroupId: groupId,
            name: `${categorySeed.emoji} ${categorySeed.name}`,
            hidden: categorySeed.hidden ?? false,
            position,
          })
          .run()
      }
    }

    const creditAccounts = accountSeeds.filter(
      (seed) => accountTypeDetails[seed.type].group === 'credit',
    )
    const paymentGroupId = createId()
    tx.insert(categoryGroups)
      .values({
        id: paymentGroupId,
        planId,
        name: 'Credit Card Payments',
        kind: 'credit_card_payments',
        position: categoryGroupSeeds.length,
      })
      .run()
    tx.insert(categories)
      .values(
        creditAccounts.map((seed, position) => ({
          categoryGroupId: paymentGroupId,
          name: seed.name,
          kind: 'credit_payment' as const,
          creditAccountId: accountIds.get(seed.key),
          position,
        })),
      )
      .run()

    const payeeNames = [
      'Starting Balance',
      'Acme Corp',
      ...new Set(spendingSeeds.map((seed) => seed.payee)),
    ]
    const payeeIds = new Map<string, string>()
    for (const name of payeeNames) {
      const id = createId()
      payeeIds.set(name, id)
      tx.insert(payees)
        .values({ id, planId, name, nameKey: getPayeeNameKey(name) })
        .run()
    }

    const start = subDays(today, HISTORY_DAYS)
    const isCleared = (date: Date) =>
      date <= subDays(today, CLEARED_AFTER_DAYS) ||
      (date <= today && faker.datatype.boolean(0.4))

    const ordinaryRows: Array<typeof transactions.$inferInsert> = []

    for (const seed of accountSeeds) {
      ordinaryRows.push({
        accountId: accountIds.get(seed.key)!,
        categoryId:
          accountTypeDetails[seed.type].group === 'cash'
            ? readyToAssignId
            : null,
        payeeId: payeeIds.get('Starting Balance'),
        date: toDate(start),
        amount: dollars(seed.startingBalance),
        startingBalance: true,
        cleared: true,
      })
    }

    // Biweekly paycheck, including one in the future.
    for (
      let date = addDays(start, 3);
      date <= addDays(today, 14);
      date = addDays(date, 14)
    ) {
      ordinaryRows.push({
        accountId: accountIds.get('checking')!,
        categoryId: readyToAssignId,
        payeeId: payeeIds.get('Acme Corp'),
        date: toDate(date),
        memo: 'Paycheck',
        amount: dollars(2150),
        cleared: isCleared(date),
      })
    }

    for (const seed of spendingSeeds) {
      const dates: Array<Date> = []
      if (seed.everyDays) {
        let date = addDays(
          start,
          faker.number.int({ min: 1, max: seed.everyDays }),
        )
        // Recurring bills get one upcoming, future-dated occurrence.
        for (
          ;
          date <= addDays(today, seed.everyDays);
          date = addDays(date, seed.everyDays)
        ) {
          dates.push(date)
        }
      } else if (seed.perWeek) {
        const count = Math.round((HISTORY_DAYS / 7) * seed.perWeek)
        for (let i = 0; i < count; i++) {
          dates.push(faker.date.between({ from: start, to: today }))
        }
      }

      for (const date of dates) {
        ordinaryRows.push({
          accountId: accountIds.get(faker.helpers.arrayElement(seed.accounts))!,
          categoryId: categoryIds.get(seed.category),
          payeeId: payeeIds.get(seed.payee),
          date: toDate(date),
          memo: faker.datatype.boolean(0.15)
            ? faker.commerce.productName()
            : null,
          amount: -dollars(
            faker.number.float({ min: seed.min, max: seed.max }),
          ),
          cleared: date <= today && isCleared(date),
        })
      }
    }

    // A few uncategorized transactions to exercise that state.
    for (let i = 0; i < 3; i++) {
      const date = faker.date.between({ from: subDays(today, 10), to: today })
      ordinaryRows.push({
        accountId: accountIds.get('checking')!,
        payeeId: payeeIds.get('Target'),
        date: toDate(date),
        amount: -dollars(faker.number.float({ min: 5, max: 60 })),
        cleared: false,
      })
    }

    tx.insert(transactions).values(ordinaryRows).run()

    const transferSeeds: Array<{
      from: string
      to: string
      amount: number
      date: Date
      memo?: string
    }> = []
    for (
      let date = addDays(start, 20);
      date <= today;
      date = addDays(date, 30)
    ) {
      transferSeeds.push(
        {
          from: 'checking',
          to: 'visa',
          amount: 600,
          date,
          memo: 'Card payment',
        },
        { from: 'checking', to: 'amex', amount: 350, date: addDays(date, 2) },
        {
          from: 'checking',
          to: 'savings',
          amount: 300,
          date: addDays(date, 1),
        },
        {
          from: 'checking',
          to: 'wallet',
          amount: 80,
          date: addDays(date, 5),
          memo: 'ATM',
        },
      )
    }
    transferSeeds.push({
      from: 'checking',
      to: 'savings',
      amount: 200,
      date: addDays(today, 7),
      memo: 'Scheduled',
    })

    for (const seed of transferSeeds) {
      const transferId = createId()
      tx.insert(transfers).values({ id: transferId, planId }).run()

      const cleared = seed.date <= today && isCleared(seed.date)
      tx.insert(transactions)
        .values([
          {
            accountId: accountIds.get(seed.from)!,
            transferId,
            transferSide: 'outflow',
            date: toDate(seed.date),
            memo: seed.memo,
            amount: -dollars(seed.amount),
            cleared,
          },
          {
            accountId: accountIds.get(seed.to)!,
            transferId,
            transferSide: 'inflow',
            date: toDate(seed.date),
            memo: seed.memo,
            amount: dollars(seed.amount),
            cleared,
          },
        ])
        .run()
    }

    console.log(
      `Seeded "${SEED_PLAN_NAME}" for ${email} (plan ${planId}): ${accountSeeds.length} accounts, ${ordinaryRows.length + transferSeeds.length * 2} transactions.`,
    )
  },
  { behavior: 'immediate' },
)
