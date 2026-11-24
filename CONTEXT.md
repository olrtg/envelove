# Budgeting

This context describes how a Plan organizes Accounts, Transactions, and Categories to track and budget money.

## Language

### Accounts and Transactions

**Account**:
A financial account that belongs to exactly one Plan and contains its Transactions. Account names are not required to be unique within a Plan.

**Credit Account**:
An Account whose type is Credit Card or Line of Credit.

**Cash Account**:
An Account whose type is Checking, Savings, or Cash.

**All Accounts**:
A unified view of Transactions across every Open and Closed Account in one Plan, with each Transaction's Account identified.

**Closed Account**:
An Account retained for historical access but unavailable for Transaction creation or modification until reopened. Plan-wide reassignments, such as a Payee Merge or deleting a Category, still update its Transactions' references.

**Current Day**:
The calendar day in the user's local time zone at the moment balances are viewed. Transactions dated after the Current Day do not contribute to balances.

**Account Balance**:
The sum of Transaction Amounts dated on or before the current calendar day in an Account. It is derived from Transactions rather than maintained as a separate value.

**Reconciliation**:
Verification of one Open Cash, Credit, or Tracking Account’s Cleared Balance against its posted bank balance on the Current Day.

**Reconciled Transaction**:
A previously verified Cleared Transaction. Its lock identifies that verification. Each side of a Transfer is verified independently.

**Reconciliation Balance Adjustment**:
An explicitly authorized Transaction for the signed difference between the posted bank balance and Cleared Balance. Its credit budget treatment depends on its stored identity and current Category.

**Cleared Balance**:
The sum of Amounts for Cleared Transactions dated on or before the current calendar day in an Account.

**Uncleared Balance**:
The sum of Amounts for Uncleared Transactions dated on or before the current calendar day in an Account.

**Working Balance**:
The sum of an Account's Cleared Balance and Uncleared Balance.

**Account Group**:
A fixed classification of Accounts by type: Cash, Credit, Loans, or Tracking. Every Account belongs to exactly one Account Group determined by its type.
_Avoid_: Account section, account category

**Account Group Balance**:
The sum of the Working Balances of the Open Accounts in one Account Group. Closed Accounts do not contribute.

**Transaction**:
A financial entry that belongs to exactly one Account and may reference one Category from the same Plan. It is dated by calendar day rather than by an exact time, may be future-dated, and cannot exist without an Account. It may be reassigned between Open Accounts in the same Plan; Transactions in Closed Accounts remain read-only.

**Transfer**:
A single movement of money between two distinct Accounts in the same Plan, represented in those Accounts by linked Transactions with equal and opposite Amounts. A Transfer has no Category.

**Credit Payment**:
A Transfer from a Cash Account to a Credit Account that uses money from the Credit Account's paired Credit Payment Category. Its linked Transactions have no Category.

**Balance Transfer**:
A Transfer between two Credit Accounts that moves debt between them. It does not itself move money between their Credit Payment Categories.

**Cleared Transaction**:
A Transaction confirmed as posted by the financial institution or otherwise verified against the real-world Account. It cannot be future-dated; among current and past Transactions, Cleared status is independent of date.

**Uncleared Transaction**:
A Transaction not yet confirmed against the real-world Account. An Uncleared Transaction may have a past, present, or future date.

**Transaction Amount**:
The nonzero signed monetary quantity of a Transaction, expressed as an integer number of milliunits in the Plan's currency. A negative Amount is an outflow and a positive Amount is an inflow.

**Milliunit**:
One thousandth of a currency unit; for example, 12,345 milliunits represents 12.345 units of the Plan's currency.

**Transaction Memo**:
An optional short note describing the reason or context for a Transaction. A blank Memo is equivalent to no Memo.

**Payee**:
The counterparty to a Transaction. A Payee is either an Ordinary Payee or a Transfer Payee; Payee answers who was involved, while Transaction Memo records additional context.

**Ordinary Payee**:
A reusable named counterparty that belongs to exactly one Plan. Its name is unique among that Plan's Ordinary Payees regardless of letter case or surrounding whitespace; differently named Ordinary Payees may represent the same real-world counterparty until merged, and an Ordinary Payee may share a display name with a Transfer Payee.
_Avoid_: Saved Payee, custom Payee

**Payee Merge**:
The replacement of one Ordinary Payee with another in the same Plan. Every Transaction referencing the source is reassigned to the destination, and the source ceases to exist.
_Avoid_: Combine Payees, link Payees

**Transfer Payee**:
A system-managed Payee that represents an Account as the counterparty of a Transfer. Its display name follows the Account's name.
_Avoid_: Account Payee, payment payee

### Categories

**Category Group**:
A possibly empty collection of Categories within one Plan. Category Groups may be ordinary or internal.
_Avoid_: Group of categories, category section

**Ordinary Category Group**:
A user-created Category Group with a required, editable, non-unique name. Groups remain distinct even when their names match. Deleting one deletes all of its Categories, including Hidden ones; Transactions using them are reassigned to a single visible Ordinary Category outside the group.

**Internal Category Group**:
A system-managed Category Group whose name and membership are controlled by the app. Credit Card Payments and Inflow are Internal Category Groups.

**Category**:
A stable, named budgeting item that belongs to exactly one Category Group. Ordinary Categories may classify Transactions; Credit Payment Categories represent money reserved for payments on Credit Accounts; the Inflow: Ready to Assign Category routes money to Ready to Assign.

**Ordinary Category**:
A user-created Category that may classify Transactions. Its name is a required, editable, non-unique label; deleting one used by Transactions requires reassigning them to another visible Ordinary Category in the same Plan; they cannot be left Uncategorized.

**Internal Category**:
A Category created and managed by the app for its own behavior rather than created by a user. Credit Payment Categories and the Inflow: Ready to Assign Category are Internal Categories.

**Inflow: Ready to Assign Category**:
The Internal Category, named Ready to Assign in the Internal Category Group named Inflow, through which Transactions add money to or take money from Ready to Assign. Every Plan has exactly one. Transactions on any Account may use it, inflow or outflow. It never appears in the Plan view and cannot be renamed, hidden, moved, deleted, given Assigned money, or chosen as a reassignment target.
_Avoid_: Income category, To be Budgeted

**Credit Payment Category**:
An Internal Category paired with a Credit Account that represents money reserved to pay that Account. Its name follows the Account, and users cannot rename or delete it independently or assign it directly to Transactions. Users may assign budget money to it to pay existing debt.

**Hidden Category**:
A Category concealed from the active Plan view while retaining its identity, history, and Category Group. Existing Transaction references remain valid, but it cannot be newly selected until shown again.

**Uncategorized Transaction**:
A Transaction that has no Category. Uncategorized Transactions are valid and may be categorized later.

**Category Activity**:
The sum of Transaction Amounts that use a Category and are dated within one Plan Month, up to and including the Current Day. Transactions dated after the Current Day do not count until that day arrives. A Category Group's Activity is the sum of its visible Categories' Activity; Hidden Categories do not contribute. Uncategorized Transactions and Transfers belong to no Category and contribute to no Activity. Inflow: Ready to Assign Transactions feed Ready to Assign, not Activity.
_Avoid_: Spending, since inflows count too

### Plan Months

**Plan Month**:
One calendar month of a Plan, such as October 2026. The Plan view shows one Plan Month at a time and defaults to the month containing the Current Day. A Plan starts in the earlier of its creation month and its earliest Transaction's month; its Plan Months run from one month before that start to one month after the later of the Current Day's month and the latest month with Assigned money.
_Avoid_: Budget period, month view

**Assigned**:
The money a user gives one Category in one Plan Month, in milliunits. It may be zero or negative. A Category Group's Assigned is the sum of its visible Categories' Assigned.
_Avoid_: Budgeted

**Money Move**:
A reallocation of budget money within a Plan between Categories, Plan Months, or Ready to Assign. It changes Assigned rather than moving money between Accounts or creating Transactions, and an explicit amount may exceed the source Category's Available or Ready to Assign.
_Avoid_: Transfer, which moves money between Accounts

**Cover Overspending**:
A Money Move into an overspent Category, limited to the smaller of its shortfall and the source's positive Available in the same Plan Month, positive Assigned in a later Plan Month, or positive Ready to Assign in the destination month. It may leave part of the shortfall uncovered, and a later-month source may be the same Category as the destination.

**Available**:
The money left in a Category at the end of a Plan Month: its Carryover plus Assigned plus Category Activity. A Category Group's Available is the sum of its visible Categories' Available.
_Avoid_: Balance, since Accounts have balances

**Carryover**:
The part of a Category's Available that moves into the next Plan Month. Positive Available carries over in full; negative Available carries over as zero.

**Cash Overspending**:
The part of a negative Available caused by cash spending (on Accounts that are not Credit Accounts, or from a Credit Account's positive balance), by negative Assigned, or by Credit Payments beyond a Credit Payment Category's Available. Within a month, cash spending uses Available before credit spending does, whatever the Transaction dates.

**Credit Overspending**:
Spending that created Credit Account debt in a Category that its Available could not fund after cash spending. It becomes debt on the Credit Account rather than a shortfall in budget money.

**Funded Spending**:
The part of a Category's credit spending in a Plan Month that its Available covers. It moves into the Activity of the Credit Payment Category of the card it was spent on.

**Inflow from Debt Account**:
The part of a Credit Payment that takes the Credit Account's balance above zero. It adds to Ready to Assign in the payment's month.
_Avoid_: Overpayment income

**Ready to Assign**:
The money in a Plan Month that has no job yet: what was left over from the previous month, plus that month's Inflow: Ready to Assign Transactions and Inflow from Debt Account, minus the previous month's Cash Overspending, minus everything Assigned in the month, minus Assigned in Future. It may be negative when more was assigned than received.
_Avoid_: To be Budgeted, unassigned money

**Assigned in Future**:
The part of the money Assigned in later Plan Months that a month's Ready to Assign sets aside. It is the smaller of the later months' Assigned total and the month's Ready to Assign before it, so later assignments can take a month down to zero but never below.
