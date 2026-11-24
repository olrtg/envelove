# Reconciliation

## Status and goal

Implemented, including database migration and register flows. The behavior below
follows YNAB web Sandbox checks, including Account eligibility, Credit adjustments, future
dates, and Transfer reassignment/removal. Explicit app adaptations and limits
of the observations are called out separately.

Let a user confirm that an Account's current Cleared Balance matches the
real-world posted balance, investigate differences, and explicitly create a
Reconciliation Balance Adjustment when necessary. Previously verified entries
remain correctable rather than immutable.

This extends [Transactions](./transactions.md) with Reconciled status and
reconciliation-aware edits. It also extends [Transfers](./transfers.md) with
warnings when a mutation affects a reconciled counterpart. Earlier documents
describe their original slices; their two-state assumptions do not define this
feature.

## Scope

- Reconcile one Open Account from its register, not All Accounts.
- Compare the current Cleared Balance, including Reconciled Transactions,
  with the real-world posted balance. Exclude pending/Uncleared Transactions
  and Transactions after the Current Day.
- No statement date, historical cutoff, or statement-period workflow.
- Support matching balances, investigating differences, and explicit
  adjustments. Never create an adjustment merely because balances differ.
- Show Reconciled status in both Account registers and All Accounts, and apply
  the same mutation rules wherever a Transaction can be edited.
- Closed Accounts remain read-only. Reconciliation does not bypass that rule.
- Include Cash (Checking, Savings, Cash), Credit (Credit Card, Line of Credit),
  and Tracking (Asset, Liability) Accounts.
- Exclude the Loans group. YNAB uses a separate **Update Balance** / **Add
  Activity** workflow for Loans; implementing that workflow is not this slice.

## Reconciled Transactions and balances

- The user-visible states are Uncleared, Cleared, and Reconciled. Reconciled
  Transactions still count toward Cleared Balance; they are not a fourth
  balance or an additional contribution to Working Balance.
- A successful reconciliation marks all eligible Cleared Transactions in the
  Account Reconciled. Already Reconciled Transactions remain so. Uncleared
  Transactions stay Uncleared, even when their dates are old.
- Each side of a Transfer has its own status. Reconciling one Account does not
  reconcile the other side or change its clearing status.
- Display a lock icon with the accessible label **This transaction is
  reconciled** in place of the clearing toggle. Clicking it does not unlock or
  un-clear the Transaction.
- Reconciled means previously verified, not permanently correct or uneditable.
  Approved edits retain the marker except when moving the Date into the future;
  deletion removes the Transaction.
- Display when the Account was last successfully reconciled. Editing a
  reconciled entry does not constitute a new reconciliation or refresh that
  timestamp. Moving a reconciled entry into an Account does not mark that
  destination Account as newly reconciled.
- Provide a way to hide/show reconciled rows. Hiding them never changes balance
  calculations. After successful reconciliation, YNAB hid them in the tested
  flow and offered **View All** to reveal them; support that focused view and
  recovery action without requiring a general-purpose filter system.

The Advanced Plan setting **Always show reconciled transactions after reconciliation**
starts unchecked. Turning it on keeps the full register visible after completion.
Either setting allows manual hide/show and newly opened registers show all rows.

## Matching-balance flow

The register shows Cleared Balance + Uncleared Balance = Working Balance in a
single strip. The balance question and bank input share a popover anchored to
**Reconcile**. Its expandable help explains how to find the posted balance.
A mismatch opens a dialog showing the signed difference. **Continue** returns
focus to the register, where the discrepancy stays visible during corrections.

1. The user activates **Reconcile** in the Account header.
2. A prompt asks **Is your current balance [Cleared Balance]?**, with **No**
   and **Yes** actions and help explaining which bank balance to use.
3. **Yes** completes reconciliation without creating a Transaction or changing
   any amounts. Persist Reconciled statuses and the Account's last-reconciled
   timestamp together.
4. **No** opens **Current balance at your bank**, with a balance input and
   **Next**. There is no date input.

The balance input follows the Plan's currency and locale, accepts zero and
negative balances, and requires valid supported precision. Unlike a Transaction
Amount, a target balance may be zero. For a Credit Account, debt is negative;
the target is not the Credit Payment Category's Available. Match YNAB's Credit
input convention: unsigned `300` means debt of −300, explicit `-300` also means
debt, and `+300` means a positive balance. Normalize and visibly display the
signed target before completion so a credit balance cannot be mistaken for
debt. Other Account inputs use ordinary signed amounts.

If the entered balance already matches, finish without creating a zero-value
adjustment. The exact label for this zero-difference branch was not observed;
use **Finish Reconciliation** rather than an adjustment action.

## Investigating a mismatch

Define the difference as the entered bank balance minus the current Cleared
Balance. A positive difference needs an inflow; a negative difference needs an
outflow if the user chooses an adjustment.

- Explain the difference and suggest comparing unlocked entries with bank
  records before creating an adjustment.
- Continue into the register with a persistent discrepancy banner, keeping
  normal entry, correction, and clearing actions available.
- State both the amount and direction in plain language. The observed banner
  read **This account's cleared balance in YNAB is Gs200 higher than your
  actual account.**
- Recompute the difference after successful Transaction mutations. When it
  reaches zero, offer **Finish Reconciliation** with no adjustment.
- While a nonzero difference remains, offer **Cancel** and **Create Adjustment
  & Finish**. The latter is the explicit confirmation; do not add a second
  confirmation dialog.
- Cancelling exits reconciliation without creating an adjustment or marking
  additional entries Reconciled. Separately saved corrections remain saved;
  cancellation is not an undo of register edits.
- Do not discard an active Transaction draft when starting or finishing
  reconciliation. Follow the existing one-active-draft rule.

The YNAB explanation included **Don't Show Again**. Persisting a preference to
skip this introductory explanation is deferred; it must not suppress the live
discrepancy banner or the explicit adjustment action.

## Reconciliation Balance Adjustments

On **Create Adjustment & Finish**, create one Transaction for the current
difference and finish reconciliation in the same atomic operation:

- Account: the Account being reconciled.
- Date: the Current Day at completion, not a selected Plan Month.
- Amount: bank balance minus Cleared Balance, in milliunits.
- Payee display: **Reconciliation Balance Adjustment**.
- Memo: **Entered automatically by YNAB** was the observed reference copy;
  our app should use **Reconciliation balance adjustment** rather than claim
  YNAB created it.
- Status: Reconciled immediately.
- For a Cash Account: Category **Inflow: Ready to Assign**, for either an
  inflow or an outflow. It therefore changes Ready to Assign through the
  existing budget calculation, not an ordinary Category's Activity.
- For a Credit Account: also display **Inflow: Ready to Assign**, but use the
  Credit adjustment rules below, not ordinary cash-income or purchase logic.
- For a Tracking Account: no Category. Change its Account balances without
  affecting Ready to Assign or Category amounts.

The adjustment remains visible whenever reconciled entries are shown and
editable/deletable under the same warning rules as other reconciled entries.
Balances remain derived from Transactions; do not overwrite or maintain an
independent Account balance. Do not change Assigned amounts to conceal the
effect of an adjustment.

### Credit adjustments

A Credit adjustment changes debt without automatically reserving payment money.
Its direct Ready to Assign effect is the change in the positive portion of the
card balance; changes that remain entirely in debt have no such effect. It
does not itself change the Credit Payment Category's Assigned, Activity, or
Available. Its displayed debt/positive balance still updates.

The following isolated cases were exercised with all card entries Cleared and
payment Assigned/Activity/Available fixed at Gs400 / Gs0 / Gs400:

| Before   | Target   | Adjustment | Ready to Assign change |
| -------- | -------- | ---------- | ---------------------- |
| −Gs1,000 | −Gs1,300 | −Gs300     | Gs0                    |
| −Gs1,000 | −Gs700   | +Gs300     | Gs0                    |
| −Gs1,000 | +Gs300   | +Gs1,300   | +Gs300                 |
| +Gs300   | −Gs200   | −Gs500     | −Gs300                 |
| +Gs300   | +Gs600   | +Gs300     | +Gs300                 |

The adjustment Amount still uses Cleared Balance. Budget effects use the
ordinary dated ledger, which includes current/past Uncleared entries too;
do not substitute the bank target for the card's budget balance. Recompute
downstream ledger effects after corrections rather than persisting a Ready to
Assign delta. These isolated examples do not assert that other Transactions'
funded-spending calculations can never change when a card balance changes.

**Implementation consequence:** the current `ready_to_assign` Credit outflow
path in `src/features/budget/budget-engine.ts` deducts the full outflow from
Ready to Assign and reserves newly created debt for payment. That is not the
observed reconciliation-adjustment behavior. Preserve ordinary Transaction
behavior and distinguish actual adjustments persistently; do not infer them
from editable Payee or Memo text, or from Reconciled status alone. Editing an
adjustment's Amount, Date, or descriptive text must not lose that identity.
Choosing an ordinary Category or converting to a Transfer instead invokes
that chosen Transaction's normal budget rules, rather than bypassing them
because the entry originated as an adjustment. This lifecycle policy is an
app requirement, not an independently tested YNAB conversion rule.

## Editing and deleting reconciled entries

Compare actual saved values with the proposed values. Focusing a field or
saving unchanged data is not a reason to warn. If several fields change,
show one confirmation when any changed field requires it.

| Operation                                                             | Warning                           | Result                               |
| --------------------------------------------------------------------- | --------------------------------- | ------------------------------------ |
| Change Amount, including inflow/outflow direction                     | Save confirmation                 | Retain Reconciled                    |
| Change Payee                                                          | Save confirmation                 | Retain Reconciled                    |
| Change a current/past Date to another current/past Date               | None                              | Retain Reconciled                    |
| Change Date to after the Current Day                                  | None for the Date change alone    | Become future-dated and Uncleared    |
| Change Category or Memo                                               | None                              | Retain Reconciled                    |
| Move an ordinary Transaction to another Open Account in the same Plan | None for the Account change alone | Retain Reconciled in the destination |
| Delete                                                                | Delete confirmation               | Remove the Transaction               |
| Click the Reconciled status icon                                      | No state transition               | Retain Reconciled                    |

The tested current/past Date edit was Current Day to the previous day. Extending
that rule to all current/past dates is the intended scope, not an exhaustive
YNAB test.

### Future dates

YNAB saved a reconciled November 7 entry as a November 10 Scheduled Transaction
without warning. It disappeared from current balances and had no clearing/lock
control. Editing it back to November 7 made it Uncleared and needing approval;
it did not regain its Reconciled marker.

Our app has future-dated Transactions, not YNAB's separate scheduling/approval
workflow. Apply the existing future-date draft behavior to Reconciled entries:
selecting a future Date makes the draft Uncleared, disables clearing with
**Future Transactions cannot be Cleared.**, and excludes the saved entry from
current balances. Returning to a current/past Date does not restore Cleared or
Reconciled status. Cancelling a draft leaves the persisted entry untouched.
Server validation rejects a future-dated Cleared/Reconciled combination rather
than silently rewriting an invalid request. Do not add scheduling or approval
features to reproduce YNAB's storage model.

For a Transfer, apply the future-date draft transition to both linked sides,
atomically, because they share one Date. This is an explicit app adaptation
of the observed ordinary-entry behavior, superseding the earlier Transfer
rule that rejected the edit while either side was Cleared. Show the shared
status change in the draft; neither side automatically regains its old status.
Date alone does not introduce a save warning, but an accompanying Amount or
Payee change still does.

### Save confirmation

Title: **Save Changes to Reconciled Transaction**

Body: **Saving your changes to this reconciled transaction may bring your
reconciliation out of balance.**

Actions: **Cancel** and **Save**. Cancellation leaves persisted data unchanged
and keeps the draft available for correction. Confirmed saves retain the
Reconciled marker unless the Date is moved into the future. A failed save must
not partially apply any fields.

### Delete confirmation

Title: **Delete Reconciled Transaction?**

Body: **Deleting a reconciled transaction will bring the reconciliation out
of balance.**

Actions: **Delete** and **Cancel**. Use this in place of, not in addition to,
the ordinary deletion confirmation.

### Scope of Payee warnings

This rule concerns changing a Transaction's selected Payee, including changing
it to a Transfer Payee. It does not add per-Transaction confirmations to
Plan-wide Payee rename/merge operations or Category reassignment workflows.
Those workflows retain their existing authorization and atomicity rules.

## Transfers and account moves

- An edit to the Amount on an unreconciled side must also inspect the linked
  side. If that side is Reconciled, warn before changing either side. The same
  applies when a Payee change moves or removes a reconciled counterpart.
- Use **Save Changes to Reconciled Transfer** and name the counterpart Account:
  **This transfer has already been reconciled in [Account]. Any changes to
  this transaction will automatically modify the matching, reconciled
  transaction in [Account] and may bring the reconciliation out of balance.**
- When the counterpart is Reconciled, use that named-account Transfer warning
  even if the edited side is also Reconciled. Otherwise use the ordinary
  reconciled-Transaction warning when the edited side requires it. Show one
  confirmation, not one per side.
- Confirmed edits preserve each existing side's Reconciled status except for
  the future-date rule above. A newly
  generated counterpart starts Uncleared; converting a reconciled ordinary
  Transaction to a Transfer does not reconcile the new side.
- Deleting from an unreconciled side with a Reconciled counterpart shows
  **Delete Reconciled Transfer?**, explains that both sides will be deleted,
  and warns that matching transfers have been reconciled and deletion may
  unbalance those reconciliations. The same dialog was observed with both
  sides Reconciled. Use one reconciliation-aware deletion confirmation if
  either side is Reconciled; delete both sides atomically after confirmation.
- Converting an unreconciled side to an Ordinary Payee showed **Save Changes
  to Reconciled Transfer** naming the reconciled counterpart Account. **Save**
  retained the edited entry and removed the counterpart, without a second
  unlink confirmation. Keep the existing unlink explanation that names the
  removed Account, combined with the reconciliation warning in one dialog.
  That explicit removal explanation is our adaptation; YNAB's observed copy
  said the matching Transaction would be modified rather than removed.
- Preserve the existing equal-and-opposite Amounts, shared Date/Memo, ownership,
  and Closed Account restrictions. Reconciliation never permits a partial
  Transfer mutation.
- Ordinary account reassignment must not reset Reconciled status. Preserve
  existing behavior for entries that are not Reconciled; that behavior was
  not part of this investigation.
- Changing a Transfer Payee to a different Account preserves a moved
  counterpart's Reconciled marker and warns when that counterpart is
  Reconciled. The unchanged side also retains its status. The destination
  Account is not thereby marked as newly reconciled.
- Extend this retention policy to moving a Reconciled Transfer row via its
  Account field in All Accounts (an app consistency requirement, not a
  separately exercised YNAB action). The original reset-to-Uncleared rule
  remains for moved sides that are not Reconciled.

## Persistence, authorization, and freshness

These are application integrity requirements, not observations of YNAB's
internal implementation:

- Persist Transaction reconciliation status and an optional Account
  last-reconciled timestamp. Existing Transactions remain unreconciled on
  migration, preserving their current Cleared/Uncleared values; existing
  Accounts have no invented reconciliation timestamp.
- Ensure Reconciled implies Cleared. Ordinary creation and the Plan's default
  clearing preference must not create Reconciled entries.
- Keep user-entered target balance and in-progress reconciliation transient;
  a durable reconciliation history/session model is not required by this slice.
- Authorize the Account through its Plan owner and recheck its Open state at
  completion. Apply existing same-Plan and both-Accounts checks to Transfers.
- Re-read eligible Transactions and compute Cleared Balance in the same
  database transaction that marks statuses, creates an optional adjustment,
  and records completion. A failure commits none of them.
- A stale preview must not silently reconcile new or changed rows or create
  an adjustment different from what the user saw. Refresh the reconciliation
  state and require review again, even if offsetting edits leave the total
  unchanged. Disable duplicate submission and prevent a retried completion
  from creating a duplicate adjustment.
- Warning requirements must be derived from current stored rows, including
  linked counterparts, rather than trusting the client's status flags. A
  confirmation applies to the proposed edit, not arbitrary subsequent edits.
- Refresh register rows, Account/sidebar balances, and the last-reconciled
  label after success. Adjustment creation or amount/category/date changes
  must also refresh affected budget calculations and invalidate cached Plan
  Months using existing mechanisms.

## Verification evidence

Observed in the YNAB web Sandbox in November 2026. The discussion and browser
captures are in the [reconciliation scoping thread](https://ampcode.com/threads/T-01a1b2ff-3c1a-776e-a1b4-caf9ce260c45).

- Audit Checking had Gs5,000,000 Cleared and Gs4,200,000 Working. Reconcile
  proposed Gs5,000,000 and exposed no statement-date field; the prompt was
  cancelled without reconciling existing history.
- A temporary Checking Account held a Gs1,000 ordinary inflow using an existing
  Payee, with Memo **Reconciliation UX probe**. After reconciliation, changing
  Amount to Gs1,200 and changing Payee each triggered the save warning and
  retained the lock after confirmation. Each change was undone separately.
- Changing only Date from November 7 to November 6, only Memo, and only Category
  to Annual Services each saved without a warning and retained Reconciled.
- Confirmed deletion removed the entry; Undo restored it. Clicking its lock
  did not un-clear or unlock it.
- Entering a bank balance of Gs800 against Gs1,000 Cleared produced a negative
  Gs200 difference. **Create Adjustment & Finish** created a reconciled Gs200
  outflow through **Inflow: Ready to Assign**, leaving Gs800 Cleared, without
  another confirmation.
- Converting the reconciled ordinary entry to a Transfer created an Uncleared
  counterpart in Savings. Editing that counterpart's Amount from Gs1,000 to
  Gs1,300 showed the named-account Transfer warning; confirmed changes updated
  both Amounts.
- In the earlier session, a reconciled Gs1,000 Starting Balance was moved from
  temporary Checking to Savings and separately to a credit card. Both moves
  preserved the lock and showed no **Move to Account** warning.
- Reconcile prompts were available for Checking, Savings, Cash, Credit Card,
  Line of Credit, Tracking Asset, and Tracking Liability. Completion and
  adjustments were exercised on Checking, Credit Card, and Tracking Asset;
  the other eligible types were checked for the entry prompt, not every branch.
- A Personal Loan displayed **Update Balance** and **Add Activity**, not
  Reconcile. Other Loan subtypes were not individually exercised; excluding
  the whole Loans group follows YNAB's separate Loan workflow.
- A Tracking Asset adjustment from Gs1,000 to Gs800 created a reconciled Gs200
  outflow without a Category column or Ready to Assign change.
- Credit adjustments covered every row of the table above, checking the Plan's
  Ready to Assign and payment Assigned/Activity/Available after each change.
  Unsigned `300` produced −Gs300 debt; `+300` produced a positive Gs300 balance.
- Future-dating the reconciled Gs1,000 Checking entry to November 10 excluded
  it from balances and removed its lock. Moving it back to November 7 without
  Undo made it Uncleared and needing approval; both edits showed no warning.
- With both Transfer sides Reconciled, changing the Payee moved a Gs1,000
  counterpart from Credit Card to Cash after the named-account warning. Its
  lock survived in the new Account, whose header still said **Not Yet
  Reconciled**.
- Deletion from the counterpart with both sides Reconciled and again with only
  the opposite side Reconciled showed **Delete Reconciled Transfer?**. Confirmed
  deletion removed both entries. Converting the unreconciled counterpart to
  an Ordinary Payee warned and removed the reconciled opposite entry.
- Test edits and payment assignments were undone, and all six temporary
  Boundary Accounts were removed. Original Working Balances were restored:
  Checking Gs4,200,000; Savings Gs250,000; Card −Gs50,000; Travel Card Gs5,000;
  Line Gs0. Ready to Assign returned to Gs3,965,000. Existing history was not
  reconciled as part of these checks.

Reference documentation:

- [Reconciling Accounts](https://support.ynab.com/en_us/reconciling-accounts-a-guide-BJFE3fHys)
- [Balance Adjustments](https://support.ynab.com/en_us/balance-adjustments-a-guide-rko4OwILs)

## Acceptance criteria

1. Reconcile compares Cleared, including Reconciled, rather than Working Balance;
   pending and future entries do not enter that comparison.
2. Matching Gs1,000 with Gs1,000 changes statuses and completion time only,
   leaves Uncleared entries untouched, and creates no zero-value Transaction.
3. A Gs800 target against Gs1,000 Cleared previews and creates a Gs200 outflow;
   a Gs1,300 target previews and creates a Gs300 inflow. Signed and zero target
   balances follow currency precision rules.
4. No mismatch adjustment occurs without **Create Adjustment & Finish**, and
   that action does not introduce an extra confirmation dialog.
5. Cash adjustments appear as reconciled **Reconciliation Balance Adjustment**
   entries through **Inflow: Ready to Assign**, affecting derived balances and
   budget amounts correctly.
6. Correcting or clearing entries updates the discrepancy. Resolving it to zero
   finishes without an adjustment. Cancel does not undo saved corrections.
7. Amount and Payee edits warn; current/past Date, Category, and Memo-only edits
   do not. Confirmed current/past saves preserve Reconciled; cancelled saves
   change nothing.
8. Ordinary account moves retain Reconciled without an Account-change warning.
   An additional Amount/Payee change still triggers its own save requirement.
9. Deleting a reconciled entry requires the reconciliation-aware confirmation.
10. Editing an unreconciled Transfer side's Amount warns when its counterpart is
    Reconciled, naming the counterpart Account, and updates both sides atomically.
11. Reconciliation neither changes the other Transfer side's status nor permits
    editing a pair with a Closed Account.
12. Account and All Accounts views expose the same statuses and mutation rules;
    All Accounts cannot reconcile multiple Accounts as one balance.
13. Hidden reconciled rows remain included in balances and can be revealed with
    **View All**. Lock indicators have accessible names.
14. Stale state, duplicate completion, invalid amounts, unauthorized access, or
    an Account closing during the flow cannot produce partial or misleading
    reconciliation results.
15. Migration preserves existing balances and clearing flags without fabricating
    reconciliation history. Failed completion preserves the user's target and
    gives a retryable error.
16. Reconcile is available only for Open Cash, Credit, and Tracking Accounts,
    never Loans; enforce eligibility on the server too. A Tracking adjustment
    from Gs1,000 to Gs800 has no Category and leaves budget amounts unchanged.
17. Every Credit adjustment example above produces the specified Amount and
    Ready to Assign change while payment amounts remain Gs400 / Gs0 / Gs400.
    Unsigned `300` and signed `+300` resolve to different targets. Include a
    current/past Uncleared entry when verifying that only adjustment sizing,
    not the entire budget ledger, uses Cleared Balance.
18. Credit adjustment treatment survives edits to descriptive text; an ordinary
    Transaction with the same Payee/Memo does not gain adjustment treatment.
    Changing Category or converting to a Transfer applies the chosen kind's
    budget rules. Existing ordinary Credit outflow behavior remains unchanged.
19. Selecting a future Date removes reconciliation/clearing from the saved
    entry without a Date-only confirmation; on a Transfer it affects both
    sides atomically. Returning to today does not restore either status.
    Cancelling the draft restores the original persisted state; invalid
    future-dated Cleared/Reconciled requests are rejected.
20. Changing a Transfer Payee preserves a Reconciled moved counterpart, warns
    naming its old Account, and does not mark the destination Account newly
    reconciled. Moving an unreconciled side retains the original reset rule.
21. Deleting or unlinking from either side inspects both stored statuses and
    shows one combined confirmation if either is Reconciled. Deletion removes
    both rows; unlinking retains only the edited row. Cancel changes neither.

## Integration with the current register

Completion participates in whole-app Undo and Redo as one saved action. The original deferral below describes the recovered scope. Reassigning a Transfer row also changes the opposite row’s effective Payee. If that opposite row is Reconciled, the confirmation names its Account. A failed deletion leaves its confirmation open with an accessible error and a retry action.

Migration 0012 also supplies the standard Inflow: Ready to Assign category to starter Plans missing it. New starter Plans use the same initializer as subsequent Plans.

## Deferred

- Dated statements and historical reconciliation cutoffs.
- Bank synchronization, imported balances, and duplicate-import prevention.
- Loan balance/activity workflows and a separate scheduling/approval system.
- Reconciliation history screens and a general audit log.
- General register search, bulk-edit UI, and unrelated filtering controls.
- A persistent **Don't Show Again** preference for the discrepancy explanation.
- General undo/redo and a dedicated unlock/unreconcile workflow. YNAB's immediate
  Undo reversed the test reconciliation, but matching its whole undo system is
  outside this slice. Reconciled is not an ordinary toggleable clearing state.
