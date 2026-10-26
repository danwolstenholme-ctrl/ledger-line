import Link from "@/components/navigation/navigation-link";
import { AlertTriangle, ArrowRight, CheckCircle2, Landmark, Lock, ScanText } from "lucide-react";

import { getPracticeDashboard } from "@/lib/data/practice";
import { getClientFiles } from "@/lib/data/clients";
import { inSentence } from "@/lib/domain/onboarding";
import { getDeadlines } from "@/lib/data/deadlines";
import { quarterLabel } from "@/lib/domain/vat";
import { formatAmount, formatDate, formatRelative, formatMoney, greeting } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { StatTile } from "@/components/reports/report-charts";
import { RecordHeader, recordButton } from "@/components/records/record-layout";


/**
 * Journey 1: every client company on one screen. What is due to the Tax
 * Department and when, what the bank says that the books do not yet, what is
 * waiting to be reviewed, who owes money, and where each set of books is locked.
 */
export default async function PracticeDashboard() {
  const [{ clients, totals, practice, today }, deadlines, files] = await Promise.all([getPracticeDashboard(), getDeadlines(), getClientFiles()]);
  const head = "text-ink-faint px-3 py-2 text-left text-[10.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  const cell = "px-3 py-2.5 align-top text-[12.5px]";
  return <PageBody className="space-y-4">
    <RecordHeader eyebrow={formatDate(today)}
      title={`${greeting()}. ${totals.clients} clients, ${totals.vatDueSoon ? `${totals.vatDueSoon} VAT return${totals.vatDueSoon === 1 ? "" : "s"} due within 30 days` : "no VAT return due within 30 days"}.`}
      description={`Everything ${practice.name} looks after, in one place: each figure opens the books behind it.`}
      action={<Link href="/capture" className={recordButton}><ScanText className="size-4" />Capture documents</Link>} />

    <section aria-label="Practice totals" className="ll-panel bg-hairline grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 xl:grid-cols-5 [&>*]:bg-surface">
      <StatTile label="Client companies" value={String(totals.clients)} context={`${clients.filter(client => client.org.vat_registered).length} registered for VAT`} />
      <StatTile label="Deadlines, next 30 days" value={String(deadlines.counts.next30)} tone={deadlines.counts.overdue ? "critical" : undefined} context={deadlines.counts.overdue ? `${deadlines.counts.overdue} overdue as well` : "Nothing overdue"} href="/deadlines" />
      <StatTile label="Bank lines to reconcile" value={String(totals.bankLines)} context="Imported, not yet matched" />
      <StatTile label="Documents to review" value={String(totals.toReview)} context={totals.unrouted ? `${totals.unrouted} not yet routed to a client` : "Read by Claude, waiting for you"} href="/capture" />
      <StatTile label="Overdue receivables" value={formatMoney(totals.overdue)} tone={totals.overdue ? "critical" : undefined} context={`${totals.overdueCount} invoice${totals.overdueCount === 1 ? "" : "s"} past due, all clients`} />
    </section>

    {files.onboarding.length ? <section aria-label="Taking on" className="ll-panel overflow-hidden">
      <header className="border-hairline flex items-center justify-between border-b px-4 py-2"><h2 className="text-ink text-[13px] font-semibold">Taking on</h2><Link href="/clients" className="text-brand text-[12px] hover:underline">Client files</Link></header>
      <ul className="divide-hairline divide-y">{files.onboarding.map(file => <li key={file.id}><Link href={`/clients/${file.id}`} className="hover:bg-surface-sunken flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-[12.5px]">
        <span className="text-ink font-medium">{file.company_name}<span className="text-ink-faint font-normal"> · {file.done} of {file.steps.length} steps</span></span>
        <span className={file.ready ? "text-positive font-medium" : "text-ink-muted"}>{file.ready ? "Ready: open the books" : file.next ? `Next: ${inSentence(file.next.todo)}` : ""}</span>
      </Link></li>)}</ul>
    </section> : null}

    <section aria-label="Clients" className="ll-panel overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b">
          <tr>
            <th scope="col" className={head}>Client</th>
            <th scope="col" className={head}>Next VAT return</th>
            <th scope="col" className={cn(head, "text-right")}>Bank lines</th>
            <th scope="col" className={cn(head, "text-right")}>To review</th>
            <th scope="col" className={cn(head, "text-right")}>Overdue receivables</th>
            <th scope="col" className={head}>Locked to</th>
            <th scope="col" className={head}>Last activity</th>
          </tr>
        </thead>
        <tbody className="divide-hairline divide-y">
          {clients.map(({ org, vat, bankLines, bankAccountId, toReview, overdue, overdueCount, lastActivity }) => <tr key={org.id} className="hover:bg-surface-sunken group">
            <td className={cell}>
              <Link href={`/c/${org.slug}`} className="text-ink group-hover:text-brand flex items-center gap-1.5 text-[13px] font-medium">{org.name}<ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" /></Link>
              <span className="text-ink-faint block text-[11.5px]">{org.industry} · {org.he_number}</span>
            </td>
            <td className={cell}>
              {!vat ? <span className="text-ink-faint">Not registered for VAT</span> : <Link href={`/c/${org.slug}/reports/vat?range=custom&from=${vat.from}&to=${vat.to}`} className="block hover:underline">
                <span className={cn("inline-flex items-center gap-1 text-[12.5px] font-medium", vat.state === "open" ? "text-ink" : vat.daysLeft <= 30 ? "text-critical" : "text-caution")}>
                  {vat.state === "open" ? null : <AlertTriangle className="size-3.5" />}
                  {quarterLabel(vat.from, vat.to)} · due {formatDate(vat.due)}
                </span>
                <span className="text-ink-faint block text-[11.5px]">
                  {vat.state === "open" ? "Quarter running" : vat.state === "overdue" ? `${-vat.daysLeft} days overdue` : `${vat.daysLeft} days left, not filed`} · {vat.net >= 0 ? `${formatAmount(vat.net)} to pay` : `${formatAmount(-vat.net)} to reclaim`}
                  {vat.lastFiled ? ` · last filed ${formatDate(vat.lastFiled.filed_on)}` : ""}
                </span>
              </Link>}
            </td>
            <td className={cn(cell, "text-right tabular-nums")}>
              {bankLines ? <Link href={`/c/${org.slug}/bank/${bankAccountId}`} className="text-brand inline-flex items-center gap-1 font-medium hover:underline"><Landmark className="size-3.5" />{bankLines}</Link>
                : <span className="text-positive inline-flex items-center gap-1"><CheckCircle2 className="size-3.5" />Reconciled</span>}
            </td>
            <td className={cn(cell, "text-right tabular-nums")}>{toReview ? <Link href="/capture" className="text-brand font-medium hover:underline">{toReview}</Link> : <span className="text-ink-faint">—</span>}</td>
            <td className={cn(cell, "text-right tabular-nums")}>
              {overdue ? <Link href={`/c/${org.slug}/reports/aged-receivables`} className="text-critical font-medium hover:underline">{formatAmount(overdue)}</Link> : <span className="text-ink-faint">—</span>}
              {overdueCount ? <span className="text-ink-faint block text-[11.5px]">{overdueCount} invoice{overdueCount === 1 ? "" : "s"}</span> : null}
            </td>
            <td className={cell}>{org.lock_date ? <span className="text-ink-muted inline-flex items-center gap-1"><Lock className="size-3" />{formatDate(org.lock_date)}</span> : <span className="text-ink-faint">Not locked</span>}</td>
            <td className={cn(cell, "text-ink-muted whitespace-nowrap")}>{lastActivity ? formatRelative(lastActivity) : "—"}</td>
          </tr>)}
        </tbody>
      </table>
    </section>
    <p className="text-ink-faint text-[11.5px]">Each company keeps its own double-entry ledger. A document can only post to its own company&apos;s accounts: the database enforces it.</p>
  </PageBody>;
}
