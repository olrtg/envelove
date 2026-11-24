# Transactions

## Goal

Introduce an Account-specific transaction register. A user can open an Account,
record money entering or leaving it, edit existing entries, confirm that entries
have cleared, and delete incorrect entries.

This slice establishes Transactions as the sole source of Account balances. It
does not introduce transfers, reconciliation, aggregate registers, or advanced
register controls.

## Domain model

```text
Plan
├── Ordinary Payee
├── Account
│   └── Transaction
└── Category Group
    └── Category
```

- A Transaction belongs to exactly one Account.
- A Transaction cannot exist without an Account.
- A Transaction may reference one Category or remain Uncategorized.
- An ordinary Transaction may reference one Ordinary Payee or have No Payee.
- When present, the Category and Account must belong to the same Plan.
- When present, the Ordinary Payee and Account must belong to the same Plan.
- A Transaction's Account cannot be changed in this slice.
- Transactions are independent entries. This slice does not link two entries as
  an Account transfer.
- A nonzero starting balance creates a cleared Transaction dated today in the
  user's time zone, with the ordinary payee Starting Balance. A blank or zero
  balance creates no Transaction. Cash and credit openings use Ready to Assign;
  loans and tracking openings have no Category. A credit opening counts before
  same-day spending: a positive balance is spendable, but existing debt neither
  takes budget money nor funds the Credit Payment Category. The budget uses the
  Transaction's starting-balance flag, not its editable payee name.

## Persisted data

The persisted model needs the equivalent of:

```text
Transaction
- id
- accountId
- categoryId (nullable)
- payeeId (nullable)
- date
- memo (nullable)
- amount
- cleared
- createdAt
- updatedAt
```

`date` is a calendar date without a time or timezone. It must use a storage
representation that round-trips without timezone conversion changing the day.

`amount` is a signed, nonzero integer number of milliunits in the Plan's
currency. A negative Amount is an outflow and a positive Amount is an inflow.
For example, an outflow of USD 12.34 is stored as `-12340`.

A new Transaction starts Uncleared unless its Plan initializes the draft as Cleared. Reconciliation marks verified Cleared entries as Reconciled. The register shows three statuses, and both posted statuses contribute to Cleared Balance. See [Reconciliation](./reconciliation.md) for corrections and future dates.

Records have stable IDs. `createdAt` provides deterministic ordering for
Transactions with equal dates; identity never depends on field values.

## Field rules

### Date

- Date is required.
- Users may enter past, present, or future dates.
- A new draft defaults to the user's current device-local calendar date.
- The date is typed in the Plan's locale order. A lone day uses the current
  month and year, and a day with a month uses the current year. While the
  calendar is open, the arrow keys move the date by a day or a week.
- All behavior involving "today" uses that device-local calendar date.
- A future-dated Transaction cannot be Cleared.
- Selecting a future date in a creation or edit draft immediately changes that
  draft to Uncleared and disables the Cleared control.
- Returning the draft to today or a past date re-enables the Cleared control but
  does not restore Cleared status; the user may choose it explicitly.
- The disabled control exposes the accessible explanation **Future Transactions
  cannot be Cleared.**
- Server validation still rejects a future-date and Cleared combination rather
  than relying on the client-side transition.

### Payee

- An ordinary Transaction may reference one reusable Ordinary Payee owned by
  its Plan or have No Payee.
- Transaction entry supports selecting an existing Payee or atomically creating
  one under the naming rules in [Payees](./payees.md).
- Transfer Transactions continue to use virtual Account-derived Transfer
  Payees rather than Ordinary Payee references.

### Category

- Category is optional.
- A blank selection is displayed as **Uncategorized**.
- The selector offers only Categories belonging to the Transaction Account's
  Plan, organized by Category Group.
- Server validation rejects a Category from another Plan even if the user owns
  both Plans.

### Memo

- Memo is an optional short note explaining the Transaction's reason or
  context.
- Outer whitespace is trimmed and internal whitespace is preserved.
- Blank input is stored as no Memo.
- Unicode, including emoji, is accepted.
- The maximum length after trimming is 200 characters.

### Amount

- The register presents separate **Outflow** and **Inflow** editors.
- The user enters a positive value in exactly one editor. Entering values in
  both, entering a negative value, leaving both blank, or entering zero is
  invalid.
- Outflow converts to a negative persisted Amount; Inflow converts to a
  positive persisted Amount.
- Typing in one editor clears the other.
- Either editor accepts arithmetic with `+`, `-`, `*`, `/`, and parentheses,
  such as `12+3.50`. Leaving the editor replaces the expression with its
  result.
- Users enter and see ordinary currency values. Raw milliunits are never shown.
- Input and display follow the Plan's country and currency settings.
- Accepted fractional precision follows the currency's standard precision:
  two decimal places for USD, GBP, and EUR, and zero for PYG.
- Excess fractional precision is rejected rather than rounded silently.
- Conversion must produce a safe integer number of milliunits without
  floating-point drift.

### Cleared

- Reconciled Transactions retain their Cleared status.
- Cleared means confirmed as posted by the financial institution or otherwise
  verified against the real-world Account.
- Clearing is explicit and is not inferred from the date.
- A Transaction dated today or earlier may be Cleared or Uncleared.
- The configurable default for a new draft's Cleared status belongs to the
  Plan, not to an individual User or Account, and applies throughout that Plan.
- The preference is disabled for existing and newly created Plans unless a user
  explicitly enables it; the initial status is therefore Uncleared by default.
- This default is only a draft-entry convenience. The user may change the
  Cleared field before saving, and saving preserves that explicit choice.
- The preference does not alter existing Transactions, the starting state of an
  edit draft, or a creation draft that is already open when the preference
  changes. It is applied when each new creation draft starts.

### Plan setting

The Plan persists this preference in a dedicated `defaultTransactionCleared`
Boolean field. Existing and newly created Plans store `false` unless the user
enables it; the preference is not stored in a generic settings document.

Plan settings presents the preference in an **Advanced** section as a checkbox:

- **Mark new Transactions as Cleared**
- **Help text:** New Transactions dated today or earlier start as Cleared.
  Existing Transactions are not changed, and you can change the status before
  saving.

The preference uses the existing Plan settings workflow. **Save changes**
persists it atomically with the other Plan fields, **Cancel** discards the draft
value, and a failed save changes none of the settings.

After the setting is saved, it applies to the next creation draft in the current
session without requiring a page reload. Another open browser tab may observe
the change on its next reload; real-time cross-tab synchronization is not
required.

## Account routing and navigation

Each Account has a dedicated, reload-safe route equivalent to:

```text
/plans/$planId/accounts/$accountId
```

- Selecting an open or closed Account name in the sidebar navigates to its
  register.
- Account settings move to a separate secondary action rather than occupying the
  Account name's primary action.
- The route loads the Account, its Plan Categories, and its Transactions.
- The URL must not expose an Account belonging to another Plan or owner.
- The existing Plan route remains the Category workspace.
- The **All Accounts** aggregate register is not implemented in this slice.

## Register layout

The Account register contains:

- the Account name and closed state;
- Cleared, Uncleared, and Working balance summaries;
- an **Add Transaction** action for open Accounts; and
- a grid with Date, Payee, Category, Memo, Outflow, Inflow, and Cleared fields.

Saved Transactions are ordered by date descending. Equal dates are ordered by
creation time descending, then by stable ID as a final deterministic
tie-breaker. Upcoming entries therefore appear before today's and past entries.

The first slice does not display a running balance on each row.

## Balance calculations

Transactions are the sole source of Account balances. No separate mutable
balance is persisted.

Only Transactions dated on or before the user's current device-local calendar
date contribute to current balances:

- **Cleared Balance** is the sum of current and past Cleared Amounts.
- **Uncleared Balance** is the sum of current and past Uncleared Amounts.
- **Working Balance** is Cleared Balance plus Uncleared Balance.

Future-dated Transactions remain visible as upcoming but contribute to none of
these summaries until their date arrives. Creating, editing, clearing, or
deleting a current Transaction updates the affected summaries immediately after
the save succeeds.

## Creating a Transaction

1. The user activates **Add Transaction** or presses `Shift+N` outside a
   field.
2. An editable row appears in the register with today's date, blank Payee,
   Category, Memo, Outflow, and Inflow fields, and the Cleared status configured
   by the Plan's creation preference. Focus starts in the date.
3. The user enters values and activates **Save** or presses `Enter`.
4. A valid save persists the Transaction and briefly highlights its saved row.
   **Save** closes the draft and scrolls to the row. `Enter` starts the next
   creation draft with the same date so a run of entries needs no mouse.
5. **Cancel** or `Escape` discards an unsaved creation draft.

The register permits one active create or edit draft at a time. Attempting to
start another draft must not discard the current draft.

Moving focus between fields does not save the row. `Enter` from a single-line
field may submit the row when doing so does not interfere with selecting a
control value. Saving always remains available through an explicit action.

Payee and Category lists open when their field is focused:

- `Tab` and `Enter` commit the highlighted option. `Enter` also moves focus to
  the next field.
- A Payee option is highlighted automatically only when a word in its name
  starts with the typed text. Otherwise **Create** is offered first, so a
  partial match is never committed by accident.
- Choosing an Ordinary Payee fills in the Category of that Payee's most
  recently saved categorized Transaction, unless the user already chose a
  Category.

`Escape` first restores the focused field to its value before it changed. A
second `Escape` cancels the draft. When a draft closes, focus returns to **Add
Transaction** or to the edited row's Edit action.

A validation failure marks the field it concerns and clears once that field
changes.

## Editing a Transaction

1. The user activates a saved row's Edit action.
2. That row enters the same multi-field editor used for creation.
3. **Save** validates and persists the complete draft.
4. **Cancel** or `Escape` restores the previously saved values.

The Account is fixed by the register and is not editable. Changing Date, Payee,
Category, Memo, Amount, or Cleared status is supported.

Editing is atomic from the user's perspective: a validation or persistence
failure changes none of the saved Transaction fields.

## Deleting a Transaction

- Every saved row in an open Account offers a Delete action.
- The user must confirm deletion because it may change Account balances.
- Confirmed deletion permanently removes the Transaction.
- A failed deletion leaves the Transaction visible and presents an error.
- Soft deletion, trash, and restoration are not implemented.

## Closed Accounts

- A Closed Account's register remains navigable and visible for historical
  access.
- Its balance summaries and Transaction rows remain visible.
- Creating, editing, clearing, and deleting Transactions are unavailable while
  the Account is closed.
- Reopening the Account restores those actions.

Both the UI and server enforce this read-only boundary. Hiding controls alone is
not sufficient authorization.

Plan-level Payee rename, merge, and deletion-with-reassignment may update the
Ordinary Payee identity associated with Closed Account history without enabling
direct Transaction editing. See [Payees](./payees.md).

## Category deletion compatibility

Category deletion is not implemented by this slice, but the Transaction model
must preserve the agreed future rule:

- Deleting a Category referenced by Transactions requires selecting another
  Category in the same Plan.
- All affected Transactions are reassigned atomically before the old Category
  is removed.
- Uncategorized is not a deletion destination.
- A used Category with no alternative Category cannot be deleted; the user must
  create a replacement first.
- Category deletion never deletes Transactions.

## Authorization and integrity

All reads and writes are authorized through the Account's owning Plan and the
Plan's owner. Client-provided Account, Category, or Transaction IDs are never
sufficient proof of access.

For every operation, the server verifies the complete ownership path:

```text
User -> Plan -> Account -> Transaction
          |       |
          |       +-> Category must resolve to the same Plan
          |
          +-> Ordinary Payee must resolve to the same Plan
```

Creating or mutating a Transaction in a Closed Account is rejected. Updates and
deletes target a Transaction only after confirming that it belongs to an Account
owned by the current user.

## Loading, empty, pending, and error states

- Loading an Account route shows a non-interactive register skeleton rather than
  an empty state.
- An Account with no Transactions shows an empty state with an **Add
  Transaction** action when the Account is open.
- A Closed Account with no Transactions shows a read-only empty state.
- An invalid, mismatched, or unowned Plan or Account does not reveal whether
  another user's record exists.
- A failed initial load shows an error with a retry action.
- While a save or delete is pending, duplicate submission for that row is
  disabled.
- A failed create or edit preserves the draft and presents field-level errors
  where applicable plus a row-level error for general failures.
- Changing routes discards an unsaved draft only through the router's normal
  navigation behavior; navigation blocking is not introduced in this slice.

## Out of scope

- Linked transfers between Accounts
- Reconciliation and Reconciled status
- All Accounts or other aggregate registers
- Moving a Transaction to another Account
- Special Starting Balance transaction types or workflows
- Scheduled-transaction recurrence
- Row-level running balances
- Search, filtering, sorting controls, and pagination
- Bulk selection and bulk actions
- File import, bank synchronization, and duplicate matching
- Flags other than Cleared
- Split Transactions with more than one Category
- Soft deletion, audit history, undo, and restoration
- Category deletion UI

## Acceptance criteria

1. Selecting an Account navigates to its reload-safe register URL.
2. An invalid or unowned Plan, Account, Category, or Transaction ID cannot be
   read or changed.
3. An open Account with no Transactions presents an Add Transaction action.
4. A new draft defaults to the device-local date and the Plan's configured
   initial Cleared status; without customization, that status is Uncleared.
5. A Transaction can be saved without a Payee, Category, or Memo.
6. A Transaction cannot be saved without a valid date and nonzero Amount.
7. Outflow input persists a negative Amount and Inflow input persists a positive
   Amount.
8. Raw milliunits are never presented to the user.
9. Currency input accepts only the Plan currency's standard fractional
   precision and is converted exactly to integer milliunits.
10. Ordinary Payee selection and creation follow the reusable Plan-owned model
    in [Payees](./payees.md); Memo outer whitespace is trimmed while internal
    whitespace and Unicode are preserved.
11. Ordinary Payee names longer than 100 characters or Memos longer than 200
    characters are rejected.
12. A Transaction may use a past, current, or future date.
13. Selecting a future date unchecks and disables Cleared with the explanation
    **Future Transactions cannot be Cleared**; returning to today or the past
    re-enables it without restoring Cleared, and server validation still rejects
    an invalid future-date and Cleared combination.
14. A Category from another Plan cannot be assigned to a Transaction.
15. Uncategorized Transactions remain valid and editable.
16. A saved Transaction can be edited inline and cancelled without changing its
    saved values.
17. Only one Transaction draft can be active in a register at a time.
18. Moving focus between draft fields does not save the row.
19. A failed save preserves the complete draft and exposes the failure.
20. A saved Transaction can be permanently deleted after confirmation.
21. A failed delete preserves the Transaction and exposes the failure.
22. Current and past Transactions contribute to the appropriate Cleared or
    Uncleared Balance and therefore to Working Balance.
23. Future-dated Transactions remain visible but do not contribute to any
    current balance summary.
24. Balance summaries update after successful creation, editing, clearing, or
    deletion.
25. Transactions render by date descending, creation time descending, and then
    stable ID.
26. A Closed Account register is visible but offers no Transaction mutations.
27. No deferred feature is presented as an active control.
28. Plan settings exposes **Mark new Transactions as Cleared** in an **Advanced**
    section, and existing and new Plans default it to disabled.
29. Enabling the preference makes the next Account-register or All Accounts
    creation draft start Cleared without changing saved Transactions, edit
    drafts, or an already open creation draft.
30. The setting takes effect after a successful Plan settings save without a
    page reload; cancelling or failing the save does not apply it.
31. Selecting or changing the Account in an unsaved All Accounts creation draft
    preserves its current Cleared status.
32. Creating a Transfer applies the preference only to the explicitly entered
    side; the generated counterpart starts Uncleared.
