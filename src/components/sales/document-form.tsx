"use client";

import { useActionState, useId, useState, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { saveInvoice, saveQuote } from "@/lib/actions/sales";
import { idleState } from "@/lib/actions/state";
import type { PickerAccount } from "@/lib/domain/accounts";
import { EU_COUNTRIES } from "@/lib/domain/countries";
import { addDays } from "@/lib/domain/invoice-math";
import { cn } from "@/lib/utils";
import { Checkbox, Field, FormError, NativeSelect, TextArea, TextInput } from "@/components/common/form-fields";
import Link from "@/components/navigation/navigation-link";
import { SalesLineEditor, type SaleItemOption, type SaleLineValue } from "@/components/sales/sales-line-editor";
import { INVOICE_PAYMENT_METHODS, type VatTreatment } from "@/types/database";
import { useRegime } from "@/components/common/regime";
import { useI18n } from "@/components/common/locale";

export type DocumentFormCustomer = { id: string; name: string; vat_number: string | null; country: string; eu_business: boolean; default_account_id: string | null; payment_terms_days?: number | null };
export type DocumentFormValues = { id: string; status: string; customer_id: string; number: string; issued_on: string; due_on: string | null; vat_treatment: VatTreatment; notes: string | null; lines: SaleLineValue[]; reference?: string | null };
/** A copy: what a new document starts from, with its own number and dates. */
export type DocumentPrefill = Pick<DocumentFormValues, "customer_id" | "vat_treatment" | "notes" | "lines">;

const TREATMENT_OPTIONS: Record<"CY" | "GB", { key: VatTreatment; label: string; note: string }[]> = {
  CY: [
    { key: "standard", label: "Standard VAT", note: "" },
    { key: "reverse_charge", label: "Reverse charge (EU)", note: "No VAT charged: the customer accounts for it (Article 196). Goes in box 8B and on the VIES statement." },
    { key: "exempt", label: "Exempt", note: "No VAT charged: an exempt supply, in box 6 only." },
    { key: "outside_scope", label: "Outside the scope", note: "No VAT charged: a customer outside the EU. Box 10." },
  ],
  GB: [
    { key: "standard", label: "Standard VAT", note: "" },
    { key: "reverse_charge", label: "Domestic reverse charge (CIS)", note: "No VAT charged: construction services to a VAT-registered contractor, who pays the VAT to HMRC. Box 6; the invoice says so." },
    { key: "exempt", label: "Exempt", note: "No VAT charged: an exempt supply, in box 6." },
    { key: "outside_scope", label: "Outside the scope of UK VAT", note: "No VAT charged: services supplied abroad (the place of supply is outside the UK). Box 6." },
  ],
};
export const treatmentsFor = (country: string) => TREATMENT_OPTIONS[country === "GB" ? "GB" : "CY"];
/** Cyprus's options: what forms outside a company start from. */
export const TREATMENTS = TREATMENT_OPTIONS.CY;
const METHODS: Record<(typeof INVOICE_PAYMENT_METHODS)[number], string> = { bank_transfer: "Bank transfer", card: "Card", cash: "Cash", cheque: "Cheque", other: "Other" };

export const NEW_CUSTOMER = "new";

/** Which treatment a sale to this customer starts from. */
export function treatmentFor(customer: DocumentFormCustomer | undefined, registered: boolean, country = "CY"): VatTreatment {
  if (!registered) return "exempt";
  if (country === "GB") return customer && customer.country !== "GB" ? "outside_scope" : "standard";
  if (customer?.eu_business) return "reverse_charge";
  if (customer && !EU_COUNTRIES.has(customer.country)) return "outside_scope";
  return "standard";
}

/**
 * A document form sent without React's reset after an action, so that a
 * problem leaves everything as it was typed and chosen: the reset used to
 * clear the chosen customer, and the next press failed for want of one.
 * `sending`: the intent of the button pressed, while it is being saved.
 */
export function useKeptForm(action: (form: FormData) => void) {
  const [pending, start] = useTransition();
  const [intent, setIntent] = useState<string | null>(null);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pressed = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, pressed);
    setIntent(pressed instanceof HTMLButtonElement ? pressed.value : null);
    start(() => action(data));
  };
  return { onSubmit, pending, sending: pending ? intent : null };
}

export function IntentButton({ intent, primary, sending, children }: { intent: string; primary?: boolean; sending: string | null; children: React.ReactNode }) {
  return <button type="submit" name="intent" value={intent} disabled={sending !== null}
    className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-60",
      primary ? "bg-brand hover:bg-brand-dark text-white" : "border-hairline-strong text-ink hover:bg-muted border")}>
    {sending === intent ? <Loader2 className="size-3.5 animate-spin" /> : null}{children}
  </button>;
}

/** Who the document is for: one of the company's customers, or a new one named here. */
export function CustomerChoice({ uid, customers, value, onChange, error, locked = false }: {
  uid: string; customers: DocumentFormCustomer[]; value: string; onChange: (id: string) => void; error?: string; locked?: boolean;
}) {
  const { t } = useI18n();
  return <>
    <Field label={t("Customer")} htmlFor={`${uid}-customer`} required error={error} className="sm:col-span-2">
      {/* "New customer" is not an id: the select sends nothing and the name beside it is used instead. */}
      <NativeSelect id={`${uid}-customer`} name={value === NEW_CUSTOMER ? undefined : "customer_id"} value={value} disabled={locked} onChange={event => onChange(event.target.value)}>
        <option value="">{t("Choose a customer")}</option>
        {customers.map(item => <option key={item.id} value={item.id}>{item.name}{item.vat_number ? ` · ${item.vat_number}` : ""}</option>)}
        {!locked ? <option value={NEW_CUSTOMER}>{t("+ New customer…")}</option> : null}
      </NativeSelect>
      {locked ? <input type="hidden" name="customer_id" value={value} /> : null}
    </Field>
    {value === NEW_CUSTOMER ? <Field label={t("New customer's name")} htmlFor={`${uid}-new`} hint={t("added to Customers with this document")} className="sm:col-span-2">
      <TextInput id={`${uid}-new`} name="new_customer" maxLength={200} placeholder={t("e.g. Seaview Café Ltd")} autoComplete="off" autoFocus />
    </Field> : <div className="hidden sm:col-span-2 sm:block" />}
  </>;
}

/**
 * An invoice or a quote: who it is for, its number and dates, how VAT applies,
 * and its lines. The same form for both, because a quote the customer accepts
 * becomes an invoice with exactly these lines.
 */
export function DocumentForm({ kind, document, prefill, customers, accounts, items, banks, defaultBank, salesAccount, number, today, due, terms, registered, presetCustomer, cancelHref }: {
  kind: "invoice" | "quote"; document?: DocumentFormValues; prefill?: DocumentPrefill; customers: DocumentFormCustomer[]; accounts: PickerAccount[]; items: SaleItemOption[];
  banks: { id: string; name: string }[]; defaultBank: string | null; salesAccount: string; number: string; today: string; due: string;
  /** The company's payment terms in days: an invoice is due this long after its date, unless the customer has terms of their own. */
  terms: number; registered: boolean; presetCustomer?: string | null; cancelHref: string;
}) {
  const { country } = useRegime();
  const { t } = useI18n();
  const [state, action] = useActionState(kind === "invoice" ? saveInvoice : saveQuote, idleState);
  const { onSubmit, sending } = useKeptForm(action);
  const uid = useId();
  const start = document ?? prefill;
  const [customerId, setCustomerId] = useState(start?.customer_id ?? (customers.some(item => item.id === presetCustomer) ? presetCustomer! : customers.length ? "" : NEW_CUSTOMER));
  const customer = customers.find(item => item.id === customerId);
  const [treatment, setTreatment] = useState<VatTreatment>(start?.vat_treatment ?? treatmentFor(customer, registered, country));
  const [editorKey, setEditorKey] = useState(0);
  const [paidNow, setPaidNow] = useState(false);
  // The due date follows the date and the customer's terms until someone sets it themselves.
  const [issuedOn, setIssuedOn] = useState(document?.issued_on ?? today);
  const [dueOn, setDueOn] = useState(document?.due_on ?? (kind === "invoice" ? addDays(today, customer?.payment_terms_days ?? terms) : due));
  const [dueTouched, setDueTouched] = useState(Boolean(document));
  const follow = (issued: string, next: DocumentFormCustomer | undefined) => { if (kind === "invoice" && !dueTouched && issued) setDueOn(addDays(issued, next?.payment_terms_days ?? terms)); };
  const customerTerms = kind === "invoice" ? customer?.payment_terms_days ?? terms : null;
  const errors = state.fieldErrors ?? {};
  const note = treatmentsFor(country).find(item => item.key === treatment)?.note;
  const canTakePayment = kind === "invoice" && (!document || document.status === "draft") && banks.length > 0;
  return <form onSubmit={onSubmit} className="space-y-5" noValidate>
    {document ? <input type="hidden" name="id" value={document.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <CustomerChoice uid={uid} customers={customers} value={customerId} error={errors.customer_id} onChange={id => {
        const next = customers.find(item => item.id === id);
        setCustomerId(id);
        follow(issuedOn, next);
        // A new customer's VAT position decides the treatment, unless lines are already written for this document.
        if (!start) { setTreatment(treatmentFor(next, registered, country)); setEditorKey(value => value + 1); }
      }} />
      <Field label={kind === "invoice" ? t("Invoice number") : t("Quote number")} htmlFor={`${uid}-number`} required error={errors.number}>
        <TextInput id={`${uid}-number`} name="number" defaultValue={document?.number ?? number} maxLength={60} className="font-mono" />
      </Field>
      <Field label={kind === "invoice" ? t("Invoice date") : t("Quote date")} htmlFor={`${uid}-issued`} required error={errors.issued_on}>
        <TextInput id={`${uid}-issued`} name="issued_on" type="date" value={issuedOn} onChange={event => { setIssuedOn(event.target.value); follow(event.target.value, customer); }} />
      </Field>
      <Field label={kind === "invoice" ? t("Due date") : t("Valid until")} htmlFor={`${uid}-due`} error={errors.due_on} hint={customerTerms !== null && !dueTouched ? t.n(customerTerms, "{count} day", "{count} days") : undefined}>
        <TextInput id={`${uid}-due`} name="due_on" type="date" value={dueOn ?? ""} onChange={event => { setDueOn(event.target.value); setDueTouched(true); }} />
      </Field>
      {registered ? <Field label={t("VAT")} htmlFor={`${uid}-vat`}>
        <NativeSelect id={`${uid}-vat`} name="vat_treatment" value={treatment} onChange={event => setTreatment(event.target.value as VatTreatment)}>
          {treatmentsFor(country).map(item => <option key={item.key} value={item.key}>{t(item.label)}</option>)}
        </NativeSelect>
      </Field> : <input type="hidden" name="vat_treatment" value="exempt" />}
    </div>
    {kind === "invoice" ? <Field label={t("Their reference")} htmlFor={`${uid}-reference`} hint={t("optional: their purchase order number, printed on the invoice")} className="max-w-md">
      <TextInput id={`${uid}-reference`} name="reference" defaultValue={document?.reference ?? ""} maxLength={80} autoComplete="off" placeholder={t("e.g. PO-4471")} />
    </Field> : null}
    {registered ? note ? <p className="border-hairline bg-surface-sunken text-ink-muted rounded-md border px-3 py-2 text-[12.5px]">{t(note)}</p> : null
      : <p className="border-hairline bg-surface-sunken text-ink-muted rounded-md border px-3 py-2 text-[12.5px]">{t("Not registered for VAT: no VAT is charged, and the invoice says so.")}</p>}
    <SalesLineEditor key={`${editorKey}-${customerId}`} accounts={accounts} items={items} initial={start?.lines} noVat={treatment !== "standard"}
      defaultAccount={customer?.default_account_id ?? salesAccount} error={errors.lines} />
    <Field label={t("Notes")} htmlFor={`${uid}-notes`} hint={t("printed on the document")}>
      <TextArea id={`${uid}-notes`} name="notes" rows={2} defaultValue={start?.notes ?? ""} maxLength={2000} placeholder={kind === "invoice" ? t("e.g. Thank you for your business.") : t("e.g. Prices held for 30 days.")} />
    </Field>
    {canTakePayment ? <div className="border-hairline space-y-3 rounded-md border px-3 py-2.5">
      <Checkbox name="paid_now" checked={paidNow} onChange={event => setPaidNow(event.target.checked)} label={t("Paid already: a card, cash or on-the-spot sale")} />
      {paidNow ? <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Paid into")} htmlFor={`${uid}-paid-bank`} error={errors.paid_bank_account_id}>
          <NativeSelect id={`${uid}-paid-bank`} name="paid_bank_account_id" defaultValue={defaultBank ?? banks[0]?.id}>{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</NativeSelect>
        </Field>
        <Field label={t("Paid by")} htmlFor={`${uid}-paid-method`}>
          <NativeSelect id={`${uid}-paid-method`} name="paid_method" defaultValue="card">{INVOICE_PAYMENT_METHODS.map(method => <option key={method} value={method}>{t(METHODS[method])}</option>)}</NativeSelect>
        </Field>
        <p className="text-ink-faint text-[12px] sm:col-span-2">{t("Issued and paid in one step, on the invoice date. The payment waits in the bank to be matched to the statement.")}</p>
      </div> : null}
    </div> : null}
    <FormError message={state.error} />
    <div className="flex flex-wrap items-center gap-3">
      {document && document.status !== "draft" ? <IntentButton intent={kind === "invoice" ? "issue" : "send"} primary sending={sending}>{t("Save changes")}</IntentButton> : <>
        <IntentButton intent={kind === "invoice" ? "issue" : "send"} primary sending={sending}>{kind === "invoice" ? paidNow ? t("Save, issue and mark paid") : t("Save and issue") : t("Save and mark as sent")}</IntentButton>
        {!paidNow ? <IntentButton intent="draft" sending={sending}>{t("Save as draft")}</IntentButton> : null}
      </>}
      <Link href={cancelHref} className="text-ink-muted hover:text-ink text-[13px]">{t("Cancel")}</Link>
    </div>
    {kind === "invoice" ? <p className="text-ink-faint text-[12px]">{t("Issuing posts it to the books: the customer owes the total, each line's account earns its net, and the VAT is owed. A draft posts nothing.")}</p> : null}
  </form>;
}
