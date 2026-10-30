"use client";

import { useActionState, useId, useState } from "react";

import { saveCreditNote } from "@/lib/actions/sales";
import { idleState } from "@/lib/actions/state";
import type { PickerAccount } from "@/lib/domain/accounts";
import { CREDIT_REASONS } from "@/lib/domain/credit-notes";
import { formatAmount } from "@/lib/format";
import { Field, FormError, NativeSelect, TextArea, TextInput } from "@/components/common/form-fields";
import Link from "@/components/navigation/navigation-link";
import { CustomerChoice, IntentButton, NEW_CUSTOMER, treatmentsFor, useKeptForm, type DocumentFormCustomer } from "@/components/sales/document-form";
import { treatmentFor } from "@/lib/domain/regimes";
import { SalesLineEditor, type SaleItemOption, type SaleLineValue } from "@/components/sales/sales-line-editor";
import type { VatTreatment } from "@/types/database";
import { useCurrency, useRegime } from "@/components/common/regime";

export type CreditNoteInvoice = { id: string; number: string; customer_id: string; vat_treatment: VatTreatment; total: number; balance: number; credited_before: number; lines: SaleLineValue[] };
export type CreditNoteValues = { id: string; customer_id: string; invoice_id: string | null; number: string; issued_on: string; vat_treatment: VatTreatment; reason: string; notes: string | null; lines: SaleLineValue[] };

/**
 * A credit note: what is being taken back, and why. Raised from an invoice it
 * starts with that invoice's lines, customer and VAT, and can never credit
 * more than the invoice charged; issued, it comes off what is owed on it.
 */
export function CreditNoteForm({ invoice, document, customers, accounts, items, salesAccount, number, today, registered, cancelHref }: {
  invoice: CreditNoteInvoice | null; document?: CreditNoteValues; customers: DocumentFormCustomer[]; accounts: PickerAccount[]; items: SaleItemOption[];
  salesAccount: string; number: string; today: string; registered: boolean; cancelHref: string;
}) {
  const { country } = useRegime();
  const currency = useCurrency();
  const [state, action] = useActionState(saveCreditNote, idleState);
  const { onSubmit, sending } = useKeptForm(action);
  const uid = useId();
  const [customerId, setCustomerId] = useState(document?.customer_id ?? invoice?.customer_id ?? (customers.length ? "" : NEW_CUSTOMER));
  const customer = customers.find(item => item.id === customerId);
  const [treatment, setTreatment] = useState<VatTreatment>(document?.vat_treatment ?? invoice?.vat_treatment ?? treatmentFor(customer, registered, country));
  const [editorKey, setEditorKey] = useState(0);
  const errors = state.fieldErrors ?? {};
  const left = invoice ? Math.max(0, invoice.total - invoice.credited_before) : null;
  return <form onSubmit={onSubmit} className="space-y-5" noValidate>
    {document ? <input type="hidden" name="id" value={document.id} /> : null}
    {invoice ? <input type="hidden" name="invoice_id" value={invoice.id} /> : null}
    {invoice ? <p className="border-hairline bg-surface-sunken text-ink-muted rounded-md border px-3 py-2 text-[12.5px]">
      Credits invoice <span className="text-ink font-mono font-medium">{invoice.number}</span> ({formatAmount(invoice.total, currency)}). Up to {formatAmount(left!, currency)} can still be credited.
      {invoice.balance > 0 ? ` Issued, it comes off the ${formatAmount(invoice.balance, currency)} still owed on it; anything more is kept as credit to use or refund.` : " The invoice is paid, so the credit is kept to use against another invoice or to refund."}
    </p> : null}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <CustomerChoice uid={uid} customers={customers} value={customerId} error={errors.customer_id} locked={Boolean(invoice)} onChange={id => {
        setCustomerId(id);
        if (!document && !invoice) { setTreatment(treatmentFor(customers.find(item => item.id === id), registered, country)); setEditorKey(value => value + 1); }
      }} />
      <Field label="Credit note number" htmlFor={`${uid}-number`} required error={errors.number}>
        <TextInput id={`${uid}-number`} name="number" defaultValue={document?.number ?? number} maxLength={60} className="font-mono" />
      </Field>
      <Field label="Date" htmlFor={`${uid}-issued`} required error={errors.issued_on}>
        <TextInput id={`${uid}-issued`} name="issued_on" type="date" defaultValue={document?.issued_on ?? today} />
      </Field>
      <Field label="Reason" htmlFor={`${uid}-reason`} required error={errors.reason}>
        <NativeSelect id={`${uid}-reason`} name="reason" defaultValue={document?.reason ?? "Goods returned"}>{CREDIT_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}</NativeSelect>
      </Field>
      {registered ? <Field label="VAT" htmlFor={`${uid}-vat`} hint={invoice ? "as on the invoice" : undefined}>
        <NativeSelect id={`${uid}-vat`} name={invoice ? undefined : "vat_treatment"} value={treatment} disabled={Boolean(invoice)} onChange={event => setTreatment(event.target.value as VatTreatment)}>
          {treatmentsFor(country).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </NativeSelect>
        {invoice ? <input type="hidden" name="vat_treatment" value={treatment} /> : null}
      </Field> : <input type="hidden" name="vat_treatment" value="exempt" />}
    </div>
    <div className="space-y-1.5">
      <p className="text-ink text-[13px] font-medium">What is credited</p>
      <p className="text-ink-faint text-[12px]">{invoice ? "The invoice's lines, to start with. Remove what is not being credited, or lower a quantity or a price." : "As on an invoice: each line takes its net back off its income account."}</p>
      <SalesLineEditor key={`${editorKey}-${customerId}`} accounts={accounts} items={items} initial={document?.lines ?? invoice?.lines} noVat={treatment !== "standard"}
        defaultAccount={customer?.default_account_id ?? salesAccount} error={errors.lines} />
    </div>
    <Field label="Notes" htmlFor={`${uid}-notes`} hint="printed on the credit note">
      <TextArea id={`${uid}-notes`} name="notes" rows={2} defaultValue={document?.notes ?? ""} maxLength={2000} placeholder="e.g. Two cases returned damaged on delivery." />
    </Field>
    <FormError message={state.error} />
    <div className="flex flex-wrap items-center gap-3">
      <IntentButton intent="issue" primary sending={sending}>Save and issue</IntentButton>
      <IntentButton intent="draft" sending={sending}>Save as draft</IntentButton>
      <Link href={cancelHref} className="text-ink-muted hover:text-ink text-[13px]">Cancel</Link>
    </div>
    <p className="text-ink-faint text-[12px]">Issuing posts the reverse of a sale: income and the VAT due fall, and the customer owes less. It comes off the VAT return for the period of its date.</p>
  </form>;
}
