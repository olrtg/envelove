import { Fragment, useState, useSyncExternalStore } from 'react'
import {
  historySubscribe,
  historyViewSnapshot,
} from '#/features/history/history-state'
import { HistoryControls } from '#/features/history/history-controls'
import { AppSidebar } from '#/components/app-sidebar'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '#/components/ui/sidebar'
import { TooltipProvider } from '#/components/ui/tooltip'

import { OpenStartPlanDialog } from '#/features/plans/start-plan-dialog'
import type { StartPlanDialog } from '#/features/plans/start-plan-dialog'

export function AppShell({
  activeAccountId,
  activeAllAccounts,
  activePayees,
  activeReflect,
  activeChat,
  activePlanId,
  children,
  user,
}: {
  activeAccountId?: string
  activeAllAccounts?: boolean
  activePayees?: boolean
  activeReflect?: boolean
  activeChat?: boolean
  activePlanId?: string
  children: React.ReactNode
  user: { email: string }
}) {
  const [startDialog, setStartDialog] = useState<StartPlanDialog>(null)
  const historyView = useSyncExternalStore(
    historySubscribe,
    historyViewSnapshot,
    () => 0,
  )
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          key={historyView}
          startDialog={startDialog}
          onStartDialogChange={setStartDialog}
          activeAccountId={activeAccountId}
          activeAllAccounts={activeAllAccounts}
          activePayees={activePayees}
          activeReflect={activeReflect}
          activeChat={activeChat}
          activePlanId={activePlanId}
          user={user}
        />
        <SidebarInset className="relative min-w-0">
          <div className="flex items-center justify-between border-b px-3 py-2 md:contents">
            <SidebarTrigger className="max-md:size-10 md:absolute md:left-4 md:top-4" />
            <HistoryControls planId={activePlanId} />
          </div>
          <OpenStartPlanDialog value={setStartDialog}>
            <Fragment key={historyView}>{children}</Fragment>
          </OpenStartPlanDialog>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
