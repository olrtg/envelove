import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { ChevronDown, X } from 'lucide-react'
import { useIsMobile } from '#/hooks/use-mobile'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Input } from '#/components/ui/input'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { bulkTransactions } from './transactions.functions'
import { confirmationKey } from './reconciliation'
import type { BulkTransactionInput } from './transaction.schemas'

type Action = BulkTransactionInput['action']
export function BulkTransactionBar({
  planId,
  accountId,
  rows,
  today,
  groups,
  onSelectAll,
  allSelected,
  onClose,
  onSaved,
}: {
  planId: string
  accountId?: string
  rows: Array<Parameters<typeof confirmationKey>[0]>
  today: string
  groups: Array<{
    id: string
    name: string
    kind: string
    categories: Array<{ id: string; name: string; hidden: boolean }>
  }>
  allSelected: boolean
  onSelectAll: () => void
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const save = useServerFn(bulkTransactions)
  const mobile = useIsMobile()
  const [dialog, setDialog] = useState<'category' | 'memo' | 'delete' | null>(
    null,
  )
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const count = `${rows.length} ${rows.length === 1 ? 'transaction' : 'transactions'}`
  const transfer = rows.some((r) => r.transferId)
  const locked = rows.some((r) => r.reconciled)
  const future = rows.some((r) => r.date > today)
  function open(next: typeof dialog) {
    setError('')
    setValue('')
    setDialog(next)
  }
  async function apply(action: Action) {
    setError('')
    setBusy(true)
    try {
      await save({
        data: {
          planId,
          accountId,
          rows: rows.map((r) => ({
            id: r.id,
            confirmation: confirmationKey(r),
          })),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          action,
        },
      })
      await onSaved()
      onClose()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not update the selection.',
      )
    } finally {
      setBusy(false)
    }
  }
  const actions = [
    ...(!allSelected
      ? [
          {
            label: 'Select all loaded',
            run: onSelectAll,
            variant: 'ghost' as const,
          },
        ]
      : []),
    { label: 'Categorize', disabled: transfer, run: () => open('category') },
    {
      label: 'Mark cleared',
      disabled: locked || future || rows.every((r) => r.cleared),
      run: () => void apply({ kind: 'cleared', cleared: true }),
    },
    {
      label: 'Mark uncleared',
      disabled: locked || rows.every((r) => !r.cleared),
      run: () => void apply({ kind: 'cleared', cleared: false }),
    },
    { label: 'Edit memo', run: () => open('memo') },
    {
      label: 'Delete',
      run: () => open('delete'),
      variant: 'destructive' as const,
    },
  ]
  return (
    <>
      <div aria-hidden="true" className="h-16" />
      <section
        aria-label="Selected transaction actions"
        aria-busy={busy}
        className="fixed inset-x-2 bottom-3 z-20 mx-auto flex w-fit max-w-[calc(100%-1rem)] flex-wrap items-center justify-center gap-1 rounded-xl border bg-background p-2 shadow-lg md:left-(--sidebar-width)"
      >
        <span role="status" className="px-2 text-sm font-medium">
          {rows.length} selected
        </span>
        {mobile ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={busy}>
                Actions
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-44">
              <DropdownMenuGroup>
                {actions.map((a) => (
                  <DropdownMenuItem
                    key={a.label}
                    disabled={a.disabled}
                    onSelect={a.run}
                    variant={
                      a.variant === 'destructive' ? 'destructive' : 'default'
                    }
                  >
                    {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          actions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.variant ?? 'outline'}
              disabled={busy || a.disabled}
              onClick={a.run}
            >
              {a.label}
            </Button>
          ))
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Clear selection"
          disabled={busy}
          onClick={onClose}
        >
          <X />
        </Button>
        {error && !dialog && (
          <p role="alert" className="w-full text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
      <AlertDialog
        open={dialog !== null}
        onOpenChange={(v) => {
          if (!v && !busy) setDialog(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === 'delete'
                ? `Delete ${count}?`
                : dialog === 'memo'
                  ? `Edit memo for ${count}`
                  : `Categorize ${count}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === 'delete'
                ? `This removes the selected transactions.${transfer ? ' Both sides of each selected transfer will be deleted.' : ''}${rows.some((r) => r.reconciled || r.counterpartReconciled) ? ' Deleting reconciled transactions can bring an account out of balance.' : ''}`
                : dialog === 'memo'
                  ? `Replace the memo on every selected transaction. Leave it blank to remove the memo.${transfer ? ' Both sides of each transfer will share the memo.' : ''}`
                  : 'Choose a category for every selected transaction.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog === 'memo' && (
            <Field>
              <FieldLabel htmlFor="bulk-memo">Memo</FieldLabel>
              <Input
                id="bulk-memo"
                maxLength={200}
                disabled={busy}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          )}
          {dialog === 'category' && (
            <Field>
              <FieldLabel htmlFor="bulk-category">Category</FieldLabel>
              <Select value={value} onValueChange={setValue} disabled={busy}>
                <SelectTrigger id="bulk-category" className="w-full">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__uncategorized__">
                      Uncategorized
                    </SelectItem>
                  </SelectGroup>
                  {groups
                    .filter((g) => g.kind !== 'credit_card_payments')
                    .map((g) => (
                      <SelectGroup key={g.id}>
                        <SelectLabel>{g.name}</SelectLabel>
                        {g.categories
                          .filter((c) => !c.hidden)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              disabled={busy || (dialog === 'category' && !value)}
              variant={dialog === 'delete' ? 'destructive' : 'default'}
              onClick={() => {
                if (dialog)
                  void apply(
                    dialog === 'delete'
                      ? { kind: 'delete' }
                      : dialog === 'memo'
                        ? { kind: 'memo', memo: value }
                        : {
                            kind: 'category',
                            categoryId:
                              value === '__uncategorized__' ? null : value,
                          },
                  )
              }}
            >
              {dialog === 'delete' ? 'Delete' : 'Update'} {count}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
