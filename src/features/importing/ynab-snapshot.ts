import { z } from 'zod'
import { accountTypeDetails } from '#/features/accounts/account-types'
import { accountTypeSchema } from '#/features/accounts/account.schemas'
import { targetSchema } from '#/features/categories/category-target'
import { getPayeeNameKey } from '#/features/payees/payee.schemas'
import { amountMatchesCurrency } from '#/features/transactions/transaction-money'
import { transactionDateSchema } from '#/features/transactions/transaction.schemas'
import { currencyCodes } from '#/lib/country-profiles'
import { createId } from '#/lib/id'
import type * as tables from '#/db/schema'
import { maxImportRows } from './ynab-limits'

// Full GET /plans/{id} response, never a delta. Keep YNAB's integer milliunits.
const id = z.string().min(1).max(4096)
const name = z.string().min(1).max(512)
const named = z.object({ id, name, deleted: z.boolean() })
const number = z.number().int().safe()
const optionalText = z.string().max(4096).nullish()
const optionalNumber = number.nullish()
const category = named.extend({
  category_group_id: id,
  original_category_group_id: optionalText,
  hidden: z.boolean(),
  goal_type: optionalText,
  goal_creation_month: optionalText,
  goal_target_date: optionalText,
  goal_target_month: optionalText,
  goal_day: optionalNumber,
  goal_cadence: optionalNumber,
  goal_cadence_frequency: optionalNumber,
  goal_needs_whole_amount: z.boolean().nullish(),
  goal_target: optionalNumber,
})
const line = z.object({
  id,
  deleted: z.boolean(),
  amount: number,
  memo: optionalText,
  payee_id: optionalText,
  category_id: optionalText,
  transfer_account_id: optionalText,
  transfer_transaction_id: optionalText,
})
const snapshot = z.object({
  name,
  currency_format: z.object({ iso_code: z.enum(currencyCodes) }),
  first_month: transactionDateSchema,
  accounts: z
    .array(
      named.extend({
        type: id,
        closed: z.boolean(),
        balance: number,
        cleared_balance: number,
        last_reconciled_at: z.iso.datetime({ offset: true }).nullish(),
      }),
    )
    .max(512),
  payees: z.array(named.extend({ transfer_account_id: optionalText })),
  category_groups: z
    .array(
      named.extend({ hidden: z.boolean(), internal: z.boolean().optional() }),
    )
    .max(4096),
  categories: z.array(category).max(4096),
  months: z.array(
    z.object({
      month: transactionDateSchema,
      deleted: z.boolean(),
      categories: z.array(
        z.object({
          id,
          budgeted: number,
          deleted: z.boolean(),
          goal_snoozed_at: optionalText,
        }),
      ),
    }),
  ),
  transactions: z.array(
    line.extend({
      account_id: id,
      date: transactionDateSchema,
      cleared: z.enum(['cleared', 'uncleared', 'reconciled']),
    }),
  ),
  subtransactions: z.array(line.extend({ transaction_id: id })),
  scheduled_transactions: z.array(z.object({ deleted: z.boolean() })),
})

function readTarget(c: z.infer<typeof category>) {
  const type = c.goal_type
  if (!type) return null
  if (!c.goal_target || c.goal_target < 0) return 'No positive target amount.'
  if (!c.goal_creation_month) return 'No target creation month.'
  const due = c.goal_target_date ?? c.goal_target_month ?? null
  const cadence = c.goal_cadence ?? 0,
    frequency = c.goal_cadence_frequency ?? 1
  const monthly = type === 'MF' || (cadence === 1 && frequency === 1)
  const weekly = cadence === 2 && frequency === 1
  const balance = type === 'TB' || type === 'TBD'
  const fixedPayment = type === 'MF' || (type === 'DEBT' && monthly)
  if (!balance && !fixedPayment && type !== 'NEED')
    return `Unsupported target type or schedule (${type}).`
  if (type === 'NEED' && c.goal_needs_whole_amount == null)
    return 'Missing target rollover behavior.'
  if ((cadence === 2 && !weekly) || cadence < 0 || cadence > 14)
    return 'Unsupported repeat interval.'
  const repeat =
    cadence === 13
      ? 12 * frequency
      : cadence === 14
        ? 24
        : cadence >= 3
          ? cadence - 1
          : cadence === 1
            ? frequency
            : 0
  const simple = !balance && (monthly || weekly)
  if (!simple && !due && type !== 'TB') return 'Missing target due date.'
  const result = targetSchema.safeParse({
    amount: c.goal_target,
    start: c.goal_creation_month,
    behavior: balance
      ? 'Have a balance of'
      : fixedPayment || c.goal_needs_whole_amount
        ? 'Set aside'
        : 'Fill up to',
    frequency: balance
      ? 'Custom'
      : monthly
        ? 'Monthly'
        : weekly
          ? 'Weekly'
          : repeat === 12
            ? 'Yearly'
            : 'Custom',
    day: c.goal_day ?? 0,
    due: simple ? null : due,
    repeatMonths: balance || simple ? 0 : repeat,
  })
  return result.success ? result.data : 'Invalid target date or schedule.'
}

function groupKind(g: { name: string; internal?: boolean }) {
  if (g.name === 'Hidden Categories') return 'hidden'
  if (g.name === 'Credit Card Payments') return 'payments'
  if (g.internal || g.name === 'Internal Master Category') return 'internal'
  return 'ordinary'
}

function owningGroupId(c: z.infer<typeof category>) {
  return c.original_category_group_id || c.category_group_id
}

function active<T extends { deleted: boolean }>(rows: T[]) {
  return rows.filter((row) => !row.deleted)
}
function lookup<T>(map: Map<string, T>, key: string) {
  if (!map.has(key))
    throw new Error(
      'A linked record is missing. Download the full plan without last_knowledge_of_server.',
    )
  return map.get(key) as T
}
function remap<T extends { id: string }>(rows: T[]) {
  const ids = new Map(rows.map((row) => [row.id, createId()]))
  if (ids.size !== rows.length)
    throw new Error('The snapshot contains duplicate record IDs.')
  return ids
}

export function prepareYnabSnapshot(content: string) {
  let envelope
  try {
    envelope = JSON.parse(content.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(
      'Choose the JSON response from Get a Plan or the original Export Plan ZIP.',
    )
  }
  const data = envelope?.data ?? envelope
  const plan = data?.plan ?? data?.budget
  // Count before validating individual rows. Deleted records and nested
  // monthly assignments cost just as much to parse as live transactions.
  let rows = 0
  function count(value: unknown) {
    if (Array.isArray(value)) rows += value.length
    if (rows > maxImportRows)
      throw new Error('This plan exceeds the 150,000-row import limit.')
  }
  for (const key of Object.keys(snapshot.shape)) count(plan?.[key])
  if (Array.isArray(plan?.months))
    for (const month of plan.months) count(month?.categories)
  const parsed = snapshot.safeParse(plan)
  if (!parsed.success)
    throw new Error(
      `Not a supported full plan snapshot. Check ${parsed.error.issues[0].path.join('.') || 'the file format'}: ${parsed.error.issues[0].message}`,
    )
  const p = parsed.data,
    planId = createId(),
    warnings: string[] = []
  const accountRows = active(p.accounts),
    accountIds = remap(accountRows)
  const accountNames = new Map(accountRows.map((a) => [a.id, a.name]))
  const accounts = accountRows.map((a) => {
    const type = accountTypeSchema.safeParse(
      a.type
        .replace(/^otherAsset$/, 'asset')
        .replace(/^otherLiability$/, 'liability')
        .replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`),
    )
    if (!type.success) throw new Error(`Unsupported account type: ${a.type}.`)
    return {
      id: lookup(accountIds, a.id),
      planId,
      name: a.name,
      type: type.data,
      closed: a.closed,
      lastReconciledAt: a.last_reconciled_at
        ? new Date(a.last_reconciled_at)
        : null,
    }
  })
  const payeeRows = active(p.payees).filter((row) => !row.transfer_account_id),
    payeeIds = remap(payeeRows)
  const adjustmentPayee = payeeRows.find(
    (row) => row.name === 'Reconciliation Balance Adjustment',
  )?.id
  const openingPayee = payeeRows.find(
    (row) => row.name === 'Starting Balance',
  )?.id
  const payees = new Map<string, typeof tables.payees.$inferInsert>()
  for (const row of payeeRows) {
    const nameKey = getPayeeNameKey(row.name),
      existing = payees.get(nameKey)
    if (existing) payeeIds.set(row.id, existing.id!)
    else
      payees.set(nameKey, {
        id: lookup(payeeIds, row.id),
        planId,
        name: row.name,
        nameKey,
      })
  }
  if (payees.size < payeeRows.length)
    warnings.push('Payees with equivalent names were combined.')
  const groups: (typeof tables.categoryGroups.$inferInsert)[] = [],
    categories: (typeof tables.categories.$inferInsert)[] = []
  const inflowGroup = createId(),
    inflow = createId()
  groups.push({
    id: inflowGroup,
    planId,
    name: 'Inflow',
    kind: 'inflow',
    position: 0,
  })
  categories.push({
    id: inflow,
    categoryGroupId: inflowGroup,
    name: 'Ready to Assign',
    kind: 'ready_to_assign',
    position: 0,
  })
  const groupRows = active(p.category_groups),
    groupIds = remap(groupRows),
    groupById = new Map(groupRows.map((g) => [g.id, g]))
  const catRows = active(p.categories),
    catIds = remap(catRows),
    ignored = new Set<string>()
  const cards = accounts.filter(
    (a) => accountTypeDetails[a.type].group === 'credit',
  )
  const paymentFor = new Map<string, string>()
  const paymentGroup = createId(),
    paymentIds = new Map(cards.map((a) => [a.id, createId()]))
  if (cards.length)
    groups.push({
      id: paymentGroup,
      planId,
      name: 'Credit Card Payments',
      kind: 'credit_card_payments',
      position: 1,
    })
  for (const a of cards)
    categories.push({
      id: lookup(paymentIds, a.id),
      categoryGroupId: paymentGroup,
      name: a.name,
      kind: 'credit_payment',
      creditAccountId: a.id,
      position: categories.length,
    })
  const owningGroups = new Set(catRows.map(owningGroupId))
  for (const g of groupRows) {
    const kind = groupKind(g)
    let groupName = g.name
    if (kind === 'hidden' && owningGroups.has(g.id)) {
      // Native exports can name the hidden bucket without identifying a real group.
      groupName = 'Imported categories'
      warnings.push(
        `Hidden categories without an original group were kept under “${groupName}”.`,
      )
    } else if (kind !== 'ordinary') continue
    groups.push({
      id: lookup(groupIds, g.id),
      planId,
      name: groupName,
      position: groups.length,
    })
  }
  let targets = 0
  for (const c of catRows) {
    const group = lookup(groupById, owningGroupId(c))
    const kind = groupKind(group)
    if (kind === 'payments') {
      const matches = cards.filter((a) => a.name === c.name)
      if (matches.length !== 1)
        throw new Error(
          `Cannot identify the account for credit payment category “${c.name}”.`,
        )
      catIds.set(c.id, lookup(paymentIds, matches[0].id))
      paymentFor.set(c.id, matches[0].id)
      if (c.goal_type)
        warnings.push(
          `Target skipped — ${group.name}: ${c.name}. Credit card payment targets are not supported.`,
        )
    } else if (kind === 'internal') {
      if (c.goal_type)
        warnings.push(
          `Target skipped — ${group.name}: ${c.name}. Internal categories cannot have targets.`,
        )
      if (/^(?:Inflow: )?(?:Ready to Assign|To Be Budgeted)$/i.test(c.name))
        catIds.set(c.id, inflow)
      else {
        ignored.add(c.id)
        if (c.name !== 'Uncategorized' && !c.name.startsWith('Split'))
          warnings.push(
            `Internal category skipped: ${c.name}. Its register lines remain uncategorized.`,
          )
      }
    } else {
      const result = readTarget(c)
      const target = typeof result === 'string' ? null : result
      if (typeof result === 'string')
        warnings.push(`Target skipped — ${group.name}: ${c.name}. ${result}`)
      if (target) {
        targets++
        if (c.goal_type === 'DEBT')
          warnings.push(
            `${group.name}: ${c.name} imports as a monthly Set aside target. Loan pairing and payoff calculations are not imported.`,
          )
      }
      categories.push({
        id: lookup(catIds, c.id),
        categoryGroupId: lookup(groupIds, group.id),
        name: c.name,
        position: categories.length,
        hidden:
          c.hidden ||
          group.hidden ||
          kind === 'hidden' ||
          groupById.get(c.category_group_id)?.name === 'Hidden Categories',
        target,
      })
    }
  }
  const assignments: (typeof tables.categoryAssignments.$inferInsert)[] = []
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  for (const m of active(p.months))
    for (const c of active(m.categories)) {
      if ((!c.budgeted && !c.goal_snoozed_at) || ignored.has(c.id)) continue
      const categoryId = lookup(catIds, c.id),
        month = m.month.slice(0, 7)
      if (categoryId === inflow) continue
      if (c.budgeted)
        assignments.push({ categoryId, month, amount: c.budgeted })
      const cat = categoryById.get(categoryId)
      if (cat?.target && c.goal_snoozed_at)
        (cat.snoozedMonths ??= []).push(month)
    }
  const parents = active(p.transactions),
    splitLines = active(p.subtransactions)
  const children = new Map<string, typeof splitLines>()
  for (const part of splitLines) {
    const siblings = children.get(part.transaction_id)
    if (siblings) siblings.push(part)
    else children.set(part.transaction_id, [part])
  }
  const lines = parents.flatMap((t) => {
    const parts = children.get(t.id)
    if (!parts) return [t]
    if (parts.reduce((sum, s) => sum + s.amount, 0) !== t.amount)
      throw new Error(
        'Split amounts do not equal their parent. Import stopped.',
      )
    children.delete(t.id)
    return parts.map((s) => ({
      ...t,
      ...s,
      memo: [t.memo, s.memo].filter(Boolean).join(' · '),
      payee_id: s.payee_id || t.payee_id,
    }))
  })
  if (children.size)
    throw new Error('A split is missing its parent. Download a full plan.')
  if (splitLines.length)
    warnings.push(
      'Split transactions become separate register entries, one per line. The parent amount is not counted again.',
    )
  const lineIds = remap(lines),
    lineById = new Map(lines.map((l) => [l.id, l]))
  const transferIds = new Map<string, string>(),
    totals = new Map<string, { all: number; cleared: number }>()
  const onBudget = new Set(
    accounts
      .filter((a) =>
        ['cash', 'credit'].includes(accountTypeDetails[a.type].group),
      )
      .map((a) => a.id),
  )
  const transactions: (typeof tables.transactions.$inferInsert)[] = []
  let unlinked = 0,
    zero = 0
  for (const l of lines) {
    if (!l.amount) {
      zero++
      continue
    }
    const accountId = lookup(accountIds, l.account_id),
      cleared = l.cleared !== 'uncleared'
    const total = totals.get(accountId) ?? { all: 0, cleared: 0 }
    total.all += l.amount
    if (cleared) total.cleared += l.amount
    totals.set(accountId, total)
    const other = l.transfer_transaction_id
      ? lineById.get(l.transfer_transaction_id)
      : undefined
    let transferId: string | undefined
    if (
      l.transfer_account_id &&
      other &&
      other.account_id !== l.account_id &&
      other.transfer_transaction_id === l.id &&
      other.account_id === l.transfer_account_id &&
      other.transfer_account_id === l.account_id &&
      l.amount === -other.amount &&
      l.date === other.date &&
      (!l.category_id ||
        paymentFor.get(l.category_id) === accountIds.get(other.account_id)) &&
      (!other.category_id || paymentFor.get(other.category_id) === accountId)
    ) {
      transferId = transferIds.get(other.id) ?? createId()
      transferIds.set(l.id, transferId)
    } else if (l.transfer_account_id) unlinked++
    const categoryId =
      !transferId && l.category_id && !ignored.has(l.category_id)
        ? lookup(catIds, l.category_id)
        : null
    const payeeId =
      !l.transfer_account_id && l.payee_id ? lookup(payeeIds, l.payee_id) : null
    const startingBalance = payeeId != null && l.payee_id === openingPayee
    transactions.push({
      id: lookup(lineIds, l.id),
      accountId,
      date: l.date,
      amount: l.amount,
      cleared,
      reconciled: l.cleared === 'reconciled',
      categoryId: startingBalance
        ? onBudget.has(accountId)
          ? inflow
          : null
        : categoryId,
      payeeId,
      transferId,
      transferSide: transferId ? (l.amount < 0 ? 'outflow' : 'inflow') : null,
      memo:
        !transferId && l.transfer_account_id
          ? [l.memo, `Transfer: ${lookup(accountNames, l.transfer_account_id)}`]
              .filter(Boolean)
              .join(' · ')
          : l.memo,
      reconciliationAdjustment:
        payeeId != null && l.payee_id === adjustmentPayee,
      startingBalance,
    })
  }
  for (const a of accountRows) {
    const total = totals.get(lookup(accountIds, a.id))
    if (
      (total?.all ?? 0) !== a.balance ||
      (total?.cleared ?? 0) !== a.cleared_balance
    )
      throw new Error(
        `The register does not match the exported balance for “${a.name}”. Download a full, current snapshot. Nothing was imported.`,
      )
  }
  if (unlinked)
    warnings.push(
      `${unlinked} transfer lines kept as separate entries to preserve categories or because no exact reciprocal link was available.`,
    )
  if (zero) warnings.push(`${zero} zero-amount register entries skipped.`)
  const scheduled = active(p.scheduled_transactions).length
  if (scheduled) warnings.push(`Scheduled transactions skipped: ${scheduled}.`)
  const transfers = [...new Set(transferIds.values())].map((transferId) => ({
    id: transferId,
    planId,
  }))
  const currency = p.currency_format.iso_code
  if (
    transactions.some((t) => !amountMatchesCurrency(t.amount, currency)) ||
    assignments.some((a) => !amountMatchesCurrency(a.amount, currency)) ||
    categories.some(
      (c) => c.target && !amountMatchesCurrency(c.target.amount, currency),
    )
  )
    throw new Error(
      `This plan contains amounts more precise than Envelove supports for ${currency}. Nothing was rounded or imported.`,
    )
  const summary = {
    name: p.name,
    currency,
    accounts: accounts.length,
    payees: payees.size,
    categories: categories.length - 1,
    transactions: transactions.length,
    transfers: transfers.length,
    assignments: assignments.length,
    targets,
    warnings,
  }
  return {
    planId,
    firstMonth: p.first_month,
    summary,
    accounts,
    payees: [...payees.values()],
    groups,
    categories,
    assignments,
    transfers,
    transactions,
  }
}
