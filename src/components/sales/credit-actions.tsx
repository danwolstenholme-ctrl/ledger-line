"use client";

import { useActionState, useState } from "react";
import { Ban, Check, RotateCcw, Send, Undo2 } from "lucide-react";

import { allocateCredit, issueCreditNote, refundCredit, setCreditNoteVoid } from "@/lib/actions/sales";
import { idleState } from "@/lib/actions/state";
import { formatAmount, formatDate } from "@/lib/format";
import { Field, FormError, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import { useCurrency } from "@/components/common/regime";

/** Issue a draft credit note. */
export function IssueCreditNoteButton({ id }: { id: string }) {
  const [state, action] = useActionState(issueCreditNote, idleState);
  return <form action={action} className="inline-flex flex-col gap-1"><input type="hidden" name="id" value={id} />
    <SubmitButton size="sm" pendingLabel="Issuing…"><Send className="size-3.5" />Issue</SubmitButton>
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : null}
  </form>;
}

/** Void an issued credit note (it comes off its invoices), or restore a void one. */
export function CreditNoteVoidButton({ id, isVoid }: { id: string; isVoid: boolean }) {
  const [state, action] = useActionState(setCreditNoteVoid, idleState);
  const [armed, setArmed] = useState(false);
  if (!isVoid && !armed) return <button type="button" onClick={() => setArmed(true)} className="text-ink-muted hover:text-critical inline-flex items-center gap-1.5 text-[13px]"><Ban className="size-3.5" />Void this credit note</button>;
  return <form action={action} className="inline-flex flex-col gap-1">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="void" value={isVoid ? "false" : "true"} />
    {isVoid ? <SubmitButton size="sm" variant="outline" pendingLabel="Restoring…"><RotateCcw className="size-3.5" />Restore</SubmitButton>
      : <span className="flex flex-wrap items-center gap-2 text-[13px]">Void it? The invoices it was set against will be owed again.
        <SubmitButton size="sm" variant="outline" pendingLabel="Voiding…">Yes, void it</SubmitButton>
        <button type="button" onClick={() => setArmed(false)} className="text-ink-muted text-[12.5px]">Keep it</button></span>}
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : null}
  </form>;
}

/** Set credit against another of the customer's open invoices. */
export function AllocateCreditForm({ creditNoteId, remaining, invoices }: { creditNoteId: string; remaining: number; invoices: { id: string; number: string; balance: number; due_on: string | null }[] }) {
  const currency = useCurrency();
  const [state, action] = useActionState(allocateCredit, idleState);
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? "");
  const invoice = invoices.find(item => item.id === invoiceId);
  const errors = state.fieldErrors ?? {};
  if (!invoices.length) return <p className="text-ink-muted text-[12.5px]">No open invoices to set it against.</p>;
  return <form action={action} className="space-y-3" key={`${remaining}-${invoices.length}`}>
    <input type="hidden" name="credit_note_id" value={creditNoteId} />
    <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
      <Field label="Invoice" error={errors.invoice_id}>
        <NativeSelect name="invoice_id" value={invoiceId} onChange={event => setInvoiceId(event.target.value)}>
          {invoices.map(item => <option key={item.id} value={item.id}>{item.number} · {formatAmount(item.balance, currency)} owed{item.due_on ? ` · due ${formatDate(item.due_on)}` : ""}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Amount" error={errors.amount}>
        <TextInput name="amount" inputMode="decimal" key={invoiceId} defaultValue={Math.min(remaining, invoice?.balance ?? remaining).toFixed(2)} className="text-right tabular-nums" />
      </Field>
    </div>
    <FormError message={state.error} />
    <SubmitButton size="sm" pendingLabel="Setting it against the invoice…"><Check className="size-3.5" />Use the credit</SubmitButton>
  </form>;
}

/** Pay the credit back to the customer from a bank account. */
export function RefundCreditForm({ creditNoteId, remaining, banks, defaultBank, today }: { creditNoteId: string; remaining: number; banks: { id: string; name: string }[]; defaultBank: string | null; today: string }) {
  const [state, action] = useActionState(refundCredit, idleState);
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-3" key={String(remaining)}>
    <input type="hidden" name="credit_note_id" value={creditNoteId} />
    <div className="grid grid-cols-2 gap-3">
      <Field label="Amount" error={errors.amount}><TextInput name="amount" inputMode="decimal" defaultValue={remaining.toFixed(2)} className="text-right tabular-nums" /></Field>
      <Field label="Refunded on" error={errors.refunded_on}><TextInput name="refunded_on" type="date" defaultValue={today} max={today} /></Field>
      <Field label="From" error={errors.bank_account_id}><NativeSelect name="bank_account_id" defaultValue={defaultBank ?? banks[0]?.id ?? ""}>{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</NativeSelect></Field>
      <Field label="Reference" hint="optional"><TextInput name="reference" maxLength={120} /></Field>
    </div>
    <FormError message={state.error} />
    <SubmitButton size="sm" variant="outline" pendingLabel="Recording the refund…"><Undo2 className="size-3.5" />Record the refund</SubmitButton>
  </form>;
}
