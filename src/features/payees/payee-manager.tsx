import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ContactRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { useServerFn } from '@tanstack/react-start'

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
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { useRowSelection } from '#/hooks/use-row-selection'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#/components/ui/field'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

import { payeeNameSchema } from './payee.schemas'
import {
  combinePayees,
  createPayee,
  deletePayee,
  renamePayee,
} from './payees.functions'

type Payee = {
  id: string
  name: string
  transactionCount: number
}

const NO_PAYEE = '__no_payee__'

export function PayeeManager({
  payees,
  planId,
}: {
  payees: Array<Payee>
  planId: string
}) {
  const createPayeeFn = useServerFn(createPayee)
  const combinePayeesFn = useServerFn(combinePayees)
  const router = useRouter()
  const renamePayeeFn = useServerFn(renamePayee)
  const deletePayeeFn = useServerFn(deletePayee)
  const [search, setSearch] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Payee | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Payee | null>(null)
  const [destinationPayeeId, setDestinationPayeeId] = useState<
    string | undefined
  >()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const filteredPayees = payees.filter((payee) =>
    payee.name.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const selection = useRowSelection(filteredPayees)
  const selected = payees.filter((p) => selection.ids.has(p.id))
  const transactionCount = selected.reduce(
    (sum, p) => sum + p.transactionCount,
    0,
  )
  const [combineName, setCombineName] = useState('')
  const [combineError, setCombineError] = useState<string | null>(null)
  const [isCombining, setIsCombining] = useState(false)

  function clearSelection() {
    selection.clear()
    setCombineName('')
    setCombineError(null)
  }

  async function refreshPayees() {
    router.clearCache()
    try {
      await router.invalidate({ sync: true })
    } catch {
      toast.error('The change was saved. Reload to refresh Payees.')
    }
  }

  async function submitCombine() {
    if (isCombining || selected.length < 2 || !combineName.trim()) return
    setIsCombining(true)
    setCombineError(null)
    try {
      const saved = await combinePayeesFn({
        data: {
          planId,
          ids: selected.map((p) => p.id),
          name: combineName.trim(),
        },
      })
      await refreshPayees()
      clearSelection()
      setSearch('')
      toast.success(`Combined ${selected.length} Payees into ${saved.name}.`)
    } catch (error) {
      setCombineError(
        getMutationError(error, 'Could not combine these Payees.'),
      )
    }
    setIsCombining(false)
  }

  function openCreate() {
    setCreateName('')
    setCreateError(null)
    setIsCreateOpen(true)
  }

  function openRename(payee: Payee) {
    setRenameTarget(payee)
    setRenameName(payee.name)
    setRenameError(null)
  }

  function openDelete(payee: Payee) {
    setDeleteTarget(payee)
    setDestinationPayeeId(payee.transactionCount === 0 ? NO_PAYEE : undefined)
    setDeleteError(null)
  }

  async function submitCreate() {
    const parsed = payeeNameSchema.safeParse(createName)
    if (!parsed.success) {
      setCreateError(parsed.error.issues.at(0)?.message ?? 'Check the name.')
      return
    }

    setIsCreating(true)
    setCreateError(null)
    try {
      await createPayeeFn({
        data: { planId, name: parsed.data },
      })
      await refreshPayees()
      setIsCreateOpen(false)
    } catch (error) {
      setCreateError(getMutationError(error, 'Could not create this Payee.'))
    } finally {
      setIsCreating(false)
    }
  }

  async function submitRename() {
    if (!renameTarget) return
    const parsed = payeeNameSchema.safeParse(renameName)
    if (!parsed.success) {
      setRenameError(parsed.error.issues.at(0)?.message ?? 'Check the name.')
      return
    }

    setIsRenaming(true)
    setRenameError(null)
    try {
      await renamePayeeFn({
        data: { id: renameTarget.id, name: parsed.data },
      })
      await refreshPayees()
      setRenameTarget(null)
    } catch (error) {
      setRenameError(getMutationError(error, 'Could not rename this Payee.'))
    } finally {
      setIsRenaming(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || destinationPayeeId === undefined) return

    const destinationId =
      destinationPayeeId === NO_PAYEE ? null : destinationPayeeId
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deletePayeeFn({
        data: {
          id: deleteTarget.id,
          destinationPayeeId: destinationId,
        },
      })
      await refreshPayees()
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(getMutationError(error, 'Could not delete this Payee.'))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <main className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-col gap-4 border-b px-4 py-5 sm:flex-row sm:items-center sm:justify-between md:pl-14 md:pr-44">
        <div>
          <h1 className="font-heading text-xl font-semibold">Payees</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reuse, rename, and consolidate counterparties across this Plan.
          </p>
        </div>
        <Button onClick={openCreate} type="button">
          <Plus data-icon="inline-start" />
          Add Payee
        </Button>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <Field>
          <FieldLabel className="sr-only" htmlFor="payee-search">
            Search Payees
          </FieldLabel>
          <Input
            className="max-w-md"
            id="payee-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Payees"
            type="search"
            value={search}
          />
        </Field>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <Card className="min-w-0 flex-1">
            <CardHeader>
              <CardTitle>Ordinary Payees</CardTitle>
              <CardDescription>
                Transfer Payees are managed through their Accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {payees.length === 0 ? (
                <Empty className="min-h-72">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ContactRound />
                    </EmptyMedia>
                    <EmptyTitle>No Payees yet</EmptyTitle>
                    <EmptyDescription>
                      Add a Payee here or create one while entering a
                      Transaction.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button onClick={openCreate} type="button">
                      <Plus data-icon="inline-start" />
                      Add Payee
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : filteredPayees.length === 0 ? (
                <Empty className="min-h-56">
                  <EmptyHeader>
                    <EmptyTitle>No matching Payees</EmptyTitle>
                    <EmptyDescription>
                      Try another search or add a new Payee.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <div className="flex items-center gap-3 pl-1">
                          <Checkbox
                            aria-label="Select all visible Payees"
                            checked={
                              selection.allSelected ||
                              (selection.selected.length > 0 && 'indeterminate')
                            }
                            disabled={isCombining}
                            onCheckedChange={selection.selectAll}
                            className="data-[state=indeterminate]:before:h-px data-[state=indeterminate]:before:w-2 data-[state=indeterminate]:before:bg-current data-[state=indeterminate]:[&_svg]:hidden"
                          />{' '}
                          Name
                        </div>
                      </TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayees.map((payee) => (
                      <TableRow
                        key={payee.id}
                        data-state={
                          selection.ids.has(payee.id) ? 'selected' : undefined
                        }
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-3 pl-1">
                            <Checkbox
                              aria-label={`Select ${payee.name}`}
                              checked={selection.ids.has(payee.id)}
                              disabled={isCombining}
                              onClick={(e) =>
                                selection.toggle(payee.id, e.shiftKey)
                              }
                            />
                            <span className="whitespace-normal break-all">
                              {payee.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {payee.transactionCount}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              aria-label={`Rename ${payee.name}`}
                              onClick={() => openRename(payee)}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <Pencil />
                            </Button>
                            <Button
                              aria-label={`Delete ${payee.name}`}
                              onClick={() => openDelete(payee)}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {selected.length > 0 && (
            <Card className="sticky bottom-2 shadow-md lg:top-4 lg:w-72 lg:shrink-0">
              <CardHeader>
                <CardTitle>
                  {selected.length} {selected.length === 1 ? 'Payee' : 'Payees'}{' '}
                  selected
                </CardTitle>
                <CardDescription className="line-clamp-2 break-words">
                  {selected.map((p) => p.name).join(', ')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void submitCombine()
                  }}
                >
                  {selected.length > 1 ? (
                    <Field data-invalid={!!combineError}>
                      <FieldLabel htmlFor="combine-name">
                        Combine and Rename
                      </FieldLabel>
                      <Input
                        id="combine-name"
                        list="combine-payees"
                        placeholder="Choose or type a Payee name"
                        maxLength={100}
                        value={combineName}
                        onChange={(e) => setCombineName(e.target.value)}
                        disabled={isCombining}
                        aria-invalid={!!combineError}
                      />
                      <datalist id="combine-payees">
                        {payees.map((p) => (
                          <option key={p.id} value={p.name} />
                        ))}
                      </datalist>
                      <p className="text-sm text-muted-foreground">
                        Keep one Payee for {transactionCount}{' '}
                        {transactionCount === 1
                          ? 'transaction'
                          : 'transactions'}
                        .
                      </p>
                      {combineError && <FieldError>{combineError}</FieldError>}
                    </Field>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Select another Payee to combine.
                    </p>
                  )}
                  <div className="flex justify-end gap-2 max-sm:*:flex-1">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={clearSelection}
                      disabled={isCombining}
                    >
                      Clear selection
                    </Button>
                    {selected.length > 1 && (
                      <Button
                        type="submit"
                        disabled={isCombining || !combineName.trim()}
                      >
                        {isCombining && <Spinner data-icon="inline-start" />}
                        Combine
                      </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!isCreating) setIsCreateOpen(open)
        }}
        open={isCreateOpen}
      >
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitCreate()
            }}
          >
            <DialogHeader>
              <DialogTitle>Add Payee</DialogTitle>
              <DialogDescription>
                Create a reusable counterparty for this Plan.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field data-invalid={Boolean(createError)}>
                <FieldLabel htmlFor="new-payee-name">Name</FieldLabel>
                <Input
                  aria-invalid={Boolean(createError)}
                  autoFocus
                  id="new-payee-name"
                  maxLength={100}
                  onChange={(event) => setCreateName(event.target.value)}
                  value={createName}
                />
                {createError && <FieldError>{createError}</FieldError>}
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                disabled={isCreating}
                onClick={() => setIsCreateOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={isCreating || !createName.trim()} type="submit">
                {isCreating && <Spinner data-icon="inline-start" />}
                {isCreating ? 'Creating…' : 'Create Payee'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isRenaming) setRenameTarget(null)
        }}
        open={renameTarget !== null}
      >
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitRename()
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename Payee</DialogTitle>
              <DialogDescription>
                The new name appears on every historical Transaction.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field data-invalid={Boolean(renameError)}>
                <FieldLabel htmlFor="rename-payee-name">Name</FieldLabel>
                <Input
                  aria-invalid={Boolean(renameError)}
                  autoFocus
                  id="rename-payee-name"
                  maxLength={100}
                  onChange={(event) => setRenameName(event.target.value)}
                  value={renameName}
                />
                {renameError && <FieldError>{renameError}</FieldError>}
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                disabled={isRenaming}
                onClick={() => setRenameTarget(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={isRenaming || !renameName.trim()} type="submit">
                {isRenaming && <Spinner data-icon="inline-start" />}
                {isRenaming ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null)
        }}
        open={deleteTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.transactionCount === 0
                ? 'This Payee is not used by any Transactions. This action cannot be undone.'
                : `${deleteTarget?.transactionCount ?? 0} Transactions use this Payee. Choose where those Transactions should move before deleting it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteTarget && deleteTarget.transactionCount > 0 && (
            <FieldGroup>
              <Field data-invalid={Boolean(deleteError)}>
                <FieldLabel htmlFor="delete-payee-destination">
                  Reassign Transactions to
                </FieldLabel>
                <Select
                  onValueChange={setDestinationPayeeId}
                  value={destinationPayeeId}
                >
                  <SelectTrigger
                    aria-invalid={Boolean(deleteError)}
                    className="w-full"
                    id="delete-payee-destination"
                  >
                    <SelectValue placeholder="Choose a destination" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      <SelectItem value={NO_PAYEE}>No Payee</SelectItem>
                      {payees
                        .filter((payee) => payee.id !== deleteTarget.id)
                        .map((payee) => (
                          <SelectItem key={payee.id} value={payee.id}>
                            {payee.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {deleteError && <FieldError>{deleteError}</FieldError>}
              </Field>
            </FieldGroup>
          )}

          {deleteError && deleteTarget?.transactionCount === 0 && (
            <Field data-invalid>
              <FieldError>{deleteError}</FieldError>
            </Field>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting || destinationPayeeId === undefined}
              onClick={() => void confirmDelete()}
              variant="destructive"
            >
              {isDeleting && <Spinner data-icon="inline-start" />}
              {isDeleting ? 'Deleting…' : 'Delete Payee'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function getMutationError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
