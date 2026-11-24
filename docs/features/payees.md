# Payees

## Goal

Replace repeated ordinary Payee text with reusable, Plan-owned Payees. A user
can select or create a Payee while entering a Transaction and can manage Payees
from a dedicated Plan-level interface without losing Transaction history.

Transfer Payees remain virtual Account-derived options. This feature does not
persist them as Ordinary Payees or infer Transfers from ordinary Payee names.

## Domain model

```text
Plan
├── Ordinary Payee
└── Account
    └── Transaction
        ├── Ordinary Payee (optional reference)
        └── Transfer (optional reference)
```

- An Ordinary Payee is a reusable identity owned by exactly one Plan.
- An ordinary Transaction may reference one Ordinary Payee or have No Payee.
- A Transaction and its Ordinary Payee must belong to the same Plan.
- A Transfer Transaction has no Ordinary Payee reference. Its Transfer Payee is
  derived from the counterpart Account.
- An Ordinary Payee may have no Transactions and remains available until a user
  explicitly deletes it.
- Ordinary and Transfer Payees have separate identity namespaces. An Ordinary
  Payee may have the same display name as a Transfer Payee.

## Persisted data

The persisted model needs the equivalent of:

```text
Ordinary Payee
- id
- planId
- name
- createdAt
- updatedAt

Transaction change
- payeeId (nullable; replaces ordinary Payee text)
```

- Ordinary Payee identity is stable and does not depend on its name.
- Ordinary Payee names are unique within a Plan under the naming comparison
  rules below.
- The database prevents a Transaction from retaining a reference to a deleted
  Ordinary Payee. Used Payees are reassigned or cleared before deletion.
- Deleting a Plan deletes its Ordinary Payees through the Plan ownership
  relationship.
- Transfer Transactions require both `payeeId` and the legacy free-text Payee
  field, while that field exists during migration, to be absent.
- The final Transaction model does not retain a denormalized Payee-name
  snapshot. Historical rows display the Ordinary Payee's current name.

## Naming rules

- Name is required after trimming surrounding whitespace.
- Internal whitespace is preserved.
- Unicode, including emoji, is accepted.
- The maximum length after trimming is 100 characters.
- Two Ordinary Payee names in the same Plan cannot differ only by letter case
  or surrounding whitespace.
- The uniqueness rule applies only among Ordinary Payees in one Plan. The same
  name may exist in different Plans or on a virtual Transfer Payee.
- A rename that changes only the casing of the same Payee is valid.
- Renaming a Payee to another Ordinary Payee's matching name is rejected. The
  user must explicitly merge through the deletion and reassignment workflow.

## Migration from free text

Migration converts the existing model completely rather than maintaining both
free-text and reusable ordinary Payees indefinitely.

- Every nonblank Payee value on an ordinary Transaction creates or resolves to
  an Ordinary Payee in that Transaction's Plan.
- Matching values within one Plan are grouped without regard to letter case or
  surrounding whitespace.
- The matching value on the most recently created Transaction supplies the
  Ordinary Payee's canonical spelling. Creation time descending and then stable
  Transaction ID descending provide deterministic selection.
- Every grouped Transaction is linked to the resulting Ordinary Payee.
- Blank and absent Payee values become No Payee.
- Transfer Transactions remain without an Ordinary Payee reference.
- Text resembling a Transfer label, including `To/From <Account name>`, remains
  an Ordinary Payee when it came from an ordinary Transaction. Migration never
  parses text into Account or Transfer identity.
- Plans are migrated independently even when their Payee names match.
- The migration preserves every Transaction and removes the legacy free-text
  field after all references have been established.

## Transaction Payee selector

Transaction creation and editing use a searchable combobox.

- Before the user types, reusable Ordinary Payees appear in case-insensitive
  alphabetical order.
- Eligible Transfer Payees appear in a separate **Payments and Transfers**
  group and continue to follow the Transfer eligibility rules.
- Typing filters both groups.
- **No Payee** is an explicit valid option for an ordinary Transaction.
- When the entered text has no exact Ordinary Payee match under the naming
  rules, the selector offers **Create “&lt;name&gt;”**.
- An exact Transfer Payee label does not prevent creation of an Ordinary Payee
  with that name because the two kinds occupy separate namespaces.
- Selecting an existing option preserves its stable identity; labels are never
  parsed or trusted as identity.
- The first slice does not rank Payees by frequency or recent usage.

Saving a Transaction with **Create “&lt;name&gt;”** creates the Ordinary Payee and
Transaction atomically. A failed save creates neither record. Cancelling the
draft creates no Payee.

If concurrent Transaction saves attempt to create the same matching name, one
creates the Ordinary Payee and the other reuses it; both valid Transactions
still save. This concurrency behavior does not permit duplicate Ordinary
Payees.

Editing an ordinary Transaction may select a different existing Ordinary
Payee, create a new one, or choose No Payee. Existing Transfer conversion and
confirmation rules remain unchanged.

## Management route and navigation

Payees have a dedicated reload-safe route:

```text
/plans/$planId/payees
```

- **Manage Payees** in the Plan switcher menu opens the route for the active
  Plan.
- An invalid, mismatched, or unowned Plan does not reveal whether another
  user's records exist.
- The page lists Ordinary Payees only; virtual Transfer Payees remain managed
  through their Accounts.
- The list supports name search and case-insensitive alphabetical ordering.
- Each row shows the current number of referencing Transactions, including
  Transactions in Open and Closed Accounts.
- The page supports creating, renaming, and deleting one Ordinary Payee at a
  time.
- Transaction-history drill-down, usage-based ordering, bulk selection, and
  bulk actions are not included.

## Creating an Ordinary Payee

- The manager allows a Payee to be created before any Transaction uses it.
- The common naming and uniqueness rules apply.
- A matching existing Payee produces a duplicate-name error rather than
  creating another record.
- A failed create leaves the list unchanged and preserves the entered name.

## Renaming an Ordinary Payee

- A rename changes the Payee's displayed name on every current and historical
  Transaction, including Transactions in Closed Accounts.
- Renaming does not rewrite individual Transactions or preserve their previous
  displayed spelling.
- A name matching another Ordinary Payee is rejected and directs the user to
  the deletion and reassignment workflow for an explicit merge.
- A failed rename leaves the saved name unchanged and preserves the draft.

## Deletion, reassignment, and merge

Every deletion requires confirmation, including deletion of an unused Payee.
The confirmation shows the number of affected Transactions.

For a used Ordinary Payee, the user must choose one of two destinations before
confirming:

- another Ordinary Payee in the same Plan; or
- **No Payee**.

Choosing another Ordinary Payee is a Payee Merge. Every Transaction referencing
the source, including Transactions in Closed Accounts, is reassigned to the
destination, then the source ceases to exist. Choosing No Payee clears every
source reference before deleting the source. Neither choice deletes a
Transaction.

An unused Payee needs no destination but still requires explicit confirmation.
Payees are never deleted automatically when their last referencing Transaction
is removed.

Reassignment and deletion occur atomically. A failure leaves the source Payee,
destination Payee, and all Transaction references unchanged. The source cannot
be its own destination, and virtual Transfer Payees cannot be destinations.

A Payee Merge does not retain the source name as an alias. Dedicated bulk merge
tools and searchable aliases are deferred.

## Closed Accounts

Plan-level Payee identity operations apply across the full Plan history:

- renaming updates the Payee label shown on Transactions in Closed Accounts;
- merging reassigns their Ordinary Payee references; and
- deleting to No Payee clears their Ordinary Payee references.

These operations do not change a Transaction's Account, Date, Category, Memo,
Amount, or Cleared status. They are therefore allowed even though direct
Transaction editing remains unavailable in a Closed Account.

## Authorization and integrity

All reads and writes verify the complete ownership and Plan relationship:

```text
User -> Plan -> Ordinary Payee
          |
          +-> Account -> Transaction
```

- Client-provided Plan, Payee, Account, or Transaction IDs are never sufficient
  proof of access.
- A Transaction may reference only an Ordinary Payee in its Account's Plan.
- Reassignment destinations must be distinct Ordinary Payees in the same owned
  Plan.
- Virtual Transfer Payees cannot be persisted as `payeeId` values.
- Create-with-Transaction, rename, reassignment, and deletion enforce naming,
  ownership, and relationship rules at the same mutation boundary as their
  writes.
- Invalid or inaccessible identifiers do not reveal record existence.

## Loading, empty, pending, and error states

- Initial loading shows a non-interactive list skeleton rather than the empty
  state.
- A Plan with no Ordinary Payees shows an empty state with an **Add Payee**
  action.
- A failed initial load shows an error with a retry action.
- Pending create, rename, or deletion disables duplicate submission for that
  operation.
- Validation failures appear next to the affected field; general failures use
  an operation-level error.
- Failed mutations preserve user input and leave persisted data unchanged.

## Out of scope

- Default Categories, default Memos, or other Payee metadata
- Dedicated bulk merge tooling
- Searchable aliases for merged or renamed Payees
- Frequency- or recency-based selector ranking
- Transaction-history drill-down from the manager
- Bulk selection and bulk actions
- Import matching rules, bank synchronization, and automatic Payee cleanup
- Automatic detection of equivalent differently named Payees
- Sharing Payees across Plans
- Persisting Transfer Payees as Ordinary Payees
- Audit history, undo, soft deletion, and restoration

## Acceptance criteria

1. Every Ordinary Payee has stable identity, belongs to exactly one Plan, and
   has a required trimmed name of at most 100 characters.
2. Ordinary Payee names are unique within a Plan without regard to letter case
   or surrounding whitespace, while Unicode and internal whitespace remain
   valid.
3. The same Ordinary Payee name may exist in different Plans or match a virtual
   Transfer Payee label.
4. An ordinary Transaction references either one Ordinary Payee from its Plan
   or No Payee; a Transfer Transaction references no Ordinary Payee.
5. Migration converts every nonblank legacy ordinary Payee value into a
   Plan-owned Ordinary Payee and relinks every affected Transaction.
6. Migration groups case variants per Plan and uses the most recent matching
   Transaction, then stable ID, to choose deterministic canonical spelling.
7. Migration preserves blank Payees as No Payee and never interprets
   Transfer-looking text as Transfer identity.
8. The Transaction Payee combobox lists Ordinary Payees alphabetically and
   eligible Transfer Payees in a separate **Payments and Transfers** group.
9. Typing filters both groups and offers **Create “name”** when no Ordinary
   Payee matches exactly.
10. **No Payee** remains an explicit valid choice for ordinary Transactions.
11. Creating a Payee through Transaction entry is atomic with saving the
    Transaction; cancelling or failing the draft creates no Payee.
12. Concurrent saves of the same new matching name reuse one Ordinary Payee
    and save both otherwise-valid Transactions.
13. **Manage Payees** opens `/plans/$planId/payees` from the Plan switcher menu.
14. The manager lists searchable, alphabetically ordered Ordinary Payees with
    Transaction counts that include Closed Accounts.
15. The manager can create an unused Ordinary Payee under the common naming
    and uniqueness rules.
16. Renaming a Payee updates its label on every referencing Transaction,
    including historical Transactions in Closed Accounts.
17. Renaming to another Payee's matching name is rejected rather than silently
    merging.
18. Every deletion requires confirmation and reports the number of affected
    Transactions, including when that number is zero.
19. Deleting a used Payee requires reassignment to another Ordinary Payee in
    the same Plan or to No Payee.
20. Reassignment and source deletion are atomic, affect Transactions in Open
    and Closed Accounts, and never delete Transactions.
21. Reassigning to another Ordinary Payee performs a Payee Merge; the source
    ceases to exist and its previous name is not retained as an alias.
22. Unused Ordinary Payees remain available until explicitly deleted.
23. Transfer Payees remain virtual Account-derived options and are never
    created, renamed, merged, or deleted through Manage Payees.
24. Invalid, cross-Plan, or unowned identifiers cannot read or mutate Payees or
    reveal inaccessible record existence.
25. Failed creates, renames, merges, and deletions preserve both persisted data
    and the user's actionable input.
