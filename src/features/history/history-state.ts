import { createId } from '#/lib/id'
import type { HistoryReceipt } from './history.schemas'

type Stack = { undo: HistoryReceipt[]; redo: HistoryReceipt[] }
const histories = new Map<string, Stack>()
const listeners = new Set<() => void>()
let revision = 0
let busy = false
let retry: (() => Promise<unknown>) | undefined
let tabId: string | undefined
let epoch = 0
export const historyEpoch = () => epoch

export class SavePreparationError extends Error {}

export function historyRequestIds() {
  try {
    return { requestId: createId(), tabId: (tabId ??= createId()) }
  } catch (cause) {
    throw new SavePreparationError(
      'Nothing was sent. Open Envelove over HTTPS or use a browser that supports secure random IDs.',
      { cause },
    )
  }
}

export const historySnapshot = () => revision
export const historySubscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function changed() {
  revision++
  listeners.forEach((listener) => listener())
}
export function stackFor(planId: string): Stack {
  let stack = histories.get(planId)
  if (!stack) {
    stack = { undo: [], redo: [] }
    histories.set(planId, stack)
  }
  return stack
}
export const historyBusy = () => busy
export const pendingRetry = () => retry
export function clearHistory() {
  epoch++
  histories.clear()
  retry = undefined
  tabId = undefined
  changed()
}
export async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('Another saved action is in progress')
  busy = true
  changed()
  try {
    return await run()
  } finally {
    busy = false
    changed()
  }
}
// Retry transport failures with the SAME operation id. A rejected domain action
// has a definite outcome; an interrupted response remains explicitly recoverable.
export class InterruptedSaveError extends Error {}

export async function requestWithRetry<T>(
  run: () => Promise<T>,
  onInterrupted?: (resume: () => Promise<T>) => void,
): Promise<T> {
  const started = epoch
  try {
    return await run()
  } catch (error) {
    if (
      started === epoch &&
      (error instanceof TypeError ||
        (error instanceof Error &&
          /fetch|network|load failed/i.test(error.message)))
    ) {
      const resume = async () => {
        retry = undefined
        return run()
      }
      retry = resume
      onInterrupted?.(resume)
      changed()
      throw new InterruptedSaveError(
        'The save result is unknown. Use Retry before making another saved change.',
      )
    }
    throw error
  }
}
export function savedAction<TData, TResult>(
  request: (options: {
    data: { value: TData; requestId: string; tabId: string }
  }) => Promise<{ value: TResult; receipt: HistoryReceipt | null }>,
  { retryFromForm = false }: { retryFromForm?: boolean } = {},
) {
  let interrupted: { input: string; resume: () => Promise<TResult> } | undefined
  return async (options: { data: TData }): Promise<TResult> => {
    const remember = (resume: () => Promise<TResult>) => {
      if (retryFromForm)
        interrupted = { input: JSON.stringify(options.data), resume }
    }
    if (retry) {
      if (
        interrupted?.resume === retry &&
        interrupted.input === JSON.stringify(options.data)
      ) {
        return exclusive(() => requestWithRetry(interrupted!.resume, remember))
      }
      throw new Error('Retry the interrupted save first')
    }
    interrupted = undefined
    const started = epoch
    const data = {
      value: options.data,
      ...historyRequestIds(),
    }
    const run = async () => {
      const response = await request({ data })
      if (response.receipt && started === epoch) {
        const stack = stackFor(response.receipt.planId)
        stack.undo.push(response.receipt)
        stack.redo = []
        changed()
      }
      return response.value
    }
    return exclusive(() => requestWithRetry(run, remember))
  }
}

let viewRevision = 0
export const historyViewSnapshot = () => viewRevision
export function refreshHistoryViews() {
  viewRevision++
  changed()
}
