import { useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  LoaderCircle,
  Plus,
  Settings,
  WalletCards,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
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
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { refreshHistoryViews } from '#/features/history/history-state'
import {
  getLocalDate,
  parseBankBalance,
} from '#/features/transactions/transaction-money'
import { useMoney, useAmountsHidden } from '#/hooks/use-amount-privacy'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'
import { cn } from '#/lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '#/components/ui/sidebar'

import { createAccount, updateAccount } from './accounts.functions'
import {
  planAccountsQueryKey,
  planAccountsQueryOptions,
} from './accounts.queries'
import {
  accountGroupLabels,
  accountGroups,
  accountTypeDetails,
} from './account-types'
import { accountTypeSchema, accountTypes } from './account.schemas'
import type { AccountGroup } from './account-types'
import type { AccountType } from './account.schemas'

type Account = {
  id: string
  planId: string
  name: string
  type: AccountType
  closed: boolean
}

type AccountWithBalance = Account & {
  workingBalance: number
}

type PlanCurrency = {
  countryCode: CountryCode
  currencyCode: CurrencyCode
}

type CreateAccountDraft = {
  name: string
  type: AccountType
  balance: string
}

const INITIAL_ACCOUNT_DRAFT: CreateAccountDraft = {
  name: '',
  type: 'checking',
  balance: '',
}

function defaultsToDebt(type: AccountType) {
  const group = accountTypeDetails[type].group
  return group === 'credit' || group === 'loans' || type === 'liability'
}

export function AccountsSidebar({
  activeAccountId,
  countryCode,
  currencyCode,
  planId,
}: {
  activeAccountId?: string
  countryCode: CountryCode
  currencyCode: CurrencyCode
  planId: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const createAccountFn = useServerFn(createAccount)
  const updateAccountFn = useServerFn(updateAccount)
  const accountsQuery = useQuery(
    planAccountsQueryOptions(planId, getLocalDate()),
  )
  const accounts = accountsQuery.data ?? []
  const currency = { countryCode, currencyCode }
  const hidden = useAmountsHidden()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState(INITIAL_ACCOUNT_DRAFT)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<Account | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  function openCreateAccount() {
    setCreateDraft(INITIAL_ACCOUNT_DRAFT)
    setCreateError(null)
    setIsCreateOpen(true)
  }

  function openAccountSettings(account: Account) {
    setSettingsDraft(account)
    setSettingsError(null)
  }

  async function addAccount() {
    const name = createDraft.name.trim()
    if (!name) return
    const startingBalance = createDraft.balance.trim()
      ? parseBankBalance(
          createDraft.balance,
          countryCode,
          currencyCode,
          defaultsToDebt(createDraft.type),
        )
      : 0
    if (startingBalance === null) {
      setCreateError(`Enter a valid starting balance in ${currencyCode}.`)
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      await createAccountFn({
        data: {
          planId,
          name,
          type: createDraft.type,
          startingBalance,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
      void queryClient.invalidateQueries({
        queryKey: ['ready-to-assign', planId],
      })
      await queryClient.invalidateQueries({
        queryKey: planAccountsQueryKey(planId),
      })
      router.clearCache()
      await router.invalidate()
      setIsCreateOpen(false)
      // The open plan and register keep local copies of their loader data.
      if (startingBalance !== 0) refreshHistoryViews()
    } catch {
      setCreateError('Could not create this account. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  async function saveAccount() {
    if (!settingsDraft) return

    await persistAccount(settingsDraft)
  }

  async function changeAccountStatus(closed: boolean) {
    if (!settingsDraft) return

    await persistAccount({ ...settingsDraft, closed })
  }

  async function persistAccount(accountDraft: Account) {
    const name = accountDraft.name.trim()
    if (!name) return

    setIsSaving(true)
    setSettingsError(null)

    try {
      await updateAccountFn({
        data: {
          id: accountDraft.id,
          name,
          closed: accountDraft.closed,
        },
      })
      await queryClient.invalidateQueries({
        queryKey: planAccountsQueryKey(planId),
      })
      void router.invalidate()
      setSettingsDraft(null)
    } catch {
      setSettingsError('Could not save this account. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const openAccounts = accounts.filter((account) => !account.closed)
  const closedAccounts = accounts.filter((account) => account.closed)

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Accounts</SidebarGroupLabel>
        <SidebarGroupAction
          aria-label="Add account"
          disabled={hidden}
          onClick={openCreateAccount}
          title="Add account"
        >
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent className="grid gap-2">
          {accountsQuery.isPending && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Loading accounts…
            </p>
          )}

          {accountsQuery.isError && (
            <p className="px-2 py-1 text-xs text-destructive" role="alert">
              Accounts could not be loaded.
            </p>
          )}

          {accountsQuery.isSuccess && accounts.length === 0 && (
            <Empty className="border py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WalletCards />
                </EmptyMedia>
                <EmptyTitle>No accounts yet</EmptyTitle>
                <EmptyDescription>
                  Add your first account to start tracking this plan.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  disabled={hidden}
                  onClick={openCreateAccount}
                  size="sm"
                  type="button"
                >
                  <Plus data-icon="inline-start" />
                  Add account
                </Button>
              </EmptyContent>
            </Empty>
          )}

          {accounts.length > 0 && (
            <SidebarMenu>
              {accountGroups.map((group) => (
                <AccountGroupList
                  accounts={openAccounts.filter(
                    (account) =>
                      accountTypeDetails[account.type].group === group,
                  )}
                  currency={currency}
                  group={group}
                  key={group}
                  activeAccountId={activeAccountId}
                  onOpenSettings={openAccountSettings}
                  planId={planId}
                />
              ))}

              {closedAccounts.length > 0 && (
                <AccountGroupList
                  accounts={closedAccounts}
                  currency={currency}
                  defaultOpen={closedAccounts.some(
                    (account) => account.id === activeAccountId,
                  )}
                  label="Closed"
                  muted
                  activeAccountId={activeAccountId}
                  onOpenSettings={openAccountSettings}
                  planId={planId}
                />
              )}
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <CreateAccountDialog
        draft={createDraft}
        currencyCode={currencyCode}
        error={createError}
        isCreating={isCreating}
        open={isCreateOpen && !hidden}
        onCreate={addAccount}
        onDraftChange={setCreateDraft}
        onOpenChange={setIsCreateOpen}
      />

      <AccountSettingsDialog
        draft={settingsDraft}
        error={settingsError}
        isSaving={isSaving}
        onDraftChange={setSettingsDraft}
        onOpenChange={(open) => {
          if (!open) setSettingsDraft(null)
        }}
        onChangeClosed={changeAccountStatus}
        onSave={saveAccount}
      />
    </>
  )
}

function AccountGroupList({
  accounts,
  activeAccountId,
  currency,
  defaultOpen = true,
  group,
  label,
  muted = false,
  onOpenSettings,
  planId,
}: {
  accounts: Array<AccountWithBalance>
  activeAccountId?: string
  currency: PlanCurrency
  defaultOpen?: boolean
  group?: AccountGroup
  label?: string
  muted?: boolean
  onOpenSettings: (account: Account) => void
  planId: string
}) {
  const money = useMoney(currency)
  if (accounts.length === 0) return null

  const resolvedLabel =
    label ?? (group ? accountGroupLabels[group] : 'Accounts')
  const groupBalance = accounts.reduce(
    (total, account) => total + account.workingBalance,
    0,
  )

  return (
    <Collapsible
      asChild
      className="group/collapsible"
      defaultOpen={defaultOpen}
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className="text-xs uppercase tracking-wider group-has-data-[sidebar=menu-action]/menu-item:pr-2"
            tooltip={resolvedLabel}
          >
            <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
            <span className="min-w-0 flex-1 truncate">{resolvedLabel}</span>
            {group && (
              <span
                className={cn(
                  'shrink-0 pr-2.25 tracking-normal normal-case tabular-nums',
                  groupBalance < 0 && 'text-destructive',
                )}
              >
                {money(groupBalance)}
              </span>
            )}
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <AccountList
            accounts={accounts}
            activeAccountId={activeAccountId}
            currency={currency}
            muted={muted}
            onOpenSettings={onOpenSettings}
            planId={planId}
          />
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function AccountList({
  accounts,
  activeAccountId,
  currency,
  muted = false,
  onOpenSettings,
  planId,
}: {
  accounts: Array<AccountWithBalance>
  activeAccountId?: string
  currency: PlanCurrency
  muted?: boolean
  onOpenSettings: (account: Account) => void
  planId: string
}) {
  const money = useMoney(currency)
  return (
    <SidebarMenuSub className="mx-0 translate-x-0 border-l-0 px-0">
      {accounts.map((account) => (
        <SidebarMenuSubItem key={account.id}>
          <SidebarMenuSubButton
            asChild
            className={cn(
              'translate-x-0 pl-8 group-hover/menu-sub-item:bg-sidebar-accent group-hover/menu-sub-item:text-sidebar-accent-foreground',
              muted && 'text-muted-foreground',
            )}
            isActive={activeAccountId === account.id}
          >
            <Link
              params={{ accountId: account.id, planId }}
              to="/plans/$planId/accounts/$accountId"
            >
              <span className="min-w-0 flex-1 truncate">{account.name}</span>
              <Badge
                className={cn('tabular-nums', muted && 'text-muted-foreground')}
                variant={
                  !muted && account.workingBalance < 0
                    ? 'destructive'
                    : 'secondary'
                }
              >
                {money(account.workingBalance)}
              </Badge>
            </Link>
          </SidebarMenuSubButton>
          <SidebarMenuAction
            aria-label={`Edit ${account.name}`}
            className="top-1 right-auto left-1.5 text-muted-foreground group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 hover:bg-transparent hover:text-sidebar-accent-foreground md:opacity-0"
            onClick={() => onOpenSettings(account)}
            title={`Edit ${account.name}`}
            type="button"
          >
            <Settings />
          </SidebarMenuAction>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  )
}

function CreateAccountDialog({
  draft,
  currencyCode,
  error,
  isCreating,
  open,
  onCreate,
  onDraftChange,
  onOpenChange,
}: {
  draft: CreateAccountDraft
  currencyCode: CurrencyCode
  error: string | null
  isCreating: boolean
  open: boolean
  onCreate: () => void
  onDraftChange: (draft: CreateAccountDraft) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-md:max-h-[calc(100dvh-2rem)] max-md:overflow-y-auto sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onCreate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Add an account</DialogTitle>
            <DialogDescription>
              Choose the account type and give it a recognizable name.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2">
            <div className="grid gap-2">
              <Label>Account type</Label>
              <Select
                onValueChange={(value) =>
                  onDraftChange({
                    ...draft,
                    type: accountTypeSchema.parse(value),
                  })
                }
                value={draft.type}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountGroups.map((group, groupIndex) => (
                    <AccountTypeSelectGroup
                      group={group}
                      key={group}
                      showSeparator={groupIndex > 0}
                    />
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-account-name">Account name</Label>
              <Input
                autoFocus
                id="new-account-name"
                maxLength={80}
                onChange={(event) =>
                  onDraftChange({ ...draft, name: event.target.value })
                }
                placeholder="e.g. Everyday checking"
                value={draft.name}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-account-balance">
                Starting balance ({currencyCode})
              </Label>
              <Input
                id="new-account-balance"
                inputMode="decimal"
                placeholder="0"
                value={draft.balance}
                aria-describedby="new-account-balance-help"
                onChange={(event) =>
                  onDraftChange({ ...draft, balance: event.target.value })
                }
              />
              <p
                id="new-account-balance-help"
                className="text-xs text-muted-foreground"
              >
                {defaultsToDebt(draft.type)
                  ? 'Enter the amount you owe. Use a plus sign for a balance in your favor.'
                  : 'Enter today’s cleared balance, without pending transactions.'}
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={!draft.name.trim() || isCreating} type="submit">
              {isCreating ? 'Adding…' : 'Add account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AccountTypeSelectGroup({
  group,
  showSeparator,
}: {
  group: AccountGroup
  showSeparator: boolean
}) {
  const types = accountTypes.filter(
    (type) => accountTypeDetails[type].group === group,
  )

  return (
    <>
      {showSeparator && <SelectSeparator />}
      <SelectGroup>
        <SelectLabel>{accountGroupLabels[group]}</SelectLabel>
        {types.map((type) => (
          <SelectItem key={type} value={type}>
            {accountTypeDetails[type].label}
          </SelectItem>
        ))}
      </SelectGroup>
    </>
  )
}

function AccountSettingsDialog({
  draft,
  error,
  isSaving,
  onChangeClosed,
  onDraftChange,
  onOpenChange,
  onSave,
}: {
  draft: Account | null
  error: string | null
  isSaving: boolean
  onChangeClosed: (closed: boolean) => void
  onDraftChange: (draft: Account | null) => void
  onOpenChange: (open: boolean) => void
  onSave: () => void
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={draft !== null}>
      <DialogContent className="max-md:max-h-[calc(100dvh-2rem)] max-md:overflow-y-auto sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onSave()
          }}
        >
          <DialogHeader>
            <DialogTitle>Account settings</DialogTitle>
            <DialogDescription>
              Rename the account or close it when you no longer use it.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="grid gap-5 py-2">
              <div className="grid gap-2">
                <Label htmlFor="account-name">Account name</Label>
                <Input
                  id="account-name"
                  maxLength={80}
                  onChange={(event) =>
                    onDraftChange({ ...draft, name: event.target.value })
                  }
                  value={draft.name}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="grid gap-1">
                  <p className="text-sm font-medium">
                    {draft.closed ? 'Reopen account' : 'Close account'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {draft.closed
                      ? 'Return this account to its active group.'
                      : 'Keep this account in the plan under Closed accounts.'}
                  </p>
                </div>
                <Button
                  disabled={isSaving}
                  onClick={() => void onChangeClosed(!draft.closed)}
                  type="button"
                  variant={draft.closed ? 'outline' : 'destructive'}
                >
                  {isSaving ? (
                    <LoaderCircle className="animate-spin" />
                  ) : draft.closed ? (
                    <ArchiveRestore />
                  ) : (
                    <Archive />
                  )}
                  {draft.closed ? 'Reopen' : 'Close'}
                </Button>
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={!draft?.name.trim() || isSaving} type="submit">
              {isSaving ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Saving…
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
