import { useRef, useState } from 'react'

import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '#/components/ui/combobox'

type ComboboxKeyboardEvent = React.KeyboardEvent<HTMLInputElement> & {
  preventBaseUIHandler: () => void
}

// Base UI ignores Tab, so typed text would be kept even when a suggestion is
// highlighted. Commit the highlighted suggestion and let focus move on. Enter
// already commits it; `onEnterPick` runs afterwards, e.g. to move focus on.
export function useComboboxKeyboard<TItem>(
  onCommit: (item: TItem) => void,
  {
    onEnterPick,
    openOnFocus = false,
  }: {
    onEnterPick?: (input: HTMLInputElement) => void
    openOnFocus?: boolean
  } = {},
) {
  const highlightedRef = useRef<TItem | undefined>(undefined)
  const [open, setOpen] = useState(false)

  return {
    open,
    onOpenChange: setOpen,
    onFocus: (event: React.FocusEvent<HTMLInputElement>) => {
      event.currentTarget.select()
      if (openOnFocus) setOpen(true)
    },
    onItemHighlighted: (item: TItem | undefined) => {
      highlightedRef.current = item
    },
    onKeyDown: (event: ComboboxKeyboardEvent) => {
      handleComboboxKeyDown(event)
      const isOpen =
        event.currentTarget.getAttribute('aria-expanded') === 'true'
      if (!isOpen || !highlightedRef.current) return

      if (event.key === 'Tab') onCommit(highlightedRef.current)
      if (event.key === 'Enter') onEnterPick?.(event.currentTarget)
    },
  }
}

// Base UI clears the value on Escape while the list is closed; let that Escape
// reach the surrounding row or dialog instead so it cancels there.
export function handleComboboxKeyDown(event: ComboboxKeyboardEvent) {
  if (
    event.key === 'Escape' &&
    event.currentTarget.getAttribute('aria-expanded') !== 'true'
  ) {
    event.preventBaseUIHandler()
  }
}

export type SearchableSelectOption = {
  detail?: React.ReactNode
  disabled?: boolean
  group?: string
  label: string
  // Shown in the input once chosen, when it differs from the list label.
  selectedLabel?: string
  value: string
}

export type SearchableSelectGroup = {
  id: string
  items: Array<SearchableSelectOption>
  label?: string
}

export function SearchableSelect({
  container,
  emptyMessage,
  groups,
  id,
  invalid,
  onChange,
  onEnterPick,
  openOnFocus,
  pageSize,
  placeholder,
  value,
}: {
  container?: React.ComponentProps<typeof ComboboxContent>['container']
  emptyMessage: string
  groups: Array<SearchableSelectGroup>
  id: string
  invalid?: boolean
  onChange: (value: string) => void
  onEnterPick?: (input: HTMLInputElement) => void
  openOnFocus?: boolean
  pageSize?: number
  placeholder: string
  value: string
}) {
  const [limit, setLimit] = useState(pageSize)
  const items = groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, group: group.label })),
    }))
  const selectedItem =
    items
      .flatMap((group) => group.items)
      .find((item) => item.value === value) ?? null
  const keyboard = useComboboxKeyboard<SearchableSelectOption>(
    (item) => onChange(item.value),
    { onEnterPick, openOnFocus },
  )

  return (
    <Combobox
      autoHighlight
      filter={(item: SearchableSelectOption, query) =>
        `${item.label} ${item.group ?? ''}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      }
      isItemEqualToValue={(item, selected) => item.value === selected.value}
      itemToStringLabel={(item) => item.selectedLabel ?? item.label}
      items={items}
      limit={limit}
      onItemHighlighted={keyboard.onItemHighlighted}
      onOpenChange={(open) => {
        keyboard.onOpenChange(open)
        if (!open && pageSize) setLimit(pageSize)
      }}
      onValueChange={(item) => {
        if (item) onChange(item.value)
      }}
      open={keyboard.open}
      value={selectedItem}
    >
      <ComboboxInput
        aria-invalid={invalid}
        className="w-full"
        id={id}
        onFocus={keyboard.onFocus}
        onKeyDown={keyboard.onKeyDown}
        placeholder={placeholder}
      />
      <ComboboxContent container={container}>
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList
          onScroll={
            pageSize && limit
              ? (event) => {
                  const list = event.currentTarget
                  if (
                    list.scrollTop + list.clientHeight >=
                      list.scrollHeight - 48 &&
                    limit <
                      items.reduce((sum, group) => sum + group.items.length, 0)
                  )
                    setLimit(limit + pageSize)
                }
              : undefined
          }
        >
          {(group: SearchableSelectGroup) => (
            <ComboboxGroup items={group.items} key={group.id}>
              {group.label && <ComboboxLabel>{group.label}</ComboboxLabel>}
              <ComboboxCollection>
                {(item: SearchableSelectOption) => (
                  <ComboboxItem
                    disabled={item.disabled}
                    key={item.value}
                    value={item}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    {item.detail && (
                      <span className="shrink-0 whitespace-nowrap">
                        {item.detail}
                      </span>
                    )}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
