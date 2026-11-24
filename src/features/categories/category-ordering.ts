import { useRef, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { move } from '@dnd-kit/helpers'
import type { Dispatch, SetStateAction } from 'react'
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/react'

import { moveCategory, reorderCategoryGroups } from './categories.functions'
import type { getCategoryHierarchy } from './categories.functions'

export type CategoryGroup = Awaited<
  ReturnType<typeof getCategoryHierarchy>
>['groups'][number]
export type Category = CategoryGroup['categories'][number]

export const groupDragId = (id: string) => `group:${id}`
export const categoryDragId = (id: string) => `category:${id}`

function withVisibleOrder<T extends { hidden?: boolean }>(
  existing: Array<T>,
  visible: Array<T>,
) {
  let nextVisibleIndex = 0
  const ordered = existing.flatMap((item) => {
    if (item.hidden) return [item]
    const nextItem = visible.at(nextVisibleIndex++)
    return nextItem === undefined ? [] : [nextItem]
  })
  return [...ordered, ...visible.slice(nextVisibleIndex)]
}

function sameOrder(before: Array<string>, after: Array<string>) {
  return (
    before.length === after.length && before.every((id, i) => id === after[i])
  )
}

function reorderVisibleGroups(
  groups: Array<CategoryGroup>,
  movedVisibleIds: Array<string>,
) {
  const byId = new Map(groups.map((group) => [groupDragId(group.id), group]))
  const visiblePositions = groups.flatMap((group, index) =>
    group.kind === 'ordinary' ||
    group.categories.some((category) => !category.hidden)
      ? [index]
      : [],
  )
  const nextGroups = [...groups]
  visiblePositions.forEach((position, index) => {
    const group = byId.get(movedVisibleIds[index])
    if (group) nextGroups[position] = group
  })
  return nextGroups
}

function isCategorySource(type: unknown) {
  return type === 'category' || type === 'internal-category'
}

function categoryIdFromDragId(id: string | number) {
  return String(id).replace(/^category:/, '')
}

function findCategoryGroup(groups: Array<CategoryGroup>, categoryId: string) {
  return groups.find((group) =>
    group.categories.some((category) => category.id === categoryId),
  )
}

function moveVisibleCategory(
  groups: Array<CategoryGroup>,
  event: DragOverEvent,
) {
  const source = event.operation.source
  if (!source) return groups
  const sourceGroup = findCategoryGroup(groups, categoryIdFromDragId(source.id))
  if (!sourceGroup) return groups
  // Internal Categories may only be reordered within their own group.
  const internalMove = sourceGroup.kind !== 'ordinary'
  if (internalMove !== (source.type === 'internal-category')) return groups
  const movableGroups = groups.filter((group) =>
    internalMove ? group.id === sourceGroup.id : group.kind === 'ordinary',
  )

  const currentVisibleIds = Object.fromEntries(
    movableGroups.map((group) => [
      group.id,
      group.categories
        .filter((category) => !category.hidden)
        .map((category) => categoryDragId(category.id)),
    ]),
  )
  const movedVisibleIds = move(currentVisibleIds, event)
  if (movedVisibleIds === currentVisibleIds) return groups

  const byId = new Map(
    groups.flatMap((group) =>
      group.categories.map(
        (category) => [categoryDragId(category.id), category] as const,
      ),
    ),
  )
  return groups.map((group) => {
    const visibleIds = movedVisibleIds[group.id] as Array<string> | undefined
    if (!visibleIds) return group
    const visibleCategories = visibleIds.flatMap((id) => {
      const category = byId.get(id)
      return category ? [{ ...category, categoryGroupId: group.id }] : []
    })
    return {
      ...group,
      categories: withVisibleOrder(group.categories, visibleCategories),
    }
  })
}

export function useCategoryOrdering({
  groups,
  setGroups,
  visibleGroups,
  planId,
  setCollapsedGroupIds,
}: {
  groups: Array<CategoryGroup>
  setGroups: Dispatch<SetStateAction<Array<CategoryGroup>>>
  visibleGroups: Array<CategoryGroup>
  planId: string
  setCollapsedGroupIds: Dispatch<SetStateAction<Set<string>>>
}) {
  const reorderCategoryGroupsFn = useServerFn(reorderCategoryGroups)
  const moveCategoryFn = useServerFn(moveCategory)
  const [orderPending, setOrderPending] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [orderAnnouncement, setOrderAnnouncement] = useState('')

  // Category moves update state while dragging so React, not dnd-kit's
  // optimistic DOM sorting, moves rows between groups.
  const dragStartGroups = useRef<Array<CategoryGroup> | null>(null)
  const draggedGroups = useRef<Array<CategoryGroup> | null>(null)

  function handleDragStart(event: DragStartEvent) {
    if (!isCategorySource(event.operation.source?.type)) return
    dragStartGroups.current = groups
    draggedGroups.current = groups
  }

  function handleDragOver(event: DragOverEvent) {
    const source = event.operation.source
    if (!source || !isCategorySource(source.type) || !draggedGroups.current)
      return

    const nextGroups = moveVisibleCategory(draggedGroups.current, event)
    if (nextGroups === draggedGroups.current) return
    draggedGroups.current = nextGroups
    setGroups(nextGroups)

    const targetGroup = findCategoryGroup(
      nextGroups,
      categoryIdFromDragId(source.id),
    )
    if (targetGroup) {
      setCollapsedGroupIds((current) => {
        if (!current.has(targetGroup.id)) return current
        const next = new Set(current)
        next.delete(targetGroup.id)
        return next
      })
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const source = event.operation.source
    if (event.canceled && dragStartGroups.current) {
      setGroups(dragStartGroups.current)
    }
    if (event.canceled || !source || orderPending) {
      dragStartGroups.current = null
      draggedGroups.current = null
      return
    }

    if (source.type === 'group') {
      if (!event.operation.target) return
      const currentVisibleIds = visibleGroups.map((group) =>
        groupDragId(group.id),
      )
      const movedVisibleIds = move(currentVisibleIds, event)
      if (sameOrder(currentVisibleIds, movedVisibleIds)) return

      const nextGroups = reorderVisibleGroups(groups, movedVisibleIds)
      const expectedIds = groups.map((group) => group.id)
      const orderedIds = nextGroups.map((group) => group.id)
      if (sameOrder(expectedIds, orderedIds)) return

      setGroups(nextGroups)
      setOrderError(null)
      setOrderPending(true)
      void reorderCategoryGroupsFn({
        data: { planId, expectedIds, orderedIds },
      })
        .then(() => {
          const movedGroup = groups.find(
            (group) => groupDragId(group.id) === source.id,
          )
          setOrderAnnouncement(`Moved ${movedGroup?.name ?? 'Category Group'}.`)
        })
        .catch(() => {
          setGroups(groups)
          setOrderError(
            'Could not save the Category Group order. Reload and try again.',
          )
        })
        .finally(() => setOrderPending(false))
      return
    }

    if (!isCategorySource(source.type)) return
    const startGroups = dragStartGroups.current ?? groups
    const nextGroups = draggedGroups.current ?? groups
    dragStartGroups.current = null
    draggedGroups.current = null

    const categoryId = categoryIdFromDragId(source.id)
    const sourceGroup = findCategoryGroup(startGroups, categoryId)
    const nextTargetGroup = findCategoryGroup(nextGroups, categoryId)
    if (!sourceGroup || !nextTargetGroup) return
    const targetGroup = startGroups.find(
      (group) => group.id === nextTargetGroup.id,
    )
    const nextSourceGroup = nextGroups.find(
      (group) => group.id === sourceGroup.id,
    )
    if (!targetGroup || !nextSourceGroup) return

    const expectedSourceIds = sourceGroup.categories.map((item) => item.id)
    const expectedTargetIds = targetGroup.categories.map((item) => item.id)
    const sourceIds = nextSourceGroup.categories.map((item) => item.id)
    const targetIds = nextTargetGroup.categories.map((item) => item.id)
    if (
      sourceGroup.id === targetGroup.id &&
      sameOrder(expectedSourceIds, sourceIds)
    )
      return

    setOrderError(null)
    setOrderPending(true)
    void moveCategoryFn({
      data: {
        planId,
        categoryId,
        fromGroupId: sourceGroup.id,
        toGroupId: targetGroup.id,
        expectedSourceIds,
        expectedTargetIds,
        sourceIds,
        targetIds,
      },
    })
      .then(() => {
        const category = sourceGroup.categories.find(
          (item) => item.id === categoryId,
        )
        setOrderAnnouncement(
          `Moved ${category?.name ?? 'Category'} to ${targetGroup.name}.`,
        )
      })
      .catch(() => {
        setGroups(startGroups)
        setOrderError(
          'Could not save the Category order. Reload and try again.',
        )
      })
      .finally(() => setOrderPending(false))
  }

  return {
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    orderPending,
    orderError,
    orderAnnouncement,
  }
}
