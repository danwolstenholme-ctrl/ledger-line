"use client";

import { useActionState, useId, useMemo, useState } from "react";
import Link from "@/components/navigation/navigation-link";
import { FileUp } from "lucide-react";

import { importStatement } from "@/lib/actions/bank";
import { idleState } from "@/lib/actions/state";
import { CSV_ROLES, parseStatementFile, readCsv, type CsvLayout, type CsvRole, type DateOrder, type ParsedStatement } from "@/lib/domain/bank-statements";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormError, SubmitButton } from "@/components/common/form-fields";
import { useCurrency } from "@/components/common/regime";

const MAX_LINES = 5000;

/** Read the file as UTF-8, or as Greek Windows text when that is what the bank wrote. */
async function readText(file: File) {
  const utf8 = await file.text();
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("windows-1253").decode(await file.arrayBuffer());
}

/**
 * Upload a statement exported from online banking. It is read here, in the
 * browser, so the lines can be checked — and a CSV's columns corrected —
 * before anything is saved. Importing the same lines twice adds nothing.
 */
export function StatementImport({ bankAccountId, bankName }: { bankAccountId: string; bankName: string }) {
  const currency = useCurrency();
  const uid = useId();
  const [state, action] = useActionState(importStatement, idleState);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [layout, setLayout] = useState<CsvLayout | null>(null);
  const [reading, setReading] = useState(false);
  const [from, setFrom] = useState("");

  async function choose(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const content = await readText(file);
      const result = parseStatementFile(content);
      setFileName(file.name); setText(content); setParsed(result); setLayout(result.csv ?? null);
    } finally { setReading(false); }
  }
  function relayout(next: CsvLayout) {
    setLayout(next);
    setParsed(readCsv(text, next));
  }
  // A statement can start before the books do: lines before then are already in the opening balance.
  const lines = useMemo(() => (parsed?.lines ?? []).filter(line => !from || line.date >= from), [parsed, from]);
  const totals = useMemo(() => {
    const sorted = lines.map(line => line.date).sort();
    return {
      count: lines.length, from: sorted[0] ?? null, to: sorted[sorted.length - 1] ?? null,
      in: lines.filter(line => line.amount > 0).reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100,
      out: lines.filter(line => line.amount < 0).reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100,
    };
  }, [lines]);
  const control = "border-hairline-strong bg-surface h-8 w-full rounded-md border px-2 text-[12.5px] touch:h-11 touch:text-[16px]";

  return <div className="space-y-5">
    <label htmlFor={`${uid}-file`} className={cn("border-hairline-strong hover:bg-surface-sunken flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center", reading && "opacity-60")}>
      <FileUp className="text-brand size-6" />
      <span className="text-ink text-[13px] font-medium">{fileName ?? "Choose the statement file"}</span>
      <span className="text-ink-muted text-[12px]">CSV, CAMT.053 (XML) or OFX, exported from online banking for {bankName}</span>
      <input id={`${uid}-file`} type="file" accept=".csv,.txt,.xml,.ofx,.qfx,.053" className="sr-only" onChange={event => choose(event.target.files?.[0])} />
    </label>

    {parsed?.format === "csv" && layout ? <section aria-label="Columns" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-ink text-[13px] font-semibold">Columns</h3>
        <p className="text-ink-muted text-[12px]">Read from the file’s headings. Correct any it got wrong.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CSV_ROLES.map(role => <label key={role.key} className="text-ink-muted space-y-1 text-[11.5px]">
          <span className="block">{role.label}</span>
          <select className={control} value={layout.columns[role.key] ?? ""} aria-label={role.label}
            onChange={event => relayout({ ...layout, columns: { ...layout.columns, [role.key]: event.target.value === "" ? undefined : Number(event.target.value) } as Partial<Record<CsvRole, number>> })}>
            <option value="">Not in this file</option>
            {layout.headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}
          </select>
        </label>)}
        <label className="text-ink-muted space-y-1 text-[11.5px]">
          <span className="block">Dates are written</span>
          <select className={control} value={layout.dateOrder} aria-label="Dates are written" onChange={event => relayout({ ...layout, dateOrder: event.target.value as DateOrder })}>
            <option value="dmy">Day first — 31/12/2026</option><option value="mdy">Month first — 12/31/2026</option><option value="ymd">Year first — 2026-12-31</option>
          </select>
        </label>
        <label className="text-ink-muted space-y-1 text-[11.5px]">
          <span className="block">Amounts are written</span>
          <select className={control} value={layout.decimal} aria-label="Amounts are written" onChange={event => relayout({ ...layout, decimal: event.target.value as "." | "," })}>
            <option value=".">1,234.56</option><option value=",">1.234,56</option>
          </select>
        </label>
      </div>
    </section> : null}

    {parsed ? <section aria-label="What will be imported" className="space-y-3">
      {parsed.problems.length ? <ul className="text-caution space-y-1 text-[12.5px]">{parsed.problems.map(problem => <li key={problem}>{problem}</li>)}</ul> : null}
      {parsed.lines.length ? <label className="text-ink-muted flex flex-wrap items-center gap-2 text-[12px]">
        Leave out lines before
        <input type="date" value={from} onChange={event => setFrom(event.target.value)} className="border-hairline-strong bg-surface h-8 rounded-md border px-2 text-[12.5px] touch:h-11 touch:text-[16px]" />
        <span className="text-ink-faint">Use this when the statement starts before the books do.</span>
      </label> : null}
      {totals.count ? <>
        <dl className="border-hairline divide-hairline grid grid-cols-2 divide-x divide-y rounded-md border sm:grid-cols-4 sm:divide-y-0">
          <div className="px-3 py-2"><dt className="text-ink-faint text-[11px] uppercase tracking-[0.06em]">Lines</dt><dd className="text-ink text-[14px] font-medium tabular-nums">{totals.count}</dd></div>
          <div className="px-3 py-2"><dt className="text-ink-faint text-[11px] uppercase tracking-[0.06em]">Dates</dt><dd className="text-ink text-[13px]">{totals.from ? `${formatDate(totals.from)} – ${formatDate(totals.to!)}` : "—"}</dd></div>
          <div className="px-3 py-2"><dt className="text-ink-faint text-[11px] uppercase tracking-[0.06em]">In · out</dt><dd className="text-ink text-[13px] tabular-nums"><span className="text-positive">{formatAmount(totals.in, currency)}</span> · {formatAmount(Math.abs(totals.out), currency)}</dd></div>
          <div className="px-3 py-2"><dt className="text-ink-faint text-[11px] uppercase tracking-[0.06em]">Bank’s closing balance</dt><dd className="text-ink text-[13px] tabular-nums">{parsed.closingBalance !== null ? formatAmount(parsed.closingBalance, currency) : "Not in the file"}</dd></div>
        </dl>
        <div className="border-hairline overflow-x-auto rounded-md border">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead><tr className="border-hairline bg-surface-sunken text-ink-faint border-b text-left text-[11px] font-semibold tracking-[0.06em] uppercase">
              <th scope="col" className="px-3 py-1.5">Date</th><th scope="col" className="px-3 py-1.5">Description</th><th scope="col" className="px-3 py-1.5 text-right">Amount</th>
            </tr></thead>
            <tbody className="divide-hairline divide-y">{lines.slice(0, 8).map(line => <tr key={line.external_id}>
              <td className="text-ink-muted px-3 py-1.5 whitespace-nowrap tabular-nums">{formatDate(line.date)}</td>
              <td className="max-w-[48ch] truncate px-3 py-1.5">{line.description}{line.reference ? <span className="text-ink-faint"> · {line.reference}</span> : null}</td>
              <td className={cn("px-3 py-1.5 text-right whitespace-nowrap tabular-nums", line.amount > 0 ? "text-positive" : "text-ink")}>{line.amount > 0 ? "" : "−"}{formatAmount(Math.abs(line.amount), currency)}</td>
            </tr>)}</tbody>
          </table>
          {lines.length > 8 ? <p className="text-ink-faint border-hairline border-t px-3 py-1.5 text-[11.5px]">and {lines.length - 8} more</p> : null}
        </div>
      </> : <p className="text-ink-muted text-[12.5px]">{parsed.lines.length ? "Every line is before that date." : `No lines can be read yet${parsed.format === "csv" ? " — check the columns above." : "."}`}</p>}
    </section> : null}

    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="bank_account_id" value={bankAccountId} />
      <input type="hidden" name="file_name" value={fileName ?? ""} />
      <input type="hidden" name="closing_balance" value={parsed?.closingBalance ?? ""} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <SubmitButton pendingLabel="Importing…" disabled={!totals.count || totals.count > MAX_LINES}>{totals.count ? `Import ${totals.count} line${totals.count === 1 ? "" : "s"}` : "Import"}</SubmitButton>
      <Link href={`/accounts/bank/${bankAccountId}`} className="text-ink-muted hover:text-ink text-[12.5px] touch:inline-flex touch:min-h-11 touch:items-center">Cancel</Link>
      {totals.count > MAX_LINES ? <p className="text-critical text-[12px]">More than {MAX_LINES.toLocaleString("en-GB")} lines: import a few months at a time.</p> : null}
    </form>
    <FormError message={state.error} />
    <p className="text-ink-faint text-[11.5px]">Lines already imported for this account are skipped, so an overlapping statement is safe. An Excel download: open it and save it as CSV first.</p>
  </div>;
}
