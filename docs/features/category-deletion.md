# Category Deletion

Agreed design decisions for deleting Ordinary Categories and Ordinary Category
Groups.

## What can be deleted

- Ordinary Categories, visible or hidden.
- Ordinary Category Groups, together with every Category they contain,
  including Hidden ones.
- Credit Payment Categories and the Credit Card Payments group cannot be
  deleted; they may be hidden instead.

## Deletion removes records

A deleted Category or Category Group ceases to exist after every reference to
it has been reassigned. Deleted records are not retained as tombstones. See
[ADR 0003](../adr/0003-deleted-categories-are-removed-not-tombstoned.md).

## Reassignment

- Transactions using a deleted Category must be reassigned before it is
  removed. They cannot be left Uncategorized.
- The target must be a visible Ordinary Category in the same Plan. Hidden
  Categories and Credit Payment Categories are not valid targets.
- Deleting a group reassigns the Transactions of all its used Categories to a
  single target outside the group. To split them across targets, the user
  first drags Categories into other groups.
- The target is chosen in a searchable picker grouped by Category Group with
  no preselected value. It lists only valid targets; invalid ones are omitted
  rather than shown disabled.
- A Category or group without Transactions needs no target.
- If a target is needed but no valid target exists, deletion is blocked and
  the dialog explains that another visible Ordinary Category is required.
- Reassignment includes Transactions in Closed Accounts. Like a Payee Merge, it
  is a Plan-wide identity operation and does not make other fields of those
  Transactions editable.

## Atomicity and stale dialogs

- Reassignment and deletion happen atomically. A failure leaves every
  Category, group, and Transaction reference unchanged.
- The server reassigns every Transaction referencing the deleted Categories at
  the moment of deletion, not only those counted when the dialog opened.
- If a target is now required but missing, or the chosen target is no longer
  valid, deletion is rejected. The dialog stays open, refreshes its count and
  targets, and shows an inline error.
- If the Category or group no longer exists, the dialog closes and the
  hierarchy refreshes.

## Row actions

Every row with actions shows an always-visible `⋯` menu button at its right
end, styled as a muted ghost icon like the drag handles. It replaces the
right-click context menu.

- Ordinary Category: Hide, Delete…
- Credit Payment Category: Hide
- Ordinary Category Group: Delete…
- Credit Card Payments group: no menu button
- Hidden Ordinary Category: keeps its inline Show button and adds a menu with
  Delete…
- Hidden Credit Payment Category: keeps its inline Show button only

## Confirmation

Every deletion requires confirmation, including unused Categories and empty
groups:

- an unused Category or empty group shows a plain confirmation;
- a used Category shows the number of affected Transactions and requires a
  target;
- a group also shows how many Categories will be deleted, including Hidden
  ones that are not otherwise visible under the group.

A group is never deleted automatically when its last Category is deleted or
moved out.

## Deferred

- **Undo.** Restores deleted records under their original IDs and moves
  reassigned Transactions back. Once it exists, drop the confirmation for
  unused Categories and empty groups, as YNAB does for empty groups.
- **Budget amounts.** A used Category's Assigned amounts and Available amount
  should move to the target with its Transactions. For now deleting a Category
  deletes its Assigned amounts, so that money returns to
  [Ready to Assign](./ready-to-assign.md), which is the intended outcome only
  for an unused Category.
- **Per-Category targets when deleting a group.** Users move Categories into
  other groups first instead.

## Acceptance criteria

1. Ordinary Categories and Ordinary Category Groups can be deleted from their
   `⋯` menu; internal ones cannot, through the UI or the server.
2. Hidden Ordinary Categories can be deleted without being shown first.
3. Every deletion asks for confirmation.
4. Deleting a used Category requires a visible Ordinary Category target
   outside what is being deleted; Uncategorized and Inflow: Ready to Assign
   are not offered.
5. Deleting a group deletes all its Categories, including Hidden ones, and
   reassigns all their Transactions to one target.
6. Transactions in Closed Accounts are reassigned too.
7. Deletion is blocked with an explanation when no valid target exists.
8. A failed deletion changes nothing and preserves the dialog with an error.
9. A Category or group from another user's Plan cannot be deleted, and a
   Category from another Plan cannot be used as a target.
