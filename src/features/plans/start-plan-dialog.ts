import { createContext } from 'react'

export type StartPlanDialog = 'new' | 'import' | null
export const OpenStartPlanDialog = createContext<
  (dialog: StartPlanDialog) => void
>(() => {})
