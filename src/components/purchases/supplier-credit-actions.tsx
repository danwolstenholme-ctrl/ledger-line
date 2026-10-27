"use client";

import { useActionState, useState } from "react";
import { Ban, Check, RotateCcw, Undo2 } from "lucide-react";

import { allocateSupplierCredit, recordSupplierRefund, setSupplierCreditVoid } from "@/lib/actions/purchases";
import { idleState } from "@/lib/actions/state";
import { formatAmount, formatDate } from "@/lib/format";
import { Field, FormError, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import { useCurrency } from "@/components/common/regime";

export function SupplierCreditVoidButton({ id, isVoid }: { id: string; isVoid: boolean }) {
  const [state, action] = useActionState(setSupplierCreditVoid, idleState);
  const [armed, setArmed] = useState(false);
  if (!isVoid && !armed) return <button type="button" onClick={() => setArmed(true)} className="text-ink-muted hover:text-critical inline-flex items-center gap-1.5 text-[12.5px]"><Ban className="size-3.5" />Void this credit note</button>;
  return <form action={action} className="inline-flex flex-col gap-1">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="void" value={isVoid ? "false" : "true"} />
    {isVoid ? <SubmitButton size="sm" variant="outline" pendingLabel="Restoring…"><RotateCcw className="size-3.5" />Restore</SubmitButton>
      : <span className="flex flex-wrap items-center gap-2 text-[12.5px]">Void it? The bills it was set against will be owed again.
        <SubmitButton size="sm" variant="outline" pendingLabel="Voiding…">Yes, void it</SubmitButton>
        <button type="button" onClick={() => setArmed(false)} className="text-ink-muted text-[12px]">Keep it</button></span>}
    {state.error ? <span role="alert" className="text-critical text-[11.5px]">{state.error}</span> : null}
  </form>;
}

export function AllocateSupplierCreditForm({ creditId, remaining, bills }: { creditId: string; remaining: number; bills: { id: string; number: string | null; balance: number; due_on: string | null }[] }) {
  const currency = useCurrency();
  const [state, action] = useActionState(allocateSupplierCredit, idleState);
  const [billId, setBillId] = useState(bills[0]?.id ?? "");
  const bill = bills.find(item => item.id === billId);
  const errors = state.fieldErrors ?? {};
  if (!bills.length) return <p className="text-ink-muted text-[12px]">No open bills from this supplier to set it against.</p>;
  return <form action={action} className="space-y-3" key={`${remaining}-${bills.length}`}>
    <input type="hidden" name="supplier_credit_id" value={creditId} />
    <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
      <Field label="Bill" error={errors.bill_id}>
        <NativeSelect name="bill_id" value={billId} onChange={event => setBillId(event.target.value)}>
          {bills.map(item => <option key={item.id} value={item.id}>{item.number ?? "No number"} · {formatAmount(item.balance, currency)} to pay{item.due_on ? ` · due ${formatDate(item.due_on)}` : ""}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Amount" error={errors.amount}><TextInput name="amount" inputMode="decimal" key={billId} defaultValue={Math.min(remaining, bill?.balance ?? remaining).toFixed(2)} className="text-right tabular-nums" /></Field>
    </div>
    <FormError message={state.error} />
    <SubmitButton size="sm" pendingLabel="Setting it against the bill…"><Check className="size-3.5" />Use the credit</SubmitButton>
  </form>;
}

export function SupplierRefundForm({ creditId, remaining, banks, defaultBank, today }: { creditId: string; remaining: number; banks: { id: string; name: string }[]; defaultBank: string | null; today: string }) {
  const [state, action] = useActionState(recordSupplierRefund, idleState);
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-3" key={String(remaining)}>
    <input type="hidden" name="supplier_credit_id" value={creditId} />
    <div className="grid grid-cols-3 gap-3">
      <Field label="Amount" error={errors.amount}><TextInput name="amount" inputMode="decimal" defaultValue={remaining.toFixed(2)} className="text-right tabular-nums" /></Field>
      <Field label="Received on" error={errors.received_on}><TextInput name="received_on" type="date" defaultValue={today} max={today} /></Field>
      <Field label="Into" error={errors.bank_account_id}><NativeSelect name="bank_account_id" defaultValue={defaultBank ?? banks[0]?.id ?? ""}>{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</NativeSelect></Field>
    </div>
    <FormError message={state.error} />
    <SubmitButton size="sm" variant="outline" pendingLabel="Recording the refund…"><Undo2 className="size-3.5" />Record the refund received</SubmitButton>
  </form>;
}
