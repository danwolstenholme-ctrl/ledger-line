"use client";

import { useActionState, useId, useState } from "react";

import { saveSupplierCredit } from "@/lib/actions/purchases";
import { idleState } from "@/lib/actions/state";
import type { PickerAccount } from "@/lib/domain/accounts";
import { formatAmount } from "@/lib/format";
import { Field, FormError, NativeSelect, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";
import { LineEditor, type LineValue } from "@/components/accounts/line-editor";
import { ReverseChargeField } from "@/components/accounts/forms";
import Link from "@/components/navigation/navigation-link";
import { useCurrency } from "@/components/common/regime";

export type SupplierCreditBill = { id: string; number: string | null; supplier_id: string; supplier_name: string; total: number; balance: number; credited_before: number; reverse_charge: boolean; lines: LineValue[] };
export type SupplierCreditValues = { id: string; supplier_id: string; bill_id: string | null; number: string | null; issued_on: string; reverse_charge: boolean; notes: string | null; lines: LineValue[] };

/**
 * A supplier's credit note, entered as they printed it. From a bill, it starts
 * with the bill's lines and supplier, and can never take back more than the
 * bill charged; recorded, it comes off what is still owed on the bill.
 */
export function SupplierCreditForm({ bill, credit, suppliers, accounts, today, cancelHref }: {
  bill: SupplierCreditBill | null; credit?: SupplierCreditValues; suppliers: { id: string; name: string; default_account_id: string | null; reverse_charge: boolean }[];
  accounts: PickerAccount[]; today: string; cancelHref: string;
}) {
  const currency = useCurrency();
  const [state, action] = useActionState(saveSupplierCredit, idleState);
  const uid = useId();
  const [supplier, setSupplier] = useState(credit?.supplier_id ?? bill?.supplier_id ?? "");
  const [reverseCharge, setReverseCharge] = useState(credit?.reverse_charge ?? bill?.reverse_charge ?? suppliers.find(item => item.id === supplier)?.reverse_charge ?? false);
  const errors = state.fieldErrors ?? {};
  const left = bill ? Math.max(0, bill.total - bill.credited_before) : null;
  return <form action={action} className="space-y-5" noValidate>
    {credit ? <input type="hidden" name="id" value={credit.id} /> : null}
    {bill ? <input type="hidden" name="bill_id" value={bill.id} /> : null}
    {bill ? <p className="border-hairline bg-surface-sunken text-ink-muted rounded-md border px-3 py-2 text-[12px]">
      Corrects bill <span className="text-ink font-mono font-medium">{bill.number ?? "without a number"}</span> from {bill.supplier_name} ({formatAmount(bill.total, currency)}). Up to {formatAmount(left!, currency)} can be credited.
      {bill.balance > 0 ? ` It comes off the ${formatAmount(bill.balance, currency)} still to pay; anything more is kept as credit to use or to have refunded.` : " The bill is paid, so the credit is kept to use against their next bill, or to be refunded."}
    </p> : null}
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Supplier" htmlFor={`${uid}-supplier`} required error={errors.supplier_id}>
        <NativeSelect id={`${uid}-supplier`} name={bill ? undefined : "supplier_id"} value={supplier} disabled={Boolean(bill)} onChange={event => { setSupplier(event.target.value); setReverseCharge(suppliers.find(item => item.id === event.target.value)?.reverse_charge ?? false); }}>
          <option value="">Choose the supplier</option>
          {suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </NativeSelect>
        {bill ? <input type="hidden" name="supplier_id" value={supplier} /> : null}
      </Field>
      <Field label="Their credit note number" htmlFor={`${uid}-number`} hint="as printed" error={errors.number}>
        <TextInput id={`${uid}-number`} name="number" defaultValue={credit?.number ?? ""} maxLength={60} className="font-mono" autoComplete="off" />
      </Field>
      <Field label="Date" htmlFor={`${uid}-issued`} required error={errors.issued_on}>
        <TextInput id={`${uid}-issued`} name="issued_on" type="date" defaultValue={credit?.issued_on ?? today} />
      </Field>
    </div>
    <div className="space-y-1.5">
      <p className="text-ink text-[12.5px] font-medium">What is credited</p>
      <p className="text-ink-faint text-[11.5px]">{bill ? "The bill's lines, to start with. Remove what is not credited, or lower an amount: the VAT follows." : "Each line takes its cost back off its account, and its VAT off the VAT reclaimed."}</p>
      <LineEditor key={supplier} accounts={accounts} initial={credit?.lines ?? bill?.lines} defaultAccount={suppliers.find(item => item.id === supplier)?.default_account_id ?? ""} error={errors.lines} reverseCharge={reverseCharge} />
    </div>
    <ReverseChargeField checked={reverseCharge} onChange={setReverseCharge} what="a supplier" />
    <Field label="Notes" htmlFor={`${uid}-notes`} hint="internal">
      <TextArea id={`${uid}-notes`} name="notes" rows={2} defaultValue={credit?.notes ?? ""} maxLength={2000} placeholder="e.g. Two cases returned damaged." />
    </Field>
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Recording…">{credit ? "Save changes" : "Record the credit note"}</SubmitButton>
      <Link href={cancelHref} className="text-ink-muted hover:text-ink text-[12.5px]">Cancel</Link>
    </div>
    <p className="text-ink-faint text-[11.5px]">Recording it posts the reverse of a bill: the cost and the VAT reclaimed fall, and less is owed to the supplier. It comes off the VAT return for the period of its date.</p>
  </form>;
}
