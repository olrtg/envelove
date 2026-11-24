# Undo and redo

## Agreed behavior

Undo and redo cover saved changes within a Plan, across the app. Each browser tab
keeps its own in-memory history for each Plan, shared across that Plan's screens.
Reloading or logging out clears the history. Navigation, filtering, unfinished
text edits, authentication, and creating a Plan are outside this history.

One completed user action is one history entry. A Money Move reverses both sides
together; a Transfer reverses both linked Transactions; deleting a Category Group
restores the group, its Categories, assignments, ordering, and affected references
together. Derived balances recalculate from restored data.

Undo reverses the most recent applied action; redo reapplies the most recently
undone action. A new successful saved action clears that tab's redo path for the
Plan. Failed operations and no-op edits do not create entries. Unsaved text fields
retain native text undo behavior.

Each successful undo or redo shows a descriptive toast, for example:

- "Undid: moved Gs50,000 from Groceries to Vacation."
- "Redid: deleted category Dining out."

Failures show an explanation instead of a success toast. The history must only
advance when the operation succeeds, including handling ambiguous network results
without applying a reversal twice.

## Conflict protection

Undo and redo must not silently overwrite newer conflicting edits from another
tab or device. Unrelated edits should remain intact and should not invalidate the
entire history merely because the Plan changed.

The server must check the current affected state and dependent relationships,
validate ownership and domain invariants, and apply the complete reversal in one
database transaction. A client-only conflict check is insufficient. On a conflict,
apply nothing and show an explanatory toast, such as "Couldn't undo: this category
was changed in another session." Do not force the reversal or silently skip to an
older history entry.

Examples to protect:

- A edits a Transaction's amount; B corrects that amount; A's undo must not replace
  B's correction.
- A deletes a Category and reassigns its Transactions; B recategorizes one of
  those Transactions; restoring A's deletion must not silently overwrite B's work.
- A creates an Account; B adds Transactions to it; undoing creation must not delete
  B's Transactions.
- A undoes an action; B changes its affected data; A's redo must also detect the
  conflict.

Whether to retain an unexecutable entry for retry or explicitly discard a blocked
history branch is an implementation detail to document. Never report that an
action was undone when conflict handling merely removed its history entry.

## Implementation scope

Inventory all mutation paths on the implementation branch. Include assignments,
Money Moves and Cover Overspending, Transaction creation/editing/deletion and
cleared status, Transfers and Credit Payments, Category and Category Group
creation/editing/hiding/reordering/deletion, Payee creation/renaming/deletion/merge,
Account creation/renaming/closing/reopening, and Plan settings.

Goals and reconciliation were not present in the checkout examined during design;
do not implement new unrelated features to make them undoable. If the implementation
base now contains additional saved Plan actions, include them in the inventory.

Keep the undo/redo stacks in browser memory. The backend still owns authorization,
validation, and atomic reversal. Choose a narrow, auditable representation of the
affected records and fields; do not restore whole-Plan snapshots over newer work.
Do not trust arbitrary client-supplied database patches. Validate or authenticate
history payloads using an appropriate server-owned mechanism. The precise storage
and validation mechanism is an engineering choice, not a settled requirement.

Preserve the existing category-deletion decision: deleted records can be restored
under their original IDs from snapshots, including cascaded assignments and
reassigned references. Read `docs/adr/0003-deleted-categories-are-removed-not-tombstoned.md`.

Provide accessible Undo/Redo controls and keyboard shortcuts across Plan screens;
disable unavailable actions and prevent overlapping mutation/undo requests.
Use Cmd/Ctrl+Z for undo and conventional redo shortcuts without intercepting text
editing. YNAB navigates to the affected screen before reversing an action; use this
as the reference for revealing the affected Account or Plan Month. Refresh all
affected views and cached data after success.

## Reference evidence

Explored the user's YNAB Sandbox on 2026-11-13. Test amounts and names were restored;
all extra test tabs were closed. The existing user tab was retained.

- YNAB's published help says web undo/redo ends on reload or logout:
  <https://support.ynab.com/en_us/how-to-fix-mistakes-with-undo-and-redo-HJzO5CfA9>.
- Its currently shipped client bundle contains in-memory undo/redo arrays and
  grouped entity changes with original/new property values:
  <https://app.ynab.com/assets/ynab_web/assets/wrapper-D4x9ETpV.js>.
- Two fresh tabs started with empty, independent histories. Actions in one tab
  did not populate or clear the other tab's history in the tested sequences.
- Starting at Gs50,000, A assigned another Gs1,000 and B another Gs1,000. Undoing
  A left Gs51,000; redoing A returned Gs52,000. YNAB uses special Money Movement
  reversal logic. This does not establish conflict safety for arbitrary actions.
- A renamed Vacation, then B renamed it again. After A's undo and redo, A's name
  replaced B's saved name without a conflict warning. A freshly loaded observer
  tab confirmed the saved result. Explicit conflict protection is an intentional
  Envelove design choice.
- Synchronization between open tabs was not immediate. Fresh observer loads were
  used to check persisted results. Reloading both editing tabs cleared history.
- Undo from All Accounts of an assignment edit returned to the Plan screen.

## Acceptance and verification

- Inventory every existing saved Plan action and verify its undo/redo coverage.
- Test multiple undo/redo steps, a new edit clearing redo, no-op and failed edits,
  Plan isolation, reload/logout clearing history, and navigation preserving it.
- Verify exact restoration of deleted data and relationships, including credit
  payment categories, transfer pairs, hidden categories, closed accounts, Payee
  merges, and assignment rows whose presence affects the Plan Month range.
- Verify source/destination assignments, Ready to Assign, Account balances,
  category availability, and cached screens after reversal.
- Exercise simultaneous tabs/devices: unrelated changes survive, conflicting
  fields and dependent records are protected, and no partial operation succeeds.
- Verify ownership boundaries, forged or stale history payload rejection,
  double-clicks, in-flight requests, and retry behavior after a lost response.
- Browser-check toolbar controls, text-edit shortcuts, cross-screen behavior,
  toasts, refresh, and multiple tabs using isolated fixture data.
- Run repository tests, type-check, lint, formatting, build, and applicable React
  Doctor checks. Follow AGENTS.md and load matching TanStack guidance before edits.
- Keep implementation local; do not commit, publish a PR, push, or deploy without
  a later request. Preserve existing private databases and configuration.

### Account reconciliation

Completing reconciliation creates one saved action covering the Account timestamp, newly verified entries, and any adjustment. Undo and Redo check the posted entries used for that reconciliation and the Account’s Open state. A conflict leaves the entire action untouched. See [Reconciliation](./reconciliation.md).
