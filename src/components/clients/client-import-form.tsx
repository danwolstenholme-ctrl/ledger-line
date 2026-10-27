"use client";

import { useActionState, useMemo, useState } from "react";
import { CheckCircle2, FileDown, Upload, UserPlus } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { importClients, type ClientImportState } from "@/lib/actions/client-import";
import { detectDelimiter, parseCsvRows } from "@/lib/domain/bank-statements";
import { businessType } from "@/lib/domain/business-types";
import { CLIENT_FIELDS, clientKeys, clientTemplate, guessClientColumns, readClientRow } from "@/lib/domain/client-import";
import { cn } from "@/lib/utils";
import { Field, FormError, NativeSelect, SubmitButton, TextArea } from "@/components/common/form-fields";
import { recordButton, recordOutlineButton } from "@/components/records/record-layout";

const monthLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A practice's client list in, from a spreadsheet saved as CSV: the columns
 * recognised from their headings (and changeable), every row checked and
 * shown, each with the kind of business its Ledgerline will be shaped to,
 * before any company is opened. Clients already here are left alone.
 */
export function ClientImportForm({ existing, staff, today }: { existing: string[]; staff: string[]; today: string }) {
  const [state, action] = useActionState<ClientImportState, FormData>(importClients, { ok: false, error: null });
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const parsed = useMemo(() => {
    if (!source.trim()) return null;
    const rows = parseCsvRows(source, detectDelimiter(source)).filter(row => row.some(cell => cell.trim()));
    return rows.length ? { headings: rows[0], body: rows.slice(1) } : null;
  }, [source]);
  const [override, setOverride] = useState<Record<string, number | null> | null>(null);
  const mapping = useMemo(() => override ?? (parsed ? guessClientColumns(parsed.headings) : {}), [override, parsed]);
  const checked = useMemo(() => {
    const known = new Set(existing);
    return (parsed?.body ?? []).map((cells, index) => {
      const read = readClientRow(cells, mapping, index + 2, today, staff);
      const keys = read.values ? clientKeys(read.values) : [];
      const there = keys.some(key => known.has(key));
      keys.forEach(key => known.add(key));
      return { ...read, there };
    });
  }, [parsed, mapping, existing, staff, today]);
  const ready = checked.filter(row => !row.problem && !row.there).length;
  const read = (file: File) => { setFileName(file.name); setOverride(null); void file.text().then(setSource); };

  if (state.ok) return <div className="space-y-3">
    <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]"><CheckCircle2 className="size-4" />
      {state.added?.length} client{state.added?.length === 1 ? "" : "s"} brought over: their books are open.{state.skipped?.length ? ` ${state.skipped.length} already here, left alone.` : ""}{state.problems?.length ? ` ${state.problems.length} row${state.problems.length === 1 ? "" : "s"} not imported.` : ""}
    </p>
    {state.problems?.length ? <ul className="text-ink-muted list-disc space-y-0.5 pl-5 text-[12px]">{state.problems.slice(0, 30).map(problem => <li key={problem.row}>Row {problem.row}: {problem.problem}</li>)}</ul> : null}
    {state.added?.length ? <ul className="ll-panel divide-hairline max-h-80 divide-y overflow-auto">{state.added.map(client => <li key={client.slug}><Link href={`/c/${client.slug}`} className="text-ink hover:bg-surface-sunken hover:text-brand block px-4 py-2 text-[12.5px]">{client.name}</Link></li>)}</ul> : null}
    <div className="flex flex-wrap gap-2">{state.added?.length ? <Link href="/clients/owners?view=todo" className={recordButton}><UserPlus className="size-3.5" />Next: invite their owners</Link> : null}
      <Link href="/" className={recordOutlineButton}>Go to the dashboard</Link><Link href="/clients" className={recordOutlineButton}>See the client files</Link></div>
  </div>;

  return <form action={action} className="space-y-4">
    <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
    <input type="hidden" name="rows" value={JSON.stringify(parsed?.body ?? [])} />
    <div className="flex flex-wrap items-center gap-3">
      <label className={cn(recordOutlineButton, "cursor-pointer")}><Upload className="size-3.5" />{fileName ?? "Choose a CSV file"}
        <input type="file" accept=".csv,.txt,.tsv,text/csv" className="sr-only" aria-label="Client list file" onChange={event => { const file = event.target.files?.[0]; if (file) read(file); }} />
      </label>
      <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${clientTemplate()}`)}`} download="clients template.csv" className="text-brand inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline"><FileDown className="size-3.5" />Template</a>
      <span className="text-ink-faint text-[11.5px]">From Excel or Google Sheets: File, Save as (or Download), CSV.</span>
    </div>
    <details className="text-[12.5px]"><summary className="text-ink-muted hover:text-brand cursor-pointer">Or paste the rows</summary>
      <TextArea aria-label="Pasted rows" rows={6} value={source} onChange={event => { setFileName(null); setOverride(null); setSource(event.target.value); }} className="mt-2 font-mono text-[12px]" placeholder="Company name,Registration number,VAT number,Year end,…" />
    </details>
    {parsed ? <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">{CLIENT_FIELDS.map(field => <Field key={field.key} label={field.label} required={field.required} htmlFor={`map-${field.key}`}>
        <NativeSelect id={`map-${field.key}`} value={mapping[field.key] ?? ""} onChange={event => setOverride({ ...mapping, [field.key]: event.target.value === "" ? null : Number(event.target.value) })}>
          <option value="">Not in the file</option>
          {parsed.headings.map((heading, index) => <option key={index} value={index}>{heading || `Column ${index + 1}`}</option>)}
        </NativeSelect>
      </Field>)}</div>
      <div className="ll-panel overflow-hidden">
        <p className="border-hairline text-ink border-b px-4 py-2 text-[12.5px]"><span className="font-semibold">{ready} to bring over</span>
          <span className="text-ink-muted">{checked.some(row => row.there) ? ` · ${checked.filter(row => row.there).length} already clients` : ""}{checked.some(row => row.problem) ? ` · ${checked.filter(row => row.problem).length} with a problem` : ""}</span></p>
        <div className="max-h-96 overflow-auto"><table className="w-full border-collapse text-[12px]">
          <thead className="bg-surface-sunken sticky top-0"><tr>{["Row", "Company", "Numbers", "Kind of business", "Year end", "Books from", ""].map(label => <th key={label} scope="col" className="text-ink-faint px-3 py-1.5 text-left text-[10.5px] font-semibold tracking-[0.06em] uppercase">{label}</th>)}</tr></thead>
          <tbody className="divide-hairline divide-y">{checked.slice(0, 300).map(row => <tr key={row.row} className={cn(row.problem && "bg-critical-soft/40", row.there && "opacity-60")}>
            <td className="text-ink-faint px-3 py-1.5 tabular-nums">{row.row}</td>
            <td className="text-ink max-w-56 px-3 py-1.5"><span className="block truncate">{row.name ?? "—"}</span>{row.values?.manager ? <span className="text-ink-faint block text-[11px]">{row.values.manager}</span> : null}</td>
            <td className="text-ink-muted px-3 py-1.5 font-mono text-[11.5px]">{[row.values?.he_number, row.values?.vat_number].filter(Boolean).join(" · ") || "—"}</td>
            <td className="text-ink-muted px-3 py-1.5">{row.values ? businessType(row.values.business_type).label : "—"}</td>
            <td className="text-ink-muted px-3 py-1.5">{row.values ? new Date(Date.UTC(2000, row.values.year_end_month - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }) : "—"}</td>
            <td className="text-ink-muted px-3 py-1.5 whitespace-nowrap">{row.values ? monthLabel(row.values.books_from) : "—"}</td>
            <td className={cn("px-3 py-1.5", row.problem ? "text-critical" : row.there ? "text-ink-faint" : "text-positive")}>
              {row.problem ?? (row.there ? "Already a client" : "Ready")}{row.notes.length && !row.problem && !row.there ? <span className="text-ink-faint block text-[11px]">{row.notes.join("; ")}</span> : null}
            </td>
          </tr>)}</tbody>
        </table></div>
        {checked.length > 300 ? <p className="border-hairline text-ink-faint border-t px-4 py-2 text-[11.5px]">The first 300 rows are shown; all {checked.length} are checked.</p> : null}
      </div>
      <p className="text-ink-muted text-[12px] leading-relaxed">Each opens its own books in its country’s terms, shaped to its kind of business, with its deadlines from the month its books start: nothing before then shows as overdue. Their engagement letters and due diligence stay where they are kept now, and are added to each client file as they come up for review.</p>
      <FormError message={state.error} />
      <SubmitButton disabled={!ready} pendingLabel="Opening their books…">Bring over {ready} client{ready === 1 ? "" : "s"}</SubmitButton>
    </> : null}
  </form>;
}
