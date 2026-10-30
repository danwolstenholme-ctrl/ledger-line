import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";
import { FileText } from "lucide-react";

import { setSupplierActive } from "@/lib/actions/accounts";
import { requireOrg } from "@/lib/org";
import { getLedgerAccounts, getSupplier } from "@/lib/data/accounts";
import { getSupplierCreditsFor } from "@/lib/data/purchases";
import { BILL_STATUS_LABELS, codableAccounts } from "@/lib/domain/accounts";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { toCents } from "@/lib/domain/invoice-math";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { InlineSubmit } from "@/components/common/form-fields";
import { SupplierForm } from "@/components/accounts/forms";
import { CreateRecordLink, RecordBadge, RecordDisclosure, RecordFailure, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { StatTile } from "@/components/reports/report-charts";
import { answerView, latestChecks, vatKey } from "@/lib/vies";
import { VatCheckButton } from "@/components/vat/vat-check";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const org = await requireOrg();
  const [result, accounts, credits] = await Promise.all([getSupplier(id), getLedgerAccounts(), getSupplierCreditsFor(id)]);
  if (result.failed) return <PageBody><RecordFailure what="this supplier" /></PageBody>;
  const supplier = result.supplier;
  if (!supplier) notFound();
  const open = result.bills.filter(bill => bill.status === "awaiting_payment" || bill.status === "part_paid");
  const owed = open.reduce((sum, bill) => sum + toCents(bill.balance), 0) / 100;
  const late = open.filter(bill => bill.days_overdue > 0);
  const overdue = late.reduce((sum, bill) => sum + toCents(bill.balance), 0) / 100;
  const vat = vatKey(supplier.vat_number, supplier.country);
  const checks = await latestChecks(vat ? [vat] : []);
  // A payment run pays several of their bills at once: one line, one remittance advice.
  const paid = [...result.payments.reduce((groups, payment) => {
    const key = payment.run_id ?? payment.id;
    const group = groups.get(key) ?? { key, run: payment.run_id, payment: payment.id, paid_on: payment.paid_on, numbers: [] as string[], amount: 0, reference: payment.reference };
    group.numbers.push(payment.number ?? "No number"); group.amount += toCents(payment.amount);
    return groups.set(key, group);
  }, new Map<string, { key: string; run: string | null; payment: string; paid_on: string; numbers: string[]; amount: number; reference: string | null }>()).values()];
  const remittance = (group: (typeof paid)[number]) => group.run ? `/c/${org.slug}/bills/runs/${group.run}/remittance/${supplier.id}` : `/c/${org.slug}/bills/${result.payments.find(payment => payment.id === group.payment)!.bill_id}/payments/${group.payment}/remittance`;
  const lastCheck = result.checks[0];
  return <PageBody className="space-y-4">
    <RecordHeader title={supplier.name} description={[supplier.vat_number ? `VAT ${supplier.vat_number}` : null, supplier.email, supplier.payment_terms_days !== null ? `pays in ${supplier.payment_terms_days} days` : null].filter(Boolean).join(" · ") || undefined}
      back={{ href: "/accounts/suppliers", label: "Suppliers" }}
      action={<>
        <Link href={`/accounts/suppliers/${supplier.id}/statement`} className={recordOutlineButton}><FileText className="size-3.5" />Statement</Link>
        <Link href={`/accounts/suppliers/${supplier.id}/reconcile`} className={recordOutlineButton}>Check their statement</Link>
        <CreateRecordLink href={`/accounts/bills/new?supplier=${supplier.id}`}>Record a bill</CreateRecordLink>
      </>} />
    <section aria-label="What is owed" className="ll-panel divide-hairline grid grid-cols-3 divide-x overflow-hidden">
      <StatTile label="To pay" value={formatAmount(owed)} context={open.length ? `${open.length} bill${open.length === 1 ? "" : "s"}` : "Nothing to pay"} />
      <StatTile label="Overdue" value={formatAmount(overdue)} tone={overdue > 0 ? "critical" : undefined} context={late.length ? `${late.length} bill${late.length === 1 ? "" : "s"} past due` : "Nothing overdue"} />
      <StatTile label="Their statement" value={lastCheck ? (lastCheck.agreed ? "Agreed" : formatAmount(Number(lastCheck.unexplained))) : "Not checked"} tone={lastCheck && !lastCheck.agreed ? "critical" : undefined}
        context={lastCheck ? `${lastCheck.agreed ? "with the books" : "not explained"} on ${formatDate(lastCheck.statement_date)}` : credits.unused > 0 ? `${formatAmount(credits.unused)} of credit to use` : "Check one when it comes"}
        href={lastCheck ? `/accounts/suppliers/${supplier.id}/checks/${lastCheck.id}` : `/accounts/suppliers/${supplier.id}/reconcile`} />
    </section>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <RecordSection title="Bills" hint={open.length ? `${formatAmount(owed)} to pay on ${open.length} bill${open.length === 1 ? "" : "s"}` : "Nothing to pay"}>
          {result.bills.length ? <ul className="divide-hairline divide-y">{result.bills.map(bill => <li key={bill.id}>
            <Link href={`/accounts/bills/${bill.id}`} className="hover:bg-surface-sunken flex items-baseline gap-3 px-4 py-2.5 sm:px-5 touch:min-h-11 touch:items-center">
              <span className="text-ink-muted w-24 shrink-0 text-[12.5px] tabular-nums">{formatDate(bill.issued_on)}</span>
              <span className="text-ink min-w-0 flex-1 truncate font-mono text-[12.5px]">{bill.number ?? "No number"}</span>
              <span className={cn("shrink-0 text-[12.5px]", bill.status === "paid" ? "text-positive" : bill.days_overdue > 0 ? "text-critical" : "text-ink-muted")}>{bill.days_overdue > 0 ? `${bill.days_overdue} days late` : BILL_STATUS_LABELS[bill.status]}</span>
              <span className="text-ink w-24 shrink-0 text-right text-[13px] tabular-nums">{formatAmount(Number(bill.total))}</span>
            </Link>
          </li>)}</ul> : <p className="text-ink-faint px-4 py-4 text-[13px] sm:px-5">No bills from this supplier yet.</p>}
        </RecordSection>
        {paid.length ? <RecordSection title="Payments" hint="Each with its remittance advice">
          <ul className="divide-hairline divide-y">{paid.map(group => <li key={group.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
            <span className="text-ink-muted w-24 shrink-0 text-[12.5px] tabular-nums">{formatDate(group.paid_on)}</span>
            <span className="text-ink min-w-0 flex-1 truncate text-[12.5px]"><span className="font-mono">{group.numbers.join(", ")}</span>{group.reference ? <span className="text-ink-faint"> · {group.reference}</span> : null}</span>
            <a href={remittance(group)} target="_blank" rel="noopener" className="text-brand shrink-0 text-[12.5px] hover:underline">Remittance</a>
            <span className="text-ink w-24 shrink-0 text-right text-[13px] tabular-nums">{formatAmount(group.amount / 100)}</span>
          </li>)}</ul>
        </RecordSection> : null}
        {credits.rows.length ? <RecordSection title="Credit notes" hint={credits.unused > 0 ? `${formatAmount(credits.unused)} of credit to use` : undefined}>
          <ul className="divide-hairline divide-y">{credits.rows.map(credit => <li key={credit.id}>
            <Link href={`/accounts/supplier-credits/${credit.id}`} className="hover:bg-surface-sunken flex items-baseline gap-3 px-4 py-2.5 sm:px-5">
              <span className="text-ink-muted w-24 shrink-0 text-[12.5px] tabular-nums">{formatDate(credit.issued_on)}</span>
              <span className="text-ink min-w-0 flex-1 truncate font-mono text-[12.5px]">{credit.number ?? "No number"}</span>
              <span className={cn("shrink-0 text-[12.5px]", credit.status === "void" ? "text-ink-faint" : Number(credit.remaining) > 0 ? "text-caution" : "text-positive")}>{credit.status === "void" ? "Void" : Number(credit.remaining) > 0 ? `${formatAmount(credit.remaining)} to use` : "Used"}</span>
              <span className="text-ink w-24 shrink-0 text-right text-[13px] tabular-nums">{formatAmount(Number(credit.total))}</span>
            </Link>
          </li>)}</ul>
        </RecordSection> : null}
      </div>
      <div className="min-w-0 space-y-4">
        <RecordSection title="Their statements" action={<Link href={`/accounts/suppliers/${supplier.id}/reconcile`} className="text-brand text-[13px] font-medium hover:underline">Check one</Link>}>
          {result.checks.length ? <ul className="divide-hairline divide-y">{result.checks.map(check => <li key={check.id}>
            <Link href={`/accounts/suppliers/${supplier.id}/checks/${check.id}`} className="hover:bg-surface-sunken flex items-baseline gap-3 px-4 py-2.5 sm:px-5">
              <span className="text-ink w-24 shrink-0 text-[12.5px] tabular-nums">{formatDate(check.statement_date)}</span>
              <span className="text-ink-muted min-w-0 flex-1 truncate text-[12.5px] tabular-nums">Theirs {formatAmount(Number(check.their_balance))}</span>
              {check.agreed ? <RecordBadge tone="positive">Agreed</RecordBadge> : <RecordBadge tone="critical">{formatAmount(Number(check.unexplained))} unexplained</RecordBadge>}
            </Link>
          </li>)}</ul> : <p className="text-ink-muted px-4 py-3.5 text-[12.5px] leading-relaxed sm:px-5">When their statement comes, check it against the books: what explains any difference is kept with it.</p>}
        </RecordSection>
        {supplier.vat_number ? <RecordSection title="VAT number" hint={supplier.reverse_charge ? "Its bills are under the reverse charge" : undefined}>
          <div className="p-4"><VatCheckButton vat={supplier.vat_number} country={supplier.country} organisationId={org.id} expectName={supplier.name} kept={answerView(vat ? checks.get(vat) : null, supplier.name)} role="supplier" /></div>
        </RecordSection> : null}
        <RecordSection title="Details">
          <div className="p-4 sm:p-5"><SupplierForm supplier={supplier} accounts={codableAccounts(accounts.rows)} /></div>
          <RecordDisclosure title={supplier.is_active ? "Stop using this supplier" : "Use this supplier again"}>
            <form action={setSupplierActive} className="space-y-2">
              <input type="hidden" name="id" value={supplier.id} />
              <input type="hidden" name="is_active" value={supplier.is_active ? "" : "on"} />
              <p className="text-ink-muted text-[12.5px]">{supplier.is_active ? "Their bills stay in the books; they are just no longer offered for new ones." : "Offer this supplier for new bills again."}</p>
              <InlineSubmit>{supplier.is_active ? "Mark inactive" : "Mark active"}</InlineSubmit>
            </form>
          </RecordDisclosure>
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
