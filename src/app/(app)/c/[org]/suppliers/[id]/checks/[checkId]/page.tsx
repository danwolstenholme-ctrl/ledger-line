import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";
import { FileText } from "lucide-react";

import { getStatementCheck } from "@/lib/data/statement-checks";
import { getSupplier } from "@/lib/data/accounts";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { requireOrg } from "@/lib/org";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordBadge, RecordHeader, RecordSection, recordButton, recordOutlineButton } from "@/components/records/record-layout";
import { StatTile } from "@/components/reports/report-charts";

export const metadata: Metadata = { title: "Their statement, checked" };

/** A supplier's statement as it was checked against the books: the two balances, and what explains the difference. */
export default async function StatementCheckPage({ params }: { params: Promise<{ id: string; checkId: string }> }) {
  const { id, checkId } = await params;
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(checkId)) notFound();
  const org = await requireOrg();
  const [check, result] = await Promise.all([getStatementCheck(checkId), getSupplier(id)]);
  if (!check || check.supplier_id !== id || !result.supplier) notFound();
  const unexplained = Number(check.unexplained);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader eyebrow="Their statement, checked" title={result.supplier.name}
      description={`Statement of ${formatDate(check.statement_date)} · checked ${formatDateTime(check.created_at)}${check.checked_by_name ? ` by ${check.checked_by_name}` : ""}`}
      back={{ href: `/accounts/suppliers/${id}`, label: "Supplier" }}
      action={<>
        {check.has_file ? <a href={`/c/${org.slug}/suppliers/${id}/checks/${check.id}/file`} target="_blank" rel="noopener" className={recordOutlineButton}><FileText className="size-3.5" />Their statement</a> : null}
        <Link href={`/accounts/suppliers/${id}/statement?view=activity&range=custom&from=${check.statement_date.slice(0, 8)}01&to=${check.statement_date}`} className={recordOutlineButton}>Our statement</Link>
        <Link href={`/accounts/suppliers/${id}/reconcile`} className={recordButton}>Check a newer one</Link>
      </>} />
    <section aria-label="The balances" className="ll-panel divide-hairline grid grid-cols-3 divide-x overflow-hidden">
      <StatTile label="Their balance" value={formatAmount(Number(check.their_balance))} context={`on ${formatDate(check.statement_date)}`} />
      <StatTile label="Ours" value={formatAmount(Number(check.our_balance))} context="the same day, in the books" />
      <StatTile label={unexplained ? "Not explained" : "Agreed"} value={unexplained ? formatAmount(unexplained) : "✓"} tone={unexplained ? "critical" : undefined}
        context={unexplained ? "still to find" : check.explained.length ? `${check.explained.length} timing difference${check.explained.length === 1 ? "" : "s"}` : "to the cent"} />
    </section>
    <RecordSection title="What explains the difference" hint={check.agreed ? undefined : "and what is still to find"}>
      {check.explained.length ? <table className="w-full text-[13px]">
        <tbody className="divide-hairline divide-y">
          {check.explained.map((item, index) => <tr key={index}>
            <td className="text-ink-muted w-28 px-4 py-2 tabular-nums sm:pl-5">{formatDate(item.date)}</td>
            <td className="px-3 py-2"><span className="font-mono text-[12.5px]">{item.reference || "—"}</span>{item.note ? <span className="text-ink-muted"> · {item.note}</span> : null}</td>
            <td className="px-3 py-2"><RecordBadge tone={item.side === "theirs" ? "caution" : "neutral"}>{item.side === "theirs" ? "Theirs only" : "Ours"}</RecordBadge></td>
            <td className="w-28 px-4 py-2 text-right tabular-nums sm:pr-5">{item.amount > 0 ? "+" : "−"}{formatAmount(Math.abs(item.amount))}</td>
          </tr>)}
        </tbody>
        <tfoot className="border-hairline border-t"><tr className={cn("font-medium", unexplained ? "text-critical" : "text-positive")}>
          <td className="px-4 py-2 sm:pl-5" colSpan={3}>{unexplained ? "Not explained" : "Agreed with their statement"}</td>
          <td className="px-4 py-2 text-right tabular-nums sm:pr-5">{unexplained ? formatAmount(unexplained) : "✓"}</td>
        </tr></tfoot>
      </table> : <p className="text-ink-muted px-4 py-3.5 text-[13px] sm:px-5">{unexplained ? "Nothing was found to explain it." : "Their balance and ours were the same."}</p>}
      {check.explained.some(item => item.side === "theirs" && item.amount > 0) ? <p className="border-hairline text-ink-muted border-t px-4 py-3 text-[12.5px] sm:px-5">
        A bill on their statement that isn’t in the books: <Link href={`/accounts/bills/new?supplier=${id}`} className="text-brand hover:underline">record it</Link> once they send it.</p> : null}
    </RecordSection>
    {check.notes ? <RecordSection title="Notes"><p className="text-ink px-4 py-3.5 text-[13px] whitespace-pre-line sm:px-5">{check.notes}</p></RecordSection> : null}
  </PageBody>;
}
