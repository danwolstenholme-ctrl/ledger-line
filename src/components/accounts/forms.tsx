"use client";

import { useActionState, useId, useRef, useState } from "react";
import Link from "@/components/navigation/navigation-link";
import { Plus, X } from "lucide-react";

import {
  deleteBankTransaction, deleteManualJournal, recordBillPayment, saveAccountingSettings, saveBankTransaction, saveBill, saveVatScheme,
  saveLedgerAccount, saveManualJournal, saveSupplier, setBillVoid,
} from "@/lib/actions/accounts";
import { setAiSuggestions } from "@/lib/actions/bank";
import { idleState, type ActionState } from "@/lib/actions/state";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_ORDER, type PickerAccount } from "@/lib/domain/accounts";
import { formatAmount } from "@/lib/format";
import { formatIban } from "@/lib/domain/iban";
import { cn } from "@/lib/utils";
import { Checkbox, Field, FormError, NativeSelect, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";
import { AccountOptions, LineEditor, type LineValue } from "@/components/accounts/line-editor";
import {
  INVOICE_PAYMENT_METHODS, type AccountingSettingsRow, type BankTransactionKind, type LedgerAccountRow, type SupplierRow,
} from "@/types/database";
import { useCurrency } from "@/components/common/regime";
import { useCurrencySymbol, useRegime } from "@/components/common/regime";
import { REVERSE_CHARGE_KINDS } from "@/lib/domain/regimes";

export type BankOption = { id: string; code: string; name: string };
const METHOD_LABELS: Record<(typeof INVOICE_PAYMENT_METHODS)[number], string> = { bank_transfer: "Bank transfer", card: "Card", cash: "Cash", cheque: "Cheque", other: "Other" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const keep = (event: React.FormEvent) => event.preventDefault();

function Saved({ state, message }: { state: ActionState; message: string }) {
  return state.ok ? <p role="status" className="text-positive text-[12.5px]">{message}</p> : null;
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

export type BillFormValues = {
  id: string; supplier_id: string; number: string | null; reference: string | null; issued_on: string; due_on: string | null;
  notes: string | null; source_document: string | null; reverse_charge: boolean; reverse_charge_kind?: string | null; lines: LineValue[];
};

/**
 * Reverse charge, explained where it is chosen. In the UK, which one: each
 * fills different boxes of the return (lib/domain/vat-uk).
 */
export function ReverseChargeField({ checked, onChange, what, kind }: { checked: boolean; onChange: (value: boolean) => void; what: string; kind?: string | null }) {
  const { country } = useRegime();
  const uid = useId();
  const [chosen, setChosen] = useState(kind ?? "services");
  const note = <p className="text-ink-muted text-[12.5px] leading-relaxed">The VAT on the lines is the company’s to account for: it goes on the return as both due and reclaimed, so it costs nothing.</p>;
  if (country === "GB") return <div className="space-y-1">
    <Field label="Reverse charge" htmlFor={`${uid}-rc`}>
      <NativeSelect id={`${uid}-rc`} name="reverse_charge_kind" value={checked ? chosen : ""} onChange={event => { onChange(Boolean(event.target.value)); if (event.target.value) setChosen(event.target.value); }}>
        <option value="">None: VAT as the supplier charged it</option>
        {Object.entries(REVERSE_CHARGE_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </NativeSelect>
    </Field>
    {checked ? <><input type="hidden" name="reverse_charge" value="on" />{note}</> : null}
  </div>;
  return <div className="space-y-1">
    <Checkbox name="reverse_charge" checked={checked} onChange={event => onChange(event.target.checked)} label={`Reverse charge: ${what} abroad charged no VAT`} />
    {checked ? <div className="pl-6">{note}</div> : null}
  </div>;
}

/** A purchase invoice as the supplier sent it. A new supplier can be named here and is added with the bill. */
export function BillForm({ bill, defaultSupplierId, suppliers, accounts, today }: {
  bill?: BillFormValues; defaultSupplierId?: string; suppliers: Pick<SupplierRow, "id" | "name" | "default_account_id" | "reverse_charge">[]; accounts: PickerAccount[]; today: string;
}) {
  const [state, action] = useActionState(saveBill, idleState);
  const uid = useId();
  const [supplier, setSupplier] = useState(bill?.supplier_id ?? (suppliers.some(item => item.id === defaultSupplierId) ? defaultSupplierId! : ""));
  // A new bill starts as its supplier usually is; an existing one as it was recorded.
  const [reverseCharge, setReverseCharge] = useState(bill?.reverse_charge ?? suppliers.find(item => item.id === supplier)?.reverse_charge ?? false);
  const [editorKey, setEditorKey] = useState(0);
  const errors = state.fieldErrors ?? {};
  const defaultAccount = suppliers.find(item => item.id === supplier)?.default_account_id ?? "";

  return <form action={action} onReset={keep} className="space-y-5" noValidate>
    {bill ? <input type="hidden" name="id" value={bill.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Supplier" htmlFor={`${uid}-supplier`} required error={errors.supplier_id}>
        <NativeSelect id={`${uid}-supplier`} name="supplier_id" value={supplier}
          onChange={event => { setSupplier(event.target.value); if (!bill) { setEditorKey(value => value + 1); setReverseCharge(suppliers.find(item => item.id === event.target.value)?.reverse_charge ?? false); } }}>
          <option value="">{suppliers.length ? "Choose a supplier, or name a new one below" : "Name the supplier below"}</option>
          {suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </NativeSelect>
      </Field>
      {!supplier ? <Field label="New supplier" htmlFor={`${uid}-new`} hint="added with this bill">
        <TextInput id={`${uid}-new`} name="new_supplier" maxLength={200} placeholder="e.g. Island Energy Supply Ltd" autoComplete="off" />
      </Field> : <div aria-hidden className="hidden sm:block" />}
      <Field label="Supplier’s invoice number" htmlFor={`${uid}-number`} hint="as printed" error={errors.number}>
        <TextInput id={`${uid}-number`} name="number" defaultValue={bill?.number ?? ""} maxLength={60} className="font-mono" autoComplete="off" />
      </Field>
      <Field label="Reference" htmlFor={`${uid}-reference`} hint="optional" error={errors.reference}>
        <TextInput id={`${uid}-reference`} name="reference" defaultValue={bill?.reference ?? ""} maxLength={120} autoComplete="off" />
      </Field>
      <Field label="Bill date" htmlFor={`${uid}-issued`} required error={errors.issued_on}>
        <TextInput id={`${uid}-issued`} name="issued_on" type="date" defaultValue={bill?.issued_on ?? today} />
      </Field>
      <Field label="Due date" htmlFor={`${uid}-due`} hint="optional" error={errors.due_on}>
        <TextInput id={`${uid}-due`} name="due_on" type="date" defaultValue={bill?.due_on ?? ""} />
      </Field>
    </div>
    <LineEditor key={editorKey} accounts={accounts} initial={bill?.lines} defaultAccount={defaultAccount} error={errors.lines} reverseCharge={reverseCharge} />
    <ReverseChargeField checked={reverseCharge} onChange={setReverseCharge} what="a supplier" kind={bill?.reverse_charge_kind} />
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Notes" htmlFor={`${uid}-notes`} hint="internal">
        <TextArea id={`${uid}-notes`} name="notes" rows={2} defaultValue={bill?.notes ?? ""} maxLength={2000} />
      </Field>
      <Field label="Source document" htmlFor={`${uid}-source`} hint="where the original is kept">
        <TextInput id={`${uid}-source`} name="source_document" defaultValue={bill?.source_document ?? ""} maxLength={300} placeholder="e.g. Captured: supplier-invoice.pdf" />
      </Field>
    </div>
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…">{bill ? "Save bill" : "Record bill"}</SubmitButton>
      <Link href={bill ? `/accounts/bills/${bill.id}` : "/accounts/bills"} className="text-ink-muted hover:text-ink text-[13px] touch:inline-flex touch:min-h-11 touch:items-center">Cancel</Link>
    </div>
  </form>;
}

export function BillPaymentForm({ billId, balance, bankAccounts, defaultBank, today }: { billId: string; balance: number; bankAccounts: BankOption[]; defaultBank: string | null; today: string }) {
  const currency = useCurrency();
  const [state, action] = useActionState(recordBillPayment, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  return <form action={action} onReset={keep} className="space-y-3" key={String(balance)}>
    <input type="hidden" name="bill_id" value={billId} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Amount paid" htmlFor={`${uid}-amount`} required hint={`${formatAmount(balance, currency)} owed`} error={errors.amount}>
        <TextInput id={`${uid}-amount`} name="amount" inputMode="decimal" defaultValue={balance.toFixed(2)} className="text-right tabular-nums" />
      </Field>
      <Field label="Date paid" htmlFor={`${uid}-date`} required error={errors.paid_on}>
        <TextInput id={`${uid}-date`} name="paid_on" type="date" defaultValue={today} max={today} />
      </Field>
      <Field label="Paid from" htmlFor={`${uid}-bank`} required error={errors.bank_account_id}>
        <NativeSelect id={`${uid}-bank`} name="bank_account_id" defaultValue={defaultBank ?? bankAccounts[0]?.id ?? ""}>
          {bankAccounts.map(bank => <option key={bank.id} value={bank.id}>{bank.code} · {bank.name}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Method" htmlFor={`${uid}-method`}>
        <NativeSelect id={`${uid}-method`} name="method" defaultValue="bank_transfer">
          {INVOICE_PAYMENT_METHODS.map(method => <option key={method} value={method}>{METHOD_LABELS[method]}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Reference" htmlFor={`${uid}-reference`} hint="optional" className="sm:col-span-2">
        <TextInput id={`${uid}-reference`} name="reference" maxLength={120} />
      </Field>
    </div>
    <FormError message={state.error} />
    <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
  </form>;
}

export function VoidBillForm({ id, isVoid }: { id: string; isVoid: boolean }) {
  const [state, action] = useActionState(setBillVoid, idleState);
  return <form action={action} className="space-y-2">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="void" value={isVoid ? "" : "on"} />
    <p className="text-ink-muted text-[12.5px]">{isVoid ? "Bring this bill back into the books." : "A void bill stays on record with its number but leaves the books and cannot be paid."}</p>
    <FormError message={state.error} />
    <SubmitButton variant="outline" size="sm" pendingLabel="Saving…">{isVoid ? "Restore this bill" : "Void this bill"}</SubmitButton>
  </form>;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export function SupplierForm({ supplier, accounts }: { supplier?: SupplierRow; accounts: PickerAccount[] }) {
  const [state, action] = useActionState(saveSupplier, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  return <form action={action} onReset={keep} className="space-y-4" noValidate>
    {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Supplier name" htmlFor={`${uid}-name`} required error={errors.name} className="sm:col-span-2">
        <TextInput id={`${uid}-name`} name="name" defaultValue={supplier?.name ?? ""} maxLength={200} autoComplete="off" />
      </Field>
      <Field label="Email" htmlFor={`${uid}-email`} error={errors.email}><TextInput id={`${uid}-email`} name="email" type="email" defaultValue={supplier?.email ?? ""} /></Field>
      <Field label="Phone" htmlFor={`${uid}-phone`} error={errors.phone}><TextInput id={`${uid}-phone`} name="phone" defaultValue={supplier?.phone ?? ""} maxLength={40} /></Field>
      <Field label="VAT number" htmlFor={`${uid}-vat`} error={errors.vat_number}><TextInput id={`${uid}-vat`} name="vat_number" defaultValue={supplier?.vat_number ?? ""} maxLength={40} className="font-mono" /></Field>
      <Field label="Usual account" htmlFor={`${uid}-account`} hint="fills new bill lines">
        <NativeSelect id={`${uid}-account`} name="default_account_id" defaultValue={supplier?.default_account_id ?? ""}><AccountOptions accounts={accounts} placeholder="None" /></NativeSelect>
      </Field>
      <Field label="IBAN" htmlFor={`${uid}-iban`} hint="to pay them by transfer" error={errors.iban}><TextInput id={`${uid}-iban`} name="iban" defaultValue={supplier?.iban ? formatIban(supplier.iban) : ""} maxLength={42} className="font-mono uppercase" autoComplete="off" placeholder="CY00 0000 0000 0000 0000 0000 0000" /></Field>
      <Field label="BIC" htmlFor={`${uid}-bic`} hint="optional" error={errors.bic}><TextInput id={`${uid}-bic`} name="bic" defaultValue={supplier?.bic ?? ""} maxLength={11} className="font-mono uppercase" autoComplete="off" /></Field>
      <Field label="Notes" htmlFor={`${uid}-notes`} className="sm:col-span-2"><TextArea id={`${uid}-notes`} name="notes" rows={2} defaultValue={supplier?.notes ?? ""} maxLength={2000} /></Field>
      <Checkbox name="reverse_charge" defaultChecked={supplier?.reverse_charge ?? false} label="Abroad, and charges no VAT: new bills start as reverse charge" className="sm:col-span-2" />
    </div>
    <FormError message={state.error} />
    <Saved state={state} message="Supplier saved." />
    <SubmitButton pendingLabel="Saving…">{supplier ? "Save supplier" : "Add supplier"}</SubmitButton>
  </form>;
}

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

export type BankTransactionValues = {
  id: string; kind: BankTransactionKind; bank_account_id: string; transfer_account_id: string | null; txn_date: string;
  contact: string | null; reference: string | null; amount: number; reverse_charge: boolean; reverse_charge_kind?: string | null; lines: LineValue[];
};

const KIND_LABELS: Record<BankTransactionKind, string> = { spend: "Spend money", receive: "Receive money", transfer: "Transfer" };

/** Money that went straight out of or into the bank, or moved between the firm's own accounts. */
export function BankTransactionForm({ transaction, initialKind = "spend", bankAccounts, accounts, defaultBank, today }: {
  transaction?: BankTransactionValues; initialKind?: BankTransactionKind; bankAccounts: BankOption[]; accounts: PickerAccount[]; defaultBank: string | null; today: string;
}) {
  const [state, action] = useActionState(saveBankTransaction, idleState);
  const uid = useId();
  const [kind, setKind] = useState<BankTransactionKind>(transaction?.kind ?? initialKind);
  const [reverseCharge, setReverseCharge] = useState(transaction?.reverse_charge ?? false);
  const errors = state.fieldErrors ?? {};
  const bank = transaction?.bank_account_id ?? defaultBank ?? bankAccounts[0]?.id ?? "";
  return <form action={action} onReset={keep} className="space-y-5" noValidate>
    {transaction ? <input type="hidden" name="id" value={transaction.id} /> : null}
    <input type="hidden" name="kind" value={kind} />
    <div role="radiogroup" aria-label="Type of transaction" className="border-hairline-strong inline-flex overflow-hidden rounded-md border">
      {(Object.keys(KIND_LABELS) as BankTransactionKind[]).map((value, index) => (
        <button key={value} type="button" role="radio" aria-checked={kind === value} onClick={() => setKind(value)}
          className={cn("h-8 px-3 text-[13px] font-medium touch:h-11 touch:px-4", index > 0 && "border-hairline-strong border-l", kind === value ? "bg-accent text-brand" : "text-ink-muted hover:bg-muted")}>
          {KIND_LABELS[value]}
        </button>
      ))}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={kind === "transfer" ? "From" : "Bank account"} htmlFor={`${uid}-bank`} required error={errors.bank_account_id}>
        <NativeSelect id={`${uid}-bank`} name="bank_account_id" defaultValue={bank}>
          {bankAccounts.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
        </NativeSelect>
      </Field>
      {kind === "transfer" ? <Field label="To" htmlFor={`${uid}-to`} required error={errors.transfer_account_id}>
        <NativeSelect id={`${uid}-to`} name="transfer_account_id" defaultValue={transaction?.transfer_account_id ?? bankAccounts.find(item => item.id !== bank)?.id ?? ""}>
          {bankAccounts.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
        </NativeSelect>
      </Field> : <Field label={kind === "receive" ? "Received from" : "Paid to"} htmlFor={`${uid}-contact`} hint="optional" error={errors.contact}>
        <TextInput id={`${uid}-contact`} name="contact" defaultValue={transaction?.contact ?? ""} maxLength={200} autoComplete="off" />
      </Field>}
      <Field label="Date" htmlFor={`${uid}-date`} required error={errors.txn_date}>
        <TextInput id={`${uid}-date`} name="txn_date" type="date" defaultValue={transaction?.txn_date ?? today} />
      </Field>
      <Field label="Reference" htmlFor={`${uid}-reference`} hint="optional" error={errors.reference}>
        <TextInput id={`${uid}-reference`} name="reference" defaultValue={transaction?.reference ?? ""} maxLength={120} autoComplete="off" />
      </Field>
      {kind === "transfer" ? <Field label="Amount" htmlFor={`${uid}-amount`} required error={errors.amount}>
        <TextInput id={`${uid}-amount`} name="amount" inputMode="decimal" defaultValue={transaction?.kind === "transfer" ? transaction.amount.toFixed(2) : ""} className="text-right tabular-nums" />
      </Field> : null}
    </div>
    {kind !== "transfer" ? <LineEditor key={kind} accounts={accounts} codable="bank" initial={transaction?.kind === kind ? transaction.lines : undefined} defaultRate={kind === "spend" ? undefined : 0} error={errors.lines} reverseCharge={kind === "spend" && reverseCharge} /> : null}
    {kind === "spend" ? <ReverseChargeField checked={reverseCharge} onChange={setReverseCharge} what="a business" kind={transaction?.reverse_charge_kind} /> : null}
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      <Link href="/accounts/bank" className="text-ink-muted hover:text-ink text-[13px] touch:inline-flex touch:min-h-11 touch:items-center">Cancel</Link>
    </div>
  </form>;
}

/** Removing a bank transaction or a journal: one confirmed press, refused inside a locked period. */
export function RemoveForm({ kind, id, label }: { kind: "bank" | "journal"; id: string; label: string }) {
  const [state, action] = useActionState(kind === "bank" ? deleteBankTransaction : deleteManualJournal, idleState);
  const [armed, setArmed] = useState(false);
  return <form action={action} className="space-y-2">
    <input type="hidden" name="id" value={id} />
    {armed ? <div className="flex flex-wrap items-center gap-2">
      <span className="text-ink text-[13px]">Remove it from the books?</span>
      <SubmitButton variant="outline" size="sm" pendingLabel="Removing…">Yes, remove</SubmitButton>
      <button type="button" onClick={() => setArmed(false)} className="text-ink-muted hover:text-ink text-[12.5px]">Keep it</button>
    </div> : <button type="button" onClick={() => setArmed(true)} className="text-critical text-[13px] font-medium hover:underline touch:min-h-10">{label}</button>}
    <FormError message={state.error} />
  </form>;
}

// ---------------------------------------------------------------------------
// Journals
// ---------------------------------------------------------------------------

type JournalLine = { key: number; account_id: string; description: string; debit: string; credit: string };
const JOURNAL_ROW = "lg:grid-cols-[14rem_minmax(0,1fr)_7rem_7rem_2.25rem] lg:gap-3";
const JOURNAL_LABEL = "text-ink-muted block text-[12px] lg:hidden";
export type JournalValues = { id: string; entry_date: string; reference: string | null; narration: string; lines: Omit<JournalLine, "key">[] };

/** Opening balances and adjustments: debits on the left, credits on the right, equal before it saves. */
/** A journal written by hand. `prefill` starts a new one from values, as a reversal starts from the journal it undoes. */
export function JournalForm({ journal, prefill, accounts, today }: { journal?: JournalValues; prefill?: Omit<JournalValues, "id">; accounts: PickerAccount[]; today: string }) {
  const symbol = useCurrencySymbol();
  const currency = useCurrency();
  const [state, action] = useActionState(saveManualJournal, idleState);
  const uid = useId();
  const start = journal ?? prefill;
  const nextKey = useRef(start?.lines.length ?? 2);
  const blank = (key: number): JournalLine => ({ key, account_id: "", description: "", debit: "", credit: "" });
  const [lines, setLines] = useState<JournalLine[]>(start?.lines.length ? start.lines.map((line, key) => ({ ...line, key })) : [blank(0), blank(1)]);
  const errors = state.fieldErrors ?? {};
  const cents = (value: string) => { const parsed = Number(value.replace(/[,\s]/g, "")); return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0; };
  const debit = lines.reduce((sum, line) => sum + cents(line.debit), 0), credit = lines.reduce((sum, line) => sum + cents(line.credit), 0);
  const update = (key: number, patch: Partial<JournalLine>) => setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  const amount = "text-right tabular-nums";

  return <form action={action} onReset={keep} className="space-y-5" noValidate>
    {journal ? <input type="hidden" name="id" value={journal.id} /> : null}
    <input type="hidden" name="lines" value={JSON.stringify(lines.map(line => ({ account_id: line.account_id, description: line.description, debit: line.debit, credit: line.credit })))} />
    <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)_12rem]">
      <Field label="Date" htmlFor={`${uid}-date`} required error={errors.entry_date}><TextInput id={`${uid}-date`} name="entry_date" type="date" defaultValue={start?.entry_date ?? today} /></Field>
      <Field label="Narration" htmlFor={`${uid}-narration`} required error={errors.narration}><TextInput id={`${uid}-narration`} name="narration" defaultValue={start?.narration ?? ""} maxLength={300} placeholder="e.g. Accrued electricity for September" /></Field>
      <Field label="Reference" htmlFor={`${uid}-reference`} hint="optional"><TextInput id={`${uid}-reference`} name="reference" defaultValue={start?.reference ?? ""} maxLength={120} /></Field>
    </div>
    <div aria-hidden className={cn("text-ink-faint hidden text-[11.5px] font-semibold tracking-[0.06em] uppercase lg:grid", JOURNAL_ROW)}>
      <span>Account</span><span>Description</span><span className="text-right">Debit {symbol}</span><span className="text-right">Credit {symbol}</span><span />
    </div>
    <ol className="space-y-3">{lines.map((line, index) => <li key={line.key} className={cn("border-hairline grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 lg:items-start lg:border-b-0 lg:pb-0", JOURNAL_ROW)}>
      <label className="min-w-0 space-y-1"><span aria-hidden className={JOURNAL_LABEL}>Account</span>
        <NativeSelect aria-label={`Line ${index + 1} account`} value={line.account_id} onChange={event => update(line.key, { account_id: event.target.value })}><AccountOptions accounts={accounts} /></NativeSelect></label>
      <label className="min-w-0 space-y-1"><span aria-hidden className={JOURNAL_LABEL}>Description</span>
        <TextInput aria-label={`Line ${index + 1} description`} value={line.description} maxLength={300} onChange={event => update(line.key, { description: event.target.value })} /></label>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-end gap-2 lg:contents">
        <label className="min-w-0 space-y-1"><span aria-hidden className={JOURNAL_LABEL}>Debit {symbol}</span>
          <TextInput aria-label={`Line ${index + 1} debit`} inputMode="decimal" value={line.debit} onChange={event => update(line.key, { debit: event.target.value, credit: event.target.value ? "" : line.credit })} className={amount} /></label>
        <label className="min-w-0 space-y-1"><span aria-hidden className={JOURNAL_LABEL}>Credit {symbol}</span>
          <TextInput aria-label={`Line ${index + 1} credit`} inputMode="decimal" value={line.credit} onChange={event => update(line.key, { credit: event.target.value, debit: event.target.value ? "" : line.debit })} className={amount} /></label>
        <button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length <= 2} onClick={() => setLines(current => current.filter(item => item.key !== line.key))}
          className="text-ink-faint hover:text-critical inline-grid size-9 place-items-center self-end rounded disabled:opacity-30 touch:size-11 lg:self-start"><X className="size-3.5" /></button>
      </div>
    </li>)}</ol>
    <div className={cn("border-hairline-strong grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 border-t pt-2 text-[13px] font-semibold lg:grid", JOURNAL_ROW)}>
      <span className="lg:col-span-2 lg:text-right">{debit !== credit ? <span className="text-critical font-normal">Out by {formatAmount(Math.abs(debit - credit) / 100, currency)}</span> : debit ? <span className="text-positive font-normal">Balanced</span> : null}</span>
      <span className="text-right tabular-nums"><span className="text-ink-muted mr-1 font-normal lg:sr-only">Debits</span>{formatAmount(debit / 100, currency)}</span>
      <span className="text-right tabular-nums"><span className="text-ink-muted mr-1 font-normal lg:sr-only">Credits</span>{formatAmount(credit / 100, currency)}</span>
    </div>
    <button type="button" onClick={() => { nextKey.current += 1; setLines(current => [...current, blank(nextKey.current)]); }} className="text-brand inline-flex items-center gap-1 text-[13px] font-medium hover:underline touch:min-h-10"><Plus className="size-3.5" />Add a line</button>
    {errors.lines ? <p role="alert" className="text-critical text-[12.5px]">{errors.lines}</p> : null}
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…" disabled={debit !== credit || debit === 0}>{journal ? "Save journal" : "Post journal"}</SubmitButton>
      <Link href={journal ? `/accounts/journals/${journal.id}` : "/accounts/journals"} className="text-ink-muted hover:text-ink text-[13px] touch:inline-flex touch:min-h-11 touch:items-center">Cancel</Link>
    </div>
  </form>;
}

// ---------------------------------------------------------------------------
// The chart and settings
// ---------------------------------------------------------------------------

export function LedgerAccountForm({ account, defaultType = "expense" }: { account?: LedgerAccountRow; defaultType?: LedgerAccountRow["type"] }) {
  const [state, action] = useActionState(saveLedgerAccount, idleState);
  const uid = useId();
  const [type, setType] = useState(account?.type ?? defaultType);
  const errors = state.fieldErrors ?? {};
  const system = Boolean(account?.system_role);
  return <form action={action} onReset={keep} className="space-y-4" noValidate>
    {account ? <input type="hidden" name="id" value={account.id} /> : null}
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4">
      <Field label="Code" htmlFor={`${uid}-code`} required error={errors.code}><TextInput id={`${uid}-code`} name="code" defaultValue={account?.code ?? ""} maxLength={6} inputMode="numeric" className="font-mono" /></Field>
      <Field label="Name" htmlFor={`${uid}-name`} required error={errors.name}><TextInput id={`${uid}-name`} name="name" defaultValue={account?.name ?? ""} maxLength={120} /></Field>
      <Field label="Type" htmlFor={`${uid}-type`} required error={errors.type} hint={system ? "fixed: used by the books" : undefined} className="col-span-2">
        {system ? <input type="hidden" name="type" value={type} /> : null}
        <NativeSelect id={`${uid}-type`} name={system ? undefined : "type"} value={type} disabled={system} onChange={event => setType(event.target.value as typeof type)}>
          {ACCOUNT_TYPE_ORDER.map(value => <option key={value} value={value}>{ACCOUNT_TYPES[value].label}</option>)}
        </NativeSelect>
      </Field>
    </div>
    <Field label="Description" htmlFor={`${uid}-description`} hint="optional"><TextInput id={`${uid}-description`} name="description" defaultValue={account?.description ?? ""} maxLength={500} /></Field>
    {type === "bank" ? <Field label="Bank details" htmlFor={`${uid}-bank`} hint="e.g. the IBAN"><TextInput id={`${uid}-bank`} name="bank_details" defaultValue={account?.bank_details ?? ""} maxLength={200} className="font-mono" /></Field> : null}
    {account && !system ? <Checkbox name="is_active" label="Active — offered on new bills, payments and journals" defaultChecked={account.is_active} /> : account ? <input type="hidden" name="is_active" value="on" /> : null}
    <FormError message={state.error} />
    <Saved state={state} message="Account saved." />
    <SubmitButton pendingLabel="Saving…">{account ? "Save account" : "Add account"}</SubmitButton>
  </form>;
}

/** Whether the reconcile screen may put bank lines to the AI service. */
export function AiSuggestionsForm({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState(setAiSuggestions, idleState);
  return <form action={action} onReset={keep} className="space-y-3">
    <Checkbox name="enabled" defaultChecked={enabled} label="Let the books ask AI: the overview’s read of the figures, and suggestions when reconciling" />
    <FormError message={state.error} />
    <Saved state={state} message="Saved." />
    <SubmitButton variant="outline" pendingLabel="Saving…">Save</SubmitButton>
  </form>;
}

export function AccountingSettingsForm({ settings, bankAccounts }: { settings: AccountingSettingsRow; bankAccounts: BankOption[] }) {
  const [state, action] = useActionState(saveAccountingSettings, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  return <form action={action} onReset={keep} className="space-y-4" noValidate>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Lock date" htmlFor={`${uid}-lock`} hint="optional" error={errors.lock_date}>
        <TextInput id={`${uid}-lock`} name="lock_date" type="date" defaultValue={settings.lock_date ?? ""} />
      </Field>
      <Field label="Financial year ends" htmlFor={`${uid}-year`} error={errors.year_end_month}>
        <NativeSelect id={`${uid}-year`} name="year_end_month" defaultValue={String(settings.year_end_month)}>
          {MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Looked after by" htmlFor={`${uid}-manager`} hint="at the practice" error={errors.manager} className="sm:col-span-2">
        <TextInput id={`${uid}-manager`} name="manager" defaultValue={settings.manager ?? ""} maxLength={120} placeholder="Who owns this company’s deadlines" />
      </Field>
      <Field label="Payments land in" htmlFor={`${uid}-bank`} error={errors.default_bank_account_id} className="sm:col-span-2">
        <NativeSelect id={`${uid}-bank`} name="default_bank_account_id" defaultValue={settings.default_bank_account_id ?? ""}>
          {bankAccounts.map(bank => <option key={bank.id} value={bank.id}>{bank.code} · {bank.name}</option>)}
        </NativeSelect>
      </Field>
    </div>
    <FormError message={state.error} />
    <Saved state={state} message="Settings saved." />
    <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
  </form>;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A UK company's VAT: quarterly on its stagger, monthly, or annual accounting; cash accounting; the flat rate. */
export function VatSchemeForm({ values }: { values: { vat_period: string; vat_quarter_end_month: number; vat_year_end_month: number | null; vat_annual_payments: string | null; vat_cash_accounting: boolean; vat_flat_rate: number | null } }) {
  const [state, action] = useActionState(saveVatScheme, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const [period, setPeriod] = useState(values.vat_period);
  const [flat, setFlat] = useState(values.vat_flat_rate === null ? "" : String(values.vat_flat_rate));
  return <form action={action} onReset={keep} className="space-y-4" noValidate>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="VAT returns" htmlFor={`${uid}-period`} error={errors.vat_period}>
        <NativeSelect id={`${uid}-period`} name="vat_period" value={period} onChange={event => setPeriod(event.target.value)}>
          <option value="quarterly">Every quarter</option><option value="monthly">Every month</option><option value="annual">Once a year (annual accounting)</option>
        </NativeSelect>
      </Field>
      {period === "annual" ? <>
        <Field label="VAT year ends in" htmlFor={`${uid}-year`} error={errors.vat_year_end_month}>
          <NativeSelect id={`${uid}-year`} name="vat_year_end_month" defaultValue={String(values.vat_year_end_month ?? 3)}>{MONTH_NAMES.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</NativeSelect>
        </Field>
        <Field label="Payments on account" htmlFor={`${uid}-payments`} error={errors.vat_annual_payments} className="sm:col-span-2">
          <NativeSelect id={`${uid}-payments`} name="vat_annual_payments" defaultValue={values.vat_annual_payments ?? "monthly"}>
            <option value="monthly">Nine of 10%, at the end of months 4 to 12</option><option value="quarterly">Three of 25%, at the end of months 4, 7 and 10</option>
          </NativeSelect>
        </Field>
      </> : null}
      <Field label="Quarters end in" htmlFor={`${uid}-stagger`} error={errors.vat_quarter_end_month} className={period === "quarterly" ? "" : "hidden"}>
        <NativeSelect id={`${uid}-stagger`} name="vat_quarter_end_month" defaultValue={String(values.vat_quarter_end_month)}>
          <option value="1">January, April, July, October</option><option value="2">February, May, August, November</option><option value="3">March, June, September, December</option>
        </NativeSelect>
      </Field>
      <Field label="Flat Rate Scheme" htmlFor={`${uid}-flat`} hint="the percentage, if on it" error={errors.vat_flat_rate}>
        <TextInput id={`${uid}-flat`} name="vat_flat_rate" inputMode="decimal" value={flat} onChange={event => setFlat(event.target.value)} placeholder="Not on the scheme" />
      </Field>
    </div>
    <Checkbox name="vat_cash_accounting" defaultChecked={values.vat_cash_accounting}
      label={flat ? "Work out the flat-rate turnover on payments received (the scheme’s cash-based method)" : "Cash accounting: VAT when customers pay and suppliers are paid"} />
    <p className="text-ink-muted text-[12.5px] leading-relaxed">The Flat Rate Scheme can’t be combined with the Cash Accounting Scheme, but has its own cash-based turnover; either can be combined with annual accounting. A return and its payment are due 1 month and 7 days after each period, or 2 months after an annual one.</p>
    <FormError message={state.error} />
    <Saved state={state} message="VAT settings saved." />
    <SubmitButton pendingLabel="Saving…">Save VAT settings</SubmitButton>
  </form>;
}
