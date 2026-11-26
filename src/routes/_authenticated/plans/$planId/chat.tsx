import { createFileRoute } from '@tanstack/react-router'
import { BudgetChat } from '#/features/chat/budget-chat'
import { getChat } from '#/features/chat/chat.functions'

export const Route = createFileRoute('/_authenticated/plans/$planId/chat')({
  validateSearch: (search) => ({
    connection: search.connection === 'failed' ? 'failed' : undefined,
  }),
  loader: ({ params }) => getChat({ data: params }),
  component: ChatRoute,
})
function ChatRoute() {
  const { planId } = Route.useParams()
  const { connection } = Route.useSearch()
  const { plan, connected } = Route.useLoaderData()
  return (
    <BudgetChat
      key={planId}
      planId={planId}
      initialError={
        connection ? 'Connection did not finish. Please try again.' : ''
      }
      plan={plan}
      connected={connected}
    />
  )
}
