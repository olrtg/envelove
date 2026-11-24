# Category Groups and Categories

## Goal

Introduce the smallest useful category hierarchy inside a Plan. A user can
create Category Groups, create Categories inside those groups, collapse and
expand groups, and rename either kind of item directly in the hierarchy.

This slice establishes a field-level editing structure that can support future
columns without implementing budgeting fields yet.

## Domain model

The hierarchy has exactly two levels:

```text
Plan
└── Category Group
    └── Category
```

- A Plan has zero or more Category Groups.
- A Category Group belongs to one Plan and may contain zero or more Categories.
- A Category belongs to exactly one Category Group.
- Category Groups cannot contain other Category Groups.
- Categories cannot contain subcategories.
- Records have stable IDs. Names are labels and do not determine identity.
- Category Group names and Category names do not need to be unique, including
  among siblings.
- Names accept Unicode, including emoji.
- Emoji are ordinary characters in the name rather than a separate field.
- A saved name is trimmed at its outer boundaries and must contain 1–80
  characters. Internal whitespace is preserved.

## Ordering

- Category Groups have an explicit position within their Plan.
- Categories have an explicit position within their Category Group.
- New items are appended to the end of their scope.
- Users reorder Category Groups, including internal ones such as Credit Card
  Payments, by dragging a handle.
- Users reorder Categories within their group or move an Ordinary Category
  to another Ordinary Category Group by dragging a handle.
- Internal Categories may be reordered only within their internal group. No
  Category may move into or out of an internal group.
- Dragging supports the keyboard: Space picks up, arrows move, Space drops,
  and Escape cancels.
- Hidden Categories keep their positions while visible siblings move around
  them.
- A reorder is saved only if the affected order still matches what the user
  saw; otherwise it is rejected and the view reverts with an error.

Persisting positions avoids making alphabetical order or creation timestamps
part of the domain.

## Plan routing

The active Plan is represented by a Plan-specific route:

```text
/plans/$planId
```

Both the Plan switcher and the main category workspace use the route's
`planId`. Changing Plans navigates to the corresponding route, making Plan
selection reload-safe and linkable.

Only persisted Plans can own Category Groups and Categories. The existing
hard-coded demo Plan fallback is removed. A user with no Plans sees a prompt to
create one before category controls are available.

An invalid or unowned `planId` must not expose another user's data.

## Initial experience

A newly created Plan has no default Category Groups or Categories.

The empty workspace:

- explains that the Plan has no Category Groups;
- offers an **Add Category Group** action;
- does not render placeholder financial columns.

## Creating items

Creation happens directly in the hierarchy:

### Category Group

1. The user activates **Add Category Group**.
2. A draft group row is appended and its name editor receives focus.
3. `Enter` or moving focus away attempts to create the group.
4. `Escape` removes the unsaved draft.

### Category

1. The user activates **Add Category** within a group.
2. A draft Category row is appended to that group and its name editor receives
   focus.
3. `Enter` or moving focus away attempts to create the Category.
4. `Escape` removes the unsaved draft.

An invalid draft remains editable and displays a field-level error.

## Editing names

Category Group and Category names use the same interaction contract:

1. Activating the name cell replaces its display value with a focused editor.
2. `Enter` or moving focus away attempts to save that field.
3. `Escape` restores the previously saved value.
4. A failed save leaves the editor open and displays a field-level error.
5. A successful save updates only that record and field.

The cell lifecycle is reusable, but validation and persistence remain
domain-specific. Future fields such as Assigned can provide their own editor
and validation while following the same edit, save, cancel, pending, and error
states.

## Collapsing groups

- Every Category Group defaults to expanded.
- A group row has a visible, accessible expand/collapse control.
- Collapsing a group hides its Category rows without changing the data.
- Expanded state is browser-local and is not persisted to the database or
  synchronized across devices in this slice.

## Grid boundaries

The first slice rendered only the **Category** column.
[Plan Months](./plan-months.md) adds the **Activity** column.

The grid should support column-based composition so future fields can be added
as independent cells. It must not display inactive placeholders for Assigned or
Available.

The reference's row checkboxes are omitted because this slice has no selection
or bulk actions.

## Persistence boundary

The persisted model needs the equivalent of:

```text
Category Group
- id
- planId
- name
- position
- createdAt
- updatedAt

Category
- id
- categoryGroupId
- name
- position
- createdAt
- updatedAt
```

All reads and writes are authorized through the owning Plan. Client-provided
IDs are never sufficient proof of ownership.

## Loading and error states

- Loading a Plan shows a non-interactive loading state rather than an empty
  state.
- A failed initial load shows an error with a retry action.
- A pending create or rename prevents duplicate submission for that item.
- A failed create or rename preserves the user's draft and makes the failure
  visible next to the affected field.
- Changing Plans replaces the hierarchy with the selected Plan's data.

## Out of scope

- Deleting Category Groups or Categories (see
  [Category Deletion](./category-deletion.md))
- Nested Category Groups or subcategories
- Assigned, Available, targets, or other financial fields (Activity is covered
  by [Plan Months](./plan-months.md))
- Group totals other than Activity
- Row selection, checkboxes, or bulk actions
- Dedicated icons
- Persisting expanded/collapsed state
- Default Category Groups, templates, or starter Categories

## Acceptance criteria

1. A user with a persisted Plan can open its Plan-specific URL.
2. A new Plan shows no default Category Groups.
3. The user can create an empty Category Group inline.
4. The user can create multiple Categories inside that group inline.
5. Two groups in one Plan can share the same name.
6. Two Categories in the same or different groups can share the same name.
7. Blank or whitespace-only names cannot be saved.
8. Names longer than 80 characters cannot be saved.
9. Unicode and emoji names persist unchanged apart from outer whitespace.
10. Clicking a saved group or Category name enters edit mode.
11. `Enter` and blur save a valid edit.
12. `Escape` cancels an edit and restores its previous value.
13. A failed save preserves the draft and presents an error.
14. Groups start expanded and can be collapsed and expanded.
15. Reloading retrieves the saved hierarchy in its explicit order.
16. Switching Plans shows only the selected Plan's hierarchy.
17. An unowned or invalid Plan, group, or Category ID cannot be read or changed.
18. No deferred feature is presented as an inactive or decorative control.
