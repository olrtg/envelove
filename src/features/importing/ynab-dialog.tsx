import { useState } from 'react'
import { useAmountsHidden } from '#/hooks/use-amount-privacy'
import { useServerFn } from '@tanstack/react-start'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { countryCodes, getCountryProfile } from '#/lib/country-profiles'
import type { CountryCode } from '#/lib/country-profiles'
import { importYnab } from './ynab.functions'
import { prepareYnabSnapshot } from './ynab-snapshot'
import { maxSnapshotBytes, uploadTooLarge } from './ynab-limits'
import { readYnabExport } from './ynab-export'
import type { NativeExport } from './ynab-export'
import { ExportOptions } from './ynab-export-options'

const numbers = {
  accounts: 'Accounts',
  payees: 'Payees',
  categories: 'Categories',
  transactions: 'Register entries',
  transfers: 'Linked transfers',
  assignments: 'Monthly assignments',
  targets: 'Targets',
} as const
const regionNames = new Intl.DisplayNames('en', { type: 'region' })
export default function YnabDialog({ onClose }: { onClose: () => void }) {
  const hidden = useAmountsHidden()
  const router = useRouter(),
    save = useServerFn(importYnab)
  const [selection, setSelection] = useState<{
    file: File
    summary: ReturnType<typeof prepareYnabSnapshot>['summary']
  } | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [country, setCountry] = useState<CountryCode | ''>('')
  const summary = selection?.summary
  const [native, setNative] = useState<NativeExport | null>(null)
  const countries = summary
    ? countryCodes.filter((c) =>
        getCountryProfile(c).currencies.includes(summary.currency),
      )
    : []
  async function preview(file?: File) {
    setSelection(null)
    setNative(null)
    setError('')
    setCountry('')
    if (!file) return
    setBusy(true)
    try {
      if (file.size > maxSnapshotBytes) throw new Error(uploadTooLarge)
      if (file.name.toLowerCase().endsWith('.zip'))
        setNative(readYnabExport(new Uint8Array(await file.arrayBuffer())))
      else showPreview(await file.text(), file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this snapshot.')
    } finally {
      setBusy(false)
    }
  }
  function showPreview(content: string, file: File) {
    if (file.size > maxSnapshotBytes)
      throw new Error('The converted plan exceeds the 32 MB import limit.')
    const { summary: result } = prepareYnabSnapshot(content)
    const candidates = countryCodes.filter((c) =>
      getCountryProfile(c).currencies.includes(result.currency),
    )
    setCountry(candidates.length === 1 ? candidates[0] : '')
    setSelection({ file, summary: result })
    setError('')
  }
  async function commit() {
    if (!selection || !country || busy) return
    setBusy(true)
    setError('')
    try {
      const data = new FormData()
      data.set('snapshot', selection.file)
      data.set('country', country)
      const planId = await save({
        data,
        fetch: async (input, init) => {
          const response = await fetch(input, init)
          if (response.status === 413) throw new Error(uploadTooLarge)
          return response
        },
      })
      toast.success('Plan imported from YNAB')
      await router.navigate({
        to: '/plans/$planId',
        params: { planId },
        reloadDocument: true,
      })
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === uploadTooLarge
          ? uploadTooLarge
          : 'Could not finish the import. Check your plan list before trying again.',
      )
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from YNAB</DialogTitle>
          <DialogDescription>
            Create a new plan. Your existing plans stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-1">
          <details hidden={!!summary} className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">
              Full plan JSON · Recommended
            </summary>
            <p className="mt-2 text-muted-foreground">
              Preserves account types, currency, linked transfers and compatible
              targets. Download the full plan using YNAB’s own site; never enter
              a token here.
            </p>
            <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
              <li>
                Create a personal token in{' '}
                <a
                  className="underline"
                  href="https://app.ynab.com/settings/developer"
                  target="_blank"
                  rel="noreferrer"
                >
                  YNAB Developer Settings
                </a>
                . Use it only on YNAB’s website.
              </li>
              <li>
                Open{' '}
                <a
                  className="underline"
                  href="https://api.ynab.com/v1#tag/plans/GET/plans"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get all plans
                </a>
                , authorize with your token and copy the plan ID.
              </li>
              <li>
                Run{' '}
                <a
                  className="underline"
                  href="https://api.ynab.com/v1#tag/plans/GET/plans/%7Bplan_id%7D"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get a plan
                </a>{' '}
                with that ID. Leave the server knowledge field empty and
                download the response. You can now revoke the token.
              </li>
            </ol>
          </details>
          <details hidden={!!summary} className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">
              Export Plan ZIP · No token needed
            </summary>
            <p className="mt-2 text-muted-foreground">
              In YNAB on the web, open the plan menu and choose Export Plan.
              Upload the ZIP without extracting it. It includes monthly
              assignments and register history, but no targets or account
              settings.
            </p>
          </details>
          <Field>
            <FieldLabel htmlFor="ynab-file">YNAB export file</FieldLabel>
            <Input
              type="file"
              id="ynab-file"
              accept=".json,.zip,application/json,application/zip"
              disabled={busy}
              onChange={(e) => void preview(e.target.files?.[0])}
            />
            <FieldDescription>
              Full plan JSON or Export Plan ZIP, up to 32 MB. The preview stays
              in your browser.
            </FieldDescription>
          </Field>
          {native && (
            <div hidden={!!summary}>
              <ExportOptions
                source={native}
                onPreview={(content) =>
                  showPreview(
                    content,
                    new File([content], 'plan.json', {
                      type: 'application/json',
                    }),
                  )
                }
              />
            </div>
          )}
          {summary && (
            <>
              <section className="rounded-lg border p-3">
                <h3 className="font-medium">
                  {summary.name} · {summary.currency}
                </h3>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  {(Object.keys(numbers) as (keyof typeof numbers)[]).map(
                    (key) => (
                      <div className="flex justify-between gap-1" key={key}>
                        <dt className="text-muted-foreground">
                          {numbers[key]}
                        </dt>
                        <dd>{summary[key]}</dd>
                      </div>
                    ),
                  )}
                </dl>
              </section>
              <Field>
                <FieldLabel htmlFor="ynab-country">
                  Country or territory
                </FieldLabel>
                <Select
                  value={country}
                  onValueChange={(v) => setCountry(v as CountryCode)}
                  disabled={busy}
                >
                  <SelectTrigger id="ynab-country" className="w-full">
                    <SelectValue placeholder="Choose a country for number formatting" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {countries.map((c) => (
                        <SelectItem key={c} value={c}>
                          {regionNames.of(c)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  All amounts stay in {summary.currency}. No conversion is
                  applied.
                </FieldDescription>
              </Field>
              <div>
                <h3 className="font-medium">What changes</h3>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                  <li>
                    Bank connections, flags, notes outside the register, loan
                    settings, approval status and payee rules are not imported.
                  </li>
                  {summary.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {native && (
                    <li>
                      ZIP only: balances are calculated from register rows.
                      Split lines stay separate; only unique mirrored transfers
                      are linked. Targets, unused payees, accounts absent from
                      both files, closed status and recurring schedules are not
                      restored.
                    </li>
                  )}
                </ul>
                {native && (
                  <Button
                    variant="outline"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => {
                      setSelection(null)
                      setError('')
                    }}
                  >
                    Change ZIP settings
                  </Button>
                )}
              </div>
            </>
          )}
          {error && (
            <FieldError>
              {hidden
                ? 'Import failed. Show amounts to see the details.'
                : error}
            </FieldError>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selection || !country || busy}
            onClick={() => void commit()}
          >
            {busy ? 'Working…' : 'Import as new plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
