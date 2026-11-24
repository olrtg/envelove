import { useRef, useState } from 'react'

export function useRowSelection<T extends { id: string }>(rows: T[]) {
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  const anchor = useRef<string | null>(null)
  const selected = rows.filter((row) => ids.has(row.id))
  const allSelected = selected.length > 0 && selected.length === rows.length
  function clear() {
    anchor.current = null
    setIds(new Set())
  }
  function selectAll() {
    anchor.current = null
    setIds((prev) => {
      const next = new Set(prev)
      for (const row of rows) {
        if (allSelected) next.delete(row.id)
        else next.add(row.id)
      }
      return next
    })
  }
  function toggle(id: string, shift: boolean) {
    const index = rows.findIndex((row) => row.id === id)
    const from = shift ? rows.findIndex((row) => row.id === anchor.current) : -1
    const range =
      from === -1
        ? [id]
        : rows
            .slice(Math.min(index, from), Math.max(index, from) + 1)
            .map((row) => row.id)
    if (from === -1) anchor.current = id
    setIds((prev) => {
      const next = new Set(prev)
      for (const key of range) {
        if (prev.has(id)) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }
  return { ids, selected, allSelected, toggle, selectAll, clear }
}
