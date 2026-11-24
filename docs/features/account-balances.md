# Account Balances

## Goal

Show each Account's Working Balance in the sidebar, and each Account Group's
balance on its header, so a user can see where their money sits without opening
every register.

## Balances

- Each Account row shows its Working Balance, using the existing balance
  definitions.
- Each Account Group header (Cash, Credit, Loans, Tracking) shows its Account
  Group Balance: the sum of Working Balances of its Open Accounts.
- The Closed header shows no total. Closed Accounts still show their own
  Working Balance.
- Balances are derived from Transactions on every request; they are never
  stored.

## Current Day

The browser sends its local calendar day with the Account list request. The
server counts only Transactions dated on or before that day, matching the
register's balance summary exactly. Crossing midnight triggers a refetch the
next time the sidebar renders or the window regains focus.

## Freshness

The sidebar loads Accounts and balances through TanStack Query under
`['accounts', planId]`. Any Transaction create, update, or delete in a register
invalidates that key, which refetches every Account's balances in one request.
Transfers and reassignments therefore update both affected Accounts. Account
create, rename, close, and reopen invalidate the same key.

Returning balances from each mutation (to skip the refetch) is deferred until
the extra request becomes noticeable.

## Presentation

- Amounts use the Plan's full currency format with tabular numerals; they are
  never abbreviated.
- Account rows show the amount in a badge: `destructive` when negative,
  `secondary` otherwise. Closed Accounts use a `secondary` badge with muted text
  regardless of sign.
- Account Group headers show plain right-aligned text, in the destructive color
  when negative.
- Account names truncate with an ellipsis; amounts never truncate.
- The Account settings button appears on hover or keyboard focus, in the
  row's leading indent.

## Deferred

- A total on the All Accounts row.
- A Cleared/Uncleared breakdown on hover.
- Widening the sidebar.
