# Ready to Assign

## Goal

Show a user how much money in a Plan Month still needs a job, and why that
amount is what it is, so they can assign it until every dollar has a job.

## Inflow: Ready to Assign Category

- Income reaches Ready to Assign through an Internal Category named Ready to
  Assign in an Internal Category Group named Inflow, as in YNAB.
- The group kind is `inflow` and the Category kind is `ready_to_assign`. Each
  Plan has exactly one of each, enforced by partial unique indexes.
- Creating a Plan creates both in the same database transaction. Migration
  `0010` backfills them for existing Plans with the ids `inflow_<planId>` and
  `ready_to_assign_<planId>`.
- Transactions on any Account may use it, as an inflow or an outflow.
  Transfers still have no Category.
- It never appears in the Plan grid. It cannot be renamed, hidden, moved,
  deleted, given Assigned money, or chosen as a deletion reassignment target.
  The server rejects each of these, not only the UI.
- Its Transactions are not Activity. They never reach Category Activity, a
  group's sums, or the Activity popover.

## Formula

For each Plan Month `m`, with `R` zero before any money:

```text
R(m) = R(m − 1) + Inflow(m) + Debt Account Inflow(m)
       − Cash Overspending(m − 1) − Assigned(m)
```

- Inflow is the signed sum of Inflow: Ready to Assign Transactions dated in
  `m`, up to the Current Day. An outflow lowers Ready to Assign. On a Credit
  Account in debt an inflow only repays debt; just the part that takes the
  balance above zero counts. See
  [Credit Payment Categories](./credit-payment-categories.md#budgeting).
- Debt Account Inflow is the part of each Credit Payment in `m` that takes the
  card's balance above zero.
- Cash Overspending is the sum of every Category's Cash Overspending in that
  month, from [Assigned and Available](./assigned-and-available.md), hidden
  and Credit Payment Categories included. It lowers the next month only. A
  Credit Payment Category made negative by an overpayment counts, so the
  overpayment's Debt Account Inflow is taken back the next month.
- Credit Overspending never lowers Ready to Assign.
- Assigned is the sum over every Category, hidden and Credit Payment
  Categories included.

The month shows:

```text
Assigned in Future = min(max(R(M), 0), max(Assigned after M, 0))
Ready to Assign    = R(M) − Assigned in Future
```

- Later months' assignments can take an earlier month down to zero, never
  below. A negative `R(M)` stays as it is.
- "Left over from the previous month" is `R(M − 1)`. Later assignments do not
  reduce it.
- Example from YNAB: September leaves 4,100,000. October adds 100,000 and
  assigns 110,000 with 15,000 Cash Overspending. November assigns 50,000.
  September shows 3,940,000, October 4,040,000, and November 4,025,000.

## Computation

- `budgetReadyToAssign()` in `budget-engine.ts` applies the formula to
  per-month totals and returns each breakdown line, the total, and the later
  months with their Assigned totals.
- `budgetPlanMonth()` budgets every Category through the month and builds
  those totals, so the Plan read gets Categories and Ready to Assign from one
  engine call.
- The Plan read groups Transactions on Accounts that are not Credit Accounts
  by Category and month, and flags the Ready to Assign Category's rows, which
  become inflows instead of Category inputs. Credit Account Transactions come
  one by one, oldest first, because their effect depends on the card balance.
  The Assigned query reads every month, since later months matter.
- `getCategoryHierarchy` returns `{ groups, readyToAssign }`.

## Header

- A box beside the month navigation shows the amount and a label.
  - Positive: green, "Ready to Assign".
  - Zero: beige with muted text, "All Money Assigned".
  - Negative: red, "You assigned more than you have".
- After an Assigned edit, the workspace refetches amounts in place, as it
  already did, and takes the new Ready to Assign from the same response.

### Header actions

The first
[money-move slice](./assigned-and-available.md#money-moves-and-covering-overspending)
includes these actions:

- Positive Ready to Assign: **Assign** opens the manual assignment form,
  prefilled with Ready to Assign, with a visible destination Category picker.
  An explicit amount may exceed Ready to Assign, making the header negative.
- Negative Ready to Assign: **Fix This** opens "Un-assign money from" with
  a visible source Category picker and no editable amount. It unassigns the
  smaller of the shortfall and the source's positive Available in the selected
  month; partial fixes are allowed.
- Zero: neither action appears.
- The amount and label retain the existing breakdown action separately from
  these buttons. Assign opens directly into manual entry; no inactive Auto
  tab is shown while auto-assign is deferred.

## Breakdown

Clicking the box opens "Ready to Assign Breakdown":

```text
(+)                                                    +4,200,000
Ready to Assign left over from September               +4,100,000
Inflow: Ready to Assign transactions in October          +100,000
Inflow from Debt Account                                 (when non-zero)
(−)                                                      −160,000
Cash overspending in September
Assigned in October                                      −110,000
Assigned in Future                                        −50,000
Total Ready to Assign                                = +4,040,000
Give these dollars a job by assigning them to one or more categories!
```

- Lines that are zero are left out, and so is a section with no lines.
- Months use full English names. Amounts carry `+` or `−`.
- The closing message follows the state. Zero: "Nice work! Every dollar has a
  job." Negative: "You have assigned more than you have."

## Category picker

- The register's Category picker lists "Inflow" with "Ready to Assign" first,
  for outflows too.
- The item shows the current month's Ready to Assign on the right, green when
  positive and red when negative. The picker reads it when a draft row opens.
- Once chosen, the field and the saved row read "Inflow: Ready to Assign".
- A Payee whose last Transaction used Ready to Assign prefills it.

## Deferred

- Auto-assign and the month summary with "Assigned in Future Months" remain
  outside that slice.
- YNAB's "Learn how to fix this" link after the negative message.
