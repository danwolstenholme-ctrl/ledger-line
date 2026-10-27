"use client";

import { useActionState, useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { payBills } from "@/lib/actions/purchases";
import { idleState } from "@/lib/actions/state";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, FormError, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import { recordButton } from "@/components/records/record-layout";
import { useCurrency } from "@/components/common/regime";

export type BillsTableRow = { id: string; supplier_name: string; number: string | null; issued_on: string; due_on: string | null; days_overdue: number; total: number; balance: number; status: string; status_label: string; has_iban: boolean };

const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase";
const cell = "px-3 py-2 text-[12.5px] whitespace-nowrap";

/**
 * The bills list. Where bills are still to pay, they can be ticked and paid
 * together: one payment each, from one account on one day, and a SEPA file
 * to upload to the bank.
 */
export function BillsTable({ rows, selectable, banks, defaultBank, today }: { rows: BillsTableRow[]; selectable: boolean; banks: { id: string; name: string }[]; defaultBank: string | null; today: string }) {
  const currency = useCurrency();
  const [state, action] = useActionState(payBills, idleState);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const payable = rows.filter(row => row.balance > 0 && (row.status === "awaiting_payment" || row.status === "part_paid"));
  const chosen = useMemo(() => payable.filter(row => selected.has(row.id)), [payable, selected]);
  const total = chosen.reduce((sum, row) => sum + Math.round(row.balance * 100), 0) / 100;
  const withoutIban = chosen.filter(row => !row.has_iban).length;
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const all = payable.length > 0 && payable.every(row => selected.has(row.id));
  return <>
    {selectable && chosen.length ? <div className="border-hairline bg-brand-50 space-y-3 border-b px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink text-[12.5px]"><span className="font-semibold">{chosen.length} bill{chosen.length === 1 ? "" : "s"} chosen · {formatAmount(total, currency)}</span>
          {withoutIban ? <span className="text-ink-muted"> · {withoutIban} without an IBAN, to pay another way</span> : null}</p>
        {!paying ? <button type="button" onClick={() => setPaying(true)} className={recordButton}><Landmark className="size-3.5" />Pay {chosen.length === 1 ? "it" : "them"}</button> : null}
      </div>
      {paying ? <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="bill_ids" value={JSON.stringify(chosen.map(row => row.id))} />
        <Field label="From"><NativeSelect name="bank_account_id" defaultValue={defaultBank ?? banks[0]?.id}>{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</NativeSelect></Field>
        <Field label="On"><TextInput name="paid_on" type="date" defaultValue={today} /></Field>
        <Field label="Reference" hint="optional"><TextInput name="reference" maxLength={120} placeholder={`Payment run ${formatDate(today)}`} /></Field>
        <SubmitButton pendingLabel="Recording the payments…">Pay {chosen.length} bill{chosen.length === 1 ? "" : "s"}, {formatAmount(total, currency)}</SubmitButton>
        <button type="button" onClick={() => setPaying(false)} className="text-ink-muted hover:text-ink pb-2 text-[12.5px]">Cancel</button>
        <FormError message={state.error} />
        <p className="text-ink-faint w-full text-[11.5px]">Each bill is paid in full and posts as paid. Next you get a SEPA file to upload to the bank, which sends the money.</p>
      </form> : null}
    </div> : null}
    <div className="w-full overflow-x-auto"><table className="w-full border-collapse">
      <thead><tr className="border-hairline bg-surface-sunken border-b">
        {selectable ? <th scope="col" className="w-8 px-3 py-2"><input type="checkbox" aria-label="Choose every bill to pay" checked={all} onChange={() => setSelected(all ? new Set() : new Set(payable.map(row => row.id)))} className="accent-brand size-3.5" /></th> : null}
        <th scope="col" className={head}>Supplier</th>
        <th scope="col" className={cn(head, "hidden sm:table-cell")}>Number</th>
        <th scope="col" className={cn(head, "hidden md:table-cell")}>Date</th>
        <th scope="col" className={head}>Due</th>
        <th scope="col" className={cn(head, "hidden lg:table-cell text-right")}>Total</th>
        <th scope="col" className={cn(head, "text-right")}>To pay</th>
        <th scope="col" className={cn(head, "hidden sm:table-cell text-right")}>Status</th>
      </tr></thead>
      <tbody className="divide-hairline divide-y">{rows.map(row => {
        const late = row.days_overdue > 0, canPay = payable.includes(row);
        return <tr key={row.id} className={cn("hover:bg-surface-sunken", selected.has(row.id) && "bg-brand-50/60")}>
          {selectable ? <td className="px-3 py-2">{canPay ? <input type="checkbox" aria-label={`Pay ${row.supplier_name} ${row.number ?? ""}`.trim()} checked={selected.has(row.id)} onChange={() => toggle(row.id)} className="accent-brand size-3.5" /> : null}</td> : null}
          <td className={cn(cell, "max-w-[28ch] truncate")}><Link href={`/accounts/bills/${row.id}`} className="text-ink hover:text-brand font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{row.supplier_name}</Link></td>
          <td className={cn(cell, "text-ink-muted hidden font-mono text-[12px] sm:table-cell")}>{row.number ?? "—"}</td>
          <td className={cn(cell, "text-ink-muted hidden tabular-nums md:table-cell")}>{formatDate(row.issued_on)}</td>
          <td className={cn(cell, "tabular-nums", late ? "text-critical font-medium" : "text-ink-muted")}>{row.due_on ? `${formatDate(row.due_on)}${late ? ` · ${row.days_overdue}d` : ""}` : "—"}</td>
          <td className={cn(cell, "text-ink-muted hidden text-right tabular-nums lg:table-cell")}>{formatAmount(row.total, currency)}</td>
          <td className={cn(cell, "text-right font-medium tabular-nums", row.status === "void" ? "text-ink-faint" : "text-ink")}>{row.status === "void" ? "—" : formatAmount(row.balance, currency)}</td>
          <td className={cn(cell, "hidden text-right text-[12px] sm:table-cell", row.status === "paid" ? "text-positive" : row.status === "void" ? "text-ink-faint" : "text-ink-muted")}>{row.status_label}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </>;
}
