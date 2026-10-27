import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Pencil } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { removeSupplierAllocation, removeSupplierRefund } from "@/lib/actions/purchases";
import { getPostings } from "@/lib/data/accounts";
import { getSupplierCredit } from "@/lib/data/purchases";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { InlineSubmit } from "@/components/common/form-fields";
import { Postings } from "@/components/accounts/postings";
import { RecordBadge, RecordDetail, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { AllocateSupplierCreditForm, SupplierCreditVoidButton, SupplierRefundForm } from "@/components/purchases/supplier-credit-actions";

export const metadata: Metadata = { title: "Supplier credit" };

/** One credit note from a supplier: what it took back, and where the credit went. */
export default async function SupplierCreditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, query] = await Promise.all([getSupplierCredit(id), searchParams]);
  if (!data) notFound();
  const { org, credit, lines, allocations, refunds, openBills, banks, today } = data;
  const postings = await getPostings([id, ...refunds.map(refund => refund.id)]);
  const remaining = Number(credit.remaining), recorded = credit.status === "recorded";
  const vat = credit.reverse_charge ? Number(credit.reverse_charge_vat) : Number(credit.vat_amount);
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title={`${credit.supplier_name}${credit.number ? ` · ${credit.number}` : ""}`} back={{ href: "/accounts/supplier-credits", label: "Supplier credits" }}
      description={`Credit note dated ${formatDate(credit.issued_on)}`}
      action={<>
        {credit.status === "void" ? <RecordBadge>Void</RecordBadge> : remaining > 0 ? <RecordBadge tone="caution">{formatAmount(remaining)} to use</RecordBadge> : <RecordBadge tone="positive">Used</RecordBadge>}
        {recorded && !refunds.length ? <Link href={`/accounts/supplier-credits/${id}/edit`} className={recordOutlineButton}><Pencil className="size-3.5" />Edit</Link> : null}
      </>} />
    {query.recorded && recorded ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]">
      <CheckCircle2 className="size-4 shrink-0" /><span><span className="font-medium">Recorded and in the books.</span> {allocations.length ? `${formatAmount(credit.amount_allocated)} came off what is owed on ${allocations.map(item => item.number ?? "the bill").join(", ")}.` : "The credit is kept for this supplier."}{remaining > 0 ? ` ${formatAmount(remaining)} is left to use or to have refunded.` : ""}</span>
    </p> : null}

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <RecordSection title="Lines" hint={credit.reverse_charge ? "Reverse charge" : undefined}>
          <table className="w-full border-collapse text-[12.5px]">
            <thead><tr className="border-hairline bg-surface-sunken text-ink-faint border-b text-left text-[11px] font-semibold tracking-[0.06em] uppercase">
              <th scope="col" className="px-4 py-2">Description</th><th scope="col" className="px-3 py-2 text-right">Net</th><th scope="col" className="px-3 py-2 text-right">VAT</th>
            </tr></thead>
            <tbody className="divide-hairline divide-y">{lines.map(line => <tr key={line.id}>
              <td className="px-4 py-2">{line.description}<span className="text-ink-faint block text-[11px]">{line.code} · {line.account_name}</span></td>
              <td className="px-3 py-2 text-right tabular-nums">{formatAmount(line.net)}</td>
              <td className="text-ink-muted px-3 py-2 text-right tabular-nums">{formatAmount(line.vat_amount)}<span className="text-ink-faint ml-1 text-[11px]">{Number(line.vat_rate)}%</span></td>
            </tr>)}</tbody>
            <tfoot className="border-hairline-strong border-t">
              <tr><td className="text-ink-muted px-4 pt-2">Net</td><td className="px-3 pt-2 text-right tabular-nums" colSpan={2}>{formatAmount(credit.net)}</td></tr>
              <tr><td className="text-ink-muted px-4">{credit.reverse_charge ? "VAT due and reclaimed, taken back (reverse charge)" : "VAT"}</td><td className="px-3 text-right tabular-nums" colSpan={2}>{formatAmount(vat)}</td></tr>
              <tr><td className="text-ink px-4 pb-2.5 font-semibold">Total credit</td><td className="px-3 pb-2.5 text-right font-semibold tabular-nums" colSpan={2}>{formatAmount(credit.total)}</td></tr>
            </tfoot>
          </table>
        </RecordSection>
        <details className="group">
          <summary className="text-ink-muted hover:text-brand cursor-pointer px-1 text-[12.5px] font-medium">How it posted to the books</summary>
          <div className="mt-2"><Postings entries={postings.entries} empty={credit.status === "void" ? "A void credit note is not in the books." : "Nothing posted."} /></div>
        </details>
      </div>
      <div className="min-w-0 space-y-4">
        {recorded ? <RecordSection title={remaining > 0 ? "Credit to use" : "Credit used"}>
          <div className="px-4 py-3.5">
            <p className="text-ink text-[22px] leading-tight font-semibold tabular-nums">{formatAmount(remaining)}</p>
            <p className="text-ink-muted mt-0.5 text-[12px]">left of {formatAmount(credit.total)}{Number(credit.amount_allocated) ? ` · ${formatAmount(credit.amount_allocated)} against bills` : ""}{Number(credit.amount_refunded) ? ` · ${formatAmount(credit.amount_refunded)} refunded` : ""}</p>
          </div>
          {allocations.length || refunds.length ? <ul aria-label="Where the credit went" className="divide-hairline border-hairline divide-y border-t">
            {allocations.map(item => <li key={item.id} className="flex items-baseline gap-3 px-4 py-2">
              <span className="text-ink-muted w-24 shrink-0 text-[12px] tabular-nums">{formatDate(item.allocated_on)}</span>
              <span className="min-w-0 flex-1 truncate text-[12px]">Against <Link href={`/accounts/bills/${item.bill_id}`} className="text-brand font-mono hover:underline">{item.number ?? "a bill"}</Link></span>
              <span className="text-ink shrink-0 text-[12.5px] font-medium tabular-nums">{formatAmount(item.amount)}</span>
              <form action={removeSupplierAllocation}><input type="hidden" name="id" value={item.id} /><InlineSubmit destructive title="Take the credit off this bill">Remove</InlineSubmit></form>
            </li>)}
            {refunds.map(item => <li key={item.id} className="flex items-baseline gap-3 px-4 py-2">
              <span className="text-ink-muted w-24 shrink-0 text-[12px] tabular-nums">{formatDate(item.txn_date)}</span>
              <span className="text-ink-muted min-w-0 flex-1 truncate text-[12px]">Refunded into {item.bank_name}</span>
              <span className="text-ink shrink-0 text-[12.5px] font-medium tabular-nums">{formatAmount(item.amount)}</span>
              {item.matched ? <span className="text-positive text-[11px]">Reconciled</span>
                : <form action={removeSupplierRefund}><input type="hidden" name="id" value={item.id} /><InlineSubmit destructive title="Remove this refund">Remove</InlineSubmit></form>}
            </li>)}
          </ul> : null}
          {remaining > 0 ? <>
            <div className="border-hairline border-t px-4 py-3.5">
              <p className="text-ink mb-2.5 text-[13px] font-semibold">Use it against a bill</p>
              <AllocateSupplierCreditForm creditId={id} remaining={remaining} bills={openBills.map(item => ({ ...item, balance: Number(item.balance) }))} />
            </div>
            <div className="border-hairline border-t px-4 py-3.5">
              <p className="text-ink mb-2.5 text-[13px] font-semibold">Or record the refund they paid</p>
              <SupplierRefundForm creditId={id} remaining={remaining} banks={banks} defaultBank={org.default_bank_account_id} today={today} />
            </div>
          </> : null}
        </RecordSection> : null}
        <RecordSection title="Details">
          <dl className="divide-hairline divide-y px-4">
            <RecordDetail label="Supplier" value={<Link href={`/accounts/suppliers/${credit.supplier_id}`} className="text-brand hover:underline">{credit.supplier_name}</Link>} />
            <RecordDetail label="Corrects" value={credit.bill_id ? <Link href={`/accounts/bills/${credit.bill_id}`} className="text-brand font-mono hover:underline">{credit.bill_number ?? "Bill"}</Link> : null} />
            <RecordDetail label="VAT" value={org.vat_registered ? credit.reverse_charge ? "Reverse charge: the VAT due and reclaimed both come back off the return" : `${formatAmount(credit.vat_amount)} comes off the VAT reclaimed in the period of ${formatDate(credit.issued_on)}` : "Not registered for VAT: the cost falls by the full amount"} />
            <RecordDetail label="Notes" value={credit.notes} />
          </dl>
          <div className={cn("border-hairline border-t px-4 py-3")}><SupplierCreditVoidButton id={id} isVoid={credit.status === "void"} /></div>
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
