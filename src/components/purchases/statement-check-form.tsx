"use client";

import { useActionState, useId, useState } from "react";
import { Plus, X } from "lucide-react";

import { saveStatementCheck } from "@/lib/actions/statement-checks";
import { idleState } from "@/lib/actions/state";
import { plainDecimal } from "@/lib/domain/line-math";
import { STATEMENT_KIND_LABELS, type StatementKind } from "@/lib/domain/statements";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, FormError, NativeSelect, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";

export type CheckLine = { date: string; kind: StatementKind; reference: string; charged: number; settled: number };
type Extra = { key: number; date: string; reference: string; amount: string; kind: "billed" | "credited" };

const cents = (value: number) => Math.round(value * 100);
/** A line's effect on what we owe them: a bill or a refund raises it, a payment or credit lowers it. */
const effect = (line: CheckLine) => cents(line.charged) - cents(line.settled);
const parse = (text: string) => {
  const value = Number(plainDecimal(text.trim().replace(/^\((.*)\)$/, "-$1")));
  return text.trim() === "" || !Number.isFinite(value) ? null : value;
};

function LineRow({ line, checked, onChange }: { line: CheckLine; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="hover:bg-surface-sunken flex cursor-pointer items-baseline gap-3 px-4 py-2 sm:px-5 touch:min-h-11 touch:items-center">
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="accent-brand size-4 shrink-0 translate-y-0.5" />
    <span className="text-ink-muted w-24 shrink-0 text-[12.5px] tabular-nums">{formatDate(line.date)}</span>
    <span className="text-ink min-w-0 flex-1 truncate text-[12.5px]">{STATEMENT_KIND_LABELS[line.kind]} <span className="font-mono">{line.reference || "—"}</span></span>
    <span className="text-ink w-24 shrink-0 text-right text-[13px] tabular-nums">{effect(line) > 0 ? "" : "−"}{formatAmount(Math.abs(effect(line)) / 100)}</span>
  </label>;
}

/**
 * A supplier's statement checked against the books: their balance on its
 * date beside ours, and what explains the difference, worked out as it is
 * ticked. Ours before the date start ticked (on their statement); ours after
 * it start unticked; anything of theirs not in the books is added by hand.
 */
export function StatementCheckForm({ supplierId, date, ours, before, after }: { supplierId: string; date: string; ours: number; before: CheckLine[]; after: CheckLine[] }) {
  const uid = useId();
  const [state, action] = useActionState(saveStatementCheck, idleState);
  const [theirs, setTheirs] = useState("");
  const [missing, setMissing] = useState<Set<number>>(() => new Set());
  const [later, setLater] = useState<Set<number>>(() => new Set());
  const [extras, setExtras] = useState<Extra[]>([]);
  const toggle = (set: Set<number>, index: number, on: boolean) => { const next = new Set(set); if (on) next.add(index); else next.delete(index); return next; };

  // Each explanation, as the amount it moves our balance towards theirs.
  const items = [
    ...before.flatMap((line, index) => missing.has(index) ? [{ side: "ours", date: line.date, reference: line.reference, amount: -effect(line) / 100, note: `${STATEMENT_KIND_LABELS[line.kind]} in our books, not on their statement yet` }] : []),
    ...after.flatMap((line, index) => later.has(index) ? [{ side: "ours", date: line.date, reference: line.reference, amount: effect(line) / 100, note: `${STATEMENT_KIND_LABELS[line.kind]} on their statement, in our books on ${formatDate(line.date)}` }] : []),
    ...extras.flatMap(extra => {
      const amount = parse(extra.amount);
      return amount && extra.date ? [{ side: "theirs", date: extra.date, reference: extra.reference, amount: extra.kind === "billed" ? Math.abs(amount) : -Math.abs(amount), note: extra.kind === "billed" ? "Billed on their statement, not in our books" : "Paid or credited on their statement, not in our books" }] : [];
    }),
  ];
  const their = parse(theirs);
  const explained = items.reduce((sum, item) => sum + cents(item.amount), 0);
  const left = their === null ? null : cents(their) - cents(ours) - explained;
  const errors = state.fieldErrors ?? {};

  return <form action={action} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" noValidate>
    <input type="hidden" name="supplier_id" value={supplierId} />
    <input type="hidden" name="statement_date" value={date} />
    <input type="hidden" name="items" value={JSON.stringify(items)} />
    <div className="min-w-0 space-y-4">
      <section className="ll-panel overflow-hidden">
        <header className="border-hairline border-b px-4 py-2.5 sm:px-5">
          <h2 className="text-ink text-[14px] font-semibold">Ours up to {formatDate(date)}</h2>
          <p className="text-ink-muted text-[12.5px]">Untick anything that isn’t on their statement yet: a payment still on its way to them, say.</p>
        </header>
        {before.length ? <div className="divide-hairline max-h-[420px] divide-y overflow-y-auto">{before.map((line, index) =>
          <LineRow key={index} line={line} checked={!missing.has(index)} onChange={on => setMissing(toggle(missing, index, !on))} />)}</div>
          : <p className="text-ink-faint px-4 py-3.5 text-[13px] sm:px-5">Nothing in the three months before it.</p>}
      </section>
      {after.length ? <section className="ll-panel overflow-hidden">
        <header className="border-hairline border-b px-4 py-2.5 sm:px-5">
          <h2 className="text-ink text-[14px] font-semibold">Ours after {formatDate(date)}</h2>
          <p className="text-ink-muted text-[12.5px]">Tick anything that is on their statement: a bill we dated when it arrived, say.</p>
        </header>
        <div className="divide-hairline max-h-[300px] divide-y overflow-y-auto">{after.map((line, index) =>
          <LineRow key={index} line={line} checked={later.has(index)} onChange={on => setLater(toggle(later, index, on))} />)}</div>
      </section> : null}
      <section className="ll-panel overflow-hidden">
        <header className="border-hairline flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5">
          <div>
            <h2 className="text-ink text-[14px] font-semibold">Theirs, not in our books</h2>
            <p className="text-ink-muted text-[12.5px]">A bill we haven’t been given, or a payment they’ve put down that we haven’t.</p>
          </div>
          <button type="button" onClick={() => setExtras([...extras, { key: Date.now(), date, reference: "", amount: "", kind: "billed" }])}
            className="text-brand inline-flex items-center gap-1 text-[13px] font-medium hover:underline touch:min-h-10"><Plus className="size-3.5" />Add one</button>
        </header>
        {extras.length ? <div className="divide-hairline divide-y">{extras.map(extra => {
          const update = (patch: Partial<Extra>) => setExtras(extras.map(item => item.key === extra.key ? { ...item, ...patch } : item));
          return <div key={extra.key} className="grid grid-cols-2 gap-2 px-4 py-2.5 sm:grid-cols-[130px_minmax(0,1fr)_110px_150px_auto] sm:items-center sm:px-5">
            <TextInput type="date" aria-label="Date on their statement" value={extra.date} onChange={event => update({ date: event.target.value })} />
            <TextInput aria-label="Their reference" placeholder="Their reference" value={extra.reference} maxLength={80} onChange={event => update({ reference: event.target.value })} />
            <TextInput aria-label="Amount" inputMode="decimal" placeholder="0.00" value={extra.amount} className="tabular-nums" onChange={event => update({ amount: event.target.value })} />
            <NativeSelect aria-label="What it is" value={extra.kind} onChange={event => update({ kind: event.target.value as Extra["kind"] })}>
              <option value="billed">They billed us</option><option value="credited">Paid or credited</option>
            </NativeSelect>
            <button type="button" aria-label="Remove" onClick={() => setExtras(extras.filter(item => item.key !== extra.key))} className="text-ink-faint hover:text-critical justify-self-end p-1"><X className="size-4" /></button>
          </div>;
        })}</div> : null}
      </section>
    </div>

    <aside className="ll-panel space-y-4 p-4 sm:p-5 lg:sticky lg:top-4">
      <Field label={`Their balance on ${formatDate(date)}`} htmlFor={`${uid}-theirs`} hint="as their statement shows it" error={errors.their_balance}>
        <TextInput id={`${uid}-theirs`} name="their_balance" inputMode="decimal" value={theirs} onChange={event => setTheirs(event.target.value)} placeholder="0.00" className="text-[15px] tabular-nums" autoFocus />
      </Field>
      <dl className="space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3"><dt className="text-ink-muted">Ours on the same day</dt><dd className="tabular-nums">{formatAmount(ours)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-muted">Explained</dt><dd className="tabular-nums">{explained ? `${explained > 0 ? "+" : "−"}${formatAmount(Math.abs(explained) / 100)}` : formatAmount(0)}</dd></div>
        <div className={cn("border-hairline flex justify-between gap-3 border-t pt-1.5 font-medium", left === null ? "text-ink-faint" : left === 0 ? "text-positive" : "text-critical")}>
          <dt>{left === 0 ? "Agreed" : "Left to explain"}</dt>
          <dd className="tabular-nums" role="status">{left === null ? "—" : left === 0 ? "✓" : formatAmount(left / 100)}</dd>
        </div>
      </dl>
      <Field label="Their statement" htmlFor={`${uid}-file`} hint="PDF or a photo, kept with the check" error={errors.file}>
        <input id={`${uid}-file`} name="file" type="file" accept="application/pdf,image/png,image/jpeg" className="text-ink-muted w-full text-[12.5px] file:mr-3 file:rounded-md file:border file:border-hairline-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink" />
      </Field>
      <Field label="Notes" htmlFor={`${uid}-notes`} hint="optional">
        <TextArea id={`${uid}-notes`} name="notes" rows={2} maxLength={2000} placeholder={left ? "e.g. Asked them for a copy of invoice 1041" : ""} />
      </Field>
      <FormError message={state.error ?? errors.items ?? errors.statement_date} />
      <SubmitButton pendingLabel="Saving…">{left === 0 ? "Save: agreed" : "Save the check"}</SubmitButton>
    </aside>
  </form>;
}
