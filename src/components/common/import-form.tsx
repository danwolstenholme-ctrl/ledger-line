"use client";

import { useActionState, useMemo, useState } from "react";
import { CheckCircle2, FileDown, Upload } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { importRecords, type ImportState } from "@/lib/actions/imports";
import { detectDelimiter, parseCsvRows } from "@/lib/domain/bank-statements";
import { IMPORT_FIELDS, guessColumns, importTemplate, readImportRow, type ImportKind } from "@/lib/domain/imports";
import { cn } from "@/lib/utils";
import { Field, FormError, NativeSelect, SubmitButton, TextArea } from "@/components/common/form-fields";
import { recordOutlineButton } from "@/components/records/record-layout";

const NOUN: Record<ImportKind, [string, string]> = { customers: ["customer", "customers"], suppliers: ["supplier", "suppliers"], items: ["product", "products"] };

/**
 * A spreadsheet in, saved as CSV: the columns recognised from their headings
 * (and changeable), every row checked and shown before anything is saved, and
 * records already in the company left alone.
 */
export function ImportForm({ kind, existing, listHref }: { kind: ImportKind; existing: { names: string[]; vats: string[]; codes: string[] }; listHref: string }) {
  const [state, action] = useActionState<ImportState, FormData>(importRecords, { ok: false, error: null });
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const parsed = useMemo(() => {
    if (!source.trim()) return null;
    const rows = parseCsvRows(source, detectDelimiter(source));
    return rows.length ? { headings: rows[0], body: rows.slice(1) } : null;
  }, [source]);
  const [override, setOverride] = useState<Record<string, number | null> | null>(null);
  const mapping = useMemo(() => override ?? (parsed ? guessColumns(kind, parsed.headings) : {}), [override, parsed, kind]);
  const known = useMemo(() => ({ names: new Set(existing.names), vats: new Set(existing.vats), codes: new Set(existing.codes) }), [existing]);
  const checked = useMemo(() => (parsed?.body ?? []).map((cells, index) => {
    const read = readImportRow(kind, cells, mapping, index + 2);
    const there = !read.problem && (known.names.has(String(read.values.name).trim().toLowerCase()) || (read.values.vat_number && known.vats.has(String(read.values.vat_number))) || (read.values.code && known.codes.has(String(read.values.code).toLowerCase())));
    return { ...read, there: Boolean(there) };
  }), [parsed, mapping, kind, known]);
  const ready = checked.filter(row => !row.problem && !row.there).length;
  const [one, many] = NOUN[kind];
  const fields = IMPORT_FIELDS[kind];
  const read = (file: File) => { setFileName(file.name); setOverride(null); void file.text().then(setSource); };

  if (state.ok) return <div className="space-y-3">
    <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px]"><CheckCircle2 className="size-4" />
      {state.added} {state.added === 1 ? one : many} added.{state.skipped?.length ? ` ${state.skipped.length} already there, left alone.` : ""}{state.problems?.length ? ` ${state.problems.length} row${state.problems.length === 1 ? "" : "s"} not imported.` : ""}</p>
    {state.problems?.length ? <ul className="text-ink-muted list-disc space-y-0.5 pl-5 text-[12.5px]">{state.problems.slice(0, 20).map(problem => <li key={problem.row}>Row {problem.row}: {problem.problem}</li>)}</ul> : null}
    <Link href={listHref} className={recordOutlineButton}>See the {many}</Link>
  </div>;

  return <form action={action} className="space-y-4">
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
    <input type="hidden" name="rows" value={JSON.stringify(parsed?.body ?? [])} />
    <div className="flex flex-wrap items-center gap-3">
      <label className={cn(recordOutlineButton, "cursor-pointer")}><Upload className="size-3.5" />{fileName ?? "Choose a CSV file"}
        <input type="file" accept=".csv,.txt,.tsv,text/csv" className="sr-only" aria-label="Spreadsheet file" onChange={event => { const file = event.target.files?.[0]; if (file) read(file); }} />
      </label>
      <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${importTemplate(kind)}`)}`} download={`${many} template.csv`} className="text-brand inline-flex items-center gap-1 text-[13px] font-medium hover:underline"><FileDown className="size-3.5" />Download a template</a>
      <span className="text-ink-faint text-[12px]">From Excel or Google Sheets: File, Save as (or Download), CSV.</span>
    </div>
    <details className="text-[13px]"><summary className="text-ink-muted hover:text-brand cursor-pointer">Or paste the rows</summary>
      <TextArea aria-label="Pasted rows" rows={6} value={source} onChange={event => { setFileName(null); setOverride(null); setSource(event.target.value); }} className="mt-2 font-mono text-[12.5px]" placeholder={importTemplate(kind)} />
    </details>
    {parsed ? <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">{fields.map(field => <Field key={field.key} label={field.label} required={field.required} htmlFor={`map-${field.key}`}>
        <NativeSelect id={`map-${field.key}`} value={mapping[field.key] ?? ""} onChange={event => setOverride({ ...mapping, [field.key]: event.target.value === "" ? null : Number(event.target.value) })}>
          <option value="">Not in the file</option>
          {parsed.headings.map((heading, index) => <option key={index} value={index}>{heading || `Column ${index + 1}`}</option>)}
        </NativeSelect>
      </Field>)}</div>
      <div className="ll-panel overflow-hidden">
        <p className="border-hairline text-ink border-b px-4 py-2 text-[13px]"><span className="font-semibold">{ready} to add</span>
          <span className="text-ink-muted">{checked.some(row => row.there) ? ` · ${checked.filter(row => row.there).length} already there` : ""}{checked.some(row => row.problem) ? ` · ${checked.filter(row => row.problem).length} with a problem` : ""} · {checked.length} row{checked.length === 1 ? "" : "s"} in the file</span></p>
        <div className="max-h-80 overflow-auto"><table className="w-full border-collapse text-[12.5px]">
          <thead className="bg-surface-sunken sticky top-0"><tr>{["Row", ...fields.filter(field => mapping[field.key] !== null && mapping[field.key] !== undefined).map(field => field.label), ""].map(label => <th key={label} scope="col" className="text-ink-faint px-3 py-1.5 text-left text-[11px] font-semibold tracking-[0.06em] uppercase">{label}</th>)}</tr></thead>
          <tbody className="divide-hairline divide-y">{checked.slice(0, 100).map(row => <tr key={row.row} className={cn(row.problem && "bg-critical-soft/40", row.there && "opacity-60")}>
            <td className="text-ink-faint px-3 py-1.5 tabular-nums">{row.row}</td>
            {fields.filter(field => mapping[field.key] !== null && mapping[field.key] !== undefined).map(field => <td key={field.key} className="text-ink max-w-56 truncate px-3 py-1.5">{String(row.values[field.key] ?? parsed.body[row.row - 2]?.[mapping[field.key]!] ?? "")}</td>)}
            <td className={cn("px-3 py-1.5 whitespace-nowrap", row.problem ? "text-critical" : row.there ? "text-ink-faint" : "text-positive")}>{row.problem ?? (row.there ? "Already there" : "Ready")}</td>
          </tr>)}</tbody>
        </table></div>
      </div>
      <FormError message={state.error} />
      <SubmitButton disabled={!ready} pendingLabel="Importing…">Add {ready} {ready === 1 ? one : many}</SubmitButton>
    </> : null}
  </form>;
}
