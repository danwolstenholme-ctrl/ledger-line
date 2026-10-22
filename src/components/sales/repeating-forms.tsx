"use client";

import { useActionState, useId } from "react";
import { Repeat } from "lucide-react";

import { raiseDueRepeating, startRepeating, updateRepeating } from "@/lib/actions/sales";
import { idleState } from "@/lib/actions/state";
import { Field, FormError, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";

const EVERY = [[1, "Every month"], [2, "Every two months"], [3, "Every quarter"], [6, "Every six months"], [12, "Every year"]] as const;

type Values = { id?: string; invoice_id?: string; name: string; every_months: number; next_on: string; ends_on: string | null; issue: boolean };

/** How often, from when, until when, and whether each invoice is issued at once or saved as a draft to check. */
export function RepeatingForm({ values, today }: { values: Values; today: string }) {
  const [state, action] = useActionState(values.id ? updateRepeating : startRepeating, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-4" noValidate>
    {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
    {values.invoice_id ? <input type="hidden" name="invoice_id" value={values.invoice_id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor={`${uid}-name`} required error={errors.name} hint="for you, not printed" className="sm:col-span-2">
        <TextInput id={`${uid}-name`} name="name" defaultValue={values.name} maxLength={120} />
      </Field>
      <Field label="How often" htmlFor={`${uid}-every`} error={errors.every_months}>
        <NativeSelect id={`${uid}-every`} name="every_months" defaultValue={String(values.every_months)}>{EVERY.map(([months, label]) => <option key={months} value={months}>{label}</option>)}</NativeSelect>
      </Field>
      <Field label="Next invoice date" htmlFor={`${uid}-next`} required error={errors.next_on}>
        <TextInput id={`${uid}-next`} name="next_on" type="date" defaultValue={values.next_on} min={values.id ? undefined : today} />
      </Field>
      <Field label="Last invoice date" htmlFor={`${uid}-ends`} error={errors.ends_on} hint="optional: leave empty to repeat until stopped">
        <TextInput id={`${uid}-ends`} name="ends_on" type="date" defaultValue={values.ends_on ?? ""} />
      </Field>
      <Field label="Each invoice" htmlFor={`${uid}-issue`}>
        <NativeSelect id={`${uid}-issue`} name="issue" defaultValue={values.issue ? "issue" : "draft"}>
          <option value="issue">Issued at once</option>
          <option value="draft">Saved as a draft to check first</option>
        </NativeSelect>
      </Field>
    </div>
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…"><Repeat className="size-3.5" />{values.id ? "Save changes" : "Start repeating"}</SubmitButton>
      {state.ok ? <span role="status" className="text-positive text-[12.5px]">Saved</span> : null}
    </div>
  </form>;
}

/** Raise what has come due: all of the company's repeating invoices, or one. */
export function RaiseDueButton({ id, count, label }: { id?: string; count: number; label?: string }) {
  const [state, action] = useActionState(raiseDueRepeating, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-3">
    {id ? <input type="hidden" name="id" value={id} /> : null}
    <SubmitButton pendingLabel="Raising…" disabled={count === 0}><Repeat className="size-3.5" />{label ?? `Raise ${count} due invoice${count === 1 ? "" : "s"}`}</SubmitButton>
    {state.notice ? <span role="status" className="text-positive text-[12.5px]">{state.notice}</span> : null}
    {state.error ? <span role="alert" className="text-critical text-[12.5px]">{state.error}</span> : null}
  </form>;
}
