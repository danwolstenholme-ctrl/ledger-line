"use client";

import { useActionState, useState } from "react";
import { Ban, Check, RotateCcw, Send, X } from "lucide-react";

import { acceptQuote, recordInvoicePayment, saveCustomer, saveInvoiceSettings, setInvoiceStatus, setQuoteStatus } from "@/lib/actions/sales";
import { idleState } from "@/lib/actions/state";
import { COUNTRIES, EU_COUNTRIES } from "@/lib/domain/countries";
import { formatAmount } from "@/lib/format";
import { Checkbox, Field, FormError, NativeSelect, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";
import { INVOICE_PAYMENT_METHODS, type CustomerRow } from "@/types/database";
import { useCurrency } from "@/components/common/regime";
import { useRegime } from "@/components/common/regime";
import { regimeOf } from "@/lib/domain/regimes";

const METHODS: Record<(typeof INVOICE_PAYMENT_METHODS)[number], string> = { bank_transfer: "Bank transfer", card: "Card", cash: "Cash", cheque: "Cheque", other: "Other" };

/** Issue a draft, void an unpaid invoice, or bring a void one back. */
export function InvoiceStatusButton({ id, to }: { id: string; to: "issued" | "void" }) {
  const [state, action] = useActionState(setInvoiceStatus, idleState);
  const [armed, setArmed] = useState(false);
  if (to === "void" && !armed) return <button type="button" onClick={() => setArmed(true)} className="text-ink-muted hover:text-critical inline-flex items-center gap-1.5 text-[13px]"><Ban className="size-3.5" />Void</button>;
  return <form action={action} className="inline-flex flex-col gap-1">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="to" value={to} />
    {to === "void" ? <span className="flex items-center gap-2 text-[13px]">Void this invoice?<SubmitButton size="sm" variant="outline" pendingLabel="Voiding…">Yes, void it</SubmitButton>
      <button type="button" onClick={() => setArmed(false)} className="text-ink-muted text-[12.5px]">Keep it</button></span>
      : <SubmitButton size="sm" pendingLabel="Issuing…"><Send className="size-3.5" />Issue</SubmitButton>}
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : null}
  </form>;
}

export function RestoreInvoiceButton({ id }: { id: string }) {
  const [state, action] = useActionState(setInvoiceStatus, idleState);
  return <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="issued" />
    <SubmitButton size="sm" variant="outline" pendingLabel="Restoring…"><RotateCcw className="size-3.5" />Restore</SubmitButton>
    {state.error ? <span role="alert" className="text-critical ml-2 text-[12px]">{state.error}</span> : null}
  </form>;
}

/** Money received against an invoice: a part payment is fine, more than is owed is not. */
export function RecordPaymentForm({ invoiceId, balance, banks, defaultBank, today }: { invoiceId: string; balance: number; banks: { id: string; code: string; name: string }[]; defaultBank: string | null; today: string }) {
  const currency = useCurrency();
  const [state, action] = useActionState(recordInvoicePayment, idleState);
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-3" key={String(balance)}>
    <input type="hidden" name="invoice_id" value={invoiceId} />
    <div className="grid grid-cols-2 gap-3">
      <Field label="Amount" hint={`${formatAmount(balance, currency)} owed`} error={errors.amount}><TextInput name="amount" inputMode="decimal" defaultValue={balance.toFixed(2)} className="text-right tabular-nums" /></Field>
      <Field label="Received on" error={errors.received_on}><TextInput name="received_on" type="date" defaultValue={today} max={today} /></Field>
      <Field label="Into" error={errors.bank_account_id}><NativeSelect name="bank_account_id" defaultValue={defaultBank ?? banks[0]?.id ?? ""}>{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</NativeSelect></Field>
      <Field label="Method"><NativeSelect name="method" defaultValue="bank_transfer">{INVOICE_PAYMENT_METHODS.map(method => <option key={method} value={method}>{METHODS[method]}</option>)}</NativeSelect></Field>
    </div>
    <Field label="Reference" hint="optional"><TextInput name="reference" maxLength={120} /></Field>
    <FormError message={state.error} />
    <SubmitButton pendingLabel="Recording…"><Check className="size-3.5" />Record payment</SubmitButton>
  </form>;
}

export function QuoteActions({ id, status }: { id: string; status: "draft" | "sent" | "accepted" | "declined" }) {
  const [accepted, accept] = useActionState(acceptQuote, idleState);
  const [changed, change] = useActionState(setQuoteStatus, idleState);
  if (status === "accepted") return null;
  return <div className="flex flex-wrap items-center gap-2">
    {status !== "declined" ? <form action={accept}><input type="hidden" name="id" value={id} /><SubmitButton pendingLabel="Raising the invoice…"><Check className="size-3.5" />Accepted: raise the invoice</SubmitButton></form> : null}
    {status === "draft" ? <form action={change}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="sent" /><SubmitButton variant="outline" pendingLabel="Saving…"><Send className="size-3.5" />Mark as sent</SubmitButton></form> : null}
    {status === "sent" ? <form action={change}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="declined" /><SubmitButton variant="outline" pendingLabel="Saving…"><X className="size-3.5" />Declined</SubmitButton></form> : null}
    {status === "declined" ? <form action={change}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="sent" /><SubmitButton variant="outline" pendingLabel="Saving…"><RotateCcw className="size-3.5" />Reopen</SubmitButton></form> : null}
    {accepted.error || changed.error ? <span role="alert" className="text-critical w-full text-[12.5px]">{accepted.error ?? changed.error}</span> : null}
  </div>;
}

export function CustomerForm({ customer, companyTerms }: { customer?: Pick<CustomerRow, "id" | "name" | "email" | "phone" | "vat_number" | "country" | "address" | "eu_business" | "payment_terms_days">; companyTerms: number }) {
  const [state, action] = useActionState(saveCustomer, idleState);
  // A customer is where the company is, unless said otherwise.
  const { country: home } = useRegime();
  const [country, setCountry] = useState(customer?.country ?? home);
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-4" noValidate>
    {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" required error={errors.name} className="sm:col-span-2"><TextInput name="name" defaultValue={customer?.name ?? ""} maxLength={200} autoComplete="off" /></Field>
      <Field label="Email" error={errors.email}><TextInput name="email" type="email" defaultValue={customer?.email ?? ""} /></Field>
      <Field label="Phone"><TextInput name="phone" defaultValue={customer?.phone ?? ""} maxLength={40} /></Field>
      <Field label="Country"><NativeSelect name="country" value={country} onChange={event => setCountry(event.target.value)}>{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</NativeSelect></Field>
      <Field label="VAT number" hint={country === home ? `e.g. ${regimeOf(home).vatNumberExample}` : "with the country prefix"} error={errors.vat_number}><TextInput name="vat_number" defaultValue={customer?.vat_number ?? ""} maxLength={40} className="font-mono" /></Field>
      <Field label="Address" hint="printed on invoices" className="sm:col-span-2"><TextArea name="address" rows={2} defaultValue={customer?.address ?? ""} maxLength={500} /></Field>
      <Field label="Payment terms" hint={`days; empty for the company's ${companyTerms}`} error={errors.payment_terms_days}>
        <TextInput name="payment_terms_days" inputMode="numeric" defaultValue={customer?.payment_terms_days ?? ""} placeholder={String(companyTerms)} className="tabular-nums" />
      </Field>
      {home === "CY" && country !== "CY" && EU_COUNTRIES.has(country) ? <Checkbox name="eu_business" defaultChecked={customer?.eu_business ?? true} label="A business in another EU state: invoices are reverse charge and go on the VIES statement" className="sm:col-span-2" /> : null}
    </div>
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…">{customer ? "Save customer" : "Add customer"}</SubmitButton>
      {state.ok ? <span role="status" className="text-positive text-[13px]">Saved</span> : null}
    </div>
  </form>;
}

/** `next` is the number the next invoice takes under the saved prefix; a new prefix starts again at 0001. */
export function InvoiceSettingsForm({ prefix, terms, year, next }: { prefix: string; terms: number; year: string; next: string }) {
  const [state, action] = useActionState(saveInvoiceSettings, idleState);
  const [value, setValue] = useState(prefix);
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-4" noValidate>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Number prefix" hint={`next: ${value.trim().toUpperCase() === prefix.toUpperCase() ? next : `${value.trim().toUpperCase() || "…"}${year}-0001`}`} error={errors.invoice_prefix}>
        <TextInput name="invoice_prefix" value={value} onChange={event => setValue(event.target.value)} maxLength={12} className="font-mono uppercase" />
      </Field>
      <Field label="Payment terms" hint="days to pay" error={errors.payment_terms_days}>
        <TextInput name="payment_terms_days" type="number" min={0} max={365} defaultValue={String(terms)} className="tabular-nums" />
      </Field>
    </div>
    <p className="text-ink-faint text-[12px]">Invoices run {value.toUpperCase() || "…"}{year}-0001 upwards each year, quotes {value.toUpperCase() || "…"}Q-001. A new invoice is due this many days after its date.</p>
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      {state.ok ? <span role="status" className="text-positive text-[13px]">Saved</span> : null}
    </div>
  </form>;
}
