import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireUser } from '#/lib/auth-session.server'
import { transactionDateSchema } from '#/features/transactions/transaction.schemas'
import { beginConnection, disconnect, isConnected } from './openrouter.server'
import { answerBudgetQuestion, chatPlan } from './chat.server'

const plan = z.object({ planId: z.string().min(1).max(256) })
const preview = () => Boolean(import.meta.env.DEV && process.env.SEED_EMAIL)
export const getChat = createServerFn({ method: 'GET' })
  .validator(plan)
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'no-store')
    const { id } = await requireUser()
    return {
      plan: chatPlan(id, data.planId).name,
      connected: isConnected(id),
    }
  })
export const getAccountConnection = createServerFn({ method: 'GET' }).handler(
  async () => {
    setResponseHeader('Cache-Control', 'no-store')
    return {
      connected: isConnected((await requireUser()).id),
      preview: preview(),
    }
  },
)
export const connectOpenRouter = createServerFn({ method: 'POST' })
  .validator(plan.partial())
  .handler(async ({ data }) => {
    const { id } = await requireUser()
    if (data.planId) chatPlan(id, data.planId)
    if (preview())
      throw new Error(
        'Real connections are disabled in the auto-sign-in preview.',
      )
    return beginConnection(id, data.planId)
  })
export const disconnectOpenRouter = createServerFn({ method: 'POST' }).handler(
  async () => disconnect((await requireUser()).id),
)
export const askBudget = createServerFn({ method: 'POST' })
  .validator(
    plan.extend({
      today: transactionDateSchema,
      messages: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string().trim().min(1).max(8000),
          }),
        )
        .min(1)
        .max(9)
        .refine((messages) => messages.at(-1)?.role === 'user'),
    }),
  )
  .handler(async ({ data }) => {
    const { id } = await requireUser()
    if (preview())
      throw new Error(
        'Real questions are disabled in the auto-sign-in preview.',
      )
    return answerBudgetQuestion(id, data.planId, data.today, data.messages)
  })
