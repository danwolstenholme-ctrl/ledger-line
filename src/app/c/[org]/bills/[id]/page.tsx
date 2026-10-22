import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";
import { Pencil } from "lucide-react";

import { removeBillPayment } from "@/lib/actions/accounts";
import { requireOrg } from "@/lib/org";
import { getAccountingSettings, getBankAccounts, getBill, getLedgerAccounts, getPostings } from "@/lib/data/accounts";
import { getBillCredits } from "@/lib/data/purchases";
import { BILL_STATUS_LABELS } from "@/lib/domain/accounts";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { MoreMenu } from "@/components/common/more-menu";
import { InlineSubmit } from "@/components/common/form-fields";
import { BillPaymentForm, VoidBillForm } from "@/components/accounts/forms";
import { Postings } from "@/components/accounts/postings";
import { RecordBadge, RecordDetail, RecordDisclosure, RecordFailure, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrg();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [result, accounts, banks, settings, credits] = await Promise.all([getBill(id), getLedgerAccounts(), getBankAccounts(), getAccountingSettings(), getBillCredits(id)]);
  if (result.failed) return <PageBody><RecordFailure what="this bill" /></PageBody>;
  const bill = result.bill;
  if (!bill) notFound();
  const postings = await getPostings([bill.id, ...result.payments.map(payment => payment.id)]);
  const account = new Map(accounts.rows.map(item => [item.id, item]));
  const balance = Number(bill.balance), credited = Number(bill.amount_credited);
  const open = bill.status === "awaiting_payment" || bill.status === "part_paid";
  const late = bill.days_overdue > 0;

  return <PageBody className="space-y-4">
    <RecordHeader title={`${bill.supplier_name}${bill.number ? ` · ${bill.number}` : ""}`} description={`Bill dated ${formatDate(bill.issued_on)}`}
      back={{ href: "/accounts/bills", label: "Purchases" }}
      action={<>
        <RecordBadge tone={bill.status === "paid" ? "positive" : late ? "critical" : "neutral"}>{late ? `${bill.days_overdue} days overdue` : BILL_STATUS_LABELS[bill.status]}</RecordBadge>
        {bill.status === "awaiting_payment" ? <Link href={`/accounts/bills/${bill.id}/edit`} className={recordOutlineButton}><Pencil className="size-3.5" />Edit</Link> : null}
        {bill.status !== "void" ? <MoreMenu items={[{ href: `/accounts/supplier-credits/new?bill=${bill.id}`, label: "Supplier credit note", hint: "Record a credit note they sent against this bill", icon: "credit" }]} /> : null}
      </>} />

    <div className="border-hairline bg-surface flex flex-wrap gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-[12.5px]">
      <p className="text-ink-muted">Supplier <Link href={`/accounts/suppliers/${bill.supplier_id}`} className="text-brand ml-1 font-medium touch:inline-flex touch:min-h-10 touch:items-center">{bill.supplier_name}</Link></p>
      <p className="text-ink-muted">Due <span className={cn("ml-1 font-medium", late ? "text-critical" : "text-ink")}>{bill.due_on ? formatDate(bill.due_on) : "No due date"}</span></p>
      {bill.reference ? <p className="text-ink-muted">Reference <span className="text-ink ml-1 font-medium">{bill.reference}</span></p> : null}
    </div>

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <RecordSection title="Lines">
          <div className="w-full overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr className="border-hairline bg-surface-sunken text-ink-faint border-b text-left text-[11px] font-semibold tracking-[0.06em] uppercase">
              <th scope="col" className="px-4 py-2">Description</th><th scope="col" className="hidden px-3 py-2 md:table-cell">Account</th>
              <th scope="col" className="px-3 py-2 text-right">Net</th><th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">VAT</th><th scope="col" className="px-4 py-2 text-right">Total</th>
            </tr></thead>
            <tbody className="divide-hairline divide-y">{result.lines.map(line => {
              const coded = account.get(line.account_id);
              return <tr key={line.id}>
                <td className="px-4 py-2 text-[12.5px]">{line.description}<span className="text-ink-faint block text-[11.5px] md:hidden">{coded ? `${coded.code} · ${coded.name}` : ""}</span></td>
                <td className="text-ink-muted hidden px-3 py-2 text-[12.5px] md:table-cell">{coded ? <Link href={`/accounts/chart/${coded.id}`} className="hover:text-brand hover:underline touch:inline-flex touch:min-h-10 touch:items-center"><span className="font-mono text-[11.5px]">{coded.code}</span> · {coded.name}</Link> : "—"}</td>
                <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">{formatAmount(Number(line.net))}</td>
                <td className="text-ink-muted hidden px-3 py-2 text-right text-[12.5px] tabular-nums sm:table-cell">{formatAmount(Number(line.vat_amount))}<span className="text-ink-faint ml-1 text-[11px]">{Number(line.vat_rate)}%</span></td>
                <td className="px-4 py-2 text-right text-[12.5px] tabular-nums">{formatAmount(Number(line.net) + (bill.reverse_charge ? 0 : Number(line.vat_amount)))}</td>
              </tr>;
            })}</tbody>
            <tfoot className="border-hairline-strong border-t text-[12.5px]">
              <tr><td className="text-ink-muted px-4 pt-2" colSpan={2}>Net</td><td className="px-3 pt-2 text-right tabular-nums" colSpan={3}>{formatAmount(Number(bill.net))}</td></tr>
              {bill.reverse_charge ? <tr><td className="text-ink-muted px-4" colSpan={2}>VAT due and reclaimed (reverse charge)</td><td className="px-3 text-right tabular-nums" colSpan={3}>{formatAmount(Number(bill.reverse_charge_vat))}</td></tr>
                : <tr><td className="text-ink-muted px-4" colSpan={2}>VAT</td><td className="px-3 text-right tabular-nums" colSpan={3}>{formatAmount(Number(bill.vat_amount))}</td></tr>}
              <tr><td className="text-ink px-4 pb-2.5 font-semibold" colSpan={2}>Total</td><td className="px-3 pb-2.5 text-right font-semibold tabular-nums" colSpan={3}>{formatAmount(Number(bill.total))}</td></tr>
            </tfoot>
          </table></div>
        </RecordSection>
        <Postings entries={postings.entries} empty={bill.status === "void" ? "A void bill is not in the books." : "Not posted yet."} />
      </div>

      <div className="min-w-0 space-y-4">
        <RecordSection title="To pay">
          <div className="p-4 sm:p-5">
            <p className={cn("text-[20px] font-semibold", balance > 0 && late ? "text-critical" : "text-ink")}>{bill.status === "void" ? "—" : formatAmount(balance)}</p>
            <p className="text-ink-muted mt-0.5 text-[12px]">{formatAmount(Number(bill.amount_paid))} paid{credited ? `, ${formatAmount(credited)} credited` : ""} of {formatAmount(Number(bill.total))}</p>
          </div>
          {credits.length ? <ul aria-label="Supplier credits" className="divide-hairline border-hairline divide-y border-t">{credits.map(item => <li key={`${item.credit_id}-${item.id ?? "raised"}`} className="flex items-baseline gap-3 px-4 py-2 sm:px-5">
            <span className="text-ink-muted w-24 shrink-0 text-[12px] tabular-nums">{formatDate(item.dated)}</span>
            <span className="min-w-0 flex-1 truncate text-[12px]">Credit note <Link href={`/accounts/supplier-credits/${item.credit_id}`} className="text-brand font-mono hover:underline">{item.number ?? "without a number"}</Link>{item.status === "void" ? <span className="text-ink-faint"> · void</span> : item.amount === null ? <span className="text-ink-faint"> · kept as credit</span> : null}</span>
            {item.amount !== null ? <span className="text-ink shrink-0 text-[12.5px] font-medium tabular-nums">{formatAmount(Number(item.amount))}</span> : null}
          </li>)}</ul> : null}
          {result.payments.length ? <ul aria-label="Payments made" className="divide-hairline border-hairline divide-y border-t">{result.payments.map(payment => <li key={payment.id} className="flex items-baseline gap-3 px-4 py-2 sm:px-5">
            <span className="text-ink-muted w-24 shrink-0 text-[12px] tabular-nums">{formatDate(payment.paid_on)}</span>
            <span className="text-ink-muted min-w-0 flex-1 truncate text-[12px]">{account.get(payment.bank_account_id)?.name ?? "Bank"}{payment.reference ? ` · ${payment.reference}` : ""}</span>
            <span className="text-ink shrink-0 text-[12.5px] font-medium tabular-nums">{formatAmount(Number(payment.amount))}</span>
            <form action={removeBillPayment}><input type="hidden" name="id" value={payment.id} /><InlineSubmit destructive title="Remove this payment">Remove</InlineSubmit></form>
          </li>)}</ul> : null}
          {open ? <RecordDisclosure title="Record a payment">
            <BillPaymentForm billId={bill.id} balance={balance} bankAccounts={banks.rows.filter(bank => bank.isActive)} defaultBank={settings.settings.default_bank_account_id} today={settings.today} />
          </RecordDisclosure> : null}
        </RecordSection>
        <RecordSection title="Details">
          <dl className="divide-hairline divide-y px-4 sm:px-5">
            <RecordDetail label="Bill date" value={formatDate(bill.issued_on)} />
            <RecordDetail label="Notes" value={bill.notes} />
            <RecordDetail label="Source document" value={bill.source_document} />
            <RecordDetail label="Recorded" value={formatDate(bill.created_at)} />
          </dl>
          {bill.status === "awaiting_payment" || bill.status === "void" ? <RecordDisclosure title={bill.status === "void" ? "Restore this bill" : "Void this bill"}>
            <VoidBillForm id={bill.id} isVoid={bill.status === "void"} />
          </RecordDisclosure> : null}
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
