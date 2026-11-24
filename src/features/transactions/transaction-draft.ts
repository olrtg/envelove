export function getClearedAfterDraftDateChange({
  cleared,
  date,
  today,
}: {
  cleared: boolean
  date: string
  today: string
}) {
  return date > today ? false : cleared
}

export function getClearedAfterDraftAccountChange({
  cleared,
  currentAccountId,
  draftId,
  nextAccountId,
}: {
  cleared: boolean
  currentAccountId: string
  draftId: string | null
  nextAccountId: string
}) {
  return draftId === null || nextAccountId === currentAccountId
    ? cleared
    : false
}
