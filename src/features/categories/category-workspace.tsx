import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronRight,
  CirclePlus,
  Eye,
  EyeOff,
  FolderTree,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { useServerFn } from '@tanstack/react-start'
import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers'
import { DragDropProvider, DragOverlay, useDroppable } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'

import { SearchableSelect } from '#/components/searchable-select'
import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Spinner } from '#/components/ui/spinner'
import { budgetCategoryMonth } from '#/features/budget/budget-engine'
import type { ReadyToAssign } from '#/features/budget/budget-engine'
import { setCategoryAssigned } from '#/features/budget/budget.functions'
import { ReadyToAssignBox } from '#/features/budget/ready-to-assign'
import { PlanMonthHeader } from '#/features/plans/plan-month-header'
import { planMonthBounds } from '#/features/plans/plan-month'
import type { PlanMonth, PlanMonthBounds } from '#/features/plans/plan-month'
import { getPlan } from '#/features/plans/plans.functions'
import { cn } from '#/lib/utils'
import { useMoney } from '#/hooks/use-amount-privacy'

import { ActivityCell } from './activity-cell'
import type { PlanCurrency } from './activity-cell'
import {
  AmountCell,
  AssignedCell,
  AvailableCell,
  CreditPaymentsAvailableCell,
  amountColumnClassName,
} from './budget-cells'
import { sumVisibleAmounts } from './category-activity'
import { categoryNameSchema } from './category.schemas'
import {
  createCategory,
  createCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
  getCategoryHierarchy,
  updateCategoryGroupName,
  updateCategoryHidden,
  updateCategoryName,
} from './categories.functions'
import {
  categoryDragId,
  groupDragId,
  useCategoryOrdering,
} from './category-ordering'
import type { Category, CategoryGroup } from './category-ordering'
import { TargetPanel, progressLabel } from './target-panel'

export function CategoryWorkspace({
  initialBounds,
  initialGroups,
  initialReadyToAssign,
  month,
  onBudgetChange,
  plan,
  today,
}: {
  initialBounds: PlanMonthBounds
  initialGroups: Array<CategoryGroup>
  initialReadyToAssign: ReadyToAssign
  month: PlanMonth
  // Called once an edit has changed amounts in other months too.
  onBudgetChange: () => void
  plan: PlanCurrency & { id: string }
  today: string
}) {
  const planId = plan.id
  const createCategoryGroupFn = useServerFn(createCategoryGroup)
  const updateCategoryGroupNameFn = useServerFn(updateCategoryGroupName)
  const createCategoryFn = useServerFn(createCategory)
  const updateCategoryNameFn = useServerFn(updateCategoryName)
  const updateCategoryHiddenFn = useServerFn(updateCategoryHidden)
  const deleteCategoryFn = useServerFn(deleteCategory)
  const deleteCategoryGroupFn = useServerFn(deleteCategoryGroup)
  const getCategoryHierarchyFn = useServerFn(getCategoryHierarchy)
  const setCategoryAssignedFn = useServerFn(setCategoryAssigned)
  const getPlanFn = useServerFn(getPlan)
  const [groups, setGroups] = useState(initialGroups)
  const [selectedId, selectCategory] = useState<string | null>(null)
  const [underfundedOnly, setUnderfundedOnly] = useState(false)
  const [phoneColumn, setPhoneColumn] = useState('Available')
  const selected = groups
    .flatMap((g) => g.categories)
    .find((c) => c.id === selectedId && !c.hidden)
  const [bounds, setBounds] = useState(initialBounds)
  const [readyToAssign, setReadyToAssign] = useState(initialReadyToAssign)
  const [assignedError, setAssignedError] = useState<string | null>(null)
  const amountsRequestRef = useRef(0)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [hasGroupDraft, setHasGroupDraft] = useState(false)
  const [categoryDraftGroupId, setCategoryDraftGroupId] = useState<
    string | null
  >(null)
  const [visibilityTarget, setVisibilityTarget] = useState<Category | null>(
    null,
  )
  const [visibilityPendingId, setVisibilityPendingId] = useState<string | null>(
    null,
  )
  const [visibilityError, setVisibilityError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [reassignmentTargetId, setReassignmentTargetId] = useState<
    string | null
  >(null)
  const visibleGroups = groups
    .map((group) => {
      const categories = group.categories.filter(
        (category) =>
          !category.hidden &&
          (!underfundedOnly || (category.progress?.underfunded ?? 0) > 0),
      )
      return { ...group, ...sumVisibleAmounts(categories), categories }
    })
    .filter(
      (group) =>
        (!underfundedOnly && group.kind === 'ordinary') ||
        group.categories.length > 0,
    )
  const hiddenCategories = groups.flatMap((group) =>
    group.categories
      .filter((category) => category.hidden)
      .map((category) => ({ category, group })),
  )

  const {
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    orderPending,
    orderError,
    orderAnnouncement,
  } = useCategoryOrdering({
    groups,
    setGroups,
    visibleGroups,
    planId,
    setCollapsedGroupIds,
  })

  async function addCategoryGroup(name: string) {
    const group = await createCategoryGroupFn({
      data: { planId, name },
    })
    setGroups((currentGroups) => [...currentGroups, group])
    setHasGroupDraft(false)
  }

  async function renameCategoryGroup(id: string, name: string) {
    const savedGroup = await updateCategoryGroupNameFn({
      data: { id, name },
    })
    setGroups((currentGroups) =>
      currentGroups.map((group) =>
        group.id === savedGroup.id
          ? { ...group, name: savedGroup.name, updatedAt: savedGroup.updatedAt }
          : group,
      ),
    )
  }

  async function addCategory(categoryGroupId: string, name: string) {
    const category = await createCategoryFn({
      data: { categoryGroupId, name },
    })
    setGroups((currentGroups) =>
      currentGroups.map((group) =>
        group.id === categoryGroupId
          ? { ...group, categories: [...group.categories, category] }
          : group,
      ),
    )
    setCategoryDraftGroupId(null)
  }

  async function renameCategory(
    categoryGroupId: string,
    id: string,
    name: string,
  ) {
    const savedCategory = await updateCategoryNameFn({
      data: { id, name },
    })
    setGroups((currentGroups) =>
      currentGroups.map((group) =>
        group.id === categoryGroupId
          ? {
              ...group,
              categories: group.categories.map((category) =>
                category.id === savedCategory.id
                  ? {
                      ...category,
                      name: savedCategory.name,
                      updatedAt: savedCategory.updatedAt,
                    }
                  : category,
              ),
            }
          : group,
      ),
    )
  }

  // Amounts refresh in place so rows, and the focused Assigned cell, stay
  // mounted. Only the latest refresh applies.
  async function refreshAmounts() {
    const request = ++amountsRequestRef.current
    const [hierarchy, freshPlan] = await Promise.all([
      getCategoryHierarchyFn({ data: { planId, month, today } }),
      getPlanFn({ data: { id: planId } }),
    ])
    if (request !== amountsRequestRef.current) return
    setGroups((currentGroups) => withAmounts(currentGroups, hierarchy.groups))
    setReadyToAssign(hierarchy.readyToAssign)
    setBounds(planMonthBounds({ ...freshPlan, today }))
  }

  function moneyMoved() {
    setAssignedError(null)
    onBudgetChange()
    void refreshAmounts().catch(() => {
      setAssignedError(
        'Money moved, but amounts could not refresh. Reload to see them.',
      )
    })
  }

  async function assignCategory(categoryId: string, assigned: number) {
    // An older refresh still in flight must not undo this edit.
    amountsRequestRef.current += 1
    setAssignedError(null)
    setGroups((currentGroups) =>
      currentGroups.map((group) => ({
        ...group,
        categories: group.categories.map((category) =>
          category.id === categoryId
            ? {
                ...category,
                ...budgetCategoryMonth(
                  category.carryover,
                  {
                    assigned,
                    cashActivity: category.cashActivity,
                    creditActivity: category.creditActivity,
                  },
                  category.cardBalance,
                ),
              }
            : category,
        ),
      })),
    )
    try {
      await setCategoryAssignedFn({
        data: { categoryId, month, amount: assigned },
      })
      onBudgetChange()
    } catch {
      setAssignedError('Could not save Assigned. Try again.')
    }
    try {
      await refreshAmounts()
    } catch {
      setAssignedError('Could not refresh amounts. Reload to see them.')
    }
  }

  function persistVisibility(category: Category, hidden: boolean) {
    setVisibilityPendingId(category.id)
    setVisibilityError(null)
    return updateCategoryHiddenFn({
      data: { id: category.id, hidden },
    })
      .then((saved) => {
        setGroups((currentGroups) =>
          currentGroups.map((group) => ({
            ...group,
            categories: group.categories.map((item) =>
              item.id === saved.id
                ? { ...item, hidden: saved.hidden, updatedAt: saved.updatedAt }
                : item,
            ),
          })),
        )
        setVisibilityTarget(null)
        // Group totals leave hidden Categories out.
        onBudgetChange()
      })
      .catch(() => {
        setVisibilityError('Could not update Category visibility. Try again.')
      })
      .finally(() => {
        setVisibilityPendingId(null)
      })
  }

  function hideCategory(category: Category) {
    if (category.kind === 'credit_payment' && !category.creditAccountClosed) {
      setVisibilityTarget(category)
      return
    }
    void persistVisibility(category, true)
  }

  function openDelete(target: DeleteTarget) {
    setDeleteTarget(target)
    setDeleteError(null)
    setReassignmentTargetId(null)
  }

  async function confirmDelete(targetCategoryId: string | null) {
    if (!deleteTarget) return

    setIsDeleting(true)
    setDeleteError(null)
    try {
      const data = { id: deleteTarget.id, targetCategoryId }
      const result =
        deleteTarget.kind === 'group'
          ? await deleteCategoryGroupFn({ data })
          : await deleteCategoryFn({ data })
      setGroups((currentGroups) =>
        removeDeleted(
          currentGroups,
          deleteTarget,
          targetCategoryId,
          result.transactionCount,
        ),
      )
      setDeleteTarget(null)
      onBudgetChange()
      // Moved Transactions change the target's Activity and Available.
      void refreshAmounts().catch(() => {})
    } catch (error) {
      setDeleteError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not delete. Please try again.',
      )
      // Refresh counts and targets; a target that no longer exists closes the
      // dialog.
      try {
        const hierarchy = await getCategoryHierarchyFn({
          data: { planId, month, today },
        })
        setGroups(hierarchy.groups)
        setReadyToAssign(hierarchy.readyToAssign)
      } catch {
        // Keep showing the error with the data we have.
      }
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <main
      className="flex min-h-full flex-1 flex-col"
      data-plan-column={phoneColumn}
    >
      <header className="flex flex-wrap items-center gap-x-10 gap-y-3 border-b px-3 py-3 max-md:flex-col max-md:items-stretch md:pl-14 md:pr-6">
        <PlanMonthHeader
          bounds={bounds}
          month={month}
          planId={planId}
          today={today}
        />
        <ReadyToAssignBox
          currency={plan}
          month={month}
          onMoved={moneyMoved}
          readyToAssign={readyToAssign}
        />
      </header>

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col p-2 md:p-6">
          <div className="mb-2 flex items-center">
            <Button
              className="text-primary"
              disabled={hasGroupDraft || orderPending || underfundedOnly}
              onClick={() => setHasGroupDraft(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <CirclePlus data-icon="inline-start" />
              Category Group
            </Button>
            <Button
              size="sm"
              variant={underfundedOnly ? 'secondary' : 'ghost'}
              aria-pressed={underfundedOnly}
              disabled={
                hasGroupDraft || categoryDraftGroupId !== null || orderPending
              }
              onClick={() => setUnderfundedOnly(!underfundedOnly)}
            >
              Underfunded
            </Button>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-background">
            <div className="md:min-w-[39rem]">
              <div className="flex items-center border-b bg-muted/30 py-2 pl-4 pr-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:pl-12">
                <span className="flex-1">Category</span>
                <Select value={phoneColumn} onValueChange={setPhoneColumn}>
                  <SelectTrigger
                    aria-label="Plan amount column"
                    size="sm"
                    className="text-foreground md:hidden"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="end">
                    <SelectGroup>
                      {['Available', 'Assigned', 'Activity'].map((column) => (
                        <SelectItem key={column} value={column}>
                          {column}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {['Assigned', 'Activity', 'Available'].map((column) => (
                  <span
                    key={column}
                    className={cn(amountColumnClassName, 'max-md:hidden')}
                  >
                    {column}
                  </span>
                ))}
              </div>

              {visibleGroups.length > 0 && (
                <p className="sr-only" id="category-drag-instructions">
                  Drag a handle to reorder. Categories can move between groups.
                  Keyboard: Space to pick up, arrows to move, Space to drop,
                  Escape to cancel.
                </p>
              )}

              {underfundedOnly && !visibleGroups.length ? (
                <Empty>
                  <EmptyTitle>No underfunded targets</EmptyTitle>
                  <EmptyDescription>
                    There’s nothing left to assign to targets this month.
                  </EmptyDescription>
                </Empty>
              ) : visibleGroups.length === 0 &&
                hiddenCategories.length === 0 &&
                !hasGroupDraft ? (
                <Empty className="min-h-72">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FolderTree />
                    </EmptyMedia>
                    <EmptyTitle>No Category Groups yet</EmptyTitle>
                    <EmptyDescription>
                      Create a group, then add the Categories that belong inside
                      it.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      onClick={() => setHasGroupDraft(true)}
                      size="sm"
                      type="button"
                    >
                      <Plus data-icon="inline-start" />
                      Add Category Group
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <>
                  <DragDropProvider
                    modifiers={[RestrictToVerticalAxis]}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    onDragStart={handleDragStart}
                  >
                    <div data-assigned-scope>
                      {visibleGroups.map((group, index) => (
                        <SortableCategoryGroup
                          categoryDraftGroupId={categoryDraftGroupId}
                          collapsed={collapsedGroupIds.has(group.id)}
                          currency={plan}
                          group={group}
                          index={index}
                          isUpdating={
                            visibilityPendingId !== null || orderPending
                          }
                          key={group.id}
                          onAddCategory={() =>
                            setCategoryDraftGroupId(group.id)
                          }
                          onAssign={(categoryId, assigned) =>
                            void assignCategory(categoryId, assigned)
                          }
                          onCancelCategoryDraft={() =>
                            setCategoryDraftGroupId(null)
                          }
                          onCollapseChange={(open) =>
                            setCollapsedGroupIds((current) => {
                              const next = new Set(current)
                              if (open) next.delete(group.id)
                              else next.add(group.id)
                              return next
                            })
                          }
                          onCreateCategory={(name) =>
                            addCategory(group.id, name)
                          }
                          onDelete={openDelete}
                          onSelectCategory={selectCategory}
                          selectedId={selectedId}
                          onHide={hideCategory}
                          onMoved={moneyMoved}
                          onRenameCategory={renameCategory}
                          onRenameGroup={renameCategoryGroup}
                          orderPending={orderPending || underfundedOnly}
                          showAddCategory={
                            categoryDraftGroupId === null &&
                            !hasGroupDraft &&
                            !underfundedOnly
                          }
                        />
                      ))}
                    </div>
                    <DragOverlay>
                      {(source) =>
                        source.type === 'group' ? (
                          <GroupDragOverlay
                            collapsedGroupIds={collapsedGroupIds}
                            currency={plan}
                            groups={visibleGroups}
                            sourceId={source.id}
                          />
                        ) : (
                          <div className="flex min-h-11 items-center rounded-lg border bg-background py-1 pl-12 pr-3 text-foreground shadow-lg">
                            <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
                              <GripVertical className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm">
                              {String(source.data.label ?? '')}
                            </span>
                            <CategoryAmounts
                              category={source.data.category as Category}
                              currency={plan}
                            />
                          </div>
                        )
                      }
                    </DragOverlay>
                  </DragDropProvider>

                  <div>
                    {hasGroupDraft && (
                      <div className="flex min-h-11 items-center gap-1 border-b bg-muted/50 px-3">
                        <span aria-hidden className="size-7 shrink-0" />
                        <InlineNameCell
                          editingInitially
                          label="New Category Group name"
                          onCancel={() => setHasGroupDraft(false)}
                          onSave={addCategoryGroup}
                          value=""
                        />
                      </div>
                    )}

                    {!underfundedOnly && hiddenCategories.length > 0 && (
                      <HiddenCategoriesSection
                        categories={hiddenCategories}
                        currency={plan}
                        isUpdating={
                          visibilityPendingId !== null || orderPending
                        }
                        onAssign={(categoryId, assigned) =>
                          void assignCategory(categoryId, assigned)
                        }
                        onDelete={openDelete}
                        onRename={renameCategory}
                        onShow={(category) =>
                          void persistVisibility(category, false)
                        }
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <p aria-live="polite" className="sr-only" role="status">
            {orderAnnouncement}
          </p>
          {orderError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {orderError}
            </p>
          )}
          {visibilityError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {visibilityError}
            </p>
          )}
          {assignedError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {assignedError}
            </p>
          )}
        </div>
        {selected && (
          <TargetPanel
            key={selected.id}
            category={selected}
            currency={plan}
            month={month}
            today={today}
            onClose={() => selectCategory(null)}
            onSaved={async () => {
              onBudgetChange()
              await refreshAmounts()
            }}
            readyToAssign={readyToAssign.total}
          />
        )}
      </div>
      <HidePaymentCategoryDialog
        category={visibilityTarget}
        isUpdating={visibilityPendingId !== null}
        onCancel={() => setVisibilityTarget(null)}
        onConfirm={(category) => void persistVisibility(category, true)}
      />
      <DeleteDialog
        error={deleteError}
        groups={groups}
        isDeleting={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(targetCategoryId) => void confirmDelete(targetCategoryId)}
        onTargetCategoryChange={setReassignmentTargetId}
        target={deleteTarget}
        targetCategoryId={reassignmentTargetId}
      />
    </main>
  )
}

function SortableCategoryGroup({
  categoryDraftGroupId,
  onSelectCategory,
  selectedId,
  collapsed,
  currency,
  group,
  index,
  isUpdating,
  onAddCategory,
  onAssign,
  onCancelCategoryDraft,
  onCollapseChange,
  onCreateCategory,
  onDelete,
  onHide,
  onMoved,
  onRenameCategory,
  onRenameGroup,
  orderPending,
  showAddCategory,
}: {
  categoryDraftGroupId: string | null
  onSelectCategory: (id: string) => void
  selectedId: string | null
  collapsed: boolean
  currency: PlanCurrency
  group: CategoryGroup
  index: number
  isUpdating: boolean
  onAddCategory: () => void
  onAssign: (categoryId: string, assigned: number) => void
  onCancelCategoryDraft: () => void
  onCollapseChange: (open: boolean) => void
  onCreateCategory: (name: string) => Promise<void>
  onDelete: (target: DeleteTarget) => void
  onHide: (category: Category) => void
  onMoved: () => void
  onRenameCategory: (groupId: string, id: string, name: string) => Promise<void>
  onRenameGroup: (id: string, name: string) => Promise<void>
  orderPending: boolean
  showAddCategory: boolean
}) {
  const groupElementRef = useRef<HTMLDivElement>(null)
  const groupHandleRef = useRef<HTMLButtonElement>(null)
  const groupDropTargetRef = useRef<HTMLDivElement>(null)
  const sortable = useSortable({
    id: groupDragId(group.id),
    element: groupElementRef,
    handle: groupHandleRef,
    index,
    group: 'category-groups',
    type: 'group',
    accept: 'group',
    disabled: orderPending,
  })
  const dropTarget = useDroppable({
    id: group.id,
    element: groupDropTargetRef,
    accept: 'category',
    disabled: group.kind !== 'ordinary' || orderPending,
    collisionPriority: -1,
  })

  return (
    <Collapsible
      className={cn(
        'group/category-group',
        sortable.isDragging && 'opacity-40',
      )}
      onOpenChange={onCollapseChange}
      open={!collapsed}
      ref={groupElementRef}
    >
      <div
        className={cn(
          'flex min-h-11 items-center gap-1 border-b bg-muted/50 pl-2 pr-3 transition-colors',
          dropTarget.isDropTarget && 'bg-accent',
        )}
        ref={groupDropTargetRef}
      >
        <Button
          aria-describedby="category-drag-instructions"
          aria-label={`Move Category Group ${group.name}`}
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          disabled={orderPending}
          ref={groupHandleRef}
          size="icon-sm"
          title={`Move Category Group ${group.name}`}
          type="button"
          variant="ghost"
        >
          <GripVertical />
        </Button>
        <CollapsibleTrigger asChild>
          <Button
            aria-label={`Toggle Categories in ${group.name}`}
            className="shrink-0"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronRight className="transition-transform group-data-[state=open]/category-group:rotate-90" />
          </Button>
        </CollapsibleTrigger>
        {group.internal ? (
          <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm font-medium">
            {group.name}
          </span>
        ) : (
          <>
            <InlineNameCell
              label="Category Group name"
              onSave={(name) => onRenameGroup(group.id, name)}
              value={group.name}
            />
            <Button
              disabled={!showAddCategory || orderPending}
              onClick={onAddCategory}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Plus data-icon="inline-start" />
              <span className="max-md:sr-only">Add Category</span>
            </Button>
            <RowActionsMenu label={`Actions for ${group.name}`}>
              <DropdownMenuItem
                disabled={isUpdating}
                onSelect={() => onDelete({ kind: 'group', id: group.id })}
                variant="destructive"
              >
                <Trash2 />
                Delete…
              </DropdownMenuItem>
            </RowActionsMenu>
          </>
        )}
        <AmountCell
          amount={group.assigned}
          className="plan-assigned font-medium"
          currency={currency}
        />
        <ActivityCell
          amount={group.activity}
          className="font-medium"
          currency={currency}
          source={{
            kind: 'group',
            id: group.id,
            name: group.name,
            creditPayments: group.kind === 'credit_card_payments',
          }}
        />
        {group.kind === 'credit_card_payments' ? (
          <CreditPaymentsAvailableCell
            amount={group.available}
            currency={currency}
          />
        ) : (
          <AmountCell
            amount={group.available}
            className="font-semibold"
            currency={currency}
          />
        )}
      </div>

      <CollapsibleContent>
        {group.categories.map((category, categoryIndex) => (
          <CategoryRow
            category={category}
            onSelectCategory={onSelectCategory}
            selected={category.id === selectedId}
            currency={currency}
            groupId={group.id}
            index={categoryIndex}
            isUpdating={isUpdating}
            key={category.id}
            onAssign={onAssign}
            onDelete={onDelete}
            onHide={onHide}
            onMoved={onMoved}
            onRename={onRenameCategory}
            orderPending={orderPending}
          />
        ))}

        {categoryDraftGroupId === group.id && (
          <div className="flex min-h-11 items-center border-b py-1 pl-12 pr-3">
            <InlineNameCell
              editingInitially
              label="New Category name"
              onCancel={onCancelCategoryDraft}
              onSave={onCreateCategory}
              value=""
            />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function GroupDragOverlay({
  collapsedGroupIds,
  currency,
  groups,
  sourceId,
}: {
  collapsedGroupIds: Set<string>
  currency: PlanCurrency
  groups: Array<CategoryGroup>
  sourceId: string | number
}) {
  const group = groups.find((item) => groupDragId(item.id) === sourceId)
  if (!group) return null
  const collapsed = collapsedGroupIds.has(group.id)

  // Mirror the whole group so the overlay matches the space it leaves behind.
  return (
    <div className="overflow-hidden rounded-lg border bg-background text-foreground shadow-lg">
      <div className="flex min-h-11 items-center gap-1 bg-muted px-2">
        <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
          <GripVertical className="size-4" />
        </span>
        <span className="flex size-7 shrink-0 items-center justify-center">
          <ChevronRight className={cn('size-4', !collapsed && 'rotate-90')} />
        </span>
        <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm font-medium">
          {group.name}
        </span>
        <AmountCell
          amount={group.assigned}
          className="plan-assigned font-medium"
          currency={currency}
        />
        <AmountCell
          amount={group.activity}
          className="plan-activity font-medium"
          currency={currency}
        />
        <AmountCell
          amount={group.available}
          className="font-semibold"
          currency={currency}
        />
      </div>
      {!collapsed &&
        group.categories.map((category) => (
          <div
            className="flex min-h-11 items-center border-t py-1 pl-12 pr-3"
            key={category.id}
          >
            <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
              <GripVertical className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm">
              {category.name}
            </span>
            <CategoryAmounts category={category} currency={currency} />
          </div>
        ))}
    </div>
  )
}

function CategoryFundingBar({
  category,
  currency,
}: {
  category: Category
  currency: PlanCurrency
}) {
  const remaining = category.progress?.snoozed
    ? 0
    : (category.progress?.remaining ?? 0)
  const available = Math.max(0, category.available)
  const spent = Math.max(0, -category.activity)
  const overspent = Math.max(0, -category.available)
  const covered = Math.max(0, spent - overspent)
  const total = available + covered + Math.max(remaining, overspent)
  const money = useMoney(currency)
  const label = `${money(available)} available, ${money(covered)} spent from funded money${overspent ? `, ${money(overspent)} overspent` : ''}${remaining ? `, ${money(remaining)} still needed` : ''}`
  const color = category.progress?.snoozed
    ? 'bg-muted-foreground'
    : category.progress?.underfunded
      ? 'bg-yellow-400'
      : 'bg-lime-500'
  const width = (value: number) => `${total ? (100 * value) / total : 0}%`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="my-0.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border"
    >
      <span className={color} style={{ width: width(available) }} />
      <span
        className={cn(
          color,
          'opacity-60 [background-image:repeating-linear-gradient(135deg,transparent_0_2px,var(--background)_2px_4px)]',
        )}
        style={{ width: width(covered) }}
      />
      <span
        className={
          category.status === 'credit_overspent'
            ? 'bg-yellow-500'
            : 'bg-red-400'
        }
        style={{ width: width(overspent) }}
      />
    </span>
  )
}

function CategoryRow({
  category,
  onSelectCategory,
  selected,
  currency,
  groupId,
  index,
  isUpdating,
  onAssign,
  onDelete,
  onHide,
  onMoved,
  onRename,
  orderPending,
}: {
  category: Category
  onSelectCategory: (id: string) => void
  selected: boolean
  currency: PlanCurrency
  groupId: string
  index: number
  isUpdating: boolean
  onAssign: (categoryId: string, assigned: number) => void
  onDelete: (target: DeleteTarget) => void
  onHide: (category: Category) => void
  onMoved: () => void
  onRename: (groupId: string, id: string, name: string) => Promise<void>
  orderPending: boolean
}) {
  const money = useMoney(currency)
  const categoryElementRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  const categoryHandleRef = useRef<HTMLButtonElement>(null)
  const sortable = useSortable({
    id: categoryDragId(category.id),
    element: categoryElementRef,
    handle: categoryHandleRef,
    index,
    group: groupId,
    // Internal Categories may only be reordered among themselves.
    type: category.internal ? 'internal-category' : 'category',
    accept: category.internal ? 'internal-category' : 'category',
    disabled: orderPending,
    data: { label: category.name, category },
  })

  return (
    <div
      className={cn(
        'flex min-h-11 items-center border-b py-1 pl-2 pr-3 transition-colors md:pl-12',
        selected && 'bg-primary/10',
        sortable.isDragging && 'opacity-40',
        sortable.isDropTarget && 'bg-accent/60',
      )}
      ref={categoryElementRef}
    >
      <Button
        aria-describedby="category-drag-instructions"
        aria-label={`Move Category ${category.name}`}
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        disabled={orderPending}
        ref={categoryHandleRef}
        size="icon-sm"
        title={`Move Category ${category.name}`}
        type="button"
        variant="ghost"
      >
        <GripVertical />
      </Button>
      {category.internal ? (
        <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm">
          {category.name}
        </span>
      ) : renaming ? (
        <InlineNameCell
          editingInitially
          label="Category name"
          onCancel={() => setRenaming(false)}
          onSave={async (name) => {
            await onRename(groupId, category.id, name)
            setRenaming(false)
          }}
          value={category.name}
        />
      ) : (
        <Button
          variant="ghost"
          className="h-auto min-w-0 flex-1 flex-col items-start gap-0.5 px-2 py-1.5"
          onClick={() => onSelectCategory(category.id)}
          aria-pressed={selected}
        >
          <span className="max-w-full truncate">{category.name}</span>
          <CategoryFundingBar category={category} currency={currency} />
          {category.progress && (
            <span className="max-w-full whitespace-normal text-left text-xs font-normal text-muted-foreground">
              {progressLabel(category.progress, money)}
            </span>
          )}
        </Button>
      )}
      <RowActionsMenu label={`Actions for ${category.name}`}>
        {!category.internal && (
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            Rename
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={isUpdating}
          onSelect={() => onHide(category)}
        >
          <EyeOff />
          Hide
        </DropdownMenuItem>
        {!category.internal && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={isUpdating}
              onSelect={() => onDelete({ kind: 'category', id: category.id })}
              variant="destructive"
            >
              <Trash2 />
              Delete…
            </DropdownMenuItem>
          </>
        )}
      </RowActionsMenu>
      <CategoryAmounts
        category={category}
        currency={currency}
        onAssign={onAssign}
        onMoved={onMoved}
      />
    </div>
  )
}

function HiddenCategoriesSection({
  categories,
  currency,
  isUpdating,
  onAssign,
  onDelete,
  onRename,
  onShow,
}: {
  categories: Array<{ category: Category; group: CategoryGroup }>
  currency: PlanCurrency
  isUpdating: boolean
  onAssign: (categoryId: string, assigned: number) => void
  onDelete: (target: DeleteTarget) => void
  onRename: (groupId: string, id: string, name: string) => Promise<void>
  onShow: (category: Category) => void
}) {
  return (
    <Collapsible className="group/hidden-categories">
      <div className="flex min-h-11 items-center gap-1 border-b bg-muted/50 px-3">
        <CollapsibleTrigger asChild>
          <Button
            aria-label="Toggle Hidden Categories"
            className="shrink-0"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronRight className="transition-transform group-data-[state=open]/hidden-categories:rotate-90" />
          </Button>
        </CollapsibleTrigger>
        <span className="px-2 py-1.5 text-sm font-medium">
          Hidden Categories
        </span>
      </div>
      <CollapsibleContent data-assigned-scope>
        {categories.map(({ category, group }) => (
          <div
            className="flex min-h-11 items-center border-b py-1 pl-12 pr-3"
            key={category.id}
          >
            {category.internal ? (
              <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm">
                {category.name}
              </span>
            ) : (
              <InlineNameCell
                label="Category name"
                onSave={(name) => onRename(group.id, category.id, name)}
                value={category.name}
              />
            )}
            <span className="truncate px-2 text-xs text-muted-foreground">
              {group.name}
            </span>
            <Button
              disabled={isUpdating}
              onClick={() => onShow(category)}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Eye data-icon="inline-start" />
              Show
            </Button>
            {!category.internal && (
              <RowActionsMenu label={`Actions for ${category.name}`}>
                <DropdownMenuItem
                  disabled={isUpdating}
                  onSelect={() =>
                    onDelete({ kind: 'category', id: category.id })
                  }
                  variant="destructive"
                >
                  <Trash2 />
                  Delete…
                </DropdownMenuItem>
              </RowActionsMenu>
            )}
            <CategoryAmounts
              category={category}
              currency={currency}
              onAssign={onAssign}
            />
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// Without onAssign the amounts are read-only, as in drag overlays.
function CategoryAmounts({
  category,
  currency,
  onAssign,
  onMoved,
}: {
  category: Category
  currency: PlanCurrency
  onAssign?: (categoryId: string, assigned: number) => void
  onMoved?: () => void
}) {
  return (
    <>
      {onAssign ? (
        <AssignedCell
          amount={category.assigned}
          currency={currency}
          label={category.name}
          onCommit={(assigned) => onAssign(category.id, assigned)}
        />
      ) : (
        <AmountCell
          amount={category.assigned}
          className="plan-assigned"
          currency={currency}
        />
      )}
      <ActivityCell
        amount={category.activity}
        currency={currency}
        source={
          onAssign
            ? {
                kind: 'category',
                id: category.id,
                name: category.name,
                creditPayments: category.kind === 'credit_payment',
              }
            : undefined
        }
      />
      <AvailableCell
        budget={category}
        currency={currency}
        source={
          onMoved && !category.hidden
            ? { id: category.id, name: category.name, onMoved }
            : undefined
        }
      />
    </>
  )
}

function withAmounts(
  groups: Array<CategoryGroup>,
  freshGroups: Array<CategoryGroup>,
) {
  const freshCategories = new Map(
    freshGroups
      .flatMap((group) => group.categories)
      .map((category) => [category.id, category]),
  )
  return groups.map((group) => ({
    ...group,
    categories: group.categories.map((category) => {
      const fresh = freshCategories.get(category.id)
      return fresh
        ? {
            ...category,
            transactionCount: fresh.transactionCount,
            target: fresh.target,
            progress: fresh.progress,
            snoozedMonths: fresh.snoozedMonths,
            assigned: fresh.assigned,
            cashActivity: fresh.cashActivity,
            creditActivity: fresh.creditActivity,
            activity: fresh.activity,
            carryover: fresh.carryover,
            available: fresh.available,
            overspending: fresh.overspending,
            fundedCredit: fresh.fundedCredit,
            cardBalance: fresh.cardBalance,
            status: fresh.status,
          }
        : category
    }),
  }))
}

function RowActionsMenu({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={label}
          className="shrink-0 text-muted-foreground"
          size="icon-sm"
          title={label}
          type="button"
          variant="ghost"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type DeleteTarget = { kind: 'category' | 'group'; id: string }

function removeDeleted(
  groups: Array<CategoryGroup>,
  deleted: DeleteTarget,
  targetCategoryId: string | null,
  transactionCount: number,
) {
  return groups
    .filter((group) => deleted.kind !== 'group' || group.id !== deleted.id)
    .map((group) => ({
      ...group,
      categories: group.categories
        .filter(
          (category) =>
            deleted.kind !== 'category' || category.id !== deleted.id,
        )
        .map((category) =>
          category.id === targetCategoryId
            ? {
                ...category,
                transactionCount: category.transactionCount + transactionCount,
              }
            : category,
        ),
    }))
}

function DeleteDialog({
  error,
  groups,
  isDeleting,
  onCancel,
  onConfirm,
  onTargetCategoryChange,
  target,
  targetCategoryId,
}: {
  error: string | null
  groups: Array<CategoryGroup>
  isDeleting: boolean
  onCancel: () => void
  onConfirm: (targetCategoryId: string | null) => void
  onTargetCategoryChange: (id: string) => void
  target: DeleteTarget | null
  targetCategoryId: string | null
}) {
  const group =
    target?.kind === 'group'
      ? groups.find((item) => item.id === target.id)
      : undefined
  const category =
    target?.kind === 'category'
      ? groups
          .flatMap((item) => item.categories)
          .find((item) => item.id === target.id)
      : undefined
  const deleted = group ?? category
  const deletedCategories = group
    ? group.categories
    : category
      ? [category]
      : []
  const transactionCount = deletedCategories.reduce(
    (sum, item) => sum + item.transactionCount,
    0,
  )
  const hiddenCount = deletedCategories.filter((item) => item.hidden).length
  // Valid targets are visible Ordinary Categories outside what is deleted.
  const targetGroups = groups
    .filter((item) => item.kind === 'ordinary' && item.id !== group?.id)
    .map((item) => ({
      id: item.id,
      label: item.name,
      items: item.categories
        .filter(
          (option) =>
            option.kind === 'ordinary' &&
            !option.hidden &&
            option.id !== category?.id,
        )
        .map((option) => ({ label: option.name, value: option.id })),
    }))
  const targetIds = targetGroups.flatMap((item) =>
    item.items.map((option) => option.value),
  )
  const needsTarget = transactionCount > 0
  const selectedTarget =
    targetCategoryId && targetIds.includes(targetCategoryId)
      ? targetCategoryId
      : null
  const noun = group ? 'Category Group' : 'Category'
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open && !isDeleting) onCancel()
      }}
      open={deleted !== undefined}
    >
      <AlertDialogContent ref={contentRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {deleted?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {group &&
              (group.categories.length === 0
                ? 'This Category Group has no Categories. '
                : `${pluralize(group.categories.length, 'Category', 'Categories')}${
                    hiddenCount > 0 ? `, including ${hiddenCount} hidden,` : ''
                  } will also be deleted. `)}
            {needsTarget
              ? `${pluralize(transactionCount, 'Transaction', 'Transactions')} ${
                  transactionCount === 1 ? 'uses' : 'use'
                } ${group ? 'them' : 'this Category'}. ${
                  targetIds.length > 0
                    ? 'Choose where to move them before deleting.'
                    : 'Create or show another Category to move them to before deleting.'
                }`
              : 'This action cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsTarget && targetIds.length > 0 && (
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="delete-category-target">
              Move Transactions to
            </FieldLabel>
            <SearchableSelect
              // Render the list inside the modal so its scroll lock and
              // pointer blocking don't apply to it.
              container={contentRef}
              emptyMessage="No matching Categories."
              groups={targetGroups}
              id="delete-category-target"
              invalid={Boolean(error)}
              onChange={onTargetCategoryChange}
              placeholder="Choose a Category"
              value={selectedTarget ?? ''}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
        )}

        {error && !(needsTarget && targetIds.length > 0) && (
          <Field data-invalid>
            <FieldError>{error}</FieldError>
          </Field>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isDeleting || (needsTarget && !selectedTarget)}
            onClick={(event) => {
              // Keep the dialog open until the deletion succeeds.
              event.preventDefault()
              onConfirm(needsTarget ? selectedTarget : null)
            }}
            variant="destructive"
          >
            {isDeleting && <Spinner data-icon="inline-start" />}
            {isDeleting ? 'Deleting…' : `Delete ${noun}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

function HidePaymentCategoryDialog({
  category,
  isUpdating,
  onCancel,
  onConfirm,
}: {
  category: Category | null
  isUpdating: boolean
  onCancel: () => void
  onConfirm: (category: Category) => void
}) {
  return (
    <AlertDialog
      open={category !== null}
      onOpenChange={(open) => {
        if (!open && !isUpdating) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hide this payment category?</AlertDialogTitle>
          <AlertDialogDescription>
            {category?.name} will keep receiving payment activity while its
            Account is open. You can show it again from Hidden Categories.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isUpdating}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isUpdating}
            onClick={() => {
              if (category) onConfirm(category)
            }}
          >
            Hide Category
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function InlineNameCell({
  editingInitially = false,
  label,
  onCancel,
  onSave,
  value,
}: {
  editingInitially?: boolean
  label: string
  onCancel?: () => void
  onSave: (name: string) => Promise<void>
  value: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const ignoreBlurRef = useRef(false)
  const [isEditing, setIsEditing] = useState(editingInitially)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function save() {
    if (isSaving) return

    const result = categoryNameSchema.safeParse(draft)
    if (!result.success) {
      setError(result.error.issues.at(0)?.message ?? 'Enter a valid name.')
      inputRef.current?.focus()
      return
    }

    if (result.data === value && !editingInitially) {
      setError(null)
      setIsEditing(false)
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      await onSave(result.data)
      setDraft(result.data)
      setIsEditing(false)
    } catch {
      setError('Could not save this name. Please try again.')
      requestAnimationFrame(() => inputRef.current?.focus())
    } finally {
      setIsSaving(false)
    }
  }

  function cancel() {
    ignoreBlurRef.current = true
    setDraft(value)
    setError(null)
    setIsEditing(false)
    onCancel?.()
    requestAnimationFrame(() => {
      ignoreBlurRef.current = false
    })
  }

  if (!isEditing) {
    return (
      <Button
        className="h-auto min-w-0 flex-1 justify-start px-2 py-1.5 text-left"
        onClick={() => {
          setDraft(value)
          setError(null)
          setIsEditing(true)
        }}
        type="button"
        variant="ghost"
      >
        <span className="truncate">{value}</span>
      </Button>
    )
  }

  return (
    <Field className="min-w-0 flex-1 py-1" data-invalid={Boolean(error)}>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          aria-invalid={Boolean(error)}
          aria-label={label}
          autoFocus
          disabled={isSaving}
          onBlur={() => {
            if (!ignoreBlurRef.current) void save()
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          value={draft}
        />
        {isSaving && <Spinner />}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}
