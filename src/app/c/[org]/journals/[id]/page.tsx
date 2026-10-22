import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Lock, Pencil, Undo2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getManualJournal } from "@/lib/data/accounts";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RemoveForm } from "@/components/accounts/forms";
import { RecordDetail, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Journal" };

/** One journal written by hand: its lines, and what can still be done with it. */
export default async function JournalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, query] = await Promise.all([getManualJournal(id), searchParams]);
  if (!data) notFound();
  const { journal, lines, locked, lockDate } = data;
  const debit = lines.reduce((sum, line) => sum + Math.round(Number(line.debit) * 100), 0) / 100;
  const credit = lines.reduce((sum, line) => sum + Math.round(Number(line.credit) * 100), 0) / 100;
  const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap first:px-4 last:pr-4";
  const cell = "px-3 py-2 text-[12.5px] first:px-4 last:pr-4";

  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={journal.narration} back={{ href: "/accounts/journals", label: "Journals" }}
      description={`Journal · ${formatDate(journal.entry_date)}${journal.reference ? ` · ${journal.reference}` : ""}`}
      action={<>
        {locked ? <span className="text-ink-muted inline-flex items-center gap-1.5 text-[12px]"><Lock className="size-3.5" />Locked</span>
          : <Link href={`/accounts/journals/${id}/edit`} className={recordOutlineButton}><Pencil className="size-3.5" />Edit</Link>}
        <Link href={`/accounts/journals/new?reverse=${id}`} className={recordOutlineButton}><Undo2 className="size-3.5" />Reverse</Link>
      </>} />

    {query.saved ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]">
      <CheckCircle2 className="size-4 shrink-0" />{query.saved === "edited" ? "Saved. The ledger now shows the journal as it reads here." : "Posted. The debits equal the credits and every report includes it."}
    </p> : null}

    <RecordSection title="Lines" hint={`${lines.length} line${lines.length === 1 ? "" : "s"}`}>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Account</th><th scope="col" className={head}>Description</th>
          <th scope="col" className={cn(head, "text-right")}>Debit</th><th scope="col" className={cn(head, "text-right")}>Credit</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{lines.map(line => <tr key={line.id}>
          <td className={cell}><Link href={`/accounts/chart/${line.account_id}`} className="text-ink hover:text-brand hover:underline"><span className="text-ink-faint mr-2 font-mono text-[11.5px]">{line.code}</span>{line.account_name}</Link></td>
          <td className={cn(cell, "text-ink-muted")}>{line.description ?? ""}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{Number(line.debit) ? formatAmount(line.debit) : ""}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{Number(line.credit) ? formatAmount(line.credit) : ""}</td>
        </tr>)}</tbody>
        <tfoot className="border-hairline-strong bg-surface-sunken border-t"><tr>
          <th scope="row" colSpan={2} className="text-ink px-4 py-2.5 text-left text-[12.5px] font-semibold">{debit === credit ? "Balanced" : "Out of balance"}</th>
          <td className={cn(cell, "py-2.5 text-right font-semibold tabular-nums")}>{formatAmount(debit)}</td>
          <td className={cn(cell, "py-2.5 text-right font-semibold tabular-nums")}>{formatAmount(credit)}</td>
        </tr></tfoot>
      </table></div>
    </RecordSection>

    <RecordSection title="Details">
      <dl className="divide-hairline divide-y px-4">
        <RecordDetail label="Date" value={formatDate(journal.entry_date)} />
        <RecordDetail label="Reference" value={journal.reference} />
        <RecordDetail label="Written" value={formatDateTime(journal.created_at)} />
        <RecordDetail label="Can it change?" value={locked ? `No: the books are locked up to ${formatDate(lockDate)}. Reverse it in an open period to undo it.` : "Yes, until the period is locked: edit it, or remove it from the books."} />
      </dl>
      {locked ? null : <div className="border-hairline border-t px-4 py-3"><RemoveForm kind="journal" id={id} label="Remove this journal" /></div>}
    </RecordSection>
  </PageBody>;
}
