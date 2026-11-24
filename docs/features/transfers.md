# Transfers

[Reconciliation](./reconciliation.md) extends the original Transfer rules below. Each side can be reconciled independently. A future-date draft clears both statuses together. Account moves preserve a moved side’s Reconciled marker. Amount and effective Payee changes inspect both sides, including moving the opposite row via its Account field.

## Goal

Allow a user to record one movement of money between two Accounts in the same
Plan without treating that movement as income or spending.

## Domain model

- A Transfer is one conceptual movement of money.
- A Transfer has one source Account and one destination Account.
- The source and destination are distinct Accounts in the same Plan.
- A Transfer is represented in the two Accounts by linked Transactions with
  equal and opposite Amounts: an outflow from the source and an inflow into the
  destination.
- The linked Transactions remain the source of Account balances.
- Creating, editing, or deleting a Transfer changes both linked Transactions
  atomically.

## Persisted identity and linkage

- A Transfer has its own stable persisted ID and belongs directly to one Plan.
- Each linked Transaction references the Transfer and identifies itself as the
  Outflow or Inflow side.
- A valid Transfer has exactly one Outflow Transaction and one Inflow
  Transaction.
- An ordinary Transaction has no Transfer reference or Transfer side.
- Transfer Transactions persist no Category or Ordinary Payee reference; their
  Transfer Payees are derived from the linked Accounts.
- The signed Amounts remain on the Transactions, which continue to be the sole
  source of Account balances.
- Date and Memo remain stored on both linked Transactions rather than on the
  Transfer record.
- Every Transfer mutation keeps both Dates and Memos equal and both Amounts
  equal in magnitude with opposite signs.
- Both linked Transaction Accounts must resolve to the Transfer's Plan.
- Deleting a Transfer cascades to both linked Transactions through their
  Transfer references.

The persisted model needs the equivalent of:

```text
Transfer
- id
- planId
- createdAt
- updatedAt

Transaction additions
- transferId (nullable)
- transferSide (nullable: outflow | inflow)
```

The Transfer record is linkage-only. Register-facing business fields remain on
the linked Transactions.

### Migration

- The migration creates the Transfer table and adds nullable `transferId` and
  `transferSide` fields to Transactions.
- Every existing Transaction remains ordinary with both new fields absent.
- Existing Payee text is never parsed or heuristically linked, even when it
  resembles a generated Transfer Payee label.
- A historical ordinary Transaction becomes part of a Transfer only through an
  explicit user conversion after this feature is available.

### Integrity constraints

- `transferId` and `transferSide` are either both absent or both present.
- A linked Transaction has no Category or persisted Ordinary Payee reference.
- A Transfer has at most one Transaction for each Transfer side.
- The Outflow side has a negative Amount and the Inflow side has a positive
  Amount.
- Database checks and unique indexes enforce these row-local rules.
- Transfer-aware server mutations run in a database transaction and enforce the
  pair-wide rules: exactly two sides, distinct Open Accounts in the Transfer's
  Plan, one shared Date and Memo, and equal-and-opposite Amounts.
- SQLite triggers are not used.
- If a read or mutation encounters an incomplete or inconsistent pair, it
  reports an integrity error rather than repairing it or treating either side
  as ordinary.
- The user-facing error does not expose inaccessible record details; server
  diagnostics retain the Transfer identity needed to investigate.
- A register that detects a malformed Transfer fails as a whole and uses the
  existing retryable load-error state; it does not present potentially
  misleading rows or balances.

## Mutation boundary

- All creation, editing, conversion, reassignment, and deletion involving a
  Transfer uses Transfer-aware server mutations.
- Ownership, Plan membership, Account state, pair integrity, and field
  validation are checked inside the same database transaction as the writes.
- Ordinary Transaction update and delete mutations reject a linked Transaction
  rather than changing one side in isolation.
- A Transfer-aware mutation may update only one side's Cleared status because
  Cleared status is intentionally Account-specific.
- Mutation input distinguishes ordinary and Transfer Payees explicitly:

  ```text
  PayeeInput =
    | { kind: ordinary, payeeId: string | null }
    | { kind: create, name: string }
    | { kind: transfer, accountId: string }
  ```

- A generated `To/From <Account name>` label is display-only and is never
  parsed or trusted as Transfer identity.
- Concurrent edits use the existing last-successful-save-wins behavior.
- Each save remains atomic, but stale-edit detection and optimistic locking are
  deferred as a cross-cutting Transaction feature.

## Account eligibility

- Creating a Transfer requires two Open Accounts.
- Editing a Transfer requires both participating Accounts to be Open.
- Closing an Account does not remove or unlink its existing Transfers; they
  remain visible as read-only history until both Accounts are Open again.
- Transfer Payee options include only other Open Accounts in the current Plan.
- The current Account and all Closed or cross-Plan Accounts are omitted rather
  than displayed as disabled choices.
- Every Account type is eligible; Transfer rules do not restrict type
  combinations.

## Date

- A Transfer has one required calendar date shared by both linked
  Transactions.
- The existing Transaction date rules apply, including the rule that a
  future-dated Transaction cannot be Cleared.
- Saving a future date is rejected if either linked Transaction is Cleared; the
  save does not silently clear either side.

## Cleared status

- Each linked Transaction has its own Cleared status.
- One side may be Cleared while the other remains Uncleared.
- When the shared date is in the future, both sides must be Uncleared.
- On creation, the explicitly entered side follows the Plan's configured
  initial Cleared status when the shared date is today or earlier.
- The automatically generated opposite Transaction always starts Uncleared,
  regardless of that Plan preference.
- Editing one side exposes only that Transaction's Cleared control. The other
  side is changed by editing its own Account row.

## Memo

- A Transfer has one optional Memo shared by both linked Transactions.
- Editing the Memo from either Account updates both sides atomically.

## Category

- Neither linked Transaction has a Category, regardless of the participating
  Account types.
- A Transfer is movement within a Plan rather than categorized spending or
  income.
- Saved and editable Transfer rows display **Category not needed** rather than
  **Uncategorized**.
- Bank fees and other differences are recorded as separate ordinary categorized
  Transactions; Transfer Amounts never become unbalanced to include them.

## Payee

- Every Account has a system-managed Transfer Payee displayed as
  **To/From &lt;Account name&gt;**.
- Each linked Transaction uses the other Account's Transfer Payee rather than
  an Ordinary Payee reference.
- Transfer Payees are presented separately from ordinary Payees.
- Renaming an Account changes its Transfer Payee label everywhere, including
  historical Transfers.
- Ordinary Payees are reusable Plan-owned records governed by
  [Payees](./payees.md).
- Transfer Payees are virtual options derived from Accounts, not persisted
  Payee records.
- The selector combines persisted Ordinary Payees with Account-derived Transfer
  Payees while keeping them in separate groups.
- Account names remain non-unique. Transfer Payee options include secondary
  Account type or group text to help distinguish matching names, while the
  Account ID remains their identity.
- Historical row labels remain the concise **To/From &lt;Account name&gt;**.

## Creation workflow

- A Transfer starts as an ordinary Transaction draft in a register.
- The Payee selector groups eligible Transfer Payees separately from ordinary
  Payees.
- Selecting a Transfer Payee turns the draft into a Transfer and makes the
  Category field unavailable.
- There is no separate **Add Transfer** action or Transfer-only editor.
- In an Account register, an Outflow moves money from the current Account to
  the selected Transfer Payee's Account.
- In an Account register, an Inflow moves money from the selected Transfer
  Payee's Account into the current Account.
- Transfer direction therefore uses the existing Outflow and Inflow editors;
  it has no separate direction control.
- In All Accounts, the user must select the row's Account before Transfer
  Payees become available.
- Once selected, that Account defines the row's point of view and is excluded
  from the Transfer Payee options.
- With fewer than two Open Accounts, ordinary Transaction creation remains
  available but no Transfer Payees are offered.

## Conversion

- Changing an ordinary Transaction's Payee to a Transfer Payee converts it to
  a Transfer and creates the opposite linked Transaction atomically.
- Changing a Transfer's Payee to an ordinary Payee or no Payee converts it to
  one ordinary Uncategorized Transaction and removes the opposite linked
  Transaction atomically.
- A failed conversion leaves the original Transaction or Transfer unchanged.
- Converting a categorized ordinary Transaction to a Transfer clears its
  Category in the draft without a separate confirmation.
- The editor immediately shows that no Category is needed; cancelling the edit
  restores the original Payee and Category.
- Converting a Transfer to an ordinary Transaction requires confirmation.
- The confirmation appears when the user activates **Save**, not when the
  draft Payee changes.
- The confirmation names the opposite Account and explains that its linked
  Transaction will be permanently removed and its balance may change.

## Changing Accounts

- A user may change the other Account by selecting a different Transfer Payee.
- The current Account, old counterpart Account, and new counterpart Account
  must all be Open and belong to the same Plan.
- The opposite Transaction moves from the old Account to the new Account
  atomically; a failed change leaves the original Transfer unchanged.
- Moving the opposite Transaction to a new Account resets that side to
  Uncleared because its prior Cleared status belonged to the old Account.
- The Transaction in the unchanged Account retains its Cleared status.
- In All Accounts, changing the edited row's Account moves that side while the
  opposite Transaction remains in place.
- A moved side retains its Transaction ID and Transfer reference but resets to
  Uncleared.
- The new Account must be Open, belong to the same Plan, and differ from the
  opposite Account.
- Changing the edited side from Outflow to Inflow, or vice versa, reverses the
  Transfer by swapping both Amount signs atomically.
- Reversing direction does not move either Transaction, so each Account keeps
  its existing Cleared status.

## All Accounts

- All Accounts displays both linked Transaction rows rather than collapsing a
  Transfer into one row.
- Each row identifies its Account and shows that side's Cleared status.
- The equal and opposite Amounts net to zero in the Plan-wide register.
- Editing either row updates both visible rows after the atomic save succeeds.
- Both linked Transactions receive the same creation timestamp.
- Within the existing date-descending and creation-time-descending order, both
  sides remain adjacent with Outflow before Inflow and a stable pair key as the
  deterministic tie-breaker.

## Deletion

- Deleting either linked Transaction means deleting the entire Transfer.
- The confirmation names both Accounts and explains that both linked
  Transactions will be permanently removed and both balances may change.
- Confirmed deletion removes both linked Transactions atomically.
- A failed deletion leaves both linked Transactions visible and unchanged.

## Register data and presentation

- Account-register loads include every Account in the Plan so historical
  Transfer Payees can be resolved and eligible Open Accounts can be offered.
- All Accounts continues to include every Open and Closed Account.
- Loaded linked Transactions expose Transfer identity and side without
  persisting a generated Payee label.
- The Payee editor accepts existing or newly created Ordinary Payees and
  presents eligible Transfer Payees in a separate **Payments and Transfers**
  group.
- Only explicit selection of a Transfer Payee creates or changes a Transfer;
  ordinary Payee text is never interpreted as an Account identity.
- A successful mutation refreshes every affected row and balance summary. A
  counterpart change also removes the old Account's row and adds the new
  Account's row where those rows are in the current register scope.

## Authorization and integrity

Every read and mutation verifies the complete ownership and relationship path:

```text
User -> Plan -> Transfer
          |         |
          |         +-> exactly two linked Transactions
          |                        |
          +-> two distinct Accounts <-+
```

- Client-provided Plan, Account, Transfer, Transaction, or Transfer Payee IDs
  are never sufficient proof of access.
- Both Transaction Accounts and the Transfer must belong to the same owned
  Plan.
- Every participating Account required for a mutation must still be Open when
  the database transaction commits.
- Invalid, mismatched, or unowned IDs do not reveal whether another user's
  records exist.
- No successful mutation can expose a half-created, half-updated, or
  half-deleted Transfer.

## Loading, pending, and error states

- Existing register loading, empty, and retryable load-error states remain in
  use.
- A register with no eligible Transfer destination still supports ordinary
  Transactions and does not present a Transfer-only empty state.
- The existing one-active-draft rule applies to Transfer creation, editing, and
  conversion.
- Pending saves, conversions, reassignments, and deletes disable duplicate
  submission.
- A failed mutation preserves the complete draft and both persisted sides.
- If an Account closes before save, the mutation fails as an Account-state
  error rather than partially applying.
- Field errors remain attached to the edited row; general persistence and
  integrity failures use a row-level or register-level error as appropriate.

## Out of scope

- Cross-Plan or cross-currency Transfers and exchange rates
- Automatic detection or linking of historical Transfer-like Transactions
- Categories on Transfers or fees embedded in an unbalanced Transfer
- Split, multi-destination, or one-sided Transfers
- Scheduled Transfers and recurrence
- Import, bank synchronization, and Transfer matching
- Reconciliation and Reconciled status
- Optimistic locking and stale-edit conflict UI
- Making Account names unique
- Audit history, undo, soft deletion, and restoration

## Acceptance criteria

1. Every Account exposes a virtual Transfer Payee labeled
   **To/From &lt;Account name&gt;** without creating a persisted Payee record.
2. Transfer Payees are grouped separately from reusable Ordinary Payees.
3. Transfer Payee choices include only other Open Accounts in the same Plan.
4. Account-register and All Accounts creation support the same Transfer
   workflow; All Accounts requires the row Account first.
5. Selecting a Transfer Payee and saving creates one Transfer record and two
   linked Transactions atomically.
6. The source and destination Accounts are distinct and may have any Account
   types.
7. The Outflow side has a negative Amount and the Inflow side has an equal
   positive Amount.
8. An Outflow in an Account register sends money to the selected Account; an
   Inflow receives money from it.
9. Both sides share one Date and one Memo, and edits from either side update
   those fields atomically.
10. Each side has an independent Cleared status.
11. The generated counterpart starts Uncleared.
12. A future-dated Transfer cannot be saved while either side is Cleared.
13. Transfer Transactions persist no Category or Ordinary Payee reference.
14. Transfer rows show **Category not needed** rather than **Uncategorized**.
15. A categorized ordinary Transaction can be converted to a Transfer; its
    Category is cleared only when the conversion saves.
16. Cancelling a draft conversion restores the ordinary Transaction's original
    Payee and Category.
17. A Transfer can be converted to one ordinary Transaction only after Save
    triggers explicit confirmation about removing the counterpart.
18. A confirmed Transfer-to-ordinary conversion keeps the edited row, removes
    its counterpart, and deletes the Transfer record atomically.
19. Changing a Transfer Payee moves the opposite row to the newly selected
    Open Account atomically.
20. In All Accounts, changing the row Account moves that side atomically and
    cannot select the counterpart Account.
21. A moved side retains its Transaction identity but resets to Uncleared; the
    unchanged side retains its Cleared status.
22. Switching Outflow and Inflow reverses both Amount signs without changing
    either side's Cleared status.
23. Renaming an Account changes its derived Transfer Payee everywhere without
    rewriting Transactions.
24. Duplicate Account names remain valid and Transfer Payee choices include
    secondary Account type or group context.
25. Closing either participating Account leaves the Transfer visible but makes
    both sides read-only until both Accounts are Open.
26. All Accounts displays both Transfer rows, adjacent with Outflow before
    Inflow, and their Amounts net to zero.
27. Deleting either row requires confirmation naming both Accounts and deletes
    the Transfer and both Transactions atomically.
28. Ordinary Transaction mutations reject direct modification or deletion of a
    linked row.
29. Ownership, Account state, validation, and writes occur in one database
    transaction.
30. Row-local database constraints reject incomplete linkage fields, invalid
    sides, persisted Transfer Categories or Payees, duplicate sides, and side
    signs that disagree with Amounts.
31. Pair-wide validation rejects missing sides, cross-Plan Accounts, matching
    Accounts, unequal Dates or Memos, and Amounts that are not equal and
    opposite.
32. Existing Transactions remain ordinary after migration regardless of their
    Payee text.
33. A failed Transfer mutation leaves both persisted Transactions unchanged and
    preserves the user's draft.
34. A malformed persisted Transfer fails the register load rather than showing
    potentially misleading rows or balances.
35. Transfer fees require a separate ordinary categorized Transaction.
