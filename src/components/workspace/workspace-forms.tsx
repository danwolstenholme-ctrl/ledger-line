"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

import { archiveField, changeBusinessType, saveField, saveModules, saveNames, saveStages } from "@/lib/actions/workspace";
import { FIELD_KINDS, FIELD_KIND_LABELS, type Board, type BusinessType, type Field, type FieldEntity, type Labels, type Module, type Stage } from "@/lib/domain/business-types";
import { ActionForm } from "@/components/common/action-form";
import { Checkbox, Field as FieldRow, NativeSelect, TextArea, TextInput } from "@/components/common/form-fields";

/** The forms that shape how a company works. Each saves on its own, so a change to the names never touches the stages. */

export function BusinessTypeForm({ current, types }: { current: string; types: Pick<BusinessType, "key" | "label" | "examples">[] }) {
  const uid = useId();
  const [choice, setChoice] = useState(current);
  const chosen = types.find(type => type.key === choice);
  return <ActionForm action={changeBusinessType} label="Use this type" variant="outline">
    <FieldRow label="Kind of business" htmlFor={`${uid}-type`} hint={chosen?.examples}>
      <NativeSelect id={`${uid}-type`} name="business_type" value={choice} onChange={event => setChoice(event.target.value)}>
        {types.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
      </NativeSelect>
    </FieldRow>
    {choice !== current ? <p className="text-ink-muted text-[12px] leading-relaxed">Its names, parts and fields replace these. Stages change only on a board nothing is in yet; nothing recorded is lost.</p> : null}
  </ActionForm>;
}

export function NamesForm({ labels }: { labels: Labels }) {
  const uid = useId();
  const row = (key: "customer" | "deal" | "job", what: string) => <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
    <p className="text-ink-muted pb-2 text-[12.5px]">{what}</p>
    <FieldRow label="One" htmlFor={`${uid}-${key}-one`}><TextInput id={`${uid}-${key}-one`} name={`${key}_one`} defaultValue={labels[key][0]} maxLength={30} /></FieldRow>
    <FieldRow label="Several" htmlFor={`${uid}-${key}-many`}><TextInput id={`${uid}-${key}-many`} name={`${key}_many`} defaultValue={labels[key][1]} maxLength={30} /></FieldRow>
  </div>;
  return <ActionForm action={saveNames} label="Save the names">
    {row("customer", "Who it sells to")}
    {row("deal", "Who might buy: the pipeline")}
    {row("job", "The work it does for them")}
  </ActionForm>;
}

const PARTS: { module: Module; label: (labels: Labels) => string; hint: string }[] = [
  { module: "pipeline", label: labels => labels.deal[1], hint: "The pipeline, from first contact to won" },
  { module: "quotes", label: () => "Quotes", hint: "Prices sent before the work, accepted online" },
  { module: "jobs", label: labels => labels.job[1], hint: "The work in hand, through its own stages" },
  { module: "tasks", label: () => "Tasks", hint: "To-dos for anyone, on anything" },
  { module: "products", label: () => "Products", hint: "What it sells, priced once" },
  { module: "payroll", label: () => "Payroll", hint: "Cyprus payroll: payslips, social insurance and tax" },
];

export function ModulesForm({ modules, labels, country }: { modules: Module[]; labels: Labels; country: string }) {
  return <ActionForm action={saveModules} label="Save">
    <div className="grid gap-2 sm:grid-cols-2">
      {PARTS.filter(part => part.module !== "payroll" || country === "CY").map(part => <div key={part.module}>
        <Checkbox name={`module_${part.module}`} defaultChecked={modules.includes(part.module)} label={part.label(labels)} />
        <p className="text-ink-faint pl-5.5 text-[11.5px]">{part.hint}</p>
      </div>)}
    </div>
    <p className="text-ink-faint text-[11.5px]">Customers, invoices and the books are always there. A part turned off keeps what was recorded in it.</p>
  </ActionForm>;
}

type Row = { key: string; id?: string; name: string; probability: number | null; outcome: Stage["outcome"] };

/** A board's stages: rename, reorder, add, and remove those with nothing in them. The closing two stay at the end. */
export function StageEditor({ board, stages, counts, closingNames }: { board: Board; stages: Stage[]; counts: Record<string, number>; closingNames: { won: string; lost: string } }) {
  const [rows, setRows] = useState<Row[]>(stages.map(stage => ({ key: stage.id, id: stage.id, name: stage.name, probability: stage.probability, outcome: stage.outcome })));
  const open = rows.filter(row => row.outcome === "open"), closing = rows.filter(row => row.outcome !== "open");
  const update = (key: string, change: Partial<Row>) => setRows(current => current.map(row => row.key === key ? { ...row, ...change } : row));
  const shift = (key: string, by: -1 | 1) => setRows(current => {
    const list = current.filter(row => row.outcome === "open");
    const at = list.findIndex(row => row.key === key), to = at + by;
    if (to < 0 || to >= list.length) return current;
    [list[at], list[to]] = [list[to], list[at]];
    return [...list, ...current.filter(row => row.outcome !== "open")];
  });
  const line = (row: Row, index: number, editable: boolean) => <li key={row.key} className="flex flex-wrap items-center gap-2 py-1.5">
    <span className="text-ink-faint w-5 text-right text-[11.5px] tabular-nums">{index + 1}</span>
    <TextInput aria-label={`Stage ${index + 1}`} value={row.name} onChange={event => update(row.key, { name: event.target.value })} maxLength={40} className="min-w-40 flex-1" />
    {board === "deal" && row.outcome === "open" ? <span className="flex items-center gap-1">
      <TextInput aria-label={`${row.name || "Stage"} probability`} inputMode="numeric" value={row.probability === null ? "" : String(row.probability)} onChange={event => update(row.key, { probability: event.target.value === "" ? null : Number(event.target.value.replace(/[^\d]/g, "")) })} className="w-16 text-right tabular-nums" />
      <span className="text-ink-faint text-[11.5px]">% likely</span>
    </span> : null}
    {row.outcome !== "open" ? <span className={row.outcome === "won" ? "text-positive text-[11.5px] font-medium" : "text-critical text-[11.5px] font-medium"}>{row.outcome === "won" ? closingNames.won : closingNames.lost}</span> : null}
    {editable ? <span className="flex items-center gap-0.5">
      <button type="button" onClick={() => shift(row.key, -1)} aria-label={`Move ${row.name} up`} className="text-ink-faint hover:text-ink grid size-7 place-items-center rounded"><ArrowUp className="size-3.5" /></button>
      <button type="button" onClick={() => shift(row.key, 1)} aria-label={`Move ${row.name} down`} className="text-ink-faint hover:text-ink grid size-7 place-items-center rounded"><ArrowDown className="size-3.5" /></button>
      {row.id && counts[row.id] ? <span className="text-ink-faint w-16 text-[11px]">{counts[row.id]} in it</span>
        : <button type="button" onClick={() => setRows(current => current.filter(item => item.key !== row.key))} aria-label={`Remove ${row.name}`} className="text-ink-faint hover:text-critical grid size-7 place-items-center rounded"><X className="size-3.5" /></button>}
    </span> : <span className="text-ink-faint w-[86px] text-[11px]">{row.id && counts[row.id] ? `${counts[row.id]} in it` : ""}</span>}
  </li>;
  return <ActionForm action={saveStages} label="Save the stages">
    <input type="hidden" name="board" value={board} />
    <input type="hidden" name="stages" value={JSON.stringify([...open, ...closing].map(row => ({ id: row.id, name: row.name, probability: row.probability, outcome: row.outcome })))} />
    <ol>{open.map((row, index) => line(row, index, true))}</ol>
    <button type="button" onClick={() => setRows(current => [...current.filter(row => row.outcome === "open"), { key: `new-${Date.now()}`, name: "", probability: null, outcome: "open" }, ...current.filter(row => row.outcome !== "open")])}
      className="text-brand inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline"><Plus className="size-3.5" />Add a stage</button>
    <div className="border-hairline border-t pt-2">
      <p className="text-ink-faint mb-1 text-[11.5px]">Where a record closes: rename them, but each board keeps both.</p>
      <ol>{closing.map((row, index) => line(row, open.length + index, false))}</ol>
    </div>
  </ActionForm>;
}

/** One of the company's fields: its name, its choices, and whether it shows on the cards; or put away. */
export function FieldEditor({ field }: { field: Field }) {
  const uid = useId();
  return <div className="space-y-3">
    <ActionForm action={saveField} label="Save">
      <input type="hidden" name="id" value={field.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRow label="Name" htmlFor={`${uid}-label`}><TextInput id={`${uid}-label`} name="label" defaultValue={field.label} maxLength={60} /></FieldRow>
        <div className="flex items-end pb-1.5"><Checkbox name="on_card" defaultChecked={field.on_card} label="Show on the cards and in the list" /></div>
        {field.kind === "choice" ? <FieldRow label="Choices" htmlFor={`${uid}-options`} hint="one on each line" className="sm:col-span-2"><TextArea id={`${uid}-options`} name="options" rows={4} defaultValue={field.options.join("\n")} /></FieldRow> : null}
      </div>
    </ActionForm>
    <ActionForm action={archiveField} label="Stop using it" variant="outline">
      <input type="hidden" name="id" value={field.id} />
      <p className="text-ink-faint text-[11.5px]">What was recorded in it is kept, and shows again if it is added back.</p>
    </ActionForm>
  </div>;
}

export function NewFieldForm({ entities }: { entities: { key: FieldEntity; label: string }[] }) {
  const uid = useId();
  const [kind, setKind] = useState<string>("text");
  return <div role="group" aria-label="Add a detail"><ActionForm action={saveField} label="Add it" reset>
    <div className="grid gap-3 sm:grid-cols-3">
      <FieldRow label="Kept on" htmlFor={`${uid}-entity`}><NativeSelect id={`${uid}-entity`} name="entity" defaultValue={entities[entities.length - 1]?.key}>{entities.map(entity => <option key={entity.key} value={entity.key}>{entity.label}</option>)}</NativeSelect></FieldRow>
      <FieldRow label="Name" htmlFor={`${uid}-label`}><TextInput id={`${uid}-label`} name="label" maxLength={60} placeholder="e.g. Site address" /></FieldRow>
      <FieldRow label="Kind" htmlFor={`${uid}-kind`}><NativeSelect id={`${uid}-kind`} name="kind" value={kind} onChange={event => setKind(event.target.value)}>{FIELD_KINDS.map(item => <option key={item} value={item}>{FIELD_KIND_LABELS[item]}</option>)}</NativeSelect></FieldRow>
      {kind === "choice" ? <FieldRow label="Choices" htmlFor={`${uid}-options`} hint="one on each line" className="sm:col-span-3"><TextArea id={`${uid}-options`} name="options" rows={4} /></FieldRow> : null}
    </div>
    <Checkbox name="on_card" label="Show on the cards and in the list" />
  </ActionForm></div>;
}
