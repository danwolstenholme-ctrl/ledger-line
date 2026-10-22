import type { Metadata } from "next";
import { CheckCircle2, Lock } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getManualJournals } from "@/lib/data/accounts";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { CreateRecordLink, RecordBadge, RecordEmpty, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Journals" };

/** The entries written by hand: opening balances, accruals, corrections. Everything else posts itself from its document. */
export default async function JournalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ rows, lockDate }, query] = await Promise.all([getManualJournals(), searchParams]);
  const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap first:px-4";
  return <PageBody className="space-y-4">
    <RecordHeader title="Journals" description="Double entries written by hand: opening balances, accruals, depreciation and corrections. Invoices, bills and the bank post their own."
      action={<CreateRecordLink href="/accounts/journals/new">New journal</CreateRecordLink>} />
    {query.removed ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]"><CheckCircle2 className="size-4 shrink-0" />The journal was removed from the books.</p> : null}
    <Panel className="overflow-hidden">
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Date</th><th scope="col" className={head}>Narration</th><th scope="col" className={head}>Reference</th>
          <th scope="col" className={cn(head, "text-right")}>Lines</th><th scope="col" className={cn(head, "text-right")}>Amount</th><th scope="col" className={head}><span className="sr-only">Locked</span></th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
          <td className="text-ink-muted px-4 py-2.5 text-[12.5px] whitespace-nowrap tabular-nums">{formatDate(row.entry_date)}</td>
          <td className="px-3 py-2.5 text-[12.5px]"><Link href={`/accounts/journals/${row.id}`} className="text-brand font-medium hover:underline">{row.narration}</Link></td>
          <td className="text-ink-muted px-3 py-2.5 font-mono text-[12px]">{row.reference ?? <span className="text-ink-faint font-sans">—</span>}</td>
          <td className="text-ink-muted px-3 py-2.5 text-right text-[12.5px] tabular-nums">{row.lines}</td>
          <td className="text-ink px-3 py-2.5 text-right text-[12.5px] tabular-nums">{formatAmount(row.amount)}</td>
          <td className="px-3 py-2.5 text-right">{lockDate && row.entry_date <= lockDate ? <RecordBadge><Lock className="mr-1 size-3" />Locked</RecordBadge> : null}</td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title="No journals yet">Write one for opening balances, an accrual or a correction. It posts when the debits equal the credits.</RecordEmpty>}
      {lockDate ? <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12px]">The books are locked up to {formatDate(lockDate)}: a journal dated on or before then cannot change. Reverse it in an open period instead.</p> : null}
    </Panel>
  </PageBody>;
}
