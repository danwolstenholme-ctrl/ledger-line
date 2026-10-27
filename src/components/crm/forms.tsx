"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";

import { addActivity, addTask, createEnquiry, createJob, issueFormKey, moveDeal, moveJob, saveCustomerExtra, saveDeal, saveJob, setNextAction, toggleTask, turnOffFormKey } from "@/lib/actions/crm";
import { idleState, type MoveState } from "@/lib/actions/state";
import type { Board, Field, Stage } from "@/lib/domain/business-types";
import { stageSwatch } from "@/lib/domain/crm";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/common/action-form";
import { useI18n } from "@/components/common/locale";
import { Checkbox, Field as FieldRow, FormError, NativeSelect, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";
import { useCurrencySymbol } from "@/components/common/regime";

type Link = { enquiry_id?: string; job_id?: string; customer_id?: string };

/** "Add a to-do…": type and press Enter. Linked to whatever page it is on. */
export function AddTodo({ link = {}, placeholder }: { link?: Link; placeholder?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(async (previous: typeof idleState, form: FormData) => { const done = await addTask(previous, form); if (done.ok) ref.current?.reset(); return done; }, idleState);
  return <form ref={ref} action={action} className="space-y-1">
    {Object.entries(link).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
    <div className="flex gap-2">
      <TextInput name="title" placeholder={placeholder ?? t("Add a to-do…")} aria-label={t("New to-do")} className="h-10 text-[13.5px]" autoComplete="off" />
      <TextInput name="due_on" type="date" aria-label={t("Due")} className="h-10 w-40" />
    </div>
    <FormError message={state.error} />
  </form>;
}

/** The round checkbox on every to-do. */
export function TaskCheck({ id, done }: { id: string; done: boolean }) {
  const { t } = useI18n();
  return <form action={toggleTask} className="shrink-0">
    <input type="hidden" name="id" value={id} />
    <button aria-label={done ? t("Mark as not done") : t("Mark as done")} className={cn("grid size-[18px] place-items-center rounded-full border transition-colors", done ? "border-positive bg-positive text-white" : "border-hairline-strong hover:border-brand")}>
      {done ? <Check className="size-3" /> : null}
    </button>
  </form>;
}

/**
 * A record's stages as a bar: where it is, and a press to move it to any
 * other. Lost asks why. A deal won is set up as a customer and opens on its
 * new job.
 */
export function StageBar({ board, id, stages, current }: { board: Board; id: string; stages: Stage[]; current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<Stage | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<MoveState | null>(null);
  const at = stages.find(stage => stage.id === current);
  const open = stages.filter(stage => stage.outcome === "open");
  const reached = (stage: Stage) => at && at.outcome !== "lost" && (stage.outcome === "open" ? at.outcome === "won" || stage.position <= at.position : stage.id === at.id);
  const go = (stage: Stage, why?: string) => startTransition(async () => {
    const done = board === "deal" ? await moveDeal(id, stage.id, why) : await moveJob(id, stage.id);
    setResult(done);
    if (done.ok && done.href && stage.outcome === "won") router.push(done.href);
    else router.refresh();
  });
  return <div className="space-y-2">
    <ol aria-label="Stages" className="ll-panel flex overflow-x-auto">{stages.map(stage => {
      const here = stage.id === current;
      return <li key={stage.id} className="border-hairline min-w-[88px] flex-1 border-r last:border-r-0">
        <button type="button" disabled={pending || here} aria-current={here ? "step" : undefined}
          onClick={() => { if (board === "deal" && stage.outcome === "lost") { setAsking(stage); setReason(""); } else go(stage); }}
          className={cn("w-full px-2 py-2 text-center text-[12px] transition-colors disabled:cursor-default", here ? "text-ink bg-surface-sunken font-semibold" : "text-ink-muted hover:bg-surface-sunken hover:text-ink")}>
          <span aria-hidden className="mx-auto mb-1 block h-1 w-full rounded-full" style={{ backgroundColor: reached(stage) || here ? stageSwatch(here ? stage.outcome : at?.outcome === "won" ? "won" : stage.outcome, stage.position, open.length) : "var(--hairline)" }} />
          {stage.name}
        </button>
      </li>;
    })}</ol>
    {asking ? <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (reason.trim()) { go(asking, reason); setAsking(null); } }}>
      <TextInput autoFocus value={reason} onChange={event => setReason(event.target.value)} maxLength={300} placeholder={`Why it was ${asking.name.toLowerCase()} (required)`} aria-label="Reason" className="min-w-56 flex-1" />
      <button type="submit" disabled={!reason.trim()} className="bg-critical inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-white disabled:opacity-50">Mark as {asking.name.toLowerCase()}</button>
      <button type="button" onClick={() => setAsking(null)} className="text-ink-muted hover:text-ink px-2 text-[13px]">Cancel</button>
    </form> : null}
    {result?.error ? <p role="alert" className="text-critical text-[12.5px]">{result.error}</p> : null}
  </div>;
}

export function NoteForm({ link }: { link: Link }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(async (previous: typeof idleState, form: FormData) => { const done = await addActivity(previous, form); if (done.ok) ref.current?.reset(); return done; }, idleState);
  return <form ref={ref} action={action} className="space-y-2 p-4">
    {Object.entries(link).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
    <TextArea name="body" rows={2} placeholder="Log a call, an email or a note…" aria-label="Note" />
    <div className="flex items-center gap-2">
      <NativeSelect name="kind" defaultValue="note" aria-label="Kind" className="w-32">
        <option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option>
      </NativeSelect>
      <SubmitButton size="sm" pendingLabel="Saving…">Add to the timeline</SubmitButton>
    </div>
    <FormError message={state.error} />
  </form>;
}

export function NextActionForm({ link, action: current, due }: { link: Link; action: string | null; due: string | null }) {
  const [state, action] = useActionState(setNextAction, idleState);
  return <form action={action} className="space-y-2 p-4">
    {Object.entries(link).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
    <TextInput name="next_action" defaultValue={current ?? ""} placeholder="The next thing to do" aria-label="Next action" />
    <div className="flex items-center gap-2">
      <TextInput name="next_action_due" type="date" defaultValue={due ?? ""} aria-label="Due" className="w-44" />
      <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">Save</SubmitButton>
      {state.ok ? <span className="text-positive text-[12.5px]">Saved</span> : null}
    </div>
    <FormError message={state.error} />
  </form>;
}

/** The company's own fields on a form: each named x_<key>, with the list of those shown so a box left unticked reads as no. */
export function ExtraFields({ fields, values = {}, errors = {}, className }: { fields: Field[]; values?: Record<string, unknown>; errors?: Record<string, string>; className?: string }) {
  const uid = useId();
  if (!fields.length) return null;
  return <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
    <input type="hidden" name="extra_fields" value={fields.map(field => field.key).join(",")} />
    {fields.map(field => {
      const name = `x_${field.key}`, id = `${uid}-${field.key}`, value = values[field.key];
      const text = value === null || value === undefined ? "" : String(value);
      if (field.kind === "yes_no") return <div key={field.key} className="flex items-end pb-1.5"><Checkbox name={name} defaultChecked={Boolean(value)} label={field.label} /></div>;
      return <FieldRow key={field.key} label={field.label} htmlFor={id} error={errors[name]}>
        {field.kind === "choice" ? <NativeSelect id={id} name={name} defaultValue={text}>
          <option value="">—</option>
          {[...field.options, ...(text && !field.options.includes(text) ? [text] : [])].map(option => <option key={option} value={option}>{option}</option>)}
        </NativeSelect>
          : <TextInput id={id} name={name} defaultValue={text} type={field.kind === "date" ? "date" : field.kind === "link" ? "url" : "text"} inputMode={field.kind === "number" || field.kind === "money" ? "decimal" : undefined}
            className={field.kind === "number" || field.kind === "money" ? "text-right tabular-nums" : undefined} maxLength={500} placeholder={field.kind === "link" ? "https://" : undefined} />}
      </FieldRow>;
    })}
  </div>;
}

type DealValues = { id: string; full_name: string; company: string | null; email: string | null; phone: string | null; service: string | null; source: string; value: number | null;
  expected_on: string | null; owner: string; priority: string; summary: string | null; extra: Record<string, unknown> };

/** A new enquiry (deal), or its details changed. */
export function DealForm({ deal, fields, sources, people, label }: { deal?: DealValues; fields: Field[]; sources: string[]; people?: string[]; label: string }) {
  const symbol = useCurrencySymbol();
  const [state, action] = useActionState(deal ? saveDeal : createEnquiry, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const choices = deal && !sources.includes(deal.source) ? [...sources, deal.source] : sources;
  return <form action={action} className="space-y-4" noValidate>
    {deal ? <input type="hidden" name="id" value={deal.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <FieldRow label="Name" htmlFor={`${uid}-name`} required error={errors.full_name}><TextInput id={`${uid}-name`} name="full_name" maxLength={200} autoComplete="off" defaultValue={deal?.full_name ?? ""} /></FieldRow>
      <FieldRow label="Company" htmlFor={`${uid}-company`} hint="optional"><TextInput id={`${uid}-company`} name="company" maxLength={200} defaultValue={deal?.company ?? ""} /></FieldRow>
      <FieldRow label="Email" htmlFor={`${uid}-email`} error={errors.email}><TextInput id={`${uid}-email`} name="email" type="email" defaultValue={deal?.email ?? ""} /></FieldRow>
      <FieldRow label="Phone" htmlFor={`${uid}-phone`}><TextInput id={`${uid}-phone`} name="phone" maxLength={40} defaultValue={deal?.phone ?? ""} /></FieldRow>
      <FieldRow label="What they want" htmlFor={`${uid}-service`} className="sm:col-span-2"><TextInput id={`${uid}-service`} name="service" maxLength={300} defaultValue={deal?.service ?? ""} /></FieldRow>
      <FieldRow label="Source" htmlFor={`${uid}-source`}><NativeSelect id={`${uid}-source`} name="source" defaultValue={deal?.source ?? choices[0]}>{choices.map(source => <option key={source}>{source}</option>)}</NativeSelect></FieldRow>
      <FieldRow label="Likely value" htmlFor={`${uid}-value`} hint={`${symbol}, optional`} error={errors.value}><TextInput id={`${uid}-value`} name="value" inputMode="decimal" className="text-right tabular-nums" defaultValue={deal?.value ? String(deal.value) : ""} /></FieldRow>
      <FieldRow label="Expected to close" htmlFor={`${uid}-expected`} hint="optional" error={errors.expected_on}><TextInput id={`${uid}-expected`} name="expected_on" type="date" defaultValue={deal?.expected_on ?? ""} /></FieldRow>
      {deal ? <>
        <FieldRow label="Owner" htmlFor={`${uid}-owner`}><NativeSelect id={`${uid}-owner`} name="owner" defaultValue={deal.owner}>{[...new Set([deal.owner, ...(people ?? [])])].map(person => <option key={person}>{person}</option>)}</NativeSelect></FieldRow>
        <FieldRow label="Priority" htmlFor={`${uid}-priority`}><NativeSelect id={`${uid}-priority`} name="priority" defaultValue={deal.priority}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></NativeSelect></FieldRow>
      </> : null}
      <FieldRow label="Summary" htmlFor={`${uid}-summary`} className="sm:col-span-2"><TextArea id={`${uid}-summary`} name="summary" rows={3} maxLength={2000} defaultValue={deal?.summary ?? ""} /></FieldRow>
    </div>
    <ExtraFields fields={fields} values={deal?.extra} errors={errors} />
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…">{deal ? "Save changes" : `Record the ${label}`}</SubmitButton>
      {deal && state.ok ? <span role="status" className="text-positive text-[13px]">Saved</span> : null}
    </div>
  </form>;
}

type JobValues = { id: string; title: string; customer_id: string | null; owner: string; value: number | null; starts_on: string | null; due_on: string | null; priority: string; summary: string | null; extra: Record<string, unknown> };

/** A new job (whatever the company calls it), or its details changed. */
export function JobForm({ job, fields, customers, people, labels, customerId }: { job?: JobValues; fields: Field[]; customers: { id: string; name: string }[]; people: string[]; labels: { job: string; customer: string }; customerId?: string }) {
  const symbol = useCurrencySymbol();
  const [state, action] = useActionState(job ? saveJob : createJob, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-4" noValidate>
    {job ? <input type="hidden" name="id" value={job.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <FieldRow label="Title" htmlFor={`${uid}-title`} required error={errors.title} className="sm:col-span-2"><TextInput id={`${uid}-title`} name="title" maxLength={200} autoComplete="off" defaultValue={job?.title ?? ""} /></FieldRow>
      <FieldRow label={labels.customer} htmlFor={`${uid}-customer`}><NativeSelect id={`${uid}-customer`} name="customer_id" defaultValue={job?.customer_id ?? customerId ?? ""}>
        <option value="">None</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
      </NativeSelect></FieldRow>
      <FieldRow label="Owner" htmlFor={`${uid}-owner`}><NativeSelect id={`${uid}-owner`} name="owner" defaultValue={job?.owner ?? people[0] ?? ""}>{[...new Set([...(job ? [job.owner] : []), ...people])].map(person => <option key={person}>{person}</option>)}</NativeSelect></FieldRow>
      <FieldRow label="Value" htmlFor={`${uid}-value`} hint={`${symbol}, optional`} error={errors.value}><TextInput id={`${uid}-value`} name="value" inputMode="decimal" className="text-right tabular-nums" defaultValue={job?.value ? String(job.value) : ""} /></FieldRow>
      <FieldRow label="Priority" htmlFor={`${uid}-priority`}><NativeSelect id={`${uid}-priority`} name="priority" defaultValue={job?.priority ?? "normal"}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></NativeSelect></FieldRow>
      <FieldRow label="Starts" htmlFor={`${uid}-starts`} error={errors.starts_on}><TextInput id={`${uid}-starts`} name="starts_on" type="date" defaultValue={job?.starts_on ?? ""} /></FieldRow>
      <FieldRow label="Due" htmlFor={`${uid}-due`} error={errors.due_on}><TextInput id={`${uid}-due`} name="due_on" type="date" defaultValue={job?.due_on ?? ""} /></FieldRow>
      <FieldRow label="Summary" htmlFor={`${uid}-summary`} className="sm:col-span-2"><TextArea id={`${uid}-summary`} name="summary" rows={3} maxLength={2000} defaultValue={job?.summary ?? ""} /></FieldRow>
    </div>
    <ExtraFields fields={fields} values={job?.extra} errors={errors} />
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…">{job ? "Save changes" : `Add the ${labels.job.toLowerCase()}`}</SubmitButton>
      {job && state.ok ? <span role="status" className="text-positive text-[13px]">Saved</span> : null}
    </div>
  </form>;
}

/** A customer's own details: the company's fields on its customers. */
export function CustomerExtraForm({ customerId, fields, values }: { customerId: string; fields: Field[]; values: Record<string, unknown> }) {
  return <ActionForm action={saveCustomerExtra} label="Save">
    <input type="hidden" name="customer_id" value={customerId} />
    <ExtraFields fields={fields} values={values} />
  </ActionForm>;
}

/** A block of text to paste somewhere else, with a button that copies it whole. */
export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => { try { await navigator.clipboard.writeText(text); setState("copied"); } catch { setState("failed"); } };
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-3">
      <p className="text-ink text-[13px] font-medium">{label}</p>
      <button type="button" onClick={copy} className="border-hairline-strong text-ink-muted hover:bg-muted inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px]">
        {state === "copied" ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}{state === "copied" ? "Copied" : "Copy"}
      </button>
    </div>
    <pre className="bg-surface-sunken border-hairline text-ink max-h-80 overflow-auto rounded-md border p-3 font-mono text-[12px] leading-relaxed whitespace-pre">{text}</pre>
    {state === "failed" ? <p role="alert" className="text-critical text-[12px]">Couldn’t copy. Select the text and copy it instead.</p> : null}
  </div>;
}

/** Issue a new form key (the old one stops at once), or turn the form off. */
export function FormKeyActions({ live }: { live: boolean }) {
  const [issued, issue] = useActionState(issueFormKey, idleState);
  const [stopped, stop] = useActionState(turnOffFormKey, idleState);
  const [armed, setArmed] = useState(false);
  return <div className="flex flex-wrap items-center gap-2">
    <form action={issue}><SubmitButton size="sm" variant={live ? "outline" : "primary"} pendingLabel="Making…">{live ? "Make a new key" : "Turn the form on"}</SubmitButton></form>
    {live ? armed ? <form action={stop} className="flex items-center gap-2"><span className="text-ink text-[13px]">Stop taking enquiries?</span><SubmitButton size="sm" variant="outline" pendingLabel="Turning off…">Yes, turn it off</SubmitButton><button type="button" onClick={() => setArmed(false)} className="text-ink-muted text-[12.5px]">Keep it on</button></form>
      : <button type="button" onClick={() => setArmed(true)} className="text-ink-muted hover:text-critical text-[13px]">Turn the form off</button> : null}
    {issued.error || stopped.error ? <p role="alert" className="text-critical text-[12.5px]">{issued.error ?? stopped.error}</p> : null}
  </div>;
}
