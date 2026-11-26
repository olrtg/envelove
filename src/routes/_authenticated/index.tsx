import { createFileRoute } from '@tanstack/react-router'
import { useContext } from 'react'
import { FolderOpen } from 'lucide-react'

import { OpenStartPlanDialog } from '#/features/plans/start-plan-dialog'
import { Button } from '#/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'

export const Route = createFileRoute('/_authenticated/')({
  component: Home,
})

function Home() {
  const openDialog = useContext(OpenStartPlanDialog)
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Empty className="max-w-lg border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyTitle>Create your first Plan</EmptyTitle>
          <EmptyDescription>
            Start with a blank plan or import one from YNAB.
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => openDialog('new')}>New plan</Button>
          <Button variant="outline" onClick={() => openDialog('import')}>
            Import from YNAB
          </Button>
        </div>
      </Empty>
    </main>
  )
}
