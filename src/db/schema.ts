import { relations, sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { countryCodes, currencyCodes } from '#/lib/country-profiles'
import type { CategoryTarget } from '#/features/categories/category-target'
import { createId } from '#/lib/id'
import { transferSides } from '#/lib/transfer'

import { user } from './auth-schema'

export * from './auth-schema'

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    countryCode: text('country_code', { enum: countryCodes })
      .notNull()
      .default('US'),
    currencyCode: text('currency_code', {
      enum: currencyCodes,
    })
      .notNull()
      .default('USD'),
    defaultTransactionCleared: integer('default_transaction_cleared', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    hideAfterReconciliation: integer('hide_after_reconciliation', {
      mode: 'boolean',
    })
      .notNull()
      .default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('plans_owner_id_idx').on(table.ownerId)],
)

export const payees = sqliteTable(
  'payees',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('payees_plan_id_name_key_unique').on(
      table.planId,
      table.nameKey,
    ),
  ],
)

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', {
      enum: [
        'checking',
        'savings',
        'cash',
        'credit_card',
        'line_of_credit',
        'mortgage',
        'auto_loan',
        'student_loan',
        'personal_loan',
        'medical_debt',
        'other_debt',
        'asset',
        'liability',
      ],
    }).notNull(),
    lastReconciledAt: integer('last_reconciled_at', { mode: 'timestamp_ms' }),
    closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('accounts_plan_id_idx').on(table.planId)],
)

export const categoryGroups = sqliteTable(
  'category_groups',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['ordinary', 'credit_card_payments', 'inflow'],
    })
      .notNull()
      .default('ordinary'),
    position: integer('position').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('category_groups_plan_id_position_idx').on(
      table.planId,
      table.position,
    ),
    uniqueIndex('category_groups_plan_credit_payments_unique')
      .on(table.planId)
      .where(sql`${table.kind} = 'credit_card_payments'`),
    uniqueIndex('category_groups_plan_inflow_unique')
      .on(table.planId)
      .where(sql`${table.kind} = 'inflow'`),
  ],
)

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    categoryGroupId: text('category_group_id')
      .notNull()
      .references(() => categoryGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['ordinary', 'credit_payment', 'ready_to_assign'],
    })
      .notNull()
      .default('ordinary'),
    creditAccountId: text('credit_account_id').references(() => accounts.id, {
      onDelete: 'cascade',
    }),
    target: text('target', { mode: 'json' }).$type<CategoryTarget>(),
    snoozedMonths: text('snoozed_months', { mode: 'json' }).$type<string[]>(),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('categories_group_id_position_idx').on(
      table.categoryGroupId,
      table.position,
    ),
    uniqueIndex('categories_credit_account_id_unique').on(
      table.creditAccountId,
    ),
    uniqueIndex('categories_group_ready_to_assign_unique')
      .on(table.categoryGroupId)
      .where(sql`${table.kind} = 'ready_to_assign'`),
    check(
      'categories_credit_payment_pair_check',
      sql`(${table.kind} in ('ordinary', 'ready_to_assign') and ${table.creditAccountId} is null) or (${table.kind} = 'credit_payment' and ${table.creditAccountId} is not null)`,
    ),
  ],
)

export const categoryAssignments = sqliteTable(
  'category_assignments',
  {
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    amount: integer('amount').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.categoryId, table.month] }),
    check(
      'category_assignments_month_check',
      sql`${table.month} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]' and substr(${table.month}, 6, 2) between '01' and '12'`,
    ),
  ],
)

export const transfers = sqliteTable(
  'transfers',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('transfers_plan_id_idx').on(table.planId)],
)

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'restrict',
    }),
    payeeId: text('payee_id').references(() => payees.id, {
      onDelete: 'restrict',
    }),
    transferId: text('transfer_id').references(() => transfers.id, {
      onDelete: 'cascade',
    }),
    transferSide: text('transfer_side', { enum: transferSides }),
    date: text('date').notNull(),
    memo: text('memo'),
    amount: integer('amount').notNull(),
    reconciled: integer('reconciled', { mode: 'boolean' })
      .notNull()
      .default(false),
    reconciliationAdjustment: integer('reconciliation_adjustment', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    startingBalance: integer('starting_balance', { mode: 'boolean' })
      .notNull()
      .default(false),
    cleared: integer('cleared', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('transactions_account_id_date_created_at_idx').on(
      table.accountId,
      table.date,
      table.createdAt,
    ),
    index('transactions_category_id_idx').on(table.categoryId),
    index('transactions_payee_id_idx').on(table.payeeId),
    index('transactions_transfer_id_idx').on(table.transferId),
    uniqueIndex('transactions_transfer_id_side_unique').on(
      table.transferId,
      table.transferSide,
    ),
    check(
      'transactions_reconciled_cleared_check',
      sql`${table.reconciled} = 0 or ${table.cleared} = 1`,
    ),
    check('transactions_amount_nonzero_check', sql`${table.amount} <> 0`),
    check(
      'transactions_transfer_linkage_check',
      sql`(${table.transferId} is null and ${table.transferSide} is null) or (${table.transferId} is not null and ${table.transferSide} is not null)`,
    ),
    check(
      'transactions_transfer_fields_check',
      sql`${table.transferId} is null or (${table.categoryId} is null and ${table.payeeId} is null)`,
    ),
    check(
      'transactions_transfer_side_amount_check',
      sql`${table.transferSide} is null or (${table.transferSide} = 'outflow' and ${table.amount} < 0) or (${table.transferSide} = 'inflow' and ${table.amount} > 0)`,
    ),
  ],
)

export const plansRelations = relations(plans, ({ many, one }) => ({
  owner: one(user, {
    fields: [plans.ownerId],
    references: [user.id],
  }),
  accounts: many(accounts),
  categoryGroups: many(categoryGroups),
  payees: many(payees),
  transfers: many(transfers),
}))

export const payeesRelations = relations(payees, ({ many, one }) => ({
  plan: one(plans, {
    fields: [payees.planId],
    references: [plans.id],
  }),
  transactions: many(transactions),
}))

export const accountsRelations = relations(accounts, ({ many, one }) => ({
  plan: one(plans, {
    fields: [accounts.planId],
    references: [plans.id],
  }),
  transactions: many(transactions),
}))

export const categoryGroupsRelations = relations(
  categoryGroups,
  ({ many, one }) => ({
    plan: one(plans, {
      fields: [categoryGroups.planId],
      references: [plans.id],
    }),
    categories: many(categories),
  }),
)

export const categoriesRelations = relations(categories, ({ many, one }) => ({
  categoryGroup: one(categoryGroups, {
    fields: [categories.categoryGroupId],
    references: [categoryGroups.id],
  }),
  transactions: many(transactions),
  assignments: many(categoryAssignments),
}))

export const categoryAssignmentsRelations = relations(
  categoryAssignments,
  ({ one }) => ({
    category: one(categories, {
      fields: [categoryAssignments.categoryId],
      references: [categories.id],
    }),
  }),
)

export const transfersRelations = relations(transfers, ({ many, one }) => ({
  plan: one(plans, {
    fields: [transfers.planId],
    references: [plans.id],
  }),
  transactions: many(transactions),
}))

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
  payee: one(payees, {
    fields: [transactions.payeeId],
    references: [payees.id],
  }),
  transfer: one(transfers, {
    fields: [transactions.transferId],
    references: [transfers.id],
  }),
}))

// Operational retry receipts; browser history itself is never persisted.
export const actionReceipts = sqliteTable('action_receipts', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
})
