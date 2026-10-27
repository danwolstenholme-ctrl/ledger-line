import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileDown, Undo2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { undoPaymentRun } from "@/lib/actions/purchases";
import { getPaymentRun } from "@/lib/data/purchases";
import { formatIban, ibanIn } from "@/lib/domain/iban";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { PageBody, Panel } from "@/components/common/primitives";
import { SubmitButton } from "@/components/common/form-fields";
import { RecordHeader, recordButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Payment run" };

/** Bills paid together: what was paid to whom, and the SEPA file that tells the bank to send it. */
export default async function PaymentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getPaymentRun(id);
  if (!data) notFound();
  const { org, run, payments, total } = data;
  const inFile = payments.filter(payment => payment.iban), outside = payments.filter(payment => !payment.iban);
  const fileTotal = inFile.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0) / 100;
  const companyIban = ibanIn(run.bank_details);
  const matched = payments.some(payment => payment.matched);
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={`Payment run, ${formatDate(run.paid_on)}`} back={{ href: "/accounts/bills", label: "Bills" }}
      description={`${payments.length} bill${payments.length === 1 ? "" : "s"} paid from ${run.bank_name}, ${formatAmount(total)} in all.${run.reference ? ` Reference: ${run.reference}.` : ""}`}
      action={inFile.length && companyIban ? <a href={`/c/${org.slug}/bills/runs/${run.id}/sepa`} className={recordButton}><FileDown className="size-3.5" />Download the SEPA file</a> : null} />
    <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px]">
      <CheckCircle2 className="size-4 shrink-0" /><span><span className="font-medium">In the books as paid.</span> {inFile.length ? `Upload the SEPA file to the company's online banking (${run.bank_name}): it sends ${inFile.length} payment${inFile.length === 1 ? "" : "s"}, ${formatAmount(fileTotal)}, on ${formatDate(run.paid_on)}. When they show on the statement, they match in one press.` : "None of these suppliers has an IBAN, so there is no file: pay them another way."}</span>
    </p>
    {!companyIban ? <p className="border-caution-line bg-caution-soft text-caution flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px]"><AlertTriangle className="size-4" />{run.bank_name} has no valid IBAN in its details, so the bank file cannot be made. Add it in the Chart of accounts.</p> : null}
    <Panel className="overflow-hidden">
      <table className="w-full border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Supplier</th><th scope="col" className={head}>Their invoice</th><th scope="col" className={head}>Paid to</th><th scope="col" className={`${head} text-right`}>Amount</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{payments.map(payment => <tr key={payment.id}>
          <td className="px-3 py-2.5 text-[13px]"><Link href={`/accounts/suppliers/${payment.supplier_id}`} className="text-ink hover:text-brand">{payment.supplier_name}</Link></td>
          <td className="px-3 py-2.5 text-[13px]"><Link href={`/accounts/bills/${payment.bill_id}`} className="text-brand font-mono hover:underline">{payment.number ?? "No number"}</Link></td>
          <td className="px-3 py-2.5 text-[12.5px]">{payment.iban ? <span className="text-ink-muted font-mono">{formatIban(payment.iban)}</span> : <span className="text-caution">No IBAN: not in the file</span>}</td>
          <td className="px-3 py-2.5 text-right text-[13px] font-medium tabular-nums">{formatAmount(payment.amount)}</td>
        </tr>)}</tbody>
        <tfoot className="border-hairline-strong border-t"><tr><td colSpan={3} className="text-ink px-3 py-2.5 text-[13px] font-semibold">Total</td><td className="px-3 py-2.5 text-right text-[13.5px] font-semibold tabular-nums">{formatAmount(total)}</td></tr></tfoot>
      </table>
    </Panel>
    {outside.length ? <p className="text-ink-muted text-[12.5px]">{outside.map(payment => payment.supplier_name).join(", ")}: pay by direct debit, card or a single transfer, and add their IBAN to the supplier to include them next time.</p> : null}
    {!matched ? <form action={undoPaymentRun} className="flex flex-wrap items-center gap-3"><input type="hidden" name="id" value={run.id} />
      <SubmitButton variant="outline" size="sm" pendingLabel="Undoing…"><Undo2 className="size-3.5" />Undo this run</SubmitButton>
      <span className="text-ink-faint text-[12px]">Only while nothing has reached the statement: the payments come off and the bills are owed again.</span>
    </form> : null}
  </PageBody>;
}
