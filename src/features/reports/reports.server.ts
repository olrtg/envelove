import { and, eq, sql } from 'drizzle-orm'
import { db } from '#/db'
import { accounts, categories, categoryGroups, plans } from '#/db/schema'
import { accountTypes } from '#/features/accounts/account.schemas'
import { accountTypeDetails } from '#/features/accounts/account-types'
import {
  addMonths,
  firstDayOfMonth,
  lastDayOfMonth,
} from '#/features/plans/plan-month'
import type { PlanMonth } from '#/features/plans/plan-month'

type Range = {
  planId: string
  today: string
  from: PlanMonth
  to: PlanMonth
  excludedAccounts: string[]
}
type Spending = Range & { byGroup: boolean; excludedCategories: string[] }

export function reportOptions(planId: string, ownerId: string) {
  const plan = db
    .select({
      id: plans.id,
      countryCode: plans.countryCode,
      currencyCode: plans.currencyCode,
    })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.ownerId, ownerId)))
    .get()
  if (!plan) return null
  const options = db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.planId, planId))
    .orderBy(accounts.createdAt, accounts.id)
    .all()
  const cats = db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .innerJoin(
      categoryGroups,
      eq(categoryGroups.id, categories.categoryGroupId),
    )
    .where(
      and(eq(categoryGroups.planId, planId), eq(categories.kind, 'ordinary')),
    )
    .orderBy(
      categoryGroups.position,
      categoryGroups.createdAt,
      categories.position,
      categories.createdAt,
    )
    .all()
  cats.push({ id: 'uncategorized', name: 'Uncategorized' })
  const first = db.get<{ date: string | null }>(
    sql`select min(t.date) as date from accounts a join transactions t on t.account_id=a.id where a.plan_id=${planId}`,
  ).date
  return { plan, accounts: options, categories: cats, first }
}

function scope(ownerId: string, r: Range) {
  return sql`a.plan_id=${r.planId} and p.owner_id=${ownerId} and t.date<=min(${lastDayOfMonth(r.to)},${r.today}) and a.id not in (select value from json_each(${JSON.stringify(r.excludedAccounts)}))`
}

export function netWorth(ownerId: string, r: Range) {
  // Fold everything before the range into each account's first displayed month.
  const rows = db.all<{
    accountId: string
    period: string
    amount: number
  }>(sql`
    select a.id as accountId, max(substr(t.date,1,7), ${r.from}) as period, sum(t.amount) as amount
    from transactions t join accounts a on a.id=t.account_id join plans p on p.id=a.plan_id
    where ${scope(ownerId, r)} group by a.id, period order by period`)
  const balances = new Map<string, number>()
  const points = []
  let index = 0
  for (let month = r.from; month <= r.to; month = addMonths(month, 1)) {
    while (index < rows.length && rows[index].period === month) {
      const row = rows[index++]
      balances.set(
        row.accountId,
        (balances.get(row.accountId) ?? 0) + row.amount,
      )
    }
    let assets = 0,
      debts = 0
    for (const balance of balances.values()) {
      if (balance < 0) debts -= balance
      else assets += balance
    }
    points.push({ month, assets, debts, net: assets - debts })
    if (month === r.to) break
  }
  return points
}

const eligible = accountTypes.filter((type) =>
  ['cash', 'credit'].includes(accountTypeDetails[type].group),
)
const categoryId = sql`coalesce(c.id,'uncategorized')`
function bucket(byGroup: boolean) {
  return byGroup ? sql`coalesce(g.id,'uncategorized')` : categoryId
}

// Both the totals and the drilldown use the same eligibility rules. Excluding
// an account from the view does not turn a budget-to-budget transfer into spending.
function spendingSource(ownerId: string, r: Spending) {
  return sql`from transactions t join accounts a on a.id=t.account_id join plans p on p.id=a.plan_id
    left join categories c on c.id=t.category_id
    left join category_groups g on g.id=c.category_group_id and g.plan_id=a.plan_id
    where ${scope(ownerId, r)} and t.date>=${firstDayOfMonth(r.from)} and not t.starting_balance
    and a.type in ${eligible} and (t.transfer_id is null or exists (
      select 1 from transactions other join accounts oa on oa.id=other.account_id
      where other.transfer_id=t.transfer_id and other.id!=t.id and oa.plan_id=a.plan_id and oa.type not in ${eligible}))
    and ((c.kind='ordinary' and g.id is not null) or (t.category_id is null and t.amount<0))
    and ${categoryId} not in (select value from json_each(${JSON.stringify(r.excludedCategories)}))`
}

export function spendingTotals(ownerId: string, r: Spending) {
  return db
    .all<{ id: string; name: string; value: number; count: number }>(
      sql`
    select ${bucket(r.byGroup)} as id, coalesce(${r.byGroup ? sql`g.name` : sql`c.name`},'Uncategorized') as name, -sum(t.amount) as value, count(*) as count
    ${spendingSource(ownerId, r)} group by ${bucket(r.byGroup)}`,
    )
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

export function spendingRows(
  ownerId: string,
  r: Spending & { bucketId: string },
) {
  return db.all<{
    id: string
    accountId: string
    date: string
    memo: string | null
    payeeName: string | null
    amount: number
  }>(sql`
    select t.id, t.account_id as accountId, t.date, t.memo, t.amount,
      (select name from payees where id=t.payee_id and plan_id=a.plan_id) as payeeName
    ${spendingSource(ownerId, r)} and ${bucket(r.byGroup)}=${r.bucketId}
    order by t.date desc,t.created_at desc,coalesce(t.transfer_id,t.id) desc,t.id desc`)
}
