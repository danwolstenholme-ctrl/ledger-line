"use client";

import { useActionState } from "react";

import { createEnquiry } from "@/lib/actions/crm";
import { idleState } from "@/lib/actions/state";
import { Field, FormError, NativeSelect, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";

export function NewEnquiryForm() {
  const [state, action] = useActionState(createEnquiry, idleState);
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-4" noValidate>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor="enquiry-name" required error={errors.full_name}><TextInput id="enquiry-name" name="full_name" maxLength={200} autoComplete="off" /></Field>
      <Field label="Company" htmlFor="enquiry-company" hint="optional"><TextInput id="enquiry-company" name="company" maxLength={200} /></Field>
      <Field label="Email" htmlFor="enquiry-email" error={errors.email}><TextInput id="enquiry-email" name="email" type="email" /></Field>
      <Field label="Phone" htmlFor="enquiry-phone"><TextInput id="enquiry-phone" name="phone" maxLength={40} /></Field>
      <Field label="What they want" htmlFor="enquiry-service" className="sm:col-span-2"><TextInput id="enquiry-service" name="service" maxLength={300} /></Field>
      <Field label="Source" htmlFor="enquiry-source"><NativeSelect id="enquiry-source" name="source" defaultValue="Website">{["Website", "Referral", "Phone", "Email", "Walk-in", "Trade fair"].map(source => <option key={source}>{source}</option>)}</NativeSelect></Field>
      <Field label="Likely value" htmlFor="enquiry-value" hint="€, optional" error={errors.value}><TextInput id="enquiry-value" name="value" inputMode="decimal" className="text-right tabular-nums" /></Field>
      <Field label="Summary" htmlFor="enquiry-summary" className="sm:col-span-2"><TextArea id="enquiry-summary" name="summary" rows={3} maxLength={2000} /></Field>
    </div>
    <FormError message={state.error} />
    <SubmitButton pendingLabel="Saving…">Record the enquiry</SubmitButton>
  </form>;
}
