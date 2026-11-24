# Plan Months

## Goal

Show the Plan one Plan Month at a time, with each Category's Activity for that
month, so a user can see where money went without opening every register.

## Month header

- The Plan view header shows the selected month in English, such as
  "Oct 2026", in every Plan locale. The picker's month names are English too.
- Circular previous and next buttons move one month back or forward.
- Activating the month label opens a month picker. It shows one year with
  previous and next year buttons and a grid of the twelve months. The month
  containing the Current Day is highlighted, and the selected month is marked.
  Months outside the allowed range are disabled. The year buttons are never
  disabled.
- A **Today** button appears right of the next button whenever the selected
  month is not the month containing the Current Day. It goes to that month.
- Every month change is a link, so it can be prefetched, opened in a new tab,
  and shared.
- **Category Group** in the toolbar below the header adds a Category Group.

## Month range

- A Plan starts in the earlier of the month it was created and the month of its
  earliest Transaction.
- The earliest selectable month is one month before the Plan starts. The
  previous button is disabled there.
- The latest selectable month is one month after the later of the month
  containing the Current Day and the latest month with an Assigned row. The
  next button is disabled there, with the tooltip "Before you can move to next
  month, you need to assign money this month."
- Assigning money in the latest month opens the next one. Setting it back to
  zero keeps the row, so the month stays open.
- The range lives in one function, `planMonthBounds()`. The Plan read returns
  the earliest Transaction date and the latest assigned month in the same
  query, and the browser computes the range with its Current Day.

## Activity

- Activity for a Category in a month is the sum of the Amounts of Transactions
  that use that Category and are dated from the first day of the month through
  the earlier of its last day and the Current Day.
- Outflows are negative and inflows are positive.
- Transactions dated after the Current Day never count, even within the
  selected month. They behave like scheduled Transactions and start counting on
  their date. A future month therefore shows no Activity.
- A Category Group's Activity is the sum of its visible Categories' Activity.
  Hidden Categories show their own Activity in the Hidden Categories section
  but do not count toward their group.
- Uncategorized Transactions and Transfers have no Category, so they count
  toward no Activity. Inflow: Ready to Assign Transactions feed
  [Ready to Assign](./ready-to-assign.md) instead. Credit Payment Categories
  show no Activity until payment activity is modeled.
- Activity is derived from Transactions on every request in one aggregate
  query grouped by month; it is never stored. That query and the Activity
  popover share one cutoff, `activityCutoff()` in `budget.server.ts`, so they
  always agree.

## Activity popover

- Activating a non-zero Activity amount on a Category or Category Group row
  opens a popover anchored to it. Zero amounts are not interactive.
- The popover is titled **Activity**, with the Category or Category Group name
  below.
- It lists the Transactions behind that Activity, newest date first, with the
  most recently entered first within a day. Columns are Account, Date, Payee,
  Memo, and Amount. Dates are numeric in the Plan locale, such as 09/10/2026,
  and inflows show a `+`.
  There is no total row.
- A Category Group lists only its visible Categories' Transactions, matching
  its Activity.
- Activating a row opens that Account's register with the Transaction scrolled
  into view and briefly highlighted, through the `transaction` search
  parameter:

  ```text
  /plans/$planId/accounts/$accountId?transaction=<id>
  ```

- **Close** or Escape closes the popover. Transactions load when the popover
  opens.

## Current Day

The browser sends its local calendar day with the request, as it does for
[Account Balances](./account-balances.md). The Plan view loads only in the
browser so the default month and the Activity cutoff both use the browser's
Current Day. Crossing midnight refetches the next time the view loads.

## Presentation

- Columns are **Category**, **Assigned**, **Activity**, and **Available**.
  Amounts are right-aligned with tabular numerals. See
  [Assigned and Available](./assigned-and-available.md).
- Amounts use the Plan's full currency format. Zero shows as `$0.00`.

## Deferred

- Payment activity on Credit Payment Categories.
