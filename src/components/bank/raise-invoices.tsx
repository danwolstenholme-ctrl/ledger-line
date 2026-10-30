"use client";

import { useActionState, useId, useState, type KeyboardEvent } from "react";
import Link from "@/components/navigation/navigation-link";

import { raiseInvoicesFromPayments } from "@/lib/actions/bank-invoicing";
import { idleState } from "@/lib/actions/state";
import { nameKey, namedAsCompany, splitGross } from "@/lib/domain/bank-invoicing";
import { treatmentFor } from "@/lib/domain/regimes";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormError, SubmitButton } from "@/components/common/form-fields";

export type PaymentToInvoice = {
  id: string; txn_date: string; amount: number; bankText: string; reference: string | null; counterparty: string | null;
  payer: string; customerId: string | null;
  /** What the invoice would say it was for: empty when the bank's words don't say. */
  description: string;
  /** Why it can't be invoiced: it is before the books begin, or on or before the lock date. */
  locked: string | null;
  /** Why it may not be a new sale, and what to do with it on the reconcile page instead; opening: it may pay an invoice from before the books began. */
  note: { text: string; action: string | null; opening?: boolean } | null;
  /** The VAT it starts at: what the customer was charged last, or the company's usual rate. */
  rate: number; special: Special;
  /** The payment on the reconcile page. */
  href: string;
  /** Ticked to start with. */
  ticked: boolean;
};
// The VAT on a row, for a customer the form would charge at the standard rate: a rate; or none, as an exempt supply (rent of a
// home, say) or one outside the scope (a service to a customer abroad, not kept yet).
type Special = "exempt" | "outside_scope" | null;
type Row = { on: boolean; customer: string; description: string; rate: number; special: Special };
// A customer by name and kind, as the server finds them: John Smith isn't John Smith Ltd.
const kindKey = (name: string) => `${nameKey(name)}|${namedAsCompany(name) ? "company" : "person"}`;

const input = "border-hairline-strong bg-surface h-8 w-full min-w-0 rounded-md border px-2 text-[13px] touch:h-11 touch:text-[16px]";
// Where the invoice form would charge no VAT for the customer, what the row says instead of a rate.
const NO_RATE = { reverse_charge: "Reverse charge", outside_scope: "Outside the scope", exempt: "Exempt" } as const;

/**
 * Payments in, each to become an invoice for its amount: to the customer of
 * that name (one already kept, or new), for what it says, with the VAT the
 * invoice form would start from for that customer. A payment from a customer
 * already kept starts ticked; one from a new payer is ticked by hand, or with
 * the rest; one with a note (it may pay an invoice already raised, it may not
 * be a sale) only by hand; one before the books begin or the lock date not at
 * all. Enter never raises them: only the button does.
 */
export function RaiseInvoices({ bankAccountId, payments, customers, rates, registered, currency, country, latestRaised, opening }: {
  bankAccountId: string; payments: PaymentToInvoice[]; customers: { id: string; name: string; eu_business: boolean; country: string }[];
  rates: number[]; registered: boolean; currency: string; country: string;
  /** What customers owed when the books began, when they owed anything: payments in the months after may pay it. */
  opening: { date: string; owed: number } | null;
  /** By year, the latest date of an invoice raised this way already: one dated before it is numbered after it. */
  latestRaised: Record<string, string>;
}) {
  const uid = useId();
  const [state, action] = useActionState(raiseInvoicesFromPayments, idleState);
  const eligible = (payment: PaymentToInvoice) => !payment.note && !payment.locked;
  const initial = (payment: PaymentToInvoice): Row => ({ on: payment.ticked, customer: payment.payer, description: payment.description, rate: payment.rate, special: payment.special });
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(payments.map(payment => [payment.id, initial(payment)])));
  // After some are raised and one isn't, the list comes back with payments this page hasn't seen: they start as new.
  const rowOf = (payment: PaymentToInvoice) => rows[payment.id] ?? initial(payment);
  const [allDescription, setAllDescription] = useState("");
  const [allRate, setAllRate] = useState("");
  const known = new Map(customers.map(customer => [kindKey(customer.name), customer]));
  const set = (payment: PaymentToInvoice, patch: Partial<Row>) => setRows(current => ({ ...current, [payment.id]: { ...(current[payment.id] ?? initial(payment)), ...patch } }));
  const forTicked = (patch: Partial<Row>) => setRows(current => ({ ...current, ...Object.fromEntries(payments.filter(payment => rowOf(payment).on).map(payment => [payment.id, { ...rowOf(payment), ...patch }])) }));
  const ticked = payments.filter(payment => rowOf(payment).on);
  const total = ticked.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0) / 100;
  const items = ticked.map(payment => {
    const row = rowOf(payment), customer = known.get(kindKey(row.customer));
    return { line_id: payment.id, customer_id: customer?.id ?? null, customer_name: row.customer.trim(), description: row.description.trim(), vat_rate: row.rate, special: row.special };
  });
  const incomplete = items.some(item => !item.customer_name || !item.description);
  const newCustomers = new Set(items.filter(item => !item.customer_id).map(item => nameKey(item.customer_name))).size;
  const free = payments.filter(eligible);
  const anyLeft = free.some(payment => !rowOf(payment).on);
  const money = (value: number) => formatAmount(value, currency);
  // A series' numbers follow the order invoices are raised in: one dated before the year's latest raised this way comes after it.
  const backdated = ticked.filter(payment => latestRaised[payment.txn_date.slice(0, 4)] > payment.txn_date);
  const vatChoice = (row: Row) => row.special ?? String(row.rate);
  const fromChoice = (value: string): Partial<Row> => value === "exempt" || value === "outside_scope" ? { special: value } : { special: null, rate: Number(value) };
  // Payments in the months after the books began, with customers owing then: ticked only by one who has read why.
  const early = payments.filter(payment => payment.note?.opening && !payment.locked);
  const earlyLeft = early.filter(payment => !rowOf(payment).on);
  const applyForAll = () => { if (allDescription.trim()) forTicked({ description: allDescription.trim() }); };
  // Enter in a text box would send the form, raising every ticked invoice: it does nothing here, or applies the text for all.
  const keepEnter = (event: KeyboardEvent<HTMLFormElement>) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); };

  return <form action={action} onKeyDown={keepEnter} className="space-y-4">
    <input type="hidden" name="bank_account_id" value={bankAccountId} />
    <input type="hidden" name="items" value={JSON.stringify(items)} />
    <datalist id={`${uid}-customers`}>{customers.map(customer => <option key={customer.id} value={customer.name} />)}</datalist>

    <div className="ll-panel flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-3">
      <label className="text-ink-muted min-w-56 flex-1 space-y-1 text-[12px]">
        <span className="block">What every ticked one was for</span>
        <span className="flex gap-2">
          <input className={input} value={allDescription} onChange={event => setAllDescription(event.target.value)} placeholder="e.g. Consulting services" maxLength={300}
            onKeyDown={event => { if (event.key === "Enter") applyForAll(); }} />
          <button type="button" className="border-hairline-strong text-ink hover:bg-muted h-8 shrink-0 rounded-md border px-3 text-[13px] font-medium touch:h-11" disabled={!allDescription.trim()} onClick={applyForAll}>Use for all</button>
        </span>
      </label>
      {registered ? <label className="text-ink-muted space-y-1 text-[12px]">
        <span className="block">VAT in every ticked one</span>
        <span className="flex gap-2">
          <select className={cn(input, "w-24")} value={allRate} onChange={event => setAllRate(event.target.value)}>
            <option value="">Choose…</option>{rates.map(rate => <option key={rate} value={rate}>{rate}%</option>)}<option value="exempt">Exempt</option><option value="outside_scope">Outside the scope</option>
          </select>
          <button type="button" className="border-hairline-strong text-ink hover:bg-muted h-8 shrink-0 rounded-md border px-3 text-[13px] font-medium touch:h-11" disabled={allRate === ""}
            onClick={() => forTicked(fromChoice(allRate))}>Apply</button>
        </span>
      </label> : null}
      {/* Ticks the payments with no note; one with a note is ticked on its own row, and stays ticked if it is. */}
      {free.length ? <button type="button" className="text-brand h-8 text-[13px] font-medium hover:underline touch:h-11"
        onClick={() => setRows(current => ({ ...current, ...Object.fromEntries(payments.map(payment => [payment.id, { ...rowOf(payment), on: anyLeft && (eligible(payment) || rowOf(payment).on) }])) }))}>
        {anyLeft ? free.length < payments.length ? `Tick the ${free.length} with no note` : "Tick them all" : "Untick them all"}
      </button> : null}
    </div>

    {opening && early.length ? <div className="border-caution-line bg-caution-soft text-ink flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 text-[13px]">
      <span>The books began on {formatDate(opening.date)} with customers owing {money(opening.owed)}. The {early.length} payment{early.length === 1 ? "" : "s"} from the months after may pay those invoices, which aren&rsquo;t new sales: tick only the ones that are.</span>
      {earlyLeft.length ? <button type="button" className="text-brand font-medium hover:underline" onClick={() => setRows(current => ({ ...current, ...Object.fromEntries(earlyLeft.map(payment => [payment.id, { ...rowOf(payment), on: true }])) }))}>
        Tick {earlyLeft.length === early.length ? `these ${early.length}` : `the other ${earlyLeft.length}`} too
      </button> : null}
    </div> : null}

    <div className="ll-panel overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-[13px]">
        <thead><tr className="border-hairline bg-surface-sunken text-ink-faint border-b text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase">
          <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Invoice it</span></th>
          <th scope="col" className="px-3 py-2">Received</th><th scope="col" className="px-3 py-2">Customer</th>
          <th scope="col" className="px-3 py-2">For</th>{registered ? <th scope="col" className="w-28 px-3 py-2">VAT</th> : null}
          <th scope="col" className="px-3 py-2 text-right">Amount</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{payments.map(payment => {
          const row = rowOf(payment), existing = known.get(kindKey(row.customer)), at = `${uid}-${payment.id}`;
          const what = `${money(payment.amount)} received ${formatDate(payment.txn_date)}`;
          // The treatment the invoice form would start from: a new customer is one in the company's own country.
          const treatment = treatmentFor(existing ?? { country, eu_business: false }, registered, country);
          const { net, vat } = splitGross(payment.amount, treatment === "standard" && !row.special ? row.rate : 0);
          const bank = [payment.bankText, payment.reference && payment.reference !== payment.bankText ? payment.reference : null, payment.counterparty && !payment.bankText.includes(payment.counterparty) ? payment.counterparty : null].filter(Boolean).join(" · ");
          return <tr key={payment.id} className={cn("align-top", !row.on && "bg-surface-sunken/60")}>
            <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Invoice ${what}`} aria-describedby={`${at}-bank${payment.note ? ` ${at}-note` : ""}${payment.locked ? ` ${at}-locked` : ""}`} checked={row.on} disabled={Boolean(payment.locked)}
              onChange={event => set(payment, { on: event.target.checked })} className="accent-brand size-4" /></td>
            <td className="px-3 py-2.5">
              <p className="text-ink tabular-nums">{formatDate(payment.txn_date)}</p>
              <p id={`${at}-bank`} className="text-ink-faint max-w-[38ch] text-[12px] break-words">{bank}</p>
              {payment.note ? <p id={`${at}-note`} className="text-caution mt-1 max-w-[38ch] text-[12px]">{payment.note.text}{payment.note.action ? <> <Link href={payment.href} target="_blank" rel="noopener" className="underline">{payment.note.action} on the reconcile page</Link></> : null}</p> : null}
              {payment.locked ? <p id={`${at}-locked`} className="text-ink-faint mt-1 max-w-[38ch] text-[12px]">{payment.locked}</p> : null}
            </td>
            <td className="px-3 py-2.5">
              <input className={input} list={`${uid}-customers`} value={row.customer} maxLength={200} aria-label={`Customer for ${what}`} aria-describedby={`${at}-customer`} disabled={!row.on}
                onChange={event => set(payment, { customer: event.target.value })} />
              <p id={`${at}-customer`} className={cn("mt-1 text-[11.5px]", existing ? "text-positive" : "text-ink-faint")}>{row.customer.trim() ? existing ? "A customer already kept" : "A new customer" : "Name the customer"}</p>
            </td>
            <td className="px-3 py-2.5"><input className={cn(input, row.on && !row.description.trim() && "border-critical")} value={row.description} maxLength={300} aria-label={`What ${what} was for`}
              aria-invalid={row.on && !row.description.trim()} placeholder={row.on ? "Say what was sold" : undefined} disabled={!row.on} onChange={event => set(payment, { description: event.target.value })} /></td>
            {registered ? <td className="px-3 py-2.5">
              {treatment !== "standard" ? <p className="text-ink-muted pt-1.5 text-[12.5px]">{NO_RATE[treatment]}</p> : <select className={input} value={vatChoice(row)} aria-label={`VAT on ${what}`} disabled={!row.on} onChange={event => set(payment, fromChoice(event.target.value))}>
                {rates.map(rate => <option key={rate} value={rate}>{rate}%</option>)}<option value="exempt">Exempt</option><option value="outside_scope">Outside the scope</option>
              </select>}
            </td> : null}
            <td className="px-3 py-2.5 text-right">
              <p className="text-positive font-medium tabular-nums">{money(payment.amount)}</p>
              {registered && vat ? <p className="text-ink-faint text-[11.5px] whitespace-nowrap tabular-nums">{money(net)} + VAT {money(vat)}</p> : null}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>

    <FormError message={state.error} />
    <div className="flex flex-wrap items-center gap-3">
      <SubmitButton pendingLabel="Raising…" disabled={!items.length || incomplete}>
        {items.length ? `Raise ${items.length} invoice${items.length === 1 ? "" : "s"} · ${money(total)}${newCustomers ? ` · ${newCustomers} new customer${newCustomers === 1 ? "" : "s"}` : ""}` : "Raise invoices"}
      </SubmitButton>
      <Link href={`/accounts/bank/${bankAccountId}`} className="text-ink-muted hover:text-ink text-[13px] touch:inline-flex touch:min-h-11 touch:items-center">Back to reconciling</Link>
      {incomplete ? <p className="text-critical text-[12.5px]">Each ticked payment needs a customer and what was sold.</p> : null}
      {backdated.length ? <p className="text-caution text-[12.5px]">{backdated.length} {backdated.length === 1 ? "is" : "are"} dated before invoices already raised this way that year, so {backdated.length === 1 ? "its number comes" : "their numbers come"} after theirs.</p> : null}
    </div>
    <p className="text-ink-faint text-[12px]">
      Each is numbered in a series of its own, dated the day the money arrived, noted as recorded from it, and matched to it, so it shows as paid.
      To undo one, open the invoice and press Undo.
    </p>
  </form>;
}
