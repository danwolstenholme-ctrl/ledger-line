"use client";

import { useActionState, useId, useMemo, useState } from "react";
import Link from "@/components/navigation/navigation-link";
import { FileUp, X } from "lucide-react";

import { importStatements } from "@/lib/actions/bank";
import { idleState } from "@/lib/actions/state";
import { CSV_ROLES, chainOrder, csvLayoutProblems, otherAccount, parseStatementFile, readCsv, statementChain, type CsvLayout, type CsvRole, type DateOrder, type ParsedStatement } from "@/lib/domain/bank-statements";
import { formatIban } from "@/lib/domain/iban";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormError, SubmitButton } from "@/components/common/form-fields";
import { useCurrency } from "@/components/common/regime";

const MAX_STATEMENTS = 36, MAX_LINES = 20_000;
// What one request can carry to the server, in bytes as it is sent (Vercel takes 4.5 MB), with room to spare: a Greek
// description takes two bytes a letter.
const MAX_PAYLOAD = 4_200_000;

/**
 * Read the file as UTF-8; or, when it isn't, as the Windows text the bank
 * wrote. Greek (1253) when that gives Greek words, else Western (1252), as
 * UK and other European banks write it: read as Greek, a Western file's
 * accented letters come out as Greek letters one at a time, inside Latin words.
 */
async function readText(file: File) {
  const utf8 = await file.text();
  // A stray byte or two in a UTF-8 file is that, not a file in another code page: read so, the whole of it would be wrong.
  const stray = (utf8.match(/�/g) ?? []).length, wide = (utf8.match(/[^\x00-\x7f]/g) ?? []).length;
  if (!stray || (stray <= 3 && wide > stray * 10)) return utf8;
  const bytes = await file.arrayBuffer(), greek = new TextDecoder("windows-1253").decode(bytes);
  return /\p{Script=Greek}{3,}/u.test(greek) ? greek : new TextDecoder("windows-1252").decode(bytes);
}

type Loaded = { id: string; name: string; text: string; parsed: ParsedStatement; layout: CsvLayout | null };
const sameHeadings = (a: CsvLayout | null, b: CsvLayout | null) => Boolean(a && b && a.headers.join("\u0000") === b.headers.join("\u0000"));
const control = "border-hairline-strong bg-surface h-8 w-full rounded-md border px-2 text-[13px] touch:h-11 touch:text-[16px]";

/** A CSV's columns as read from its headings, to correct. */
function CsvColumns({ layout, onChange }: { layout: CsvLayout; onChange: (layout: CsvLayout) => void }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {CSV_ROLES.map(role => <label key={role.key} className="text-ink-muted space-y-1 text-[12px]">
      <span className="block">{role.label}</span>
      <select className={control} value={layout.columns[role.key] ?? ""} aria-label={role.label}
        onChange={event => onChange({ ...layout, columns: { ...layout.columns, [role.key]: event.target.value === "" ? undefined : Number(event.target.value) } as Partial<Record<CsvRole, number>> })}>
        <option value="">Not in this file</option>
        {layout.headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}{layout.sample[0]?.[index] ? ` · ${layout.sample[0][index].slice(0, 24)}` : ""}</option>)}
      </select>
    </label>)}
    <label className="text-ink-muted space-y-1 text-[12px]">
      <span className="block">Dates are written</span>
      <select className={control} value={layout.dateOrder} aria-label="Dates are written" onChange={event => onChange({ ...layout, dateOrder: event.target.value as DateOrder })}>
        <option value="dmy">Day first — 31/12/2026</option><option value="mdy">Month first — 12/31/2026</option><option value="ymd">Year first — 2026-12-31</option>
      </select>
    </label>
    <label className="text-ink-muted space-y-1 text-[12px]">
      <span className="block">Amounts are written</span>
      <select className={control} value={layout.decimal} aria-label="Amounts are written" onChange={event => onChange({ ...layout, decimal: event.target.value as "." | "," })}>
        <option value=".">1,234.56</option><option value=",">1.234,56</option>
      </select>
    </label>
  </div>;
}

/**
 * Upload statements exported from online banking: one, or a year's worth at
 * once. Each is read here, in the browser, so its lines can be checked (and a
 * CSV's columns corrected) before anything is saved; and the statements are
 * set side by side in date order, each against the one before it and the
 * first against the last one already imported, so a statement missing or one
 * there twice shows before it matters. A statement whose file is for another
 * account (its IBAN not this one's) is left out. They import together, all or
 * none; lines already imported are skipped.
 */
export function StatementImport({ bankAccountId, bankName, iban, before, history }: {
  bankAccountId: string; bankName: string;
  /** The account's IBAN, from its details: a statement for another is left out. */
  iban: string | null;
  /** The last statement already imported for this account: where the new ones should follow on from. */
  before: { last: string | null; closing: number | null; format: ParsedStatement["format"] | null } | null;
  /** The statements imported before, latest first (the last one is checked by the chain as well). */
  history: { first: string; last: string; name: string | null; format: ParsedStatement["format"] | null }[];
}) {
  const currency = useCurrency();
  const uid = useId();
  const [state, action] = useActionState(importStatements, idleState);
  const [files, setFiles] = useState<Loaded[]>([]);
  const [reading, setReading] = useState(false);
  const [columnsOf, setColumnsOf] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const money = (value: number) => formatAmount(value, currency);

  async function choose(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    try {
      const loaded: Loaded[] = [];
      for (const file of Array.from(list)) {
        const id = `${file.name}-${file.size}-${file.lastModified}`;
        if (files.some(item => item.id === id) || loaded.some(item => item.id === id)) continue;
        const text = await readText(file);
        const parsed = parseStatementFile(text, { currency, iban });
        loaded.push({ id, name: file.name, text, parsed, layout: parsed.csv ?? null });
      }
      setFiles(current => [...current, ...loaded]);
    } finally { setReading(false); }
  }
  /** A CSV's columns corrected: every CSV with the same headings is read the same way. */
  function relayout(id: string, layout: CsvLayout) {
    const changed = files.find(item => item.id === id);
    setFiles(current => current.map(item => item.id === id || (item.layout && sameHeadings(item.layout, changed?.layout ?? null))
      ? { ...item, layout: { ...layout, headerRow: item.layout!.headerRow, delimiter: item.layout!.delimiter }, parsed: readCsv(item.text, { ...layout, headerRow: item.layout!.headerRow, delimiter: item.layout!.delimiter }, { currency, iban }) } : item));
  }

  // A statement can start before the books do: lines before then are already in the opening balance.
  const statements = useMemo(() => files.map(item => {
    const lines = item.parsed.lines.filter(line => !from || line.date >= from);
    const dates = lines.map(line => line.date).sort();
    return { ...item, lines, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null, elsewhere: otherAccount(item.parsed.account, iban),
      // Cut short, a statement no longer starts at its opening balance.
      opening: lines.length === item.parsed.lines.length ? item.parsed.openingBalance : null };
  }).sort((a, b) => chainOrder(a, b) || a.name.localeCompare(b.name)), [files, from, iban]);
  const notes = statementChain(statements.filter(item => !item.elsewhere?.sure).map(item => ({ key: item.id, first: item.first, last: item.last, opening: item.opening, closing: item.parsed.closingBalance, format: item.parsed.format })), before, money);
  const ready = statements.filter(item => item.lines.length && !item.elsewhere?.sure);
  const totals = useMemo(() => {
    // A line in two files (statements that overlap) is imported once, and counted once.
    const all = ready.flatMap(item => item.lines), once = [...new Map(all.map(line => [line.external_id, line])).values()], dates = once.map(line => line.date).sort();
    return {
      count: once.length, repeated: all.length - once.length, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
      in: once.filter(line => line.amount > 0).reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100,
      out: once.filter(line => line.amount < 0).reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100,
    };
  }, [ready]);
  // A statement covering days already imported from another kind of file: their lines are keyed apart, so they would come in twice.
  const historyNote = (item: (typeof statements)[number]) => {
    // The latest import is the chain's to check, when the chain does: when this statement ends no earlier than it.
    const chained = (old: (typeof history)[number]) => Boolean(before?.last && old.last === before.last && before.last <= item.last!);
    const clash = item.first && item.last ? history.find(old => !chained(old) && old.first <= item.last! && item.first! <= old.last && old.format !== item.parsed.format) : undefined;
    if (!clash) return null;
    const what = `${clash.name ?? "a statement"} (${formatDate(clash.first)} – ${formatDate(clash.last)})`;
    return clash.format ? { tone: "critical" as const, twice: true, text: `Covers days already imported from ${what}, another kind of file: the lines in both would come in twice.` }
      : { tone: "caution" as const, text: `Covers days already imported from ${what}: if that was another kind of file, the lines in both come in twice.` };
  };
  const accountNote = (item: (typeof statements)[number]) => !item.elsewhere ? null : item.elsewhere.sure
    ? { tone: "critical" as const, text: `This is ${formatIban(item.elsewhere.account)}’s statement, not ${bankName}’s (${formatIban(iban!)}), so it is left out: import it into its own account. If ${bankName}’s IBAN has changed, change it in the account’s details.` }
    : { tone: "caution" as const, text: `This file is for account ${item.elsewhere.account}: check it is ${bankName}’s.` };
  // Without the fields a line leaves empty (the server reads a missing one as empty), and measured as the bytes sent.
  const payload = JSON.stringify(ready.map(item => ({ file_name: item.name, closing_balance: item.parsed.closingBalance, lines: item.lines })), (_, value) => value === null ? undefined : value);
  const bytes = new TextEncoder().encode(payload).length, tooBig = bytes > MAX_PAYLOAD;
  const tooMany = ready.length > MAX_STATEMENTS || totals.count > MAX_LINES || tooBig;
  // When nothing can be imported, why.
  const nothing = statements.every(item => item.elsewhere?.sure) ? "Each statement is another account’s."
    : from && statements.some(item => item.parsed.lines.length && !item.lines.length) && !statements.some(item => item.lines.length) ? "Every line is before that date."
    : statements.some(item => item.layout && csvLayoutProblems(item.layout).length) ? "No lines can be read yet: open a CSV’s columns and check them."
    : "There is nothing to import in these files: each one says why.";
  const twice = ready.some(item => (notes.get(item.id) ?? []).some(note => note.twice) || historyNote(item)?.twice);
  const serious = ready.some(item => (notes.get(item.id) ?? []).some(note => note.tone === "critical" && !note.twice));
  const preview = [...new Map(ready.flatMap(item => item.lines).map(line => [line.external_id, line])).values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);

  return <div className="space-y-5">
    <label htmlFor={`${uid}-file`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void choose(event.dataTransfer.files); }}
      className={cn("border-hairline-strong hover:bg-surface-sunken focus-within:ring-brand flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center focus-within:ring-2", reading && "opacity-60")}>
      <FileUp className="text-brand size-6" />
      <span className="text-ink text-[13.5px] font-medium">{reading ? "Reading…" : files.length ? "Add more statements" : "Choose the statement files, or drop them here"}</span>
      <span className="text-ink-muted text-[12.5px]">CSV, CAMT.053 (XML), MT940 or OFX, exported from online banking for {bankName}: one, or a year’s worth at once</span>
      <input id={`${uid}-file`} type="file" multiple accept=".csv,.txt,.xml,.ofx,.qfx,.qbo,.053,.sta,.940,.mt940" className="sr-only" onChange={event => { void choose(event.target.files); event.target.value = ""; }} />
    </label>

    {statements.length ? <section aria-label="Statements" className="space-y-3">
      <div className="border-hairline overflow-x-auto rounded-md border">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead><tr className="border-hairline bg-surface-sunken text-ink-faint border-b text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase">
            <th scope="col" className="px-3 py-1.5">Statement</th><th scope="col" className="px-3 py-1.5">Dates</th><th scope="col" className="px-3 py-1.5 text-right">Lines</th>
            <th scope="col" className="px-3 py-1.5 text-right">Opening → closing</th><th scope="col" className="w-8 px-2 py-1.5"><span className="sr-only">Remove</span></th>
          </tr></thead>
          <tbody className="divide-hairline divide-y">{statements.map(item => {
            const account = accountNote(item), older = historyNote(item), early = from && item.parsed.lines.length && !item.lines.length ? { tone: "caution" as const, text: `Every line is before ${formatDate(from)}.` } : null;
            const itemNotes = [...(account ? [account] : []), ...(early ? [early] : []), ...(notes.get(item.id) ?? []), ...(older ? [older] : [])];
            return <tr key={item.id} className="align-top">
              <td className="px-3 py-2">
                <p className="text-ink max-w-[32ch] truncate font-medium">{item.name}</p>
                <p className="text-ink-faint text-[12px] uppercase">{item.parsed.format}{item.layout ? <> · <button type="button" className="text-brand normal-case hover:underline" onClick={() => setColumnsOf(columnsOf === item.id ? null : item.id)}>{columnsOf === item.id ? "Hide the columns" : "Columns"}</button></> : null}</p>
                {[...item.parsed.problems.map(text => ({ tone: "caution" as const, text })), ...itemNotes].map(note => <p key={note.text} className={cn("mt-1 max-w-[60ch] text-[12.5px]", note.tone === "critical" ? "text-critical" : note.tone === "caution" ? "text-caution" : "text-positive")}>{note.text}</p>)}
                {columnsOf === item.id && item.layout ? <div className="border-hairline mt-3 rounded-md border p-3"><CsvColumns layout={item.layout} onChange={layout => relayout(item.id, layout)} /></div> : null}
              </td>
              <td className="text-ink-muted px-3 py-2 whitespace-nowrap tabular-nums">{item.first ? `${formatDate(item.first)} – ${formatDate(item.last!)}` : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{item.lines.length || <span className="text-ink-faint">none</span>}</td>
              <td className="text-ink-muted px-3 py-2 text-right whitespace-nowrap tabular-nums">{item.opening !== null ? money(item.opening) : "?"} → {item.parsed.closingBalance !== null ? money(item.parsed.closingBalance) : "?"}</td>
              <td className="px-2 py-2"><button type="button" aria-label={`Remove ${item.name}`} className="text-ink-faint hover:text-critical p-1" onClick={() => setFiles(current => current.filter(file => file.id !== item.id))}><X className="size-4" /></button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <label className="text-ink-muted flex flex-wrap items-center gap-2 text-[12.5px]">
        Leave out lines before
        <input type="date" value={from} onChange={event => setFrom(event.target.value)} className="border-hairline-strong bg-surface h-8 rounded-md border px-2 text-[13px] touch:h-11 touch:text-[16px]" />
        <span className="text-ink-faint">Use this when the statements start before the books do.</span>
      </label>
      {totals.count ? <>
        <dl className="border-hairline divide-hairline grid grid-cols-2 divide-x divide-y rounded-md border sm:grid-cols-4 sm:divide-y-0">
          <div className="px-3 py-2"><dt className="text-ink-faint text-[11.5px] uppercase tracking-[0.06em]">Lines</dt><dd className="text-ink text-[14px] font-medium tabular-nums">{totals.count}</dd></div>
          <div className="px-3 py-2"><dt className="text-ink-faint text-[11.5px] uppercase tracking-[0.06em]">Dates</dt><dd className="text-ink text-[13.5px]">{totals.from ? `${formatDate(totals.from)} – ${formatDate(totals.to!)}` : "—"}</dd></div>
          <div className="px-3 py-2"><dt className="text-ink-faint text-[11.5px] uppercase tracking-[0.06em]">In · out</dt><dd className="text-ink text-[13.5px] tabular-nums"><span className="text-positive">{money(totals.in)}</span> · {money(Math.abs(totals.out))}</dd></div>
          <div className="px-3 py-2"><dt className="text-ink-faint text-[11.5px] uppercase tracking-[0.06em]">Statements</dt><dd className="text-ink text-[14px] font-medium tabular-nums">{ready.length}</dd></div>
        </dl>
        <div className="border-hairline overflow-x-auto rounded-md border">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead><tr className="border-hairline bg-surface-sunken text-ink-faint border-b text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase">
              <th scope="col" className="px-3 py-1.5">Date</th><th scope="col" className="px-3 py-1.5">Description</th><th scope="col" className="px-3 py-1.5 text-right">Amount</th>
            </tr></thead>
            <tbody className="divide-hairline divide-y">{preview.map(line => <tr key={line.external_id}>
              <td className="text-ink-muted px-3 py-1.5 whitespace-nowrap tabular-nums">{formatDate(line.date)}</td>
              <td className="max-w-[48ch] truncate px-3 py-1.5">{line.description}{line.reference ? <span className="text-ink-faint"> · {line.reference}</span> : null}</td>
              <td className={cn("px-3 py-1.5 text-right whitespace-nowrap tabular-nums", line.amount > 0 ? "text-positive" : "text-ink")}>{line.amount > 0 ? "" : "−"}{money(Math.abs(line.amount))}</td>
            </tr>)}</tbody>
          </table>
          {totals.count > preview.length ? <p className="text-ink-faint border-hairline border-t px-3 py-1.5 text-[12px]">and {totals.count - preview.length} more</p> : null}
        </div>
        {totals.repeated ? <p className="text-ink-muted text-[12.5px]">{totals.repeated} line{totals.repeated === 1 ? " is" : "s are"} in more than one of these files, and imported once.</p> : null}
      </> : <p className="text-ink-muted text-[13px]">{nothing}</p>}
    </section> : null}

    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="bank_account_id" value={bankAccountId} />
      <input type="hidden" name="statements" value={tooMany ? "[]" : payload} />
      <SubmitButton pendingLabel="Importing…" disabled={!totals.count || tooMany}>
        {totals.count ? `Import ${totals.count} line${totals.count === 1 ? "" : "s"}${ready.length > 1 ? ` from ${ready.length} statements` : ""}` : "Import"}
      </SubmitButton>
      <Link href={`/accounts/bank/${bankAccountId}`} className="text-ink-muted hover:text-ink text-[13px] touch:inline-flex touch:min-h-11 touch:items-center">Cancel</Link>
      {tooMany ? <p className="text-critical text-[12.5px]">{tooBig ? `Too much for one go: these come to ${(bytes / 1_000_000).toFixed(1)} MB, and one go takes ${(MAX_PAYLOAD / 1_000_000).toFixed(1)}. Import some now and the rest after.`
        : `Too many for one go (at most ${MAX_STATEMENTS} statements and ${MAX_LINES.toLocaleString("en-GB")} lines): import some now and the rest after.`}</p>
        : twice ? <p className="text-critical text-[12.5px]">Some days are in two kinds of file, so their lines would come in twice. Export one of them again without those days, or leave them out with the date above.</p>
        : serious ? <p className="text-caution text-[12.5px]">A statement doesn’t follow on from the one before. Import anyway if you know why; the reconciliation will show the difference.</p> : null}
    </form>
    <FormError message={state.error} />
    <p className="text-ink-faint text-[12px]">They import together: all of them, or none if one can’t be. Lines already imported from the same kind of file are skipped, so overlapping statements from the same bank are safe. An Excel download: open it and save it as CSV first.</p>
  </div>;
}
