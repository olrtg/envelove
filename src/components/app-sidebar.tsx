import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Check,
  ChevronsUpDown,
  ContactRound,
  Eye,
  EyeOff,
  FileInput,
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MessageCircle,
  PlusCircle,
  ReceiptText,
  Settings,
  WalletCards,
} from 'lucide-react'
import {
  Link,
  useLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { PlanCurrencyFields } from '#/features/plans/plan-currency-fields'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '#/components/ui/sidebar'
import { Spinner } from '#/components/ui/spinner'
import { useAmountsHidden, setAmountsHidden } from '#/hooks/use-amount-privacy'
import { AccountsSidebar } from '#/features/accounts/accounts-sidebar'
import {
  createPlan,
  listPlans,
  updatePlanSettings,
} from '#/features/plans/plans.functions'
import { authClient } from '#/lib/auth-client'
import type { CountryCode, CurrencyCode } from '#/lib/country-profiles'

const YnabDialog = lazy(() => import('#/features/importing/ynab-dialog'))

type Plan = {
  id: string
  name: string
  country: CountryCode
  currency: CurrencyCode
  defaultTransactionCleared: boolean
  hideAfterReconciliation: boolean
}

type AccountUser = {
  email: string
}

type PlanDraft = Pick<Plan, 'name' | 'country'> & {
  currency: CurrencyCode | ''
}
type SettingsDraft = Omit<Plan, 'currency'> & PlanDraft

const INITIAL_PLAN_DRAFT: PlanDraft = {
  name: '',
  country: 'US',
  currency: 'USD',
}

export function AppSidebar({
  activeAccountId,
  activeAllAccounts = false,
  activePayees = false,
  activeReflect = false,
  activeChat = false,
  activePlanId,
  user,
}: {
  activeAccountId?: string
  activeAllAccounts?: boolean
  activePayees?: boolean
  activeReflect?: boolean
  activeChat?: boolean
  activePlanId?: string
  user: AccountUser
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const { setOpenMobile } = useSidebar()
  const hidden = useAmountsHidden()
  useEffect(
    () =>
      router.subscribe('onResolved', ({ hrefChanged }) => {
        if (hrefChanged) setOpenMobile(false)
      }),
    [router, setOpenMobile],
  )
  const listPlansFn = useServerFn(listPlans)
  const createPlanFn = useServerFn(createPlan)
  const updatePlanSettingsFn = useServerFn(updatePlanSettings)
  const [plans, setPlans] = useState<Array<Plan>>([])
  const [isCreatePlanOpen, setIsCreatePlanOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [createPlanDraft, setCreatePlanDraft] =
    useState<PlanDraft>(INITIAL_PLAN_DRAFT)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null)
  const [isLoadingPlans, setIsLoadingPlans] = useState(true)
  const [isCreatingPlan, setIsCreatingPlan] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [createPlanError, setCreatePlanError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const path = useLocation({ select: (location) => location.pathname })
  const activePlan =
    plans.find((plan) => plan.id === activePlanId) ??
    (path === '/settings' ? plans[0] : null) ??
    null

  useEffect(() => {
    let ignore = false

    async function loadPlans() {
      setIsLoadingPlans(true)

      try {
        const persistedPlans = await listPlansFn()
        if (!ignore) {
          const nextPlans = persistedPlans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            country: plan.countryCode,
            currency: plan.currencyCode,
            defaultTransactionCleared: plan.defaultTransactionCleared,
            hideAfterReconciliation: plan.hideAfterReconciliation,
          }))
          setPlans(nextPlans)
        }
      } finally {
        if (!ignore) setIsLoadingPlans(false)
      }
    }

    void loadPlans()

    return () => {
      ignore = true
    }
  }, [listPlansFn])

  useEffect(() => {
    const firstPlan = plans.at(0)
    if (isLoadingPlans || path !== '/' || !firstPlan) return

    void navigate({
      to: '/plans/$planId',
      params: { planId: firstPlan.id },
      replace: true,
    })
  }, [path, isLoadingPlans, navigate, plans])

  function openSettings() {
    if (!activePlan) return
    setOpenMobile(false)
    setSettingsDraft(activePlan)
    setSettingsError(null)
    setIsSettingsOpen(true)
  }

  function openCreatePlan() {
    setOpenMobile(false)
    setCreatePlanDraft(INITIAL_PLAN_DRAFT)
    setCreatePlanError(null)
    setIsCreatePlanOpen(true)
  }

  async function addPlan() {
    const name = createPlanDraft.name.trim()
    if (!name || !createPlanDraft.currency) return

    setIsCreatingPlan(true)
    setCreatePlanError(null)

    try {
      const savedPlan = await createPlanFn({
        data: {
          name,
          countryCode: createPlanDraft.country,
          currencyCode: createPlanDraft.currency,
        },
      })
      const newPlan = {
        id: savedPlan.id,
        name: savedPlan.name,
        country: savedPlan.countryCode,
        currency: savedPlan.currencyCode,
        defaultTransactionCleared: savedPlan.defaultTransactionCleared,
        hideAfterReconciliation: savedPlan.hideAfterReconciliation,
      }
      setPlans((currentPlans) => [...currentPlans, newPlan])
      setIsCreatePlanOpen(false)
      await navigate({
        to: '/plans/$planId',
        params: { planId: newPlan.id },
      })
    } catch {
      setCreatePlanError('Could not create this plan. Please try again.')
    } finally {
      setIsCreatingPlan(false)
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return

    const name = settingsDraft.name.trim()
    if (!name || !settingsDraft.currency) return
    const currencyChanged =
      settingsDraft.country !== activePlan?.country ||
      settingsDraft.currency !== activePlan.currency

    setIsSavingSettings(true)
    setSettingsError(null)

    try {
      const savedPlan = await updatePlanSettingsFn({
        data: {
          id: settingsDraft.id,
          name,
          ...(currencyChanged && {
            countryCode: settingsDraft.country,
            currencyCode: settingsDraft.currency,
          }),
          defaultTransactionCleared: settingsDraft.defaultTransactionCleared,
          hideAfterReconciliation: settingsDraft.hideAfterReconciliation,
        },
      })
      setPlans((currentPlans) =>
        currentPlans.map((plan) =>
          plan.id === savedPlan.id
            ? {
                id: savedPlan.id,
                name: savedPlan.name,
                country: savedPlan.countryCode,
                currency: savedPlan.currencyCode,
                defaultTransactionCleared: savedPlan.defaultTransactionCleared,
                hideAfterReconciliation: savedPlan.hideAfterReconciliation,
              }
            : plan,
        ),
      )
      await router.invalidate({ sync: true })
      setSettingsDraft(null)
      setIsSettingsOpen(false)
    } catch {
      setSettingsError('Could not save these settings. Please try again.')
    } finally {
      setIsSavingSettings(false)
    }
  }

  return (
    <>
      <Sidebar>
        <SidebarHeader className="border-b p-3">
          <PlanSwitcher
            activePlan={activePlan}
            isLoading={isLoadingPlans}
            plans={plans}
            user={user}
            onCreatePlan={openCreatePlan}
            onImport={() => {
              setOpenMobile(false)
              setIsImportOpen(true)
            }}
            onOpenSettings={openSettings}
            onSelectPlan={(planId) => {
              void navigate({
                to: '/plans/$planId',
                params: { planId },
              })
            }}
          />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="pb-0">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild={Boolean(activePlan)}
                    disabled={!activePlan}
                    isActive={
                      Boolean(activePlanId) &&
                      !activeAccountId &&
                      !activeAllAccounts &&
                      !activeReflect &&
                      !activeChat &&
                      !activePayees
                    }
                  >
                    {activePlan ? (
                      <Link
                        params={{ planId: activePlan.id }}
                        to="/plans/$planId"
                      >
                        <LayoutDashboard />
                        <span>Plan</span>
                      </Link>
                    ) : (
                      <>
                        <LayoutDashboard />
                        <span>Plan</span>
                      </>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild={Boolean(activePlan)}
                    disabled={!activePlan}
                    isActive={activeReflect}
                  >
                    {activePlan ? (
                      <Link
                        params={{ planId: activePlan.id }}
                        to="/plans/$planId/reflect"
                      >
                        <ReceiptText />
                        <span>Reflect</span>
                      </Link>
                    ) : (
                      <>
                        <ReceiptText />
                        <span>Reflect</span>
                      </>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild={Boolean(activePlan)}
                    disabled={!activePlan}
                    isActive={activeChat}
                  >
                    {activePlan ? (
                      <Link
                        params={{ planId: activePlan.id }}
                        to="/plans/$planId/chat"
                        search={{ connection: undefined }}
                      >
                        <MessageCircle />
                        <span>Budget chat</span>
                      </Link>
                    ) : (
                      <>
                        <MessageCircle />
                        <span>Budget chat</span>
                      </>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild={Boolean(activePlan)}
                    disabled={!activePlan}
                    isActive={Boolean(activePlan) && activeAllAccounts}
                  >
                    {activePlan ? (
                      <Link
                        params={{ planId: activePlan.id }}
                        to="/plans/$planId/accounts"
                      >
                        <WalletCards />
                        <span>All Accounts</span>
                      </Link>
                    ) : (
                      <>
                        <WalletCards />
                        <span>All Accounts</span>
                      </>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {activePlan && (
            <AccountsSidebar
              activeAccountId={activeAccountId}
              countryCode={activePlan.country}
              currencyCode={activePlan.currency}
              planId={activePlan.id}
            />
          )}
        </SidebarContent>
        <SidebarFooter className="border-t">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setAmountsHidden(!hidden)}>
                {hidden ? <Eye /> : <EyeOff />}
                {hidden ? 'Show amounts' : 'Hide amounts'}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {isImportOpen && (
        <Suspense>
          <YnabDialog onClose={() => setIsImportOpen(false)} />
        </Suspense>
      )}
      <CreatePlanDialog
        draft={createPlanDraft}
        error={createPlanError}
        isCreating={isCreatingPlan}
        open={isCreatePlanOpen}
        onCreate={addPlan}
        onDraftChange={setCreatePlanDraft}
        onOpenChange={setIsCreatePlanOpen}
      />

      {settingsDraft && (
        <PlanSettingsDialog
          draft={settingsDraft}
          error={settingsError}
          isSaving={isSavingSettings}
          open={isSettingsOpen}
          onDraftChange={setSettingsDraft}
          onOpenChange={setIsSettingsOpen}
          onSave={saveSettings}
        />
      )}
    </>
  )
}

function PlanSwitcher({
  activePlan,
  isLoading,
  plans,
  user,
  onCreatePlan,
  onImport,
  onSelectPlan,
  onOpenSettings,
}: {
  activePlan: Plan | null
  isLoading: boolean
  plans: Array<Plan>
  user: AccountUser
  onCreatePlan: () => void
  onImport: () => void
  onSelectPlan: (planId: string) => void
  onOpenSettings: () => void
}) {
  const navigate = useNavigate()
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function signOut() {
    setIsSigningOut(true)

    try {
      const result = await authClient.signOut()
      if (result.error) return
      await navigate({ to: '/login' })
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="h-12 data-[state=open]:bg-sidebar-accent"
              size="lg"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <WalletCards className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {isLoading
                    ? 'Loading plans…'
                    : (activePlan?.name ?? 'No plans yet')}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="start"
            className="min-w-56"
            side="bottom"
            sideOffset={8}
          >
            <DropdownMenuGroup>
              <DropdownMenuItem className="gap-2 py-2" onSelect={onCreatePlan}>
                <PlusCircle className="text-muted-foreground" />
                New plan
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 py-2" onSelect={onImport}>
                <FileInput />
                Import from YNAB
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className="gap-2 py-2"
                  disabled={plans.length === 0}
                >
                  <FolderOpen className="text-muted-foreground" />
                  Switch plan
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-52">
                  <DropdownMenuGroup>
                    {plans.map((plan) => (
                      <DropdownMenuItem
                        className="gap-2 py-2"
                        key={plan.id}
                        onSelect={() => onSelectPlan(plan.id)}
                      >
                        <span className="truncate">{plan.name}</span>
                        {plan.id === activePlan?.id && (
                          <Check className="ml-auto" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {activePlan ? (
                <DropdownMenuItem asChild className="gap-2 py-2">
                  <Link
                    params={{ planId: activePlan.id }}
                    to="/plans/$planId/payees"
                  >
                    <ContactRound />
                    Manage Payees
                  </Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="gap-2 py-2" disabled>
                  <ContactRound />
                  Manage Payees
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="gap-2 py-2"
                disabled={!activePlan}
                onSelect={onOpenSettings}
              >
                <Settings />
                Plan settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="gap-2 py-2">
                <Link to="/settings">
                  <Settings />
                  Account settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isSigningOut}
                onSelect={() => {
                  void signOut()
                }}
                variant="destructive"
              >
                {isSigningOut ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <LogOut />
                )}
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function CreatePlanDialog({
  draft,
  error,
  isCreating,
  open,
  onCreate,
  onDraftChange,
  onOpenChange,
}: {
  draft: PlanDraft
  error: string | null
  isCreating: boolean
  open: boolean
  onCreate: () => void
  onDraftChange: (draft: PlanDraft) => void
  onOpenChange: (open: boolean) => void
}) {
  function updateDraft<TKey extends keyof PlanDraft>(
    key: TKey,
    value: PlanDraft[TKey],
  ) {
    onDraftChange({ ...draft, [key]: value })
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onCreate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Create a new plan</DialogTitle>
            <DialogDescription>
              Name your plan and choose the country whose currency and number
              formatting you want to use.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-2">
            <Field>
              <FieldLabel htmlFor="new-plan-name">Plan name</FieldLabel>
              <Input
                autoFocus
                id="new-plan-name"
                onChange={(event) => updateDraft('name', event.target.value)}
                placeholder="e.g. Household budget"
                value={draft.name}
              />
            </Field>

            <PlanCurrencyFields
              country={draft.country}
              currency={draft.currency}
              onChange={(selection) =>
                onDraftChange({ ...draft, ...selection })
              }
            />

            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>

          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={!draft.name.trim() || !draft.currency || isCreating}
              type="submit"
            >
              {isCreating && <Spinner data-icon="inline-start" />}
              {isCreating ? 'Creating…' : 'Create plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PlanSettingsDialog({
  draft,
  error,
  isSaving,
  open,
  onDraftChange,
  onOpenChange,
  onSave,
}: {
  draft: SettingsDraft
  error: string | null
  isSaving: boolean
  open: boolean
  onDraftChange: (draft: SettingsDraft) => void
  onOpenChange: (open: boolean) => void
  onSave: () => void
}) {
  function updateDraft<TKey extends keyof SettingsDraft>(
    key: TKey,
    value: SettingsDraft[TKey],
  ) {
    onDraftChange({ ...draft, [key]: value })
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan settings</DialogTitle>
          <DialogDescription>
            Choose the plan name, country, and currency. Changing currency does
            not convert existing amounts.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="py-2">
          <Field>
            <FieldLabel htmlFor="plan-name">Plan name</FieldLabel>
            <Input
              id="plan-name"
              onChange={(event) => updateDraft('name', event.target.value)}
              value={draft.name}
            />
          </Field>

          <PlanCurrencyFields
            country={draft.country}
            currency={draft.currency}
            onChange={(selection) => onDraftChange({ ...draft, ...selection })}
          />

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Advanced</p>
            <Field className="items-start" orientation="horizontal">
              <Checkbox
                aria-describedby="default-transaction-cleared-description"
                checked={draft.defaultTransactionCleared}
                id="default-transaction-cleared"
                onCheckedChange={(checked) =>
                  updateDraft('defaultTransactionCleared', checked === true)
                }
              />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="default-transaction-cleared">
                  Mark new Transactions as Cleared
                </FieldLabel>
                <FieldDescription id="default-transaction-cleared-description">
                  New Transactions dated today or earlier start as Cleared.
                  Existing Transactions are not changed, and you can change the
                  status before saving.
                </FieldDescription>
              </div>
            </Field>
            <Field className="items-start" orientation="horizontal">
              <Checkbox
                id="show-after-reconciliation"
                aria-describedby="show-after-reconciliation-description"
                checked={!draft.hideAfterReconciliation}
                onCheckedChange={(checked) =>
                  updateDraft('hideAfterReconciliation', checked !== true)
                }
              />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="show-after-reconciliation">
                  Always show reconciled transactions after reconciliation
                </FieldLabel>
                <FieldDescription id="show-after-reconciliation-description">
                  Keep the full register visible when you finish. You can still
                  hide reconciled transactions manually.
                </FieldDescription>
              </div>
            </Field>
          </div>

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!draft.name.trim() || !draft.currency || isSaving}
            onClick={() => void onSave()}
          >
            {isSaving && <Spinner data-icon="inline-start" />}
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
