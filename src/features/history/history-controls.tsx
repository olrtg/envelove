import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Redo2, Undo2 } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { useAmountsHidden } from '#/hooks/use-amount-privacy'
import { reverseSavedAction } from './history.functions'
import {
  changed,
  clearHistory,
  exclusive,
  historyBusy,
  historyEpoch,
  historySnapshot,
  historySubscribe,
  historyRequestIds,
  pendingRetry,
  requestWithRetry,
  refreshHistoryViews,
  stackFor,
} from './history-state'

function HistoryMessage({
  direction,
  description,
}: {
  direction: 'undo' | 'redo'
  description: string
}) {
  const hidden = useAmountsHidden()
  return `${direction === 'undo' ? 'Undid' : 'Redid'}${hidden ? ' last change' : `: ${description}`}.`
}

export function HistoryControls({ planId }: { planId?: string }) {
  const hidden = useAmountsHidden()
  useSyncExternalStore(historySubscribe, historySnapshot, () => 0)
  const queryClient = useQueryClient()
  const router = useRouter()
  const stack = planId ? stackFor(planId) : undefined
  async function refresh() {
    await queryClient.invalidateQueries()
    router.clearCache()
    await router.invalidate()
    refreshHistoryViews()
  }
  async function reverse(direction: 'undo' | 'redo') {
    if (!planId || historyBusy() || pendingRetry()) return
    const started = historyEpoch()
    const source = stackFor(planId)[direction]
    const entry = source.at(-1)
    if (!entry) return
    const run = async (ids: ReturnType<typeof historyRequestIds>) => {
      const data = {
        ...ids,
        receiptId: entry.id,
        generation: entry.generation,
        direction,
      }
      const receipt = await reverseSavedAction({ data })
      if (started !== historyEpoch()) return
      source.pop()
      stackFor(planId)[direction === 'undo' ? 'redo' : 'undo'].push(receipt)
      changed()
      try {
        if (entry.payees)
          await router.navigate({
            to: '/plans/$planId/payees',
            params: { planId },
          })
        else if (entry.accountId)
          await router.navigate({
            to: '/plans/$planId/accounts/$accountId',
            params: { planId, accountId: entry.accountId },
          })
        else if (entry.accountId === null)
          await router.navigate({
            to: '/plans/$planId/accounts',
            params: { planId },
          })
        else
          await router.navigate({
            to: '/plans/$planId',
            params: { planId },
            search: entry.month ? { month: entry.month } : {},
          })
        await refresh()
      } catch {
        toast.error('The change was saved. Reload to refresh the view.')
      }
      toast.success(
        <HistoryMessage
          direction={direction}
          description={entry.description}
        />,
      )
    }
    try {
      const ids = historyRequestIds()
      await exclusive(() => requestWithRetry(() => run(ids)))
    } catch (error) {
      toast.error(
        `Couldn't ${direction}: ${error instanceof Error ? error.message : 'Request failed'}`,
      )
    }
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        )
      )
        return
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.repeat)
        return
      const key = event.key.toLowerCase()
      if (key === 'z' || (key === 'y' && event.ctrlKey)) {
        event.preventDefault()
        void reverse(event.shiftKey || key === 'y' ? 'redo' : 'undo')
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  useEffect(() => () => clearHistory(), [])
  const blocked = historyBusy() || Boolean(pendingRetry())
  return (
    <>
      {planId && (
        <div
          className="flex gap-1 md:absolute md:right-4 md:top-4"
          role="group"
          aria-label="Plan history"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={blocked || !stack?.undo.length}
            onClick={() => void reverse('undo')}
            title={hidden ? undefined : stack?.undo.at(-1)?.description}
            aria-keyshortcuts="Control+z Meta+z"
          >
            <Undo2 data-icon="inline-start" />
            Undo
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={blocked || !stack?.redo.length}
            onClick={() => void reverse('redo')}
            title={hidden ? undefined : stack?.redo.at(-1)?.description}
            aria-keyshortcuts="Control+Shift+z Meta+Shift+z Control+y"
          >
            <Redo2 data-icon="inline-start" />
            Redo
          </Button>
          {pendingRetry() && (
            <Button
              disabled={historyBusy()}
              onClick={() =>
                void exclusive(async () => {
                  try {
                    const retry = pendingRetry()
                    if (retry) await requestWithRetry(retry)
                    await refresh()
                  } catch (error) {
                    toast.error(String(error))
                  }
                })
              }
            >
              Retry save
            </Button>
          )}
        </div>
      )}
      <Toaster richColors />
    </>
  )
}
