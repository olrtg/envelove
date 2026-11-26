import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowUp,
  ChartNoAxesColumn,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { Bubble, BubbleContent } from '#/components/ui/bubble'
import { Message, MessageContent, MessageHeader } from '#/components/ui/message'
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from '#/components/ui/message-scroller'
import { Empty, EmptyHeader, EmptyDescription } from '#/components/ui/empty'
import { getLocalDate } from '#/features/transactions/transaction-money'
import { askBudget } from './chat.functions'

type Turn = { role: 'assistant' | 'user'; content: string }
const prompts = [
  'Where did I spend the most this month?',
  'How does my spending compare to last month?',
]

export function BudgetChat({
  planId,
  plan,
  connected,
  initialError,
}: {
  planId: string
  plan: string
  connected: boolean
  initialError: string
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])

  async function send() {
    if (busy) return
    if (!connected) {
      await navigate({ to: '/settings', search: { fromChat: planId } })
      return
    }
    if (!draft.trim()) return
    const next: Turn[] = [...turns, { role: 'user', content: draft.trim() }]
    setTurns(next)
    setDraft('')
    setBusy(true)
    setError('')
    try {
      const answer = await askBudget({
        data: { planId, today: getLocalDate(), messages: next.slice(-9) },
      })
      setTurns([...next, { role: 'assistant', content: answer }])
    } catch {
      setTurns(turns)
      setDraft(next[next.length - 1].content)
      setError(
        'No answer received. Check your OpenRouter connection and credits, then try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-h-96 flex-col px-4 pb-4 md:h-dvh md:px-10 md:pt-16 md:pb-7">
      <header className="flex items-center justify-between gap-2 border-b py-4">
        <div>
          <p className="text-xs text-muted-foreground">{plan}</p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Budget chat
          </h1>
        </div>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        {turns.length === 0 ? (
          <Empty className="px-0">
            <EmptyHeader>
              <div className="mb-2 rounded-2xl bg-primary/10 p-3 text-primary">
                <MessageCircle aria-hidden="true" />
              </div>
              <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                Plan insights
              </span>
              <h2 className="font-heading text-3xl font-semibold tracking-tight">
                Where did my money go?
              </h2>
              <EmptyDescription>
                Explore this month’s spending and compare it with last month,
                one question at a time.
              </EmptyDescription>
            </EmptyHeader>
            <div className="mt-2 grid w-full gap-2 sm:grid-cols-2">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left text-sm hover:bg-muted focus-visible:outline-ring"
                  onClick={() => setDraft(prompt)}
                >
                  <ChartNoAxesColumn className="size-4 shrink-0 text-primary" />
                  {prompt}
                </button>
              ))}
            </div>
          </Empty>
        ) : (
          <MessageScrollerProvider autoScroll>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  className="py-5"
                  role="log"
                  aria-label="Budget conversation"
                >
                  {turns.map((turn, i) => (
                    <MessageScrollerItem key={i} messageId={String(i)}>
                      <Message align={turn.role === 'user' ? 'end' : 'start'}>
                        <MessageContent>
                          <MessageHeader>
                            {turn.role === 'user' ? 'You' : 'Budget chat'}
                          </MessageHeader>
                          <Bubble
                            variant={
                              turn.role === 'user' ? 'secondary' : 'ghost'
                            }
                          >
                            <BubbleContent className="whitespace-pre-wrap">
                              {turn.content}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
        {error && (
          <p role="alert" className="my-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm">
            <Textarea
              aria-label="Budget question"
              maxLength={2000}
              disabled={busy}
              rows={2}
              placeholder="Ask about your spending…"
              className="max-h-36 min-h-12 resize-none border-0 shadow-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <Button
              type="submit"
              disabled={busy || (connected && !draft.trim())}
              aria-label={connected ? 'Send question' : 'Connect OpenRouter'}
            >
              {connected ? <ArrowUp /> : 'Connect OpenRouter'}
            </Button>
          </div>
          <p
            role="status"
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            <ShieldCheck className="size-4 shrink-0" />
            {busy
              ? 'Working…'
              : 'Read-only. Sending shares recent chat and two months of category totals with OpenRouter and its model provider.'}
          </p>
        </form>
      </div>
    </main>
  )
}
