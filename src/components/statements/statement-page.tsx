import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";
import { Download, FileText } from "lucide-react";

import { getStatement } from "@/lib/data/statements";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { statementPeriod, statementQuery, type StatementParty } from "@/lib/domain/statements";
import { formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/org";
import { PageBody } from "@/components/common/primitives";
import { RecordHeader, recordButton, recordOutlineButton } from "@/components/records/record-layout";
import { StatementView } from "./statement-view";

/** A customer's or a supplier's statement page: the statement, its downloads, and (for a supplier) checking theirs against it. */
export async function StatementPage({ party, id, searchParams }: { party: StatementParty; id: string; searchParams: Record<string, string | string[] | undefined> }) {
  if (!UUID_PATTERN.test(id)) notFound();
  const org = await requireOrg();
  const period = statementPeriod(searchParams, firmToday(), org.year_end_month);
  const data = await getStatement(party, id, period);
  if (!data) notFound();
  const query = statementQuery(period);
  const files = `/c/${org.slug}/${party}s/${id}/statement`;
  const span = period.view === "activity" ? `${formatDate(data.from)} to ${formatDate(data.to)}` : `Open items on ${formatDate(data.to)}`;
  return <PageBody className="space-y-4">
    <RecordHeader eyebrow="Statement of account" title={data.account.name} description={span}
      back={{ href: `/accounts/${party}s/${id}`, label: party === "supplier" ? "Supplier" : "Customer" }}
      action={<>
        <a href={`${files}/csv?${query}`} download className={recordOutlineButton}><Download className="size-3.5" />CSV</a>
        <a href={`${files}/pdf?${query}`} target="_blank" rel="noopener" className={party === "supplier" ? recordOutlineButton : recordButton}><FileText className="size-3.5" />PDF</a>
        {party === "supplier" ? <Link href={`/accounts/suppliers/${id}/reconcile`} className={recordButton}>Check their statement</Link> : null}
      </>} />
    <StatementView data={data} period={period} base={`/accounts/${party}s/${id}/statement`} />
  </PageBody>;
}
