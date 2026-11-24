import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { format, parseISO } from 'date-fns'
import {
  CalendarDays,
  LockKeyhole,
  Check,
  Copyright,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  X,
} from 'lucide-react'
import {
  QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useParams, useRouter } from '@tanstack/react-router'
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
import { BulkTransactionBar } from './bulk-transaction-bar'
import { Calendar } from '#/components/ui/calendar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '#/components/ui/combobox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'
import {
  SearchableSelect,
  useComboboxKeyboard,
} from '#/components/searchable-select'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '#/components/ui/popover'
import { Spinner } from '#/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Toggle } from '#/components/ui/toggle'
import { getCountryProfile } from '#/lib/country-profiles'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'
import type { TransferSide } from '#/lib/transfer'
import { cn } from '#/lib/utils'
import { planAccountsQueryKey } from '#/features/accounts/accounts.queries'
import { readyToAssignQueryOptions } from '#/features/budget/budget.queries'
import { getPayeeNameKey } from '#/features/payees/payee.schemas'

import {
  accountGroupLabels,
  accountTypeDetails,
} from '../accounts/account-types'
import type { AccountType } from '../accounts/account.schemas'
import {
  addDays,
  formatDateInput,
  formatTransactionDate,
  parseDateInput,
} from './transaction-date'
import {
  getClearedAfterDraftAccountChange,
  getClearedAfterDraftDateChange,
} from './transaction-draft'
import {
  evaluateCurrencyToMilliunits,
  formatMilliunitsForInput,
  getLocalDate,
} from './transaction-money'
import { ReconciliationControls } from './reconciliation-controls'
import { useAmountsHidden, useMoney } from '#/hooks/use-amount-privacy'
import { confirmationKey, reconciliationWarning } from './reconciliation'
import { discardCachedPlanMonths } from '../plans/plan-month-cache'
import { createTransactionSchema } from './transaction.schemas'
import { sortRegisterTransactions } from './transfer-logic'
import {
  createTransaction,
  getTransactionRegister,
  getRegisterPage,
  reconcileAccount,
  deleteTransaction,
  updateTransaction,
} from './transactions.functions'
import type { MutationPayload } from './transactions.server'

type Register = Awaited<ReturnType<typeof getTransactionRegister>>

type Transaction = {
  id: string
  accountId: string
  categoryId: string | null
  payeeId: string | null
  transferId: string | null
  transferSide: TransferSide | null
  counterpartAccountId: string | null
  date: string
  payeeName: string | null
  memo: string | null
  amount: number
  cleared: boolean
  reconciled: boolean
  counterpartReconciled: boolean
  createdAt: Date
  updatedAt: Date
}

type Payee = {
  id: string
  name: string
  lastCategoryId?: string | null
}

type Account = {
  id: string
  name: string
  type: AccountType
  closed: boolean
  lastReconciledAt?: Date | null
}

type CategoryGroup = {
  id: string
  name: string
  kind: 'ordinary' | 'credit_card_payments' | 'inflow'
  categories: Array<{
    id: string
    categoryGroupId: string
    name: string
    kind: 'ordinary' | 'credit_payment' | 'ready_to_assign'
    hidden: boolean
    position: number
  }>
}

// Ready to Assign reads "Inflow: Ready to Assign" once chosen, as in YNAB.
function categoryDisplayName(
  group: CategoryGroup,
  category: CategoryGroup['categories'][number],
) {
  return group.kind === 'inflow'
    ? `${group.name}: ${category.name}`
    : category.name
}

type Draft = {
  id: string | null
  accountId: string
  date: string
  payee:
    | { kind: 'ordinary'; payeeId: string | null }
    | { kind: 'create'; name: string }
    | { kind: 'transfer'; accountId: string }
  categoryId: string | null
  memo: string
  reconciled?: boolean
  futureDraftDate?: string
  outflow: string
  inflow: string
  cleared: boolean
}

type DraftField =
  'account' | 'amount' | 'category' | 'cleared' | 'date' | 'memo' | 'payee'

type DraftError = { field: DraftField | null; message: string }

const UNCATEGORIZED = '__uncategorized__'

export function TransactionRegister({
  accounts,
  categoryGroups,
  initialPage,
  initialSummary,
  payees: initialPayees,
  plan,
  scope,
  selectedTransactionId,
}: {
  accounts: Array<Account>
  categoryGroups: Array<CategoryGroup>
  initialPage: Register['page']
  initialSummary: Register['summary']
  payees: Array<Payee>
  plan: {
    countryCode: CountryCode
    currencyCode: CurrencyCode
    defaultTransactionCleared: boolean
    hideAfterReconciliation: boolean
  }
  scope: { kind: 'account'; account: Account } | { kind: 'plan' }
  selectedTransactionId?: string
}) {
  const amountsHidden = useAmountsHidden()
  const { planId } = useParams({ from: '/_authenticated/plans/$planId' })
  const queryClient = useQueryClient()
  // The route loader already serializes page one. Keep scroll history local
  // to this register rather than dehydrating it a second time in the app cache.
  const [pageClient] = useState(() => new QueryClient())
  const createTransactionFn = useServerFn(createTransaction)
  const updateTransactionFn = useServerFn(updateTransaction)
  const deleteTransactionFn = useServerFn(deleteTransaction)
  const [summary, setSummary] = useState(initialSummary)
  const [firstPage, setFirstPage] = useState(initialPage)
  const [payees, setPayees] = useState(() => sortPayees(initialPayees))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editingRow, setEditingRow] = useState<Transaction | null>(null)
  // Remounts the creation row so desktop drafts start focused on the date.
  const [draftSession, setDraftSession] = useState(0)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  // Where focus returns once the open draft closes.
  const [closedDraft, setClosedDraft] = useState<{ id: string | null } | null>(
    null,
  )
  const [draftError, setDraftError] = useState<DraftError | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(
    () => new Set(selectedTransactionId ? [selectedTransactionId] : []),
  )
  const [saveConfirmation, setSaveConfirmation] = useState<{
    key: string
    warning: 'transaction' | 'transfer' | null
  } | null>(null)
  const confirmingUnlink = saveConfirmation !== null
  const warning = saveConfirmation?.warning
  const router = useRouter()
  const loadRegister = useServerFn(getTransactionRegister)
  const loadPage = useServerFn(getRegisterPage)
  const complete = useServerFn(reconcileAccount)
  const [last, setLast] = useState(
    scope.kind === 'account' ? (scope.account.lastReconciledAt ?? null) : null,
  )
  const [hidden, setHidden] = useState(false)
  const today = getLocalDate()
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])
  const accountId = scope.kind === 'account' ? scope.account.id : undefined
  const pageKey = [
    'register-page',
    planId,
    accountId,
    selectedTransactionId,
    hidden,
    term,
    today,
  ] as const
  const pages = useInfiniteQuery(
    {
      queryKey: pageKey,
      queryFn: ({ pageParam }) =>
        loadPage({
          data: {
            planId,
            accountId,
            today,
            hideReconciled: hidden,
            search: term,
            selectedId: selectedTransactionId,
            after: pageParam ?? undefined,
          },
        }),
      initialPageParam: null as Register['page']['next'],
      getNextPageParam: (page) => page.next,
      initialData: () =>
        !hidden && !term
          ? { pages: [firstPage], pageParams: [null] }
          : undefined,
      staleTime: Infinity,
      gcTime: 0,
    },
    pageClient,
  )
  const editingId = draft?.id
  const transactions = useMemo(() => {
    const byId = new Map<string, Transaction>()
    // Keep the editor mounted if reconciliation hides the row being edited.
    if (editingRow && editingRow.id === editingId)
      byId.set(editingRow.id, editingRow)
    for (const page of pages.data?.pages ?? [])
      for (const row of page.transactions) byId.set(row.id, row)
    return sortRegisterTransactions([...byId.values()])
  }, [pages.data, editingId, editingRow])
  // On a direct visit the server's day can differ from the user's local day.
  useEffect(() => {
    if (summary.today === today) return
    let ignore = false
    void loadRegister({ data: { planId, accountId, today } })
      .then((fresh) => {
        if (!ignore) setSummary(fresh.summary)
      })
      .catch(() => {
        if (!ignore)
          setRegisterError(
            'Could not refresh today’s balances. Reload to try again.',
          )
      })
    return () => {
      ignore = true
    }
  }, [summary.today, today, planId, accountId, loadRegister])
  const sentinel = useRef<HTMLButtonElement>(null)
  const { fetchNextPage, hasNextPage, isFetching, isError } = pages
  useEffect(() => {
    if (!sentinel.current || !hasNextPage || isFetching || isError) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage({ cancelRefetch: false })
      },
      { rootMargin: '300px' },
    )
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetching, isError])
  function invalidateBalances() {
    discardCachedPlanMonths(router, '/_authenticated/plans/$planId/')
    router.clearCache({
      filter: (match) =>
        match.routeId === '/_authenticated/plans/$planId/accounts/' ||
        match.routeId === '/_authenticated/plans/$planId/accounts/$accountId',
    })
    void queryClient.invalidateQueries({
      queryKey: ['ready-to-assign', planId],
    })
    void queryClient.invalidateQueries({
      queryKey: planAccountsQueryKey(planId),
    })
  }
  async function refreshRegister(
    focusId?: string | null,
    review = summary.version !== null,
  ) {
    const fresh = await loadRegister({
      data: {
        planId,
        accountId,
        today,
        review,
        selectedId:
          focusId === null
            ? undefined
            : (focusId ??
              draft?.id ??
              deleteTarget?.id ??
              selectedTransactionId),
      },
    })
    setLast(fresh.account?.lastReconciledAt ?? null)
    setSummary(fresh.summary)
    setFirstPage(fresh.page)
    if (draft?.id)
      setEditingRow(
        fresh.page.transactions.find((row) => row.id === draft.id) ?? null,
      )
    await pageClient.cancelQueries({ queryKey: pageKey, exact: true })
    if (hidden || term) await pages.refetch()
    else
      pageClient.setQueryData(pageKey, {
        pages: [fresh.page],
        pageParams: [null],
      })
    setPayees(sortPayees(fresh.payees))
    setDeleteTarget((previous) =>
      previous
        ? (fresh.page.transactions.find((row) => row.id === previous.id) ??
          null)
        : null,
    )
    setDraft((current) => {
      if (!current?.id || current.futureDraftDate) return current
      const stored = fresh.page.transactions.find(
        (row) => row.id === current.id,
      )
      return stored?.reconciled
        ? { ...current, reconciled: true, cleared: true }
        : current
    })
  }
  const openAccounts = accounts.filter((account) => !account.closed)
  const isPlanRegister = scope.kind === 'plan'
  const canCreate = isPlanRegister
    ? openAccounts.length > 0
    : !scope.account.closed

  const { clearedBalance, unclearedBalance } = summary
  const workingBalance = clearedBalance + unclearedBalance

  const categoryNames = new Map(
    categoryGroups.flatMap((group) =>
      group.categories.map(
        (category) =>
          [category.id, categoryDisplayName(group, category)] as const,
      ),
    ),
  )

  async function applyMutation(payload: MutationPayload) {
    invalidateBalances()
    const savedIds = new Set(
      payload.transactions
        .filter((row) => !accountId || row.accountId === accountId)
        .map((transaction) => transaction.id),
    )
    try {
      await refreshRegister([...savedIds][0])
    } catch {
      setRegisterError(
        'Changes saved, but the register could not refresh. Reload to see the latest balances.',
      )
    }
    setHighlightedIds(savedIds)
  }

  // Point out where saved rows landed, since they are sorted by date, and the
  // row a link opened.
  useEffect(() => {
    if (highlightedIds.size === 0) return

    if (!draft) {
      const [savedId] = highlightedIds
      document
        .querySelector(`[data-transaction-id="${CSS.escape(savedId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    const timeout = setTimeout(() => setHighlightedIds(new Set()), 2000)
    return () => clearTimeout(timeout)
    // Only react to a new save, not to later draft changes.
  }, [highlightedIds])

  function closeDraft(id: string | null) {
    setDraft(null)
    setClosedDraft({ id })
  }

  useEffect(() => {
    if (!closedDraft) return

    const editButton = closedDraft.id
      ? document.querySelector<HTMLElement>(
          `[data-transaction-id="${closedDraft.id}"] [aria-label="Edit Transaction"]`,
        )
      : null
    const target = editButton ?? addButtonRef.current
    target?.focus()
    setClosedDraft(null)
  }, [closedDraft])

  useEffect(() => {
    if (!canCreate || draft || deleteTarget || confirmingUnlink) return

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key !== 'N' ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat ||
        isEditableTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      startCreate()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  function startCreate() {
    if (amountsHidden) return
    if (draft) {
      setDraftError({
        field: null,
        message: 'Save or cancel the current draft first.',
      })
      return
    }

    setRegisterError(null)
    setDraftError(null)
    startCreationDraft(isPlanRegister ? '' : scope.account.id, today)
  }

  function startCreationDraft(draftAccountId: string, date: string) {
    setDraftSession((session) => session + 1)
    setDraft({
      id: null,
      accountId: draftAccountId,
      date,
      payee: { kind: 'ordinary', payeeId: null },
      categoryId: null,
      memo: '',
      outflow: '',
      inflow: '',
      cleared: getClearedAfterDraftDateChange({
        cleared: plan.defaultTransactionCleared,
        date,
        today,
      }),
    })
  }

  // A stable handler keeps the memoized saved rows from re-rendering.
  const startEditRef = useRef(startEdit)
  useLayoutEffect(() => {
    startEditRef.current = startEdit
  })
  const editTransaction = useCallback(
    (transaction: Transaction) => startEditRef.current(transaction),
    [],
  )

  function startEdit(transaction: Transaction) {
    if (amountsHidden) return
    if (draft) {
      setDraftError({
        field: null,
        message: 'Save or cancel the current draft first.',
      })
      return
    }

    setRegisterError(null)
    setDraftError(null)
    setEditingRow(transaction)
    setDraft({
      id: transaction.id,
      accountId: transaction.accountId,
      date: transaction.date,
      payee: transaction.transferId
        ? {
            kind: 'transfer',
            accountId: transaction.counterpartAccountId ?? '',
          }
        : { kind: 'ordinary', payeeId: transaction.payeeId },
      categoryId: transaction.categoryId,
      memo: transaction.memo ?? '',
      outflow:
        transaction.amount < 0
          ? formatMilliunitsForInput(
              transaction.amount,
              plan.countryCode,
              plan.currencyCode,
            )
          : '',
      inflow:
        transaction.amount > 0
          ? formatMilliunitsForInput(
              transaction.amount,
              plan.countryCode,
              plan.currencyCode,
            )
          : '',
      cleared: transaction.cleared,
      reconciled: transaction.reconciled,
    })
  }

  async function saveDraft({
    addAnother = false,
    confirmUnlink = false,
  }: { addAnother?: boolean; confirmUnlink?: boolean } = {}) {
    if (!draft) return

    const hasOutflow = Boolean(draft.outflow.trim())
    const hasInflow = Boolean(draft.inflow.trim())

    if (hasOutflow === hasInflow) {
      setDraftError({
        field: 'amount',
        message: 'Enter a positive value in either Outflow or Inflow.',
      })
      return
    }

    const outflow = hasOutflow
      ? evaluateCurrencyToMilliunits(
          draft.outflow,
          plan.countryCode,
          plan.currencyCode,
        )
      : null
    const inflow = hasInflow
      ? evaluateCurrencyToMilliunits(
          draft.inflow,
          plan.countryCode,
          plan.currencyCode,
        )
      : null

    if (outflow === null && inflow === null) {
      setDraftError({
        field: 'amount',
        message: 'Enter a valid positive amount.',
      })
      return
    }

    const parsed = createTransactionSchema.safeParse({
      accountId: draft.accountId,
      categoryId: draft.categoryId,
      date: draft.date,
      payee: draft.payee,
      memo: draft.memo,
      amount: outflow === null ? inflow : -outflow,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cleared: draft.cleared,
      today,
    })

    if (!parsed.success) {
      const issue = parsed.error.issues.at(0)
      setDraftError({
        field: getDraftField(issue?.path.at(0)),
        message: issue?.message ?? 'Check this row.',
      })
      return
    }

    const original = draft.id
      ? transactions.find((transaction) => transaction.id === draft.id)
      : null
    if (parsed.data.payee.kind === 'create') {
      const nameKey = getPayeeNameKey(parsed.data.payee.name)
      const existing = payees.find(
        (payee) => getPayeeNameKey(payee.name) === nameKey,
      )
      if (existing)
        parsed.data.payee = { kind: 'ordinary', payeeId: existing.id }
    }
    const needed = original && reconciliationWarning(original, parsed.data)
    if (
      !confirmUnlink &&
      (needed || (original?.transferId && draft.payee.kind !== 'transfer'))
    ) {
      setSaveConfirmation({
        warning: needed ?? null,
        key: confirmationKey(original, {
          ...parsed.data,
          futureDraftDate: draft.futureDraftDate,
        }),
      })
      return
    }

    setIsSaving(true)
    setDraftError(null)
    setRegisterError(null)

    try {
      const payload = draft.id
        ? await updateTransactionFn({
            data: {
              id: draft.id,
              confirmUnlink,
              futureDraftDate: draft.futureDraftDate,
              confirmation: confirmUnlink ? saveConfirmation?.key : undefined,
              ...parsed.data,
            },
          })
        : await createTransactionFn({ data: parsed.data })

      await applyMutation(payload)
      setSaveConfirmation(null)
      // Entering a run of new Transactions keeps the date of the last one.
      if (addAnother && !draft.id) {
        startCreationDraft(draft.accountId, draft.date)
      } else {
        closeDraft(draft.id)
      }
    } catch (cause) {
      const stale =
        cause instanceof Error &&
        cause.message.startsWith('The Transaction changed.')
      setDraftError({
        field: null,
        message: stale
          ? cause.message
          : 'Could not save this Transaction. Please try again.',
      })
      if (stale)
        await refreshRegister().catch(() =>
          setDraftError({
            field: null,
            message: 'Could not refresh this Transaction. Please try again.',
          }),
        )
    } finally {
      setIsSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return

    setIsDeleting(true)
    setRegisterError(null)

    try {
      const payload = await deleteTransactionFn({
        data: {
          id: deleteTarget.id,
          confirmation: confirmationKey(deleteTarget),
        },
      })
      await applyMutation(payload)
      setDeleteTarget(null)
    } catch (cause) {
      const stale =
        cause instanceof Error &&
        cause.message.startsWith('The Transaction changed.')
      setRegisterError(
        stale
          ? cause.message
          : 'Could not delete this Transaction. Please try again.',
      )
      if (stale)
        await refreshRegister().catch(() =>
          setRegisterError(
            'Could not refresh this Transaction. Please try again.',
          ),
        )
    } finally {
      setIsDeleting(false)
    }
  }

  const title = isPlanRegister ? 'All Accounts' : scope.account.name
  const deletionIsReconciled = Boolean(
    deleteTarget?.reconciled || deleteTarget?.counterpartReconciled,
  )
  const description = isPlanRegister
    ? 'Review and manage Transactions across every Account in this Plan.'
    : scope.account.closed
      ? 'Historical Transactions are read-only until this Account is reopened.'
      : accountTypeDetails[scope.account.type].label
  const emptyDescription = isPlanRegister
    ? accounts.length === 0
      ? 'Add an Account before recording the first Transaction in this Plan.'
      : openAccounts.length === 0
        ? 'This Plan has no Transaction history, and all of its Accounts are Closed.'
        : 'Add the first entry to start building this Plan’s Account balances.'
    : scope.account.closed
      ? 'This Account has no Transaction history.'
      : 'Add the first entry to start building this Account balance.'
  const accountById = new Map(
    accounts.map((account) => [account.id, account] as const),
  )
  const deleteAccount = deleteTarget
    ? accountById.get(deleteTarget.accountId)
    : null
  const deleteCounterpartAccount = deleteTarget?.counterpartAccountId
    ? accountById.get(deleteTarget.counterpartAccountId)
    : null
  const unlinkOriginal = draft?.id
    ? transactions.find((transaction) => transaction.id === draft.id)
    : null
  const unlinkCounterpartAccount = unlinkOriginal?.counterpartAccountId
    ? accountById.get(unlinkOriginal.counterpartAccountId)
    : null

  return (
    <main className="flex min-h-full min-w-0 flex-1 flex-col">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 border-b px-3 py-4 md:pl-14 md:pr-64">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold">{title}</h1>
            {!isPlanRegister && scope.account.closed && (
              <span className="text-sm text-muted-foreground">· Closed</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{description}</span>
            {scope.kind === 'account' &&
              accountTypeDetails[scope.account.type].group !== 'loans' && (
                <span className="inline-flex items-center gap-1">
                  <LockKeyhole aria-hidden className="size-3" />
                  {last
                    ? 'Last reconciled ' + last.toLocaleString()
                    : 'Not Yet Reconciled'}
                </span>
              )}
          </div>
        </div>

        {!amountsHidden &&
          scope.kind === 'account' &&
          !scope.account.closed &&
          accountTypeDetails[scope.account.type].group !== 'loans' && (
            <ReconciliationControls
              balance={clearedBalance}
              credit={accountTypeDetails[scope.account.type].group === 'credit'}
              plan={plan}
              refresh={refreshRegister}
              review={() => refreshRegister(undefined, true)}
              finish={async (target, adjust) => {
                const result = await complete({
                  data: {
                    accountId: scope.account.id,
                    planId,
                    target,
                    adjust,
                    today,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    version: summary.version!,
                  },
                })
                const verifiedIds = new Set(result.verifiedIds)
                setDraft((current) =>
                  current?.id &&
                  verifiedIds.has(current.id) &&
                  !current.futureDraftDate
                    ? { ...current, reconciled: true, cleared: true }
                    : current,
                )
                setLast(result.completedAt)
                await applyMutation(result.adjustment)
                setHidden(plan.hideAfterReconciliation)
              }}
            />
          )}
      </header>

      <div className="flex flex-col">
        <div
          aria-label="Account balances"
          className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b px-3 py-3 sm:gap-x-5 sm:px-6"
        >
          <RegisterBalance
            amount={clearedBalance}
            label="Cleared Balance"
            plan={plan}
          />
          <span aria-hidden className="text-muted-foreground">
            +
          </span>
          <RegisterBalance
            amount={unclearedBalance}
            label="Uncleared Balance"
            plan={plan}
          />
          <span aria-hidden className="text-muted-foreground">
            =
          </span>
          <RegisterBalance
            amount={workingBalance}
            label="Working Balance"
            plan={plan}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 sm:px-6">
          {canCreate && (
            <Button
              variant="ghost"
              className="text-primary"
              disabled={amountsHidden || draft !== null}
              aria-keyshortcuts="Shift+N"
              onClick={startCreate}
              ref={addButtonRef}
              title="Add Transaction (Shift+N)"
              type="button"
            >
              <Plus data-icon="inline-start" />
              Add Transaction
            </Button>
          )}
          <Input
            type="search"
            aria-label="Search transactions"
            placeholder="Search transactions"
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!!draft}
            className="w-44"
          />
          {(hidden || summary.hasReconciled) && (
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setHidden(!hidden)}
            >
              {hidden ? 'View All' : 'Hide Reconciled'}
            </Button>
          )}
        </div>
        <Card className="rounded-none border-x-0 shadow-none">
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>
              Newest entries appear first. Upcoming entries do not affect
              today&apos;s balances.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {registerError && !deleteTarget && (
              <p role="alert">{registerError}</p>
            )}
            {pages.data?.pages[0]?.anchored && (
              <Button
                variant="ghost"
                disabled={!!draft}
                onClick={() => {
                  if (selectedTransactionId && accountId)
                    void router.navigate({
                      to: '/plans/$planId/accounts/$accountId',
                      params: { planId, accountId },
                      search: {},
                      replace: true,
                    })
                  else
                    void refreshRegister(null).catch(() =>
                      setRegisterError(
                        'Could not load the newest transactions. Try again.',
                      ),
                    )
                }}
              >
                Show newest transactions
              </Button>
            )}
            {pages.isPending && !draft ? (
              <p role="status">Loading transactions…</p>
            ) : transactions.length === 0 &&
              draft === null &&
              !pages.isError ? (
              <Empty className="min-h-72">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ReceiptText />
                  </EmptyMedia>
                  <EmptyTitle>
                    {term || hidden
                      ? 'No matching transactions'
                      : 'No Transactions yet'}
                  </EmptyTitle>
                  <EmptyDescription>
                    {term || hidden
                      ? 'Try a different search or filter.'
                      : emptyDescription}
                  </EmptyDescription>
                </EmptyHeader>
                {canCreate && (
                  <EmptyContent>
                    <Button
                      disabled={amountsHidden}
                      onClick={startCreate}
                      type="button"
                    >
                      <Plus data-icon="inline-start" />
                      Add Transaction
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            ) : (
              <TransactionTable
                key={JSON.stringify([
                  planId,
                  accountId,
                  term,
                  hidden,
                  selectedTransactionId,
                  draft?.id,
                  !!draft,
                ])}
                planId={planId}
                onBulkSaved={async () => {
                  invalidateBalances()
                  try {
                    await refreshRegister(null)
                  } catch {
                    setRegisterError(
                      'Changes saved. Reload the register to see them.',
                    )
                  }
                }}
                accounts={accounts}
                categoryGroups={categoryGroups}
                categoryNames={categoryNames}
                countryCode={plan.countryCode}
                currencyCode={plan.currencyCode}
                draft={amountsHidden ? null : draft}
                draftError={draftError}
                draftSession={draftSession}
                isSaving={isSaving}
                payees={payees}
                showAccount={isPlanRegister}
                today={today}
                highlightedIds={highlightedIds}
                transactions={transactions}
                onCancelDraft={() => {
                  closeDraft(draft?.id ?? null)
                  setDraftError(null)
                  setSaveConfirmation(null)
                }}
                onDelete={setDeleteTarget}
                onDraftChange={(next) => {
                  // A late blur from a closing row must not reopen its draft.
                  setDraft((current) =>
                    current?.id === next.id ? next : current,
                  )
                  if (
                    draft &&
                    draftError?.field &&
                    draftFieldChanged(draft, next, draftError.field)
                  ) {
                    setDraftError(null)
                  }
                }}
                onEdit={editTransaction}
                onSave={(options) => void saveDraft(options)}
              />
            )}
            {(pages.hasNextPage || pages.isError) && (
              <Button
                variant="ghost"
                ref={sentinel}
                disabled={pages.isFetching}
                onClick={() =>
                  void (pages.isError && !pages.hasNextPage
                    ? pages.refetch()
                    : pages.fetchNextPage({ cancelRefetch: false }))
                }
              >
                {pages.isError
                  ? 'Could not load transactions · Retry'
                  : pages.isFetching
                    ? 'Loading transactions…'
                    : 'Load more transactions'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteTarget(null)
            setRegisterError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletionIsReconciled
                ? deleteTarget?.transferId
                  ? 'Delete Reconciled Transfer?'
                  : 'Delete Reconciled Transaction?'
                : deleteTarget?.transferId
                  ? 'Delete this Transfer?'
                  : 'Delete this Transaction?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletionIsReconciled
                ? deleteTarget?.transferId
                  ? 'Both sides of this transfer will be deleted. Matching transfers have been reconciled and deletion may bring those reconciliations out of balance.'
                  : 'Deleting a reconciled transaction will bring the reconciliation out of balance.'
                : deleteTarget?.transferId
                  ? `This permanently removes the linked Transactions from ${deleteAccount?.name ?? 'this Account'} and ${deleteCounterpartAccount?.name ?? 'the other Account'} and may change both balances.`
                  : 'This permanently removes the entry and may change the Account balances.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {registerError && (
            <p className="text-sm text-destructive" role="alert">
              {registerError}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
              variant="destructive"
            >
              {isDeleting && <Spinner data-icon="inline-start" />}
              {isDeleting
                ? 'Deleting…'
                : deletionIsReconciled
                  ? 'Delete'
                  : deleteTarget?.transferId
                    ? 'Delete Transfer'
                    : 'Delete Transaction'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmingUnlink}
        onOpenChange={(open) => {
          if (!open && !isSaving) setSaveConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {warning === 'transfer'
                ? 'Save Changes to Reconciled Transfer'
                : warning === 'transaction'
                  ? 'Save Changes to Reconciled Transaction'
                  : 'Break this Transfer link?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {warning === 'transfer' &&
                `This transfer has already been reconciled in ${unlinkCounterpartAccount?.name}. Any changes to this transaction will automatically modify the matching, reconciled transaction in ${unlinkCounterpartAccount?.name} and may bring the reconciliation out of balance. `}
              {warning === 'transaction' &&
                'Saving your changes to this reconciled transaction may bring your reconciliation out of balance. '}
              {unlinkOriginal?.transferId &&
                draft?.payee.kind !== 'transfer' &&
                `Saving this as an ordinary Transaction permanently removes the linked entry from ${unlinkCounterpartAccount?.name} and may change that Account’s balance.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSaving}
              onClick={() => {
                setSaveConfirmation(null)
                void saveDraft({ confirmUnlink: true })
              }}
              variant="destructive"
            >
              {isSaving && <Spinner data-icon="inline-start" />}
              {isSaving ? 'Saving…' : warning ? 'Save' : 'Break Link and Save'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        'input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"]',
      ) !== null)
  )
}

function RegisterBalance({
  amount,
  label,
  plan,
}: {
  amount: number
  label: string
  plan: { countryCode: CountryCode; currencyCode: CurrencyCode }
}) {
  const money = useMoney(plan)
  return (
    <dl className="flex min-w-0 flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'break-all font-heading text-base font-semibold tabular-nums sm:text-xl',
          amount > 0 && 'text-emerald-700 dark:text-emerald-400',
        )}
      >
        {money(amount)}
      </dd>
    </dl>
  )
}

function TransactionTable({
  planId,
  onBulkSaved,
  accounts,
  categoryGroups,
  categoryNames,
  countryCode,
  currencyCode,
  draft,
  draftError,
  draftSession,
  isSaving,
  payees,
  showAccount,
  today,
  highlightedIds,
  transactions,
  onCancelDraft,
  onDelete,
  onDraftChange,
  onEdit,
  onSave,
}: {
  planId: string
  onBulkSaved: () => Promise<void>
  accounts: Array<Account>
  categoryGroups: Array<CategoryGroup>
  categoryNames: Map<string, string>
  countryCode: CountryCode
  currencyCode: CurrencyCode
  draft: Draft | null
  draftError: DraftError | null
  draftSession: number
  isSaving: boolean
  payees: Array<Payee>
  showAccount: boolean
  today: string
  highlightedIds: ReadonlySet<string>
  transactions: Array<Transaction>
  onCancelDraft: () => void
  onDelete: (transaction: Transaction) => void
  onDraftChange: (draft: Draft) => void
  onEdit: (transaction: Transaction) => void
  onSave: (options: { addAnother: boolean }) => void
}) {
  const accountById = new Map(
    accounts.map((account) => [account.id, account] as const),
  )
  const openAccounts = accounts.filter((account) => !account.closed)
  const transactionIsReadOnly = (transaction: Transaction) => {
    const transactionAccount = accountById.get(transaction.accountId)
    const counterpartAccount = transaction.counterpartAccountId
      ? accountById.get(transaction.counterpartAccountId)
      : null
    return (
      !transactionAccount ||
      transactionAccount.closed ||
      Boolean(counterpartAccount?.closed)
    )
  }
  const showActions =
    showAccount ||
    draft !== null ||
    transactions.some((transaction) => !transactionIsReadOnly(transaction))

  const selectable = draft
    ? []
    : transactions.filter((t) => !transactionIsReadOnly(t))
  const { ids, selected, allSelected, selectAll, toggle, clear } =
    useRowSelection(selectable)
  return (
    // Fixed column widths keep the columns still when a draft row opens.
    <>
      <Table className="max-md:block md:min-w-5xl md:table-fixed">
        <TableHeader className="max-md:sr-only">
          <TableRow>
            <TableHead className="w-36">
              <div className="flex items-center gap-3">
                {selectable.length > 0 && (
                  <Checkbox
                    aria-label="Select all loaded editable transactions"
                    className="data-[state=indeterminate]:before:h-px data-[state=indeterminate]:before:w-2 data-[state=indeterminate]:before:bg-current data-[state=indeterminate]:[&_svg]:hidden"
                    checked={
                      allSelected || (selected.length > 0 && 'indeterminate')
                    }
                    onCheckedChange={selectAll}
                  />
                )}
                Date
              </div>
            </TableHead>
            {showAccount && <TableHead className="w-40">Account</TableHead>}
            <TableHead>Payee</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Memo</TableHead>
            <TableHead className="w-28 text-right">Outflow</TableHead>
            <TableHead className="w-28 text-right">Inflow</TableHead>
            <TableHead className="w-20 text-center">Cleared</TableHead>
            {showActions && (
              <TableHead className="w-24 text-right">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody className="max-md:block">
          {draft?.id === null && (
            <DraftRows
              key={draftSession}
              accounts={openAccounts}
              categoryGroups={categoryGroups}
              countryCode={countryCode}
              currencyCode={currencyCode}
              draft={draft}
              error={draftError}
              isSaving={isSaving}
              payees={payees}
              showAccount={showAccount}
              today={today}
              onCancel={onCancelDraft}
              onChange={onDraftChange}
              onSave={onSave}
            />
          )}

          {transactions.map((transaction) => {
            if (draft?.id === transaction.id) {
              return (
                <DraftRows
                  accounts={openAccounts}
                  categoryGroups={categoryGroups}
                  countryCode={countryCode}
                  currencyCode={currencyCode}
                  draft={draft}
                  error={draftError}
                  isSaving={isSaving}
                  payees={payees}
                  key={transaction.id}
                  showAccount={showAccount}
                  today={today}
                  onCancel={onCancelDraft}
                  onChange={onDraftChange}
                  onSave={onSave}
                />
              )
            }

            return (
              <TransactionRow
                account={accountById.get(transaction.accountId)}
                categoryName={
                  transaction.categoryId
                    ? categoryNames.get(transaction.categoryId)
                    : undefined
                }
                counterpartAccount={
                  transaction.counterpartAccountId
                    ? accountById.get(transaction.counterpartAccountId)
                    : undefined
                }
                countryCode={countryCode}
                currencyCode={currencyCode}
                highlighted={highlightedIds.has(transaction.id)}
                checked={ids.has(transaction.id)}
                onSelect={draft ? undefined : toggle}
                isReadOnly={transactionIsReadOnly(transaction)}
                key={transaction.id}
                showAccount={showAccount}
                showActions={showActions}
                transaction={transaction}
                onDelete={onDelete}
                onEdit={onEdit}
              />
            )
          })}
        </TableBody>
      </Table>
      {selected.length > 0 && (
        <BulkTransactionBar
          planId={planId}
          accountId={showAccount ? undefined : selected[0].accountId}
          rows={selected}
          today={today}
          groups={categoryGroups}
          onSelectAll={selectAll}
          allSelected={allSelected}
          onClose={clear}
          onSaved={onBulkSaved}
        />
      )}
    </>
  )
}

// Saved rows only depend on their own data, so a draft change elsewhere in the
// register does not re-render them.
const TransactionRow = memo(function TransactionRow({
  checked,
  onSelect,
  account,
  categoryName,
  counterpartAccount,
  countryCode,
  currencyCode,
  highlighted,
  isReadOnly,
  showAccount,
  showActions,
  transaction,
  onDelete,
  onEdit,
}: {
  checked: boolean
  onSelect?: (id: string, shift: boolean) => void
  account: Account | undefined
  categoryName: string | undefined
  counterpartAccount: Account | undefined
  countryCode: CountryCode
  currencyCode: CurrencyCode
  highlighted: boolean
  isReadOnly: boolean
  showAccount: boolean
  showActions: boolean
  transaction: Transaction
  onDelete: (transaction: Transaction) => void
  onEdit: (transaction: Transaction) => void
}) {
  const money = useMoney({ countryCode, currencyCode })
  const amountsHidden = useAmountsHidden()
  return (
    <TableRow
      className={cn(
        'transition-colors duration-1000 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-2 max-md:px-4 max-md:py-3 max-md:[&>td]:p-0',
        highlighted && 'bg-primary/10',
      )}
      data-transaction-id={transaction.id}
      data-state={checked ? 'selected' : undefined}
    >
      <TableCell className="max-md:col-start-1 max-md:row-start-3 max-md:text-xs max-md:text-muted-foreground">
        <div className="flex items-center gap-3">
          {onSelect && !isReadOnly && (
            <Checkbox
              aria-label={`Select transaction ${transaction.date}, ${transaction.payeeName ?? account?.name ?? 'no payee'}`}
              checked={checked}
              onClick={(e) => onSelect(transaction.id, e.shiftKey)}
            />
          )}
          {formatTransactionDate(transaction.date, countryCode)}
        </div>
      </TableCell>
      {showAccount && (
        <TableCell className="truncate max-md:col-start-1 max-md:row-start-4 max-md:text-xs max-md:text-muted-foreground">
          {account
            ? `${account.name}${account.closed ? ' (Closed)' : ''}`
            : 'Unknown Account'}
        </TableCell>
      )}
      <TableCell className="truncate max-md:col-start-1 max-md:row-start-1 max-md:font-semibold">
        {counterpartAccount
          ? `To/From ${counterpartAccount.name}`
          : transaction.payeeName || '—'}
      </TableCell>
      <TableCell className="truncate max-md:col-start-1 max-md:row-start-2 max-md:text-muted-foreground">
        {transaction.transferId
          ? 'Category not needed'
          : transaction.categoryId
            ? (categoryName ?? 'Unknown')
            : 'Uncategorized'}
      </TableCell>
      <TableCell
        className={cn(
          'truncate text-muted-foreground max-md:col-start-1 max-md:text-xs',
          !transaction.memo && 'max-md:hidden',
        )}
      >
        {transaction.memo || '—'}
      </TableCell>
      <TableCell
        className={cn(
          'text-right tabular-nums max-md:col-start-2 max-md:row-start-1 max-md:font-semibold',
          transaction.amount >= 0 && 'max-md:hidden',
        )}
      >
        {transaction.amount < 0 && <span className="md:hidden">−</span>}
        {transaction.amount < 0 ? money(Math.abs(transaction.amount)) : '—'}
      </TableCell>
      <TableCell
        className={cn(
          'text-right tabular-nums max-md:col-start-2 max-md:row-start-1 max-md:font-semibold',
          transaction.amount < 0 && 'max-md:hidden',
        )}
      >
        {transaction.amount > 0 ? money(transaction.amount) : '—'}
      </TableCell>
      <TableCell className="text-center max-md:col-start-2 max-md:row-start-2 max-md:text-right max-md:[&_svg]:size-4">
        <span
          className={cn(
            'inline-flex justify-center text-foreground',
            transaction.cleared && 'text-primary',
          )}
          title={transaction.cleared ? 'Cleared' : 'Uncleared'}
        >
          {transaction.reconciled ? (
            <LockKeyhole
              role="img"
              aria-label="This transaction is reconciled"
            />
          ) : (
            <Copyright
              aria-label={transaction.cleared ? 'Cleared' : 'Uncleared'}
            />
          )}
        </span>
      </TableCell>
      {showActions && (
        <TableCell className="max-md:col-start-2 max-md:row-start-3 max-md:row-span-2">
          {!isReadOnly && (
            <div className="flex justify-end gap-1">
              <Button
                aria-label="Edit Transaction"
                disabled={amountsHidden}
                onClick={() => onEdit(transaction)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Pencil />
              </Button>
              <Button
                aria-label="Delete Transaction"
                onClick={() => onDelete(transaction)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  )
})

function DraftStatus({
  draft,
  onChange,
  inputId,
  isFutureDated,
  invalid,
}: {
  draft: Draft
  onChange: (next: Draft) => void
  inputId: string
  isFutureDated: boolean
  invalid: boolean
}) {
  const clearedDescriptionId = `${inputId}-cleared-description`
  return (
    <Field
      className="items-center"
      data-disabled={isFutureDated}
      data-invalid={invalid}
    >
      <FieldLabel className="sr-only" htmlFor={`${inputId}-cleared`}>
        Cleared
      </FieldLabel>
      {draft.reconciled ? (
        <LockKeyhole role="img" aria-label="This transaction is reconciled" />
      ) : (
        <Toggle
          aria-describedby={isFutureDated ? clearedDescriptionId : undefined}
          aria-label="Cleared"
          disabled={isFutureDated}
          id={`${inputId}-cleared`}
          onPressedChange={(pressed) =>
            onChange({ ...draft, cleared: pressed })
          }
          pressed={draft.cleared}
          size="icon-sm"
          title={
            isFutureDated
              ? 'Future Transactions cannot be Cleared.'
              : draft.cleared
                ? 'Cleared'
                : 'Uncleared'
          }
          type="button"
          variant="cleared"
        >
          <Copyright />
        </Toggle>
      )}
      {draft.payee.kind === 'transfer' && isFutureDated && (
        <span>Both sides are Uncleared.</span>
      )}
      {isFutureDated && (
        <span className="sr-only" id={clearedDescriptionId}>
          Future Transactions cannot be Cleared.
        </span>
      )}
    </Field>
  )
}

function DraftRows({
  accounts,
  categoryGroups,
  countryCode,
  currencyCode,
  draft,
  error,
  isSaving,
  payees,
  showAccount,
  today,
  onCancel,
  onChange: commitChange,
  onSave,
}: {
  accounts: Array<Account>
  categoryGroups: Array<CategoryGroup>
  countryCode: CountryCode
  currencyCode: CurrencyCode
  draft: Draft
  error: DraftError | null
  isSaving: boolean
  payees: Array<Payee>
  showAccount: boolean
  today: string
  onCancel: () => void
  onChange: (draft: Draft) => void
  onSave: (options: { addAnother: boolean }) => void
}) {
  const inputId = draft.id ?? 'new'
  const money = useMoney({ countryCode, currencyCode })
  const invalidField = error?.field
  const isFutureDated = draft.date > today
  const selectableAccounts = accounts.filter(
    (account) =>
      draft.payee.kind !== 'transfer' || account.id !== draft.payee.accountId,
  )
  const { planId } = useParams({ from: '/_authenticated/plans/$planId' })
  const readyToAssign = useQuery(readyToAssignQueryOptions(planId, today)).data
  const readyToAssignDetail = readyToAssign !== undefined && (
    <span
      className={cn(
        'tabular-nums',
        readyToAssign > 0 && 'text-lime-700 dark:text-lime-400',
        readyToAssign < 0 && 'text-destructive',
      )}
    >
      {money(readyToAssign)}
    </span>
  )
  // Inflow: Ready to Assign comes first. Credit Payment Categories are never
  // offered.
  const categoryOptionGroups = categoryGroups
    .filter((group) => group.kind !== 'credit_card_payments')
    .sort((a, b) => Number(b.kind === 'inflow') - Number(a.kind === 'inflow'))
    .map((group) => ({
      id: group.id,
      label: group.name,
      items: group.categories
        .filter(
          (category) => !category.hidden || category.id === draft.categoryId,
        )
        .map((category) => ({
          detail:
            category.kind === 'ready_to_assign' ? readyToAssignDetail : null,
          disabled: category.hidden,
          label: category.hidden ? `${category.name} (hidden)` : category.name,
          selectedLabel: categoryDisplayName(group, category),
          value: category.id,
        })),
    }))
  const assignableCategoryIds = new Set(
    categoryOptionGroups
      .flatMap((group) => group.items)
      .filter((item) => !item.disabled)
      .map((item) => item.value),
  )

  function getRememberedCategoryId(payee: Draft['payee']) {
    if (payee.kind !== 'ordinary' || !payee.payeeId) return null
    const categoryId = payees.find(
      (option) => option.id === payee.payeeId,
    )?.lastCategoryId
    return categoryId && assignableCategoryIds.has(categoryId)
      ? categoryId
      : null
  }

  // Evaluate arithmetic and normalize the amount once the user leaves it.
  function formatAmount(value: string) {
    const milliunits = evaluateCurrencyToMilliunits(
      value,
      countryCode,
      currencyCode,
    )
    return milliunits === null
      ? value
      : formatMilliunitsForInput(milliunits, countryCode, currencyCode)
  }

  // Prefill the Payee's last Category unless the user already chose one.
  function getCategoryAfterPayeeChange(payee: Draft['payee']) {
    if (payee.kind === 'transfer') return null
    const isPrefilled =
      draft.categoryId === null ||
      draft.categoryId === getRememberedCategoryId(draft.payee)
    return isPrefilled ? getRememberedCategoryId(payee) : draft.categoryId
  }

  // The draft as it was before the focused field changed, so Escape can undo
  // just that field before it cancels the whole draft.
  const fieldSnapshotRef = useRef<Draft | null>(null)
  const focusedFieldRef = useRef<EventTarget | null>(null)

  function onChange(next: Draft) {
    fieldSnapshotRef.current ??= draft
    commitChange(next)
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && !isSaving) {
      const snapshot = fieldSnapshotRef.current
      fieldSnapshotRef.current = null
      if (snapshot) {
        commitChange(snapshot)
      } else {
        onCancel()
      }
    }
    if (
      event.key === 'Enter' &&
      !event.defaultPrevented &&
      event.target instanceof HTMLInputElement
    ) {
      onSave({ addAnother: true })
    }
  }

  return (
    <>
      <TableRow
        className="register-draft"
        onFocus={(event) => {
          if (event.target === focusedFieldRef.current) return
          focusedFieldRef.current = event.target
          fieldSnapshotRef.current = null
        }}
        onKeyDown={handleKeyDown}
      >
        <TableCell>
          <Field data-invalid={invalidField === 'date'}>
            <FieldLabel className="sr-only" htmlFor={`${inputId}-date`}>
              Date
            </FieldLabel>
            <TransactionDatePicker
              autoFocus={
                draft.id === null &&
                window.matchMedia('(min-width: 48rem)').matches
              }
              invalid={invalidField === 'date'}
              id={`${inputId}-date`}
              locale={getCountryProfile(countryCode).locale}
              onChange={(nextDate) => {
                onChange({
                  ...draft,
                  date: nextDate,
                  reconciled: nextDate > today ? false : draft.reconciled,
                  futureDraftDate:
                    nextDate > today ? nextDate : draft.futureDraftDate,
                  cleared: getClearedAfterDraftDateChange({
                    cleared: draft.cleared,
                    date: nextDate,
                    today,
                  }),
                })
              }}
              today={today}
              value={draft.date}
            />
          </Field>
        </TableCell>
        {showAccount && (
          <TableCell>
            <Field data-invalid={invalidField === 'account'}>
              <FieldLabel className="sr-only" htmlFor={`${inputId}-account`}>
                Account
              </FieldLabel>
              <SearchableSelect
                {...draftComboboxOptions}
                emptyMessage="No matching Accounts."
                groups={[
                  {
                    id: 'open-accounts',
                    label: 'Open Accounts',
                    items: selectableAccounts.map((account) => ({
                      label: account.name,
                      value: account.id,
                    })),
                  },
                ]}
                id={`${inputId}-account`}
                invalid={invalidField === 'account'}
                onChange={(accountId) =>
                  onChange({
                    ...draft,
                    accountId,
                    cleared:
                      draft.reconciled ||
                      getClearedAfterDraftAccountChange({
                        cleared: draft.cleared,
                        currentAccountId: draft.accountId,
                        draftId: draft.id,
                        nextAccountId: accountId,
                      }),
                  })
                }
                placeholder="Select Account"
                value={draft.accountId}
              />
            </Field>
          </TableCell>
        )}
        <TableCell>
          <Field data-invalid={invalidField === 'payee'}>
            <FieldLabel className="sr-only" htmlFor={`${inputId}-payee`}>
              Payee
            </FieldLabel>
            <PayeeEditor
              accounts={accounts}
              currentAccountId={draft.accountId}
              id={`${inputId}-payee`}
              invalid={invalidField === 'payee'}
              payees={payees}
              onChange={(payee) =>
                onChange({
                  ...draft,
                  payee,
                  categoryId: getCategoryAfterPayeeChange(payee),
                })
              }
              value={draft.payee}
            />
          </Field>
        </TableCell>
        <TableCell>
          <Field
            data-disabled={draft.payee.kind === 'transfer'}
            data-invalid={invalidField === 'category'}
          >
            <FieldLabel className="sr-only" htmlFor={`${inputId}-category`}>
              Category
            </FieldLabel>
            {draft.payee.kind === 'transfer' ? (
              <Input
                disabled
                id={`${inputId}-category`}
                value="Category not needed"
              />
            ) : (
              <SearchableSelect
                {...draftComboboxOptions}
                emptyMessage="No matching Categories."
                groups={[
                  {
                    id: UNCATEGORIZED,
                    items: [{ label: 'Uncategorized', value: UNCATEGORIZED }],
                  },
                  ...categoryOptionGroups,
                ]}
                id={`${inputId}-category`}
                invalid={invalidField === 'category'}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    categoryId: value === UNCATEGORIZED ? null : value,
                  })
                }
                placeholder="Category"
                value={draft.categoryId ?? UNCATEGORIZED}
              />
            )}
          </Field>
        </TableCell>
        <TableCell>
          <Field data-invalid={invalidField === 'memo'}>
            <FieldLabel className="sr-only" htmlFor={`${inputId}-memo`}>
              Memo
            </FieldLabel>
            <Input
              aria-invalid={invalidField === 'memo'}
              id={`${inputId}-memo`}
              maxLength={200}
              onChange={(event) =>
                onChange({ ...draft, memo: event.target.value })
              }
              placeholder="Memo"
              value={draft.memo}
            />
          </Field>
        </TableCell>
        <TableCell>
          <Field data-invalid={invalidField === 'amount'}>
            <FieldLabel className="sr-only" htmlFor={`${inputId}-outflow`}>
              Outflow
            </FieldLabel>
            <Input
              aria-invalid={invalidField === 'amount'}
              className="text-right tabular-nums"
              id={`${inputId}-outflow`}
              inputMode="decimal"
              onBlur={() => {
                const outflow = formatAmount(draft.outflow)
                if (outflow !== draft.outflow) onChange({ ...draft, outflow })
              }}
              onChange={(event) =>
                onChange({
                  ...draft,
                  outflow: event.target.value,
                  inflow: event.target.value ? '' : draft.inflow,
                })
              }
              placeholder="0"
              value={draft.outflow}
            />
          </Field>
        </TableCell>
        <TableCell>
          <Field data-invalid={invalidField === 'amount'}>
            <FieldLabel className="sr-only" htmlFor={`${inputId}-inflow`}>
              Inflow
            </FieldLabel>
            <Input
              aria-invalid={invalidField === 'amount'}
              className="text-right tabular-nums"
              id={`${inputId}-inflow`}
              inputMode="decimal"
              onBlur={() => {
                const inflow = formatAmount(draft.inflow)
                if (inflow !== draft.inflow) onChange({ ...draft, inflow })
              }}
              onChange={(event) =>
                onChange({
                  ...draft,
                  inflow: event.target.value,
                  outflow: event.target.value ? '' : draft.outflow,
                })
              }
              placeholder="0"
              value={draft.inflow}
            />
          </Field>
        </TableCell>
        <TableCell>
          <DraftStatus
            draft={draft}
            onChange={onChange}
            inputId={inputId}
            isFutureDated={isFutureDated}
            invalid={invalidField === 'cleared'}
          />
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button
              aria-label="Cancel editing"
              disabled={isSaving}
              onClick={onCancel}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
            <Button
              aria-label="Save Transaction"
              className="max-md:w-auto max-md:px-3"
              disabled={isSaving}
              onClick={() => onSave({ addAnother: false })}
              size="icon-sm"
              type="button"
            >
              {isSaving ? <Spinner /> : <Check />}
              <span className="md:hidden">Save</span>
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {error && (
        <TableRow>
          <TableCell colSpan={showAccount ? 9 : 8}>
            <Field data-invalid>
              <FieldError>{error.message}</FieldError>
            </Field>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function getDraftField(path: PropertyKey | undefined): DraftField | null {
  switch (path) {
    case 'accountId':
      return 'account'
    case 'amount':
      return 'amount'
    case 'categoryId':
      return 'category'
    case 'cleared':
      return 'cleared'
    case 'date':
      return 'date'
    case 'memo':
      return 'memo'
    case 'payee':
      return 'payee'
    default:
      return null
  }
}

function draftFieldChanged(current: Draft, next: Draft, field: DraftField) {
  switch (field) {
    case 'account':
      return current.accountId !== next.accountId
    case 'amount':
      return current.outflow !== next.outflow || current.inflow !== next.inflow
    case 'category':
      return current.categoryId !== next.categoryId
    case 'cleared':
      return current.cleared !== next.cleared || current.date !== next.date
    case 'date':
      return current.date !== next.date
    case 'memo':
      return current.memo !== next.memo
    case 'payee':
      return JSON.stringify(current.payee) !== JSON.stringify(next.payee)
  }
}

function PayeeEditor({
  accounts,
  currentAccountId,
  id,
  invalid,
  onChange,
  payees,
  value,
}: {
  accounts: Array<Account>
  currentAccountId: string
  id: string
  invalid: boolean
  onChange: (value: Draft['payee']) => void
  payees: Array<Payee>
  value: Draft['payee']
}) {
  const accountById = new Map(
    accounts.map((account) => [account.id, account] as const),
  )
  const selectedAccount =
    value.kind === 'transfer' ? accountById.get(value.accountId) : null
  const selectedPayee =
    value.kind === 'ordinary' && value.payeeId
      ? payees.find((payee) => payee.id === value.payeeId)
      : null
  const displayValue = selectedAccount
    ? `To/From ${selectedAccount.name}`
    : value.kind === 'create'
      ? value.name
      : (selectedPayee?.name ?? '')
  const search = value.kind === 'create' ? getPayeeNameKey(value.name) : ''
  const filteredPayees = payees
    .filter((payee) => !search || getPayeeNameKey(payee.name).includes(search))
    .sort(
      (left, right) =>
        Number(matchesWordStart(right.name, search)) -
        Number(matchesWordStart(left.name, search)),
    )
  const hasExactPayee = payees.some(
    (payee) => getPayeeNameKey(payee.name) === search,
  )
  const eligibleAccounts = currentAccountId
    ? accounts.filter((account) => {
        if (account.closed || account.id === currentAccountId) return false
        if (!search) return true

        const details = accountTypeDetails[account.type]
        const haystack = `${account.name} ${details.label} ${accountGroupLabels[details.group]}`
        return haystack.toLowerCase().includes(search)
      })
    : []
  const payeeItems: Array<PayeeOption> = [
    ...(search
      ? []
      : [
          {
            key: 'none',
            label: 'No Payee',
            payee: { kind: 'ordinary', payeeId: null },
          } satisfies PayeeOption,
        ]),
    ...filteredPayees.map((payee): PayeeOption => ({
      key: `payee:${payee.id}`,
      label: payee.name,
      payee: { kind: 'ordinary', payeeId: payee.id },
    })),
  ]
  const transferItems: Array<PayeeOption> = currentAccountId
    ? eligibleAccounts.map((account) => {
        const details = accountTypeDetails[account.type]
        return {
          description: `${details.label} · ${accountGroupLabels[details.group]}`,
          key: `transfer:${account.id}`,
          label: `To/From ${account.name}`,
          payee: { kind: 'transfer', accountId: account.id },
        }
      })
    : [
        {
          disabled: true,
          key: 'transfer:none',
          label: 'Select an Account first.',
          payee: { kind: 'ordinary', payeeId: null },
        },
      ]
  const createItems: Array<PayeeOption> =
    search && !hasExactPayee && value.kind === 'create'
      ? [
          {
            key: 'create',
            label: value.name.trim(),
            payee: { kind: 'create', name: value.name.trim() },
          },
        ]
      : []
  // Only a match at the start of a word is strong enough to be committed by
  // Tab or Enter; otherwise Create is offered first.
  const hasWordStartMatch =
    filteredPayees.some((payee) => matchesWordStart(payee.name, search)) ||
    eligibleAccounts.some((account) =>
      matchesWordStart(`To/From ${account.name}`, search),
    )
  const createGroup = { id: 'create', items: createItems }
  const items = [
    ...(hasWordStartMatch ? [] : [createGroup]),
    { id: 'payees', items: payeeItems, label: 'Payees' },
    { id: 'transfers', items: transferItems, label: 'Payments and Transfers' },
    ...(hasWordStartMatch ? [createGroup] : []),
  ].filter((group) => group.items.length > 0)
  const selectedKey = selectedAccount
    ? `transfer:${selectedAccount.id}`
    : selectedPayee
      ? `payee:${selectedPayee.id}`
      : null
  const selectedItem =
    items
      .flatMap((group) => group.items)
      .find((item) => item.key === selectedKey) ?? null
  // The highlighted Create option keeps its key while its name changes, so
  // resolve it again from the current items.
  const keyboard = useComboboxKeyboard<PayeeOption>((highlighted) => {
    const item = items
      .flatMap((group) => group.items)
      .find((option) => option.key === highlighted.key)
    if (item) onChange(item.payee)
  }, draftComboboxOptions)

  return (
    <Combobox
      autoHighlight
      filter={null}
      inputValue={displayValue}
      isItemEqualToValue={(item, selected) => item.key === selected.key}
      itemToStringLabel={(item) => item.label}
      items={items}
      onInputValueChange={(text, details) => {
        if (details.reason !== 'input-change') return
        onChange(
          text
            ? { kind: 'create', name: text }
            : { kind: 'ordinary', payeeId: null },
        )
      }}
      onItemHighlighted={keyboard.onItemHighlighted}
      onOpenChange={keyboard.onOpenChange}
      onValueChange={(item) => {
        if (item) onChange(item.payee)
      }}
      open={keyboard.open}
      value={selectedItem}
    >
      <ComboboxInput
        aria-invalid={invalid}
        autoComplete="off"
        className="w-full"
        id={id}
        maxLength={100}
        onFocus={keyboard.onFocus}
        onKeyDown={keyboard.onKeyDown}
        placeholder="Payee"
        showTrigger={false}
      />
      <ComboboxContent className="w-80">
        <ComboboxList>
          {(group: {
            id: string
            items: Array<PayeeOption>
            label?: string
          }) => (
            <ComboboxGroup items={group.items} key={group.id}>
              {group.label && <ComboboxLabel>{group.label}</ComboboxLabel>}
              <ComboboxCollection>
                {(item: PayeeOption) => (
                  <ComboboxItem
                    disabled={item.disabled}
                    key={item.key}
                    value={item}
                  >
                    {item.key === 'create' ? (
                      <>
                        <Plus />
                        Create “{item.label}”
                      </>
                    ) : item.description ? (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{item.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    ) : (
                      item.label
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

function focusNextDraftField(from: HTMLElement) {
  const row = from.closest('tr')
  if (!row) return

  const fields = Array.from(
    row.querySelectorAll<HTMLElement>('input, button'),
  ).filter(
    (field) =>
      field.tabIndex >= 0 &&
      !field.hasAttribute('disabled') &&
      field.getAttribute('aria-hidden') !== 'true',
  )
  fields.at(fields.indexOf(from) + 1)?.focus()
}

// Draft lists open on focus, and picking with Enter moves on to the next field.
const draftComboboxOptions = {
  onEnterPick: (input: HTMLElement) =>
    requestAnimationFrame(() => focusNextDraftField(input)),
  openOnFocus: true,
}

type PayeeOption = {
  description?: string
  disabled?: boolean
  key: string
  label: string
  payee: Draft['payee']
}

function matchesWordStart(text: string, query: string) {
  const needle = normalizeWords(query)
  return Boolean(needle) && ` ${normalizeWords(text)}`.includes(` ${needle}`)
}

function normalizeWords(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function sortPayees(rows: Array<Payee>) {
  return [...rows].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: 'base',
      }) || left.id.localeCompare(right.id),
  )
}

const dateKeyOffsets: Partial<Record<string, number>> = {
  ArrowDown: 7,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
}

// A typeable date: partial dates fill in from today, and while the calendar is
// open the arrow keys move the date like they move through the calendar grid.
function TransactionDatePicker({
  autoFocus,
  id,
  invalid,
  locale,
  onChange,
  today,
  value,
}: {
  autoFocus?: boolean
  id: string
  invalid: boolean
  locale: string
  onChange: (date: string) => void
  today: string
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [month, setMonth] = useState(() => parseISO(value))
  const inputRef = useRef<HTMLInputElement>(null)

  // Follow outside changes, such as Escape restoring the previous date.
  useEffect(() => {
    setMonth(parseISO(value))
    setText((current) =>
      current !== null && parseDateInput(current, locale, today) === value
        ? current
        : null,
    )
  }, [locale, today, value])

  function changeDate(date: string) {
    if (date !== value) onChange(date)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            aria-invalid={invalid}
            autoComplete="off"
            autoFocus={autoFocus}
            className="pr-8 tabular-nums focus:border-ring focus:ring-3 focus:ring-ring/50"
            id={id}
            onBlur={() => {
              setText(null)
              setOpen(false)
            }}
            onChange={(event) => {
              setText(event.target.value)
              const date = parseDateInput(event.target.value, locale, today)
              if (date) changeDate(date)
            }}
            onFocus={(event) => {
              event.currentTarget.select()
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && open) {
                event.stopPropagation()
                setOpen(false)
                return
              }

              const offset = dateKeyOffsets[event.key]
              if (!open || offset === undefined) return
              event.preventDefault()
              setText(null)
              changeDate(addDays(value, offset))
            }}
            ref={inputRef}
            value={text ?? formatDateInput(value, locale)}
          />
          <CalendarDays className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        // Focus stays in the input, which handles Escape itself.
        onEscapeKeyDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          onSelect={(date) => {
            setText(null)
            changeDate(format(date, 'yyyy-MM-dd'))
            setOpen(false)
            const input = inputRef.current
            if (input) requestAnimationFrame(() => focusNextDraftField(input))
          }}
          required
          selected={parseISO(value)}
        />
      </PopoverContent>
    </Popover>
  )
}
