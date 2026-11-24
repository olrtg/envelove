import { createFileRoute } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'

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
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Empty className="max-w-lg border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyTitle>Create your first Plan</EmptyTitle>
          <EmptyDescription>
            Open the Plan menu in the sidebar and create a Plan before adding
            Category Groups.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  )
}
