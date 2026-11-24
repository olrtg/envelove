# Credit Payment Categories

Agreed design decisions from the domain interview, corrected against observed YNAB behavior. The structural and visibility slice and the monthly budgeting slice are implemented.

## Initial implementation boundary

- The first implementation creates and maintains the internal group and paired Categories, keeps their names aligned with Accounts, and prevents direct edits or ordinary Transaction assignment.
- The first implementation includes Hide/Unhide for both Ordinary and Credit Payment Categories.
- Hiding or unhiding an entire Category Group is deferred; this slice changes visibility one Category at a time.
- Assigned and Available follow [Assigned and Available](./assigned-and-available.md). [Budgeting](#budgeting) adds payment Activity and the movement of funded spending.

## Hidden Categories

- Hiding a Category preserves its Category Group relationship. The UI gathers hidden Categories in a separate Hidden Categories area without moving them between groups. The Hidden Categories area starts collapsed.
- Hidden Ordinary Categories are omitted from the Category picker for new Transactions.
- Every server write path rejects a new assignment to a Hidden Category, including future integration APIs and edits that change an existing Transaction's Category.
- An existing Transaction may be edited while retaining its current Hidden Category without unhiding it.
- Hiding a Credit Payment Category changes only its visibility. Its pairing and future payment activity continue while hidden, including when the Credit Account remains open.
- Hiding the Credit Payment Category of an open Credit Account shows a nonblocking confirmation that its activity will continue while hidden.
- When every Credit Payment Category is hidden, the Credit Card Payments group is omitted from the active view but remains stored. It reappears when one of its Categories becomes visible.

## Identity and ownership

- Each Credit Account has a paired Credit Payment Category with a stable identity.
- The Account and its Credit Payment Category have an explicit, unique ID relationship. Pairing is never inferred from names or Category Group membership.
- Credit Accounts include Credit Card and Line of Credit Accounts.
- Both Credit Account types follow the same payment-category budgeting rules for purchases, payments, overpayments, refunds, and positive balances.
- Credit Payment Categories belong to the system-managed **Credit Card Payments** Category Group.
- Both the Credit Card Payments Category Group and its paired Credit Payment Categories are internal. A future API exposes `internal: true` for each.
- The app controls that group's name and membership. Users cannot add ordinary Categories to it.
- When Category Group reordering is added, users may reposition Credit Card Payments among other groups; internal ownership does not lock its display position.
- When Category reordering is added, users may reorder Credit Payment Categories within Credit Card Payments independently of Account sidebar order. They cannot move those Categories to another group.
- A Credit Payment Category's name follows its Account's name and cannot be edited independently.
- A Credit Payment Category cannot be deleted independently of its Account, including after that Account is closed. It may be hidden instead.
- A Credit Payment Category cannot be assigned directly to a Transaction. The Inflow: Ready to Assign Category can, on any Account.
- Users may assign money directly to a Credit Payment Category to reserve cash for existing or previously unfunded debt. System ownership of its identity does not prevent budget assignments.

## Credit payments

- A Transfer from a Cash Account (Checking, Savings, or Cash) to a Credit Account is a Credit Payment.
- Neither linked Transaction stores a Category. The Credit Account's paired Credit Payment Category reflects the payment in its budget activity.
- Funded direct spending from a Credit Account moves only the funded portion from its Ordinary Category to the paired Credit Payment Category. The unfunded portion creates debt without reserving payment money; for example, Gs40,000 Available for a Gs100,000 purchase reserves Gs40,000 and leaves Gs60,000 unfunded.
- If the user covers credit overspending by adding money to the spending Category later in the same month, that newly funded portion automatically moves to the paired Credit Payment Category.
- Credit overspending left at month end becomes carried debt. Money assigned in a later month to repay that debt goes directly to the Credit Payment Category; it is not routed through the prior month's spending Category.
- A Credit Payment may exceed the money Available in its paired Category. The Transfer still records the actual Account movement; the Category shows a negative Available amount until the user covers the shortfall.
- While a Credit Account has a positive balance, purchases spend that balance first. They do not automatically move money from an Ordinary Category to the paired Credit Payment Category until the Account has debt again.
- When one funded purchase crosses a Credit Account from a positive balance into debt, only the debt-creating portion moves from the spending Category to the Credit Payment Category. For example, a Gs50,000 purchase on an Account with a positive Gs30,000 balance reserves Gs20,000 for payment.
- The part of a Credit Payment that takes the Credit Account balance above zero is budgetable money. It enters [Ready to Assign](./ready-to-assign.md) in the payment's month as "Inflow from Debt Account". The whole payment still lowers the Credit Payment Category, which goes negative, and that negative Available is Cash Overspending against the next month's Ready to Assign.
- An Inflow: Ready to Assign Transaction on a Credit Account in debt only reduces the debt; just the part that takes the balance above zero reaches Ready to Assign.
- When a categorized refund creates a positive Credit Account balance, the refunded money returns to the Ordinary Category chosen for that refund rather than entering Ready to Assign.
- A refund categorized to an Ordinary Category reverses the corresponding reservation: money moves from the paired Credit Payment Category back to the chosen Category.
- A Balance Transfer between Credit Accounts does not move money between their Credit Payment Categories. Users move that budgeted money explicitly when needed.

## Budgeting

`budget-engine.ts` computes all of this from Transactions and Assigned amounts;
nothing else is stored.

### Card balance

- Each Credit Account's Transactions up to the Current Day are walked in date
  order, outflows before inflows within a day, then by creation time and id,
  keeping a running balance. Debt is the negative part of that balance. A
  purchase and its payment on the same day therefore never lift the card
  above zero in between.
- Every Transaction splits into the part that changed debt and the rest.
  - A categorized purchase: the debt-creating part is credit spending for its
    Category and card; the part paid from a positive balance is cash
    Activity. A refund mirrors this: the debt-reducing part is negative credit
    spending; the rest is cash Activity. Category Activity still shows the full
    amount.
  - A Credit Payment, a Transfer into the card from a Cash Account: its full
    amount lowers the Credit Payment Category's Activity, and the part above
    zero is an Inflow from Debt Account.
  - An Inflow: Ready to Assign inflow: only the part above zero reaches Ready
    to Assign.
  - An Inflow: Ready to Assign outflow lowers Ready to Assign by its full
    amount. The part that creates debt raises the Credit Payment Category's
    Activity, as funded spending would, so the money stays accounted for.
  - Uncategorized Transactions, cash advances (Transfers out of the card), and
    Balance Transfers only move the balance. Transfers from Loan or Tracking
    Accounts count as Balance Transfers.

### Funding

- Each Category funds its credit spending per month as in
  [Assigned and Available](./assigned-and-available.md): cash Activity first,
  then `funded = clamp(afterCash, 0, creditSpending)`.
- The funded amount becomes Activity of the Credit Payment Category of the
  card it was spent on. When spending spans cards and is only partly funded,
  cards are funded in the order they were first used that month. Refunds take
  their money back from their own card in full.
- Funding is recomputed from the month's totals, so assigning more later in
  the month moves more.

### Credit Payment Category Available

- `Available = Carryover + Assigned + Activity`, where Activity is funded
  spending minus Credit Payments. Positive Available carries over; negative
  Available resets to zero and is Cash Overspending.
- The pill compares Available with the card's debt at the end of the month,
  up to the Current Day.
  - Green when Available covers the debt and either Available is positive or
    the card is in credit, so a card holding a cashback with no debt shows a
    green zero. Beige when Available is zero and the card balance is exactly
    zero.
  - Yellow when Available is zero or more but less than the debt: "You have
    Gs80.000 set aside for payment. (Want to send more? Add money to
    Assigned.)"
  - Red when Available is negative: "Red in your payment? Assign more (and
    cover overspending) to get back to green!"
- The engine reports these as the statuses `payment_underfunded` and
  `payment_overspent`, beside the ordinary ones.

### Plan view

- The Credit Card Payments group row has no Add Category. Its Available cell
  has a "? PAYMENT" button whose popover reads "Using Credit Cards in YNAB: You
  assigned money to your categories, then charged a purchase on your card, so
  we moved the money from your categories to your credit card payment."
- The Activity popover of a Credit Payment Category follows YNAB. A summary
  comes first:
  - Spending: categorized outflows on the card in the month.
  - Returns: categorized inflows on the card.
  - Total Spending: Spending plus Returns.
  - Funded Spending: what the engine moved into the payment from Categories
    (net of refunds), plus debt from Inflow: Ready to Assign outflows.
  - Payments & Returns: Credit Payments into the card, as their negative
    effect on Activity.
  - Total Activity: Funded Spending plus Payments & Returns, always the
    Category's Activity.

  Then every card Transaction in the month up to the Current Day, newest
  first, as DATE | PAYEE | CATEGORY | MEMO | AMOUNT with card-side amounts.
  Purchases and refunds show "Group: Category"; Credit Payments show the
  payment Category, such as "Credit Card Payments: Audit Card".

- The Credit Card Payments group's popover lists the Credit Payments into its
  cards as negative amounts. When Activity differs from their sum, a first
  row, "Funded spending moved from categories", shows the difference.

### Money-move entry points

These entry points follow the YNAB web app,
verified in the Sandbox Plan on November 6, 2026, for the
[money-move implementation](./assigned-and-available.md#money-moves-and-covering-overspending).

- A **positive** payment Available opens **Move Money**, with the payment
  Category as the source and the full Available amount prefilled. This is
  true for both yellow underfunded and green funded payments. A yellow pill
  does not open a dialog to fund the difference between Available and debt.
- A **zero** payment Available has no money-move action. YNAB disables the
  pill whether it is yellow with outstanding debt, green with a positive
  Account balance, or neutral with a zero Account balance.
- A **negative** payment Available opens **Cover Overspending**, with the
  payment Category as the destination and no editable amount. Coverage is
  limited by the source's funds and the negative Available, not the Account's
  full debt. Reaching zero may leave the payment underfunded and yellow.
- A payment Category can be chosen as the destination of another Category's
  Move Money. Users can also fund it through Assigned. Neither action creates
  an Account Transaction or makes an actual Credit Payment.
- Explicit moves out may exceed payment Available, without an extra warning,
  just as for Ordinary Categories. The payment Category can become negative.
- The group's combined payment Available is not actionable; its separate
  PAYMENT information button remains informational.

YNAB's selected-card inspector also exposes a positive Available for Payment
amount that opens the same Move Money form. Its underfunded state says how
much more to assign, rather than treating that debt gap as overspending. This
observation does not add a card inspector or auto-assign to this slice.

Verified with an Account balance of −Gs50,000 and no current-month Activity:

1. Gs40,000 payment Available was yellow but opened Move Money with Gs40,000
   prefilled, in both the grid and inspector. Reducing Available to zero
   disabled the pill while the inspector still showed Gs50,000 underfunded.
2. At −Gs20,000 Available, covering from a Category holding Gs100,000 moved
   only Gs20,000. The payment reached zero and remained Gs50,000 underfunded;
   the source retained Gs80,000.
3. Moving Gs20,000 into the original Gs40,000 payment made it green at
   Gs60,000. Moving Gs70,000 back out succeeded and made it red at −Gs10,000.
   Ready to Assign was unchanged by these Category-to-Category moves.

All fixture edits and moves were undone, with original Assigned and Available
amounts restored. No Account Transactions were created or modified.

## Group creation

- A new Plan has no Credit Card Payments group by default.
- Adding the first Credit Account creates the group. Additional Credit Accounts use the same group.
- Creating a Credit Account, its paired Category, and the group when needed is one atomic operation; a failed creation leaves no partially created records.

## Rollout

- This feature is being designed before production launch, so no production data backfill is required.
- An ordinary Category Group or Category is never adopted as an internal record based on its name.

## Closing an account

- Closing a Credit Account retains its paired Credit Payment Category and stable identity.
- Account closure does not delete the category or its history.
- Closing an Account leaves its Credit Payment Category visible. The user may hide it separately after moving any remaining money.
- Reopening a Credit Account preserves the category's hidden setting. A user who hid it must unhide it explicitly.

### Reconciliation adjustments

A Credit Account adjustment through Inflow: Ready to Assign changes Ready to Assign by the change in the positive portion of the card’s dated balance. The payment Category receives no direct Activity. The reconciliation target uses posted entries, while the budget ledger includes current and past Uncleared entries. See [Reconciliation](./reconciliation.md#credit-adjustments).
