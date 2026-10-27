import type { Metadata } from "next";
import { CheckCircle2, Loader2, RefreshCw, ScanSearch, Upload, UserPlus, Users } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { screenEveryone, updateSanctionsList } from "@/lib/actions/clients";
import { getClientFiles } from "@/lib/data/clients";
import { inSentence, RISK_LEVELS } from "@/lib/domain/onboarding";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { SubmitButton } from "@/components/common/form-fields";
import { RecordBadge, RecordDisclosure, RecordEmpty, RecordHeader, RecordPagination, RecordSection, recordButton, recordOutlineButton } from "@/components/records/record-layout";
import { ListSearch, clientMatches } from "@/components/common/list-search";

export const metadata: Metadata = { title: "Client files" };

const LEVEL_TONE = { low: "positive", normal: "neutral", high: "critical" } as const;
const PAGE_SIZE = 50;

/**
 * The practice's client files: who it is taking on, step by step, and every
 * client's due diligence as it stands: risk, next review, and screening
 * against the EU sanctions list.
 */
export default async function ClientFilesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [data, query] = await Promise.all([getClientFiles(), searchParams]);
  const refreshing = data.refreshing;
  // Hundreds of clients: a possible sanctions match, then reviews overdue or soon due, first; a page at a time.
  const urgency = (file: (typeof data.active)[number]) => (file.openMatches ? 10_000 : 0) + (file.reviewIn !== null && file.reviewIn < 0 ? 5_000 : 0) + (file.reviewIn !== null && file.reviewIn <= 30 ? 1_000 : 0) + (file.screenedOnCurrent ? 0 : 100);
  const matching = data.active.filter(file => clientMatches(query.q ?? "", { name: file.company_name, he: file.he_number, vat: file.vat_number }))
    .sort((a, b) => urgency(b) - urgency(a) || a.company_name.localeCompare(b.company_name));
  const page = Math.max(1, Math.min(Number(query.page) || 1, Math.ceil(matching.length / PAGE_SIZE) || 1));
  const clients = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title="Client files" description="Taking clients on, and keeping their due diligence current, as ICPAC’s AML Directive asks: the engagement letter, the people behind each company, sanctions screening and a risk rating."
      action={<><Link href="/clients/owners" className={recordOutlineButton}><Users className="size-3.5" />Owners on Ledgerline</Link><Link href="/clients/import" className={recordOutlineButton}><Upload className="size-3.5" />Bring clients over</Link><Link href="/clients/new" className={recordButton}><UserPlus className="size-3.5" />Take on a client</Link></>} />

    {query.screened ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]"><CheckCircle2 className="size-4 shrink-0" />
      {query.screened} names screened against the EU list of {data.list ? formatDate(data.list.generated_on) : "today"}{data.counts.openMatches ? `: ${data.counts.openMatches} possible match${data.counts.openMatches === 1 ? "" : "es"} to look at.` : ". Everyone is clear."}</p> : null}

    <RecordSection title="Taking on" hint={data.onboarding.length ? `${data.onboarding.length} in progress` : undefined}>
      {data.onboarding.length ? <ul className="divide-hairline divide-y">{data.onboarding.map(file => <li key={file.id}>
        <Link href={`/clients/${file.id}`} className="hover:bg-muted/60 grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_9rem_minmax(0,1fr)] sm:items-center">
          <span className="min-w-0"><span className="text-ink block truncate text-[13px] font-medium">{file.company_name}</span>
            <span className="text-ink-faint block text-[11.5px]">{file.contact_name ?? "No contact yet"} · started {formatDate(file.created_at.slice(0, 10))}</span></span>
          <span className="flex items-center gap-2" aria-label={`${file.done} of ${file.steps.length} steps done`}>
            <span className="bg-surface-sunken h-1.5 w-20 overflow-hidden rounded-full"><span className="bg-brand block h-full rounded-full" style={{ width: `${(file.done / file.steps.length) * 100}%` }} /></span>
            <span className="text-ink-muted text-[11.5px] tabular-nums">{file.done} of {file.steps.length}</span></span>
          <span className="text-[12px]">{file.ready ? <span className="text-positive font-medium">Ready: open the books</span> : file.next ? <><span className="text-ink">Next: {inSentence(file.next.todo)}</span><span className="text-ink-faint block text-[11.5px]">{file.next.detail}</span></> : null}</span>
        </Link></li>)}</ul>
        : <RecordEmpty title="Nobody being taken on">Start a file from a won enquiry, or with <b>Take on a client</b>.</RecordEmpty>}
    </RecordSection>

    <RecordSection title="Clients" hint={`${data.active.length} clients${data.counts.reviewsDue ? ` · ${data.counts.reviewsDue} review${data.counts.reviewsDue === 1 ? "" : "s"} due within 30 days` : ""}`}
      action={data.active.length > PAGE_SIZE ? <ListSearch action="/clients" value={query.q} placeholder="Find a client: name, HE or VAT number" /> : undefined}>
      {data.active.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-[12.5px]">
        <thead><tr className="border-hairline bg-surface-sunken border-b text-left">{["Client", "Risk", "Next review", "Sanctions screening"].map(label => <th key={label} scope="col" className="text-ink-faint px-4 py-2 text-[11px] font-semibold tracking-[0.06em] uppercase">{label}</th>)}</tr></thead>
        <tbody className="divide-hairline divide-y">{clients.map(file => <tr key={file.id}>
          <td className="px-4 py-2.5"><Link href={`/clients/${file.id}`} className="text-ink hover:text-brand font-medium hover:underline">{file.company_name}</Link>
            <span className="text-ink-faint block text-[11.5px]">{file.he_number ?? ""}{file.manager ? ` · ${file.manager}` : ""}</span></td>
          <td className="px-4 py-2.5">{file.level ? <RecordBadge tone={LEVEL_TONE[file.level]}>{RISK_LEVELS[file.level].label} · {RISK_LEVELS[file.level].short}</RecordBadge> : <RecordBadge tone="caution">Not rated</RecordBadge>}</td>
          <td className={cn("px-4 py-2.5 tabular-nums", file.reviewIn !== null && file.reviewIn < 0 ? "text-critical font-medium" : file.reviewIn !== null && file.reviewIn <= 30 ? "text-caution font-medium" : "text-ink-muted")}>
            {file.review ? <>{formatDate(file.review)}<span className="block text-[11.5px] font-normal">{file.reviewIn! < 0 ? `${-file.reviewIn!} days overdue` : file.reviewIn! <= 60 ? `in ${file.reviewIn} days` : ""}</span></> : "Not set"}</td>
          <td className="px-4 py-2.5">{file.openMatches ? <RecordBadge tone="critical">{file.openMatches} possible match{file.openMatches === 1 ? "" : "es"}</RecordBadge>
            : file.screenedOnCurrent ? <span className="text-positive">Clear on the list of {formatDate(file.lastScreened!)}</span>
            : <span className="text-caution">{file.lastScreened ? `Last screened on the list of ${formatDate(file.lastScreened)}` : "Not screened"}</span>}</td>
        </tr>)}</tbody>
      </table>{matching.length > PAGE_SIZE ? <RecordPagination page={page} total={matching.length} pageSize={PAGE_SIZE} href={`/clients${query.q ? `?q=${encodeURIComponent(query.q)}` : ""}`} /> : null}</div>
        : <RecordEmpty title="No clients yet">Clients appear here once their books are opened.</RecordEmpty>}
    </RecordSection>

    <RecordSection title="The EU sanctions list" hint="The consolidated list of persons, groups and entities subject to EU financial sanctions"
      action={<div className="flex flex-wrap gap-2">
        <form action={screenEveryone}><SubmitButton size="sm" variant="outline" pendingLabel="Screening…"><ScanSearch className="size-3.5" />Screen everyone again</SubmitButton></form>
        <form action={updateSanctionsList}><SubmitButton size="sm" variant="outline" pendingLabel="Starting…" disabled={Boolean(refreshing && !refreshing.done && !refreshing.error)}><RefreshCw className="size-3.5" />Update the list</SubmitButton></form>
      </div>}>
      <div className="space-y-1 px-4 py-3 text-[12.5px]">
        {data.list ? <p className="text-ink">The list of <b>{formatDate(data.list.generated_on)}</b>: {data.list.entries.toLocaleString("en-GB")} people and entities.{data.counts.notOnCurrentList ? <span className="text-caution"> {data.counts.notOnCurrentList} file{data.counts.notOnCurrentList === 1 ? " has" : "s have"} not been screened on it yet.</span> : <span className="text-positive"> Every file is screened on it.</span>}</p>
          : <p className="text-caution">No list is loaded: update it to screen.</p>}
        {refreshing ? <p role="status" className={cn("flex items-center gap-1.5 text-[12px]", refreshing.error ? "text-critical" : refreshing.done ? "text-positive" : "text-ink-muted")}>
          {!refreshing.done && !refreshing.error ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {refreshing.error ? `Couldn’t update the list: ${refreshing.error}` : refreshing.done ? `Updated to the list of ${formatDate(refreshing.done)}. Screen everyone again to check every client against it.` : "Fetching the current list from the EU (about 25 MB). Reload this page in a minute."}</p> : null}
        <p className="text-ink-faint text-[11.5px]">From the EU’s Financial Sanctions Files, which include the UN’s designations. Names are matched in any order, without accents, allowing for a typing slip; a person’s date of birth tells namesakes apart. Every possible match is decided by a person, with the reason.</p>
      </div>
    </RecordSection>

    {data.declined.length ? <RecordDisclosure title={`Declined (${data.declined.length})`}>
      <ul className="divide-hairline divide-y">{data.declined.map(file => <li key={file.id} className="px-4 py-2 text-[12.5px]"><Link href={`/clients/${file.id}`} className="text-ink hover:underline">{file.company_name}</Link><span className="text-ink-faint"> · {file.declined_reason}</span></li>)}</ul>
    </RecordDisclosure> : null}
  </PageBody>;
}
