import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowUpRight, Link2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  CardFooter,
} from '#/components/ui/card'
import {
  connectOpenRouter,
  disconnectOpenRouter,
  getAccountConnection,
} from '#/features/chat/chat.functions'

export const Route = createFileRoute('/_authenticated/settings')({
  validateSearch: (search): { fromChat?: string; connection?: 'failed' } => ({
    fromChat:
      typeof search.fromChat === 'string' && search.fromChat.length <= 256
        ? search.fromChat
        : undefined,
    connection: search.connection === 'failed' ? 'failed' : undefined,
  }),
  loader: () => getAccountConnection(),
  component: AccountSettings,
})

function AccountSettings() {
  const { connected, preview } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const { fromChat, connection } = Route.useSearch()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(
    connection === 'failed'
      ? 'Connection did not finish. Please try again.'
      : '',
  )
  async function update() {
    setBusy(true)
    setError('')
    try {
      if (connected) {
        await disconnectOpenRouter()
        await router.invalidate()
      } else
        window.location.assign(
          await connectOpenRouter({ data: { planId: fromChat } }),
        )
    } catch {
      setError(
        'Could not update your connection. Check the server setup and try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-5 sm:p-10 md:pt-20">
      <header className="flex flex-col gap-1 border-b pb-5">
        <p className="text-sm text-muted-foreground">{user.email}</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Account settings
        </h1>
      </header>
      <section
        aria-labelledby="connections-title"
        className="flex flex-col gap-4"
      >
        <div>
          <h2
            id="connections-title"
            className="font-heading text-xl font-semibold"
          >
            AI connections
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Used across all your Plans. Other people on this server manage their
            own connections.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Link2 aria-hidden="true" className="size-4 text-primary" />
                OpenRouter
              </span>
            </CardTitle>
            <CardDescription>
              Pay for budget chat with your OpenRouter credits.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">
                {connected ? 'Connected' : 'Not connected'}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {connected ? (
              <>
                Disconnecting removes Envelove’s key for all your Plans. To
                revoke it at the provider, visit{' '}
                <a
                  href="https://openrouter.ai/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  OpenRouter key settings
                </a>
                .
              </>
            ) : (
              'Authorize Envelove on OpenRouter. Your self-hosted server stores the issued key encrypted; you don’t need to paste a key here.'
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {preview
                ? 'Real connections are disabled in the auto-sign-in preview.'
                : 'Only sending a chat question shares budget data.'}
            </p>
            <Button
              disabled={busy || preview}
              variant={connected ? 'outline' : 'default'}
              onClick={() => void update()}
            >
              {connected ? 'Disconnect OpenRouter' : 'Connect OpenRouter'}
              {!connected && <ArrowUpRight data-icon="inline-end" />}
            </Button>
          </CardFooter>
        </Card>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
      {fromChat && (
        <Link
          to="/plans/$planId/chat"
          params={{ planId: fromChat }}
          search={{ connection: undefined }}
          className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to budget chat
        </Link>
      )}
    </main>
  )
}
