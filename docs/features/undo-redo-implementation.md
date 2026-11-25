# Undo/Redo implementation

Implements the agreed [design](undo-redo.md), copied unchanged from the planning
checkout before implementation. No goals or reconciliation feature was added.

## Mutation inventory

All existing saved Plan POST endpoints pass through `savedAction` and
`captureAction`. Several user actions share an endpoint; all writes inside the
operation belong to its single receipt.

| Area            | Endpoints                                                                                        | Included behavior                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Budget          | `setCategoryAssigned`, `moveMoney`                                                               | Assignment presence and amount; Money Move, Ready to Assign endpoints, Cover Overspending, both months/sides                             |
| Transactions    | `createTransaction`, `updateTransaction`, `deleteTransaction`                                    | Ordinary transactions, inline Payee creation, cleared status, linked Transfers, Credit Payments, explicit unlinking and both linked rows |
| Categories      | `createCategory`, `updateCategoryName`, `updateCategoryHidden`, `moveCategory`, `deleteCategory` | Creation, name, hide/unhide, reordering and group moves, hard deletion, assignments and reassigned transaction references                |
| Category Groups | `createCategoryGroup`, `updateCategoryGroupName`, `reorderCategoryGroups`, `deleteCategoryGroup` | Group and child restoration under original IDs; ordering and assignments                                                                 |
| Payees          | `createPayee`, `renamePayee`, `deletePayee`                                                      | Stable IDs; delete with destination implements merge and restores reassigned references                                                  |
| Accounts        | `createAccount`, `updateAccount`                                                                 | Rename, close/reopen; generated credit payment group/category included in creation                                                       |
| Plan            | `updatePlanSettings`                                                                             | Name, country/currency and default cleared preference                                                                                    |

`createPlan`, authentication, route/search state, collapsed groups, drafts and
unfinished text are excluded. There are 20 wrapped mutation endpoints. The only
other feature POST endpoint is the reversal endpoint itself.

## Server authority and atomicity

SQLite temporary triggers capture actual database writes inside an IMMEDIATE
transaction. They are removed in `finally`. Coalescing multiple writes to the
same key produces a single before/after pair. Updates retain only their changed
business fields; creations/deletions retain complete rows. `updated_at` alone is
not a history action or conflict. Updated rows keep their latest metadata
timestamp; inserted/restored rows retain their recorded timestamps and IDs.

Existing async SQLite mutation helpers were made synchronous with explicit
`.all()`/`.run()` execution so there is no await inside the transaction. Existing
nested Drizzle transactions use savepoints. Authentication completes before the
transaction; domain validation, mutation, capture and receipt storage commit
atomically. Failure rolls everything back. No-op operations produce no stack entry
and preserve redo.

The `action_receipts` table (migration 0011) holds server-owned operational
receipts and serialized retry results, not the user's browser stacks. Clients
submit Nano IDs, a direction and an expected receipt generation. They cannot submit
record/field patches. Receipts bind owner, tab token and Plan; every reversal and
retry checks current Plan ownership. Input reuse with a different operation is
rejected. Browser history cannot be listed or reconstructed from the server.

Receipts are durable to make lost responses safe across process restarts. They
currently have no automatic retention cleanup. They contain historical private
Plan values and must receive the same database protection as current Plan data.
The binary payload format uses Node V8 serialization; it is an internal format,
not an API or portable export contract. This is backend operational storage;
reload/logout still discards all client stacks and tab identity.

Before reversal, the server compares the affected fields (entire business row for
a deletion), structural parent dependencies, and affected ordering collections.
It checks for new incoming children before deleting a parent, including cascade
relationships. This protects another session's newly created Transactions,
Categories and assignments. Transaction restoration checks closed Accounts.
Parent creation, reference updates and dependent-first deletion execute inside
one transaction with deferred foreign keys. SQLite constraints and additional
transfer/Plan integrity checks validate the final state before commit.

Independent fields survive: undoing a name change preserves a visibility edit;
undoing a closed flag preserves a newer Account name. Changes to the same saved
field, deleted references, changed structural dependencies or a changed ordering
collection reject the complete action. This uses current-state equality, not a
Plan-wide revision. Structural conflicts are intentionally conservative (for
example a relevant Account closing or Plan currency change). Equal values after
an intervening edit are treated as the same affected state.

Blocked entries remain at the top of their branch. Failure neither pops the entry
nor skips to an older one. There is no force operation or silent discard. Reload
is an explicit way to clear the tab's history.

## Client behavior

Module memory stores separate stacks by Plan; each browser tab has its own Nano ID.
Navigation preserves the stacks. Successful new saved actions clear only that
Plan's redo branch. A global per-tab lock prevents overlapping saved requests and
reversals. A logout/unmount epoch prevents late responses from repopulating old
history. Nothing is placed in localStorage, sessionStorage or browser persistence.

Transport failures retain the exact request closure and operation ID. Controls
show **Retry save** and block subsequent saves/reversals. A retry retrieves the
committed result or performs the previously uncommitted request; generation checks
and persisted results prevent double reversal. Domain conflicts remain failures.
Reload after an ambiguous result abandons the local history, not the saved action.

Undo/Redo buttons expose disabled state, descriptions and keyboard shortcuts.
Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Ctrl+Y work outside inputs, textareas, editable
content and textboxes. Native text undo keeps control inside those fields.
Success toasts identify the action, affected names/dates, and assignment amounts
and months when applicable. Failure toasts explain rejection.

After confirmed reversal, the client reveals the recorded Account or Plan Month,
invalidates Query caches, clears inactive Router caches, reloads active loaders
and remounts route contents that own local copies of loaded data. The authenticated
shell and history controls remain mounted; the sidebar reloads its local Plan
settings list too. This remount is necessary because the
existing budget/register components keep local state. It can reset selection,
collapsed groups and unsaved local view state. Data itself remains server-owned.

Exact reference divergence: the affected screen is revealed **after** server
confirmation, whereas the observed YNAB client navigates before reversal. Failed
conflicts therefore leave the user on their current screen. Payee and settings
actions reveal the Plan screen; Transaction actions reveal their Account.

## Verification evidence (2026-11-13)

Integration tests use newly migrated temporary SQLite files, never a private or
production database. They cover field conflicts, unrelated edits, no-ops,
rollback, original-ID deletion restoration and references, assignment row presence,
credit payment categories, Transfer pair create/edit/clear/delete, Credit Payments,
Payee merge, Money Move, Cover Overspending, Account close/reopen, settings,
category/group operations, ordering membership changes, ownership, forged receipts,
stale generations and duplicate requests. Client tests cover Plan isolation,
redo branching, serialization, ambiguous retry identity and logout response races.
The existing budget/balance calculation suite also runs.

Browser QA used headless Chrome through Playwright with only a freshly seeded
`/private/tmp/envelove-undo-qa/fixture.sqlite`. The thread's T3 preview capability
was disabled; its tool explicitly directed a headless browser fallback. Two tabs
verified independent histories, unrelated assignments surviving undo, overlap
rejection with history retained, redo, reload reset, navigation from All Accounts
back to the Plan, refreshed Ready to Assign/availability, new edits clearing redo, switching Plans without losing their separate branches,
and logout clearing both stacks,
text-field shortcut exclusion, app shortcuts and a response deliberately dropped
after server completion followed by a successful single-application retry. No
page errors were observed. Browser automation and screenshots are temporary
artifacts in that directory, not repository files.

Browser coverage is representative: the deletion/merge/transfer matrix is tested
at the integration layer rather than every dialog being manually exercised.
Multiple-device hardware, live production data and the user's YNAB sandbox were
not used. No deployment, production migration, push, PR or commit was performed.

Final checks: all 115 tests pass. TypeScript and the
production Vite build passed. Formatting passes for every changed/new file.
The whole-repository formatting check reports 32 existing files (skills, older
migration snapshots and registry components); those files were left untouched. Lint's existing
`src/components/ui/sidebar.tsx` no-shadow warnings are outside this feature.
React Doctor's changed-file scan reported no findings with an aggregate score of
49; a full scan included the new untracked files and reported existing repository
diagnostics (27/100). The final full scan has no diagnostics in the new history
files or modified shell. Its only new history warning was an Intl formatter allocation,
resolved using the existing cached formatter helper. No unrelated Doctor cleanup
was performed.
