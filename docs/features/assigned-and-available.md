# Assigned and Available

## Goal

Let a user give money a job in each Plan Month and see, for every Category,
how much of it is left, so overspending shows up before it becomes a surprise.

## Assigned

- Assigned is the money a user puts in one Category for one Plan Month. It is
  stored per Category and month in `category_assignments`, in milliunits.
- Assigned may be zero or negative. A negative amount takes money out of the
  Category.
- Hidden Categories and Credit Payment Categories accept Assigned. The
  Inflow: Ready to Assign Category does not; see
  [Ready to Assign](./ready-to-assign.md).
- Setting Assigned back to zero keeps the stored row. Zero alone never creates
  a row.
- Amounts must match the Plan currency precision, as Transaction Amounts do.
- A Category Group's Assigned is the sum of its visible Categories' Assigned.

## Available

For each Category and month:

```text
Available = Carryover + Assigned + Activity
Carryover = max(0, previous month's Available)
```

- Positive Available carries into the next month. Negative Available resets to
  zero in the next month.
- Activity is split by whether it changed card debt. Credit Activity is the
  part of the Category's Credit Account Transactions that created or repaid
  debt, per card. Cash Activity is the rest: Transactions on other Accounts,
  and card spending from a positive balance. See
  [Credit Payment Categories](./credit-payment-categories.md#budgeting). Both
  follow the Activity rules in [Plan Months](./plan-months.md).
- Within a month, cash spending uses Available first, whatever the Transaction
  dates. Credit spending is funded from what remains:

  ```text
  afterCash      = Carryover + Assigned + Cash Activity
  creditSpending = max(0, -Credit Activity)
  funded         = clamp(afterCash, 0, creditSpending)
  Cash Overspending   = max(0, -afterCash)
  Credit Overspending = creditSpending - funded
  ```

  A net credit refund counts toward `afterCash`.

- Examples: Assigned 10, cash −25, credit −15 gives Available −30 with 15 Cash
  Overspending. Assigned 30, cash −25, credit −15 gives Available −10 with 10
  Credit Overspending.
- A Category Group's Available is the sum of its visible Categories' Available.
- The funded amount moves to the Credit Payment Category of the card it was
  spent on.
- Credit Payment Categories use the same formula. Their Activity is funded
  spending minus Credit Payments.

## Computation

- `budget-engine.ts` is pure. `budgetCategoryMonth()` budgets one month from a
  Carryover and the month's inputs; `budgetCategoryMonths()` folds consecutive
  months, oldest first.
- The Plan read loads the inputs with one query over Transactions on Accounts
  that are not Credit Accounts, grouped by Category and month, one ordered
  query over Credit Account Transactions, and one query over Assigned amounts.
  It budgets each Category from its first month with data through the
  selected month.
- Each Category carries a `status`: `positive`, `zero`, `cash_overspent`, or
  `credit_overspent`. Cash Overspending wins when both kinds exist. Credit
  Payment Categories also use `payment_underfunded` and `payment_overspent`.
- Nothing is stored except Assigned.

## Assigned cell

- The cell is always an input. Focusing it shows the editable amount, selected.
- It accepts math with `+`, `-`, `*`, `/`, `x`, and parentheses. Numbers use the
  Plan locale.
- A leading `+` adds to the current amount: `+5000` turns 30,000 into 35,000.
  A leading `-` sets a negative amount.
- An empty cell means zero. Text that is not an amount reverts.
- **Enter** saves. A plain number then leaves the cell. An expression stays
  focused and shows its result; a second **Enter** leaves.
- **Escape** reverts and leaves.
- **Tab** saves and moves to the next focusable element.
- **Arrow Up** and **Arrow Down** save and move to the previous or next
  Category's Assigned, across Category Groups. Hidden Categories move among
  themselves.
- The edited row updates at once with the engine. Then the workspace refetches
  the amounts and the month range in place. The route key leaves amounts out,
  so a save never remounts the workspace or moves focus. A refresh that a
  newer edit has overtaken is dropped.
- A save also changes other months, such as their Available or Assigned in
  Future. The workspace never takes reloaded route data, so the route keeps
  no cache of months the user has left (`gcTime: 0`), and a save, a
  Category deletion, or a visibility change drops every cached month,
  including months a link preloaded. The open month is the active match, so
  dropping the cache never remounts it.
- A Category Group's Assigned is read-only.

## Available pills

- Positive: green. Zero: beige with muted text. Cash Overspending: red.
  Credit Overspending: yellow with a card icon.
- Cash Overspending tooltip: "A green category is a happy category. Make this
  category happy by adding funds from surplus categories."
- Credit Overspending tooltip: "You've overspent this category by −$15.00 with
  credit. Cover this overspending to avoid creating debt!"
- A Category Group's Available is bold text, not a pill.

## Money moves and covering overspending

Money moves, coverage, and the Ready to Assign header actions are implemented.
Amount rules match the YNAB web app, verified in a sandbox Plan on November 6, 2026.

### Agreed behavior

- Clicking a positive Available opens **Move Money**: enter an amount and
  choose a destination Category in the selected month. The amount may exceed
  the source's Available; there is no extra warning or confirmation for doing so.
- Clicking a negative Available opens **Cover Overspending**: choose a source
  in the selected month or a later month. There is no editable amount in this
  flow. Within the selected month, move the smaller of the destination's
  shortfall and the source's positive Available, leaving any remaining
  shortfall visible. Later-month sources use Assigned instead, as below.
- Between Categories, both operations reduce the source's Assigned and
  increase the destination's Assigned by the same amount. A move involving
  Ready to Assign changes only the other Category's Assigned. Neither creates
  Account Transactions or assigns money to the internal inflow Category.
- Moving between Categories in the same month leaves that month's total
  Assigned and Ready to Assign unchanged, even if the source becomes
  overspent. Later months still reflect the existing Carryover and Cash
  Overspending rules.
- Credit Payment Categories can be sources: the verified Cover Overspending
  case used money reserved for a card payment.

The observed example moved Gs350,000 from Annual Services, which had Gs300,000
Available, to Audit Subscription, which had Gs100,000 Available. Their
Available became −Gs50,000 and Gs450,000 respectively. Covering the shortfall
from a Credit Payment Category with Gs40,000 moved only Gs40,000, leaving
−Gs10,000 in Annual Services and zero in the payment Category. Ready to Assign
remained Gs3,965,000 throughout. Both operations were undone and the original
amounts verified afterward.

### Covering from future months

- This first slice includes future-month coverage, matching YNAB. When later
  months have eligible assignments, the Cover Overspending popover offers a
  source-month selector. Each opening defaults to the displayed Plan Month.
- For a later source month, offer Categories with positive Assigned in that
  month and display that Assigned amount, not Available. Carryover-only
  Categories are excluded. Ready to Assign is not a future-month source.
- Move the smaller of the destination's current shortfall and the source's
  positive Assigned in the chosen month. Decrease that future assignment and
  increase Assigned in the destination month by the same amount.
- The same Category can be both source and destination when the months differ.
  The source and destination are Category-and-month pairs, not just Categories.
- After a source's Assigned reaches zero, it disappears from that future
  month's source list even if it still has positive Available from Carryover.
- Recompute both months and dependent months. Do not assume later Ready to
  Assign stays unchanged: covering Cash Overspending also reduces the
  shortfall carried into the following month.

Verified cases in the YNAB sandbox on November 6, 2026:

1. November Groceries had −Gs80,000 Available. December Annual Services had
   Gs30,000 Assigned and Gs330,000 Available; the picker offered Gs30,000.
   December Audit Subscription had zero Assigned and Gs100,000 Available;
   it was absent. December Vacation had Gs200,000 Assigned and Gs250,000
   Available; the picker offered Gs200,000.
2. Covering from December Annual Services moved Gs30,000, leaving November
   Groceries at −Gs50,000 and December Annual Services at zero Assigned.
   Annual Services then disappeared from the December source list.
3. Covering the remaining Gs50,000 from December Vacation left November
   Groceries at zero and December Vacation with Gs150,000 Assigned and
   Gs200,000 Available. November Ready to Assign stayed Gs3,815,000 across
   the two covers; December Ready to Assign rose from Gs3,735,000 to
   Gs3,815,000 as the November Cash Overspending was covered.
4. In a separate case, November Groceries at −Gs10,000 could be covered from
   December Groceries with Gs20,000 Assigned. November ended at zero and
   December retained Gs10,000 Assigned.

These fixtures used Assigned edits, not new Account Transactions. All eight
setup and coverage operations were undone; both months' original amounts
were checked, and the app was returned to November.

### Ready to Assign

Verified in the YNAB web sandbox on November 6, 2026:

- Ready to Assign is a same-month destination in Move Money. Returning
  Gs50,000 from a Category with Gs300,000 Carryover and zero Assigned made
  its Assigned −Gs50,000 and Available Gs250,000; Ready to Assign rose from
  Gs3,965,000 to Gs4,015,000. Returned money is not limited to this month's
  positive Assigned.
- Ready to Assign is a source in same-month Cover Overspending when it has
  a positive balance. With Gs40,000 Ready to Assign and a Category at
  −Gs80,000, covering moved Gs40,000, leaving Ready to Assign at zero and
  the Category at −Gs40,000. Ready to Assign then disappeared from the
  source picker. It is not offered for future source months.
- The positive Ready to Assign header has **Assign**, with **Auto** and
  **Manually** tabs. The manual tab prefills the full Ready to Assign amount
  and allows choosing a destination and an explicit amount greater than that
  balance. Assigning Gs4,005,000 when Ready to Assign was Gs3,965,000 succeeded
  without an extra warning and produced −Gs40,000 with the header label
  "You assigned more than you have".
- The negative header has **Fix This**, opening "Un-assign money from" with
  a source picker and no editable amount. Choosing a Category with Gs100,000
  Available to fix −Gs40,000 Ready to Assign removed Gs40,000 from its
  Assigned, left Gs60,000 Available, and restored Ready to Assign to zero.
  The zero header read "All Money Assigned" with no Assign or Fix This button.

The Money Move and Cover Overspending pickers match these endpoint
rules. The first slice includes the header's Assign and Fix This entry
points. Assign opens the manual form directly, without an Auto tab or other
placeholder controls; auto-assign remains deferred. The amount and label
continue to open the existing Ready to Assign breakdown independently of
these actions.

### Hidden Categories

Verified in the same sandbox session:

- Hidden Categories are absent from Move Money destination pickers and
  Cover Overspending source pickers. This includes positive Available in the
  displayed month and positive Assigned in a later source month.
- Hiding Annual Services with Gs300,000 Available in November and Gs30,000
  Assigned in December removed it from both pickers. When it was the only
  future-funded source, the source-month selector disappeared; unhiding it
  restored the selector. With an additional visible December assignment,
  the December picker offered only that visible Category.
- The Hidden Categories control opens "Click to unhide a category", listing
  names under their original groups. It offers unhiding, not an Available
  pill or a money-move action. Hiding an overspent Category did not expose a
  separate coverage action there.

For these new money-move interactions, users must show a Hidden Category
before using it as a source or destination. This replaces the initial
proposal to include a separate Hidden section in the pickers; it does not
change the existing direct Assigned editor for Hidden Categories.

All Ready to Assign edits, visibility changes, and fixture assignments were
undone. November and December amounts and the original Category visibility
were verified afterward; no Account Transactions were created.

### Credit Payment Categories

Payment Available follows the same amount-based entry points: positive opens
Move Money, zero has no action, and negative opens Cover Overspending. Yellow
underfunding alone is not overspending and does not change those entry points.
Coverage targets zero Available, not the full Account debt. See the verified
[payment entry-point rules and cases](./credit-payment-categories.md#money-move-entry-points).

### First implementation scope

- Same-month Move Money, including moves to Ready to Assign.
- Cover Overspending from current-month Available or Ready to Assign, or
  future-month Assigned, including partial coverage and same-Category moves
  across months.
- Ready to Assign header actions: manual Assign when positive, Fix This when
  negative, and neither action when zero. Fix This unassigns the smaller of
  the Ready to Assign shortfall and the chosen source's positive Available.
- Visible Ordinary and Credit Payment Categories, with the entry-point and
  eligibility rules above. Existing direct Assigned editing remains available.
- No move history, undo/redo, auto-assign, or card inspector in this slice.

### Saving and refresh

- `getMoneyMoveOptions` reads visible Categories and their current Available,
  Ready to Assign, and positive future assignments. The shared
  `MoneyMovePopover` handles the four entry points with searchable, grouped
  Category choices and locale-aware amount input.
- `moveMoney` authenticates the request; `moveOwnedMoney` validates and saves
  it in an immediate SQLite transaction. Budget reads are synchronous so
  coverage uses the same locked snapshot as the assignment writes.
- Save all assignment changes for a move atomically: a failure must leave
  both endpoints unchanged. Ready to Assign is derived, not a stored
  assignment endpoint.
- Authorize the Plan and both endpoints, validate visibility and currency
  precision, and reject identical Category-and-month endpoints. The same
  Category across different months is valid for future-month coverage.
- Explicit moves apply the requested positive amount to current assignments.
  Coverage and Fix This calculate their capped amounts from current server
  values when saving, not stale amounts from when a picker opened.
- Keep the form open on failure with its inputs and an error. Refresh the
  budget, dependent payment Categories, Ready to Assign, and month bounds
  after success, and invalidate cached months affected by the assignment
  changes using the existing budget refresh behavior.

## Deferred

- Move history, undo/redo, auto-assign, targets, and the month summary remain
  outside that slice.
