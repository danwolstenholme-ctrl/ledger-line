"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { addActivity, addTask, issueFormKey, setEnquiryStage, setNextAction, toggleTask, turnOffFormKey } from "@/lib/actions/crm";
import { idleState } from "@/lib/actions/state";
import { CRM_STAGES } from "@/lib/domain/crm";
import { cn } from "@/lib/utils";
import { FormError, NativeSelect, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";

/** "Add a to-do…": type and press Enter. Linked to whatever page it is on. */
export function AddTodo({ link = {}, placeholder = "Add a to-do…" }: { link?: { enquiry_id?: string; matter_id?: string; customer_id?: string }; placeholder?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(async (previous: typeof idleState, form: FormData) => { const done = await addTask(previous, form); if (done.ok) ref.current?.reset(); return done; }, idleState);
  return <form ref={ref} action={action} className="space-y-1">
    {Object.entries(link).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
    <div className="flex gap-2">
      <TextInput name="title" placeholder={placeholder} aria-label="New to-do" className="h-10 text-[13px]" autoComplete="off" />
      <TextInput name="due_on" type="date" aria-label="Due" className="h-10 w-40" />
    </div>
    <FormError message={state.error} />
  </form>;
}

/** The round checkbox on every to-do. */
export function TaskCheck({ id, done }: { id: string; done: boolean }) {
  return <form action={toggleTask} className="shrink-0">
    <input type="hidden" name="id" value={id} />
    <button aria-label={done ? "Mark as not done" : "Mark as done"} className={cn("grid size-[18px] place-items-center rounded-full border transition-colors", done ? "border-positive bg-positive text-white" : "border-hairline-strong hover:border-brand")}>
      {done ? <Check className="size-3" /> : null}
    </button>
  </form>;
}

export function StageForm({ id, stage }: { id: string; stage: string }) {
  const [state, action] = useActionState(setEnquiryStage, idleState);
  const [choice, setChoice] = useState(stage);
  return <form action={action} className="space-y-2">
    <input type="hidden" name="id" value={id} />
    <div className="flex gap-2">
      <NativeSelect name="stage" value={choice} onChange={event => setChoice(event.target.value)} aria-label="Stage">
        {CRM_STAGES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </NativeSelect>
      <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">Move</SubmitButton>
    </div>
    {choice === "lost" ? <TextInput name="lost_reason" placeholder="Why it was lost (required)" aria-label="Lost reason" /> : null}
    <FormError message={state.error} />
  </form>;
}

export function NoteForm({ link }: { link: { enquiry_id?: string; matter_id?: string; customer_id?: string } }) {
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

export function NextActionForm({ link, action: current, due }: { link: { enquiry_id?: string; matter_id?: string }; action: string | null; due: string | null }) {
  const [state, action] = useActionState(setNextAction, idleState);
  return <form action={action} className="space-y-2 p-4">
    {Object.entries(link).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
    <TextInput name="next_action" defaultValue={current ?? ""} placeholder="The next thing to do" aria-label="Next action" />
    <div className="flex items-center gap-2">
      <TextInput name="next_action_due" type="date" defaultValue={due ?? ""} aria-label="Due" className="w-44" />
      <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">Save</SubmitButton>
      {state.ok ? <span className="text-positive text-[12px]">Saved</span> : null}
    </div>
    <FormError message={state.error} />
  </form>;
}

/** A block of text to paste somewhere else, with a button that copies it whole. */
export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => { try { await navigator.clipboard.writeText(text); setState("copied"); } catch { setState("failed"); } };
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-3">
      <p className="text-ink text-[12.5px] font-medium">{label}</p>
      <button type="button" onClick={copy} className="border-hairline-strong text-ink-muted hover:bg-muted inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px]">
        {state === "copied" ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}{state === "copied" ? "Copied" : "Copy"}
      </button>
    </div>
    <pre className="bg-surface-sunken border-hairline text-ink max-h-80 overflow-auto rounded-md border p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre">{text}</pre>
    {state === "failed" ? <p role="alert" className="text-critical text-[11.5px]">Couldn’t copy. Select the text and copy it instead.</p> : null}
  </div>;
}

/** Issue a new form key (the old one stops at once), or turn the form off. */
export function FormKeyActions({ live }: { live: boolean }) {
  const [issued, issue] = useActionState(issueFormKey, idleState);
  const [stopped, stop] = useActionState(turnOffFormKey, idleState);
  const [armed, setArmed] = useState(false);
  return <div className="flex flex-wrap items-center gap-2">
    <form action={issue}><SubmitButton size="sm" variant={live ? "outline" : "primary"} pendingLabel="Making…">{live ? "Make a new key" : "Turn the form on"}</SubmitButton></form>
    {live ? armed ? <form action={stop} className="flex items-center gap-2"><span className="text-ink text-[12.5px]">Stop taking enquiries?</span><SubmitButton size="sm" variant="outline" pendingLabel="Turning off…">Yes, turn it off</SubmitButton><button type="button" onClick={() => setArmed(false)} className="text-ink-muted text-[12px]">Keep it on</button></form>
      : <button type="button" onClick={() => setArmed(true)} className="text-ink-muted hover:text-critical text-[12.5px]">Turn the form off</button> : null}
    {issued.error || stopped.error ? <p role="alert" className="text-critical text-[12px]">{issued.error ?? stopped.error}</p> : null}
  </div>;
}
