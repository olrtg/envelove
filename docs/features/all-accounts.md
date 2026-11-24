# All Accounts

## Goal

Introduce a Plan-wide Transaction register at `/plans/$planId/accounts`. A user
can review every Transaction in the Plan and manage Transactions belonging to
Open Accounts without opening each Account separately.

## Register scope

- The register includes Transactions from every Open and Closed Account in the
  Plan.
- Transactions are ordered by date descending, creation time descending, then
  stable ID, matching the Account-specific register.
- Each row identifies its Account in an Account column.
- Closed Account rows remain visible and read-only.
- The Account-specific register remains available at
  `/plans/$planId/accounts/$accountId` and keeps its Account fixed.

The initial aggregate register loads all matching Transactions. Search, filters,
pagination, user-controlled sorting, row selection, and bulk actions are deferred
to a later slice.

## Balances

The Cleared, Uncleared, and Working Balance summaries use the existing balance
definitions and aggregate Transactions from every Open and Closed Account in the
Plan. Future-dated Transactions remain visible but do not contribute until their
date arrives.

## Creating and editing

- Creating a Transaction requires explicitly selecting an Open Account; the
  register does not choose a default.
- A new draft initializes Cleared status from the Plan's creation preference
  before an Account is selected. Selecting or changing the Account in that
  unsaved creation draft preserves its current Cleared status.
- Transactions in Open Accounts support the existing create, edit, and delete
  workflows.
- An existing Transaction may be reassigned to another Open Account in the same
  Plan from All Accounts.
- Closed Accounts are unavailable as reassignment destinations.
- Reassignment changes which Account owns one Transaction. It does not create a
  linked transfer or a second Transaction.
- Changing the Account while editing a saved Transaction resets that
  Transaction to Uncleared. The creation preference does not change this
  existing edit behavior.

The server verifies the current owner, source Account, destination Account, and
Plan boundary for every reassignment. A source or destination Account that is
Closed causes the mutation to fail.

## Navigation and empty states

The existing All Accounts sidebar item becomes a reload-safe link to the
aggregate register and is active only on that route. A Plan with no Accounts or
no Transactions still renders the page with guidance; adding a Transaction is
available only when at least one Open Account exists.
