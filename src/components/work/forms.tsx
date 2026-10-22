"use client";

import { useActionState, useId } from "react";
import { Coins } from "lucide-react";

import { addTime, raiseFees, saveClientFee, saveFeeFloor } from "@/lib/actions/work";
import { idleState } from "@/lib/actions/state";
import { formatAmount } from "@/lib/format";
import { Checkbox, Field, FormError, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import { WORK_SUGGESTIONS } from "@/components/work/timer-control";

/** Time worked without a timer: the client, the work, how long, the day. */
export function AddTimeForm({ companies, people, user, today }: { companies: { id: string; name: string; is_practice: boolean }[]; people: string[]; user: string; today: string }) {
  const [state, action] = useActionState(addTime, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-3" noValidate>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Client" htmlFor={`${uid}-org`} error={errors.organisation_id}>
        <NativeSelect id={`${uid}-org`} name="organisation_id" defaultValue={companies.find(company => !company.is_practice)?.id}>
          {companies.map(company => <option key={company.id} value={company.id}>{company.is_practice ? `${company.name} (the firm’s own work)` : company.name}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Work" htmlFor={`${uid}-work`} error={errors.work}>
        <TextInput id={`${uid}-work`} name="work" list={`${uid}-works`} maxLength={200} placeholder="Bank reconciliation" />
        <datalist id={`${uid}-works`}>{WORK_SUGGESTIONS.map(work => <option key={work} value={work} />)}</datalist>
      </Field>
      <Field label="How long" htmlFor={`${uid}-duration`} hint="1:30, 1.5 or 90m" error={errors.duration}>
        <TextInput id={`${uid}-duration`} name="duration" inputMode="decimal" placeholder="1:30" className="tabular-nums" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day" htmlFor={`${uid}-on`} error={errors.on}><TextInput id={`${uid}-on`} name="on" type="date" defaultValue={today} max={today} /></Field>
        <Field label="Who" htmlFor={`${uid}-person`}>
          <NativeSelect id={`${uid}-person`} name="person" defaultValue={user}>{people.map(person => <option key={person} value={person}>{person}</option>)}</NativeSelect>
        </Field>
      </div>
    </div>
    <Checkbox name="extra" label="Extra work: bill it on top of the monthly fee, at the client’s rate" />
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton size="sm" pendingLabel="Saving…">Add the time</SubmitButton>
      {state.ok ? <span role="status" className="text-positive text-[12px]">Added</span> : null}
    </div>
  </form>;
}

/** One client's fee: the monthly amount and the rate for extra work. */
export function ClientFeeForm({ organisationId, fee, rate, app }: { organisationId: string; fee: number; rate: number; app: number }) {
  const [state, action] = useActionState(saveClientFee, idleState);
  const uid = useId();
  return <form action={action} className="flex flex-wrap items-end gap-2">
    <input type="hidden" name="organisation_id" value={organisationId} />
    <label className="space-y-1 text-[11.5px]" htmlFor={`${uid}-fee`}><span className="text-ink-muted block">Monthly fee €</span>
      <TextInput id={`${uid}-fee`} name="monthly_fee" defaultValue={fee.toFixed(2)} inputMode="decimal" className="w-28 text-right tabular-nums" /></label>
    <label className="space-y-1 text-[11.5px]" htmlFor={`${uid}-rate`}><span className="text-ink-muted block">Extra work €/hour</span>
      <TextInput id={`${uid}-rate`} name="hourly_rate" defaultValue={rate.toFixed(2)} inputMode="decimal" className="w-28 text-right tabular-nums" /></label>
    <label className="space-y-1 text-[11.5px]" htmlFor={`${uid}-app`}><span className="text-ink-muted block">App, a month €</span>
      <TextInput id={`${uid}-app`} name="app_fee" defaultValue={app.toFixed(2)} inputMode="decimal" className="w-24 text-right tabular-nums" /></label>
    <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">Save</SubmitButton>
    {state.ok ? <span role="status" className="text-positive text-[12px]">Saved</span> : null}
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : null}
  </form>;
}

export function FeeFloorForm({ floor }: { floor: number }) {
  const [state, action] = useActionState(saveFeeFloor, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-2 text-[12.5px]">
    <label htmlFor="fee-floor" className="text-ink-muted">Flag clients earning less than €</label>
    <TextInput id="fee-floor" name="fee_floor" defaultValue={floor.toFixed(0)} inputMode="decimal" className="h-7 w-16 text-right tabular-nums" />
    <span className="text-ink-muted">an hour</span>
    <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">Set</SubmitButton>
    {state.error ? <span role="alert" className="text-critical">{state.error}</span> : null}
  </form>;
}

/** Every client's fee for the month, invoiced in one press. */
export function RaiseFeesButton({ period, month, count, net }: { period: string; month: string; count: number; net: number }) {
  const [state, action] = useActionState(raiseFees, idleState);
  return <form action={action} className="flex flex-col items-end gap-1">
    <input type="hidden" name="period" value={period} />
    <SubmitButton pendingLabel="Raising the invoices…"><Coins className="size-4" />Raise {month}’s fees · {formatAmount(net)}</SubmitButton>
    <span className="text-ink-faint text-[11.5px]">{count} invoice{count === 1 ? "" : "s"}, plus 19% VAT, from the firm’s own books</span>
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : null}
  </form>;
}
