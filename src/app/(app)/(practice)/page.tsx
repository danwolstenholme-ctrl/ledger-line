import Link from "@/components/navigation/navigation-link";
import { AlertTriangle, ArrowRight, CheckCircle2, Landmark, Lock, ScanText } from "lucide-react";

import { getPracticeDashboard, getVatToPay } from "@/lib/data/practice";
import { getClientFiles } from "@/lib/data/clients";
import { inSentence } from "@/lib/domain/onboarding";
import { getDeadlines } from "@/lib/data/deadlines";
import { quarterLabel } from "@/lib/domain/vat";
import { formatAmount, formatDate, formatRelative, formatMoney, greeting } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { StatTile } from "@/components/reports/report-charts";
import { RecordEmpty, RecordFilterLinks, RecordHeader, RecordPagination, recordButton } from "@/components/records/record-layout";
import { NavigationForm } from "@/components/navigation/navigation-form";
import { getCurrentUser } from "@/lib/org";


const PAGE_SIZE = 40;

/**
 * Journey 1: every client company on one screen. What is due to the Tax
 * Department and when, what the bank says that the books do not yet, what is
 * waiting to be reviewed, who owes money, and where each set of books is locked.
 */
export default async function PracticeDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ clients, totals, today }, deadlines, files, user, query] = await Promise.all([getPracticeDashboard(), getDeadlines(), getClientFiles(), getCurrentUser(), searchParams]);
  // Hundreds of clients: the ones that need something first, a page at a time, narrowed to yours or to a search.
  const pressing = (client: (typeof clients)[number]) => (client.vat && client.vat.state === "overdue" ? 10_000 : 0) + (client.vat && client.vat.state !== "open" && client.vat.daysLeft <= 30 ? 5_000 : 0)
    + client.toReview * 100 + (client.overdue > 0 ? 50 : 0) + Math.min(client.bankLines, 49);
  const view = query.view === "mine" || query.view === "attention" ? query.view : "all";
  const term = (query.q ?? "").trim().toLowerCase();
  const plainNumber = (text: string | null) => (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const matching = clients.filter(client => !term || client.org.name.toLowerCase().includes(term) || (term.replace(/[^a-z0-9]/g, "").length > 2 && [client.org.he_number, client.org.vat_number].some(number => plainNumber(number).includes(term.replace(/[^a-z0-9]/g, "")))));
  const mine = matching.filter(client => client.org.manager === user.name), needing = matching.filter(client => pressing(client) >= 50);
  const listed = (view === "mine" ? mine : view === "attention" ? needing : matching).sort((a, b) => pressing(b) - pressing(a) || a.org.name.localeCompare(b.org.name));
  const page = Math.max(1, Math.min(Number(query.page) || 1, Math.ceil(listed.length / PAGE_SIZE) || 1));
  const shown = listed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const vatToPay = await getVatToPay(shown);
  const href = (next: { view?: string }) => {
    const params = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== "all") params.set("view", v);
    if (term) params.set("q", query.q!.trim());
    return `/${params.size ? `?${params}` : ""}`;
  };
  const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  const cell = "px-3 py-2.5 align-top text-[13px]";
  return <PageBody className="space-y-4">
    <RecordHeader eyebrow={formatDate(today)}
      title={`${greeting()}. ${totals.clients} clients, ${totals.vatDueSoon ? `${totals.vatDueSoon} VAT return${totals.vatDueSoon === 1 ? "" : "s"} due within 30 days` : "no VAT return due within 30 days"}.`}
      action={<Link href="/capture" className={recordButton}><ScanText className="size-4" />Capture documents</Link>} />

    <section aria-label="Practice totals" className="ll-panel bg-hairline grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 xl:grid-cols-5 [&>*]:bg-surface">
      <StatTile label="Client companies" value={String(totals.clients)} context={`${clients.filter(client => client.org.vat_registered).length} registered for VAT`} />
      <StatTile label="Deadlines, next 30 days" value={String(deadlines.counts.next30)} tone={deadlines.counts.overdue ? "critical" : undefined} context={deadlines.counts.overdue ? `${deadlines.counts.overdue} overdue as well` : "Nothing overdue"} href="/deadlines" />
      <StatTile label="Bank lines to reconcile" value={String(totals.bankLines)} context="Imported, not yet matched" />
      <StatTile label="Documents to review" value={String(totals.toReview)} context={totals.unrouted ? `${totals.unrouted} not yet routed to a client` : "Read by Claude, waiting for you"} href="/capture" />
      <StatTile label="Overdue receivables" value={totals.overdue.length ? totals.overdue.map(([currency, sum]) => formatMoney(sum, currency)).join(" · ") : formatMoney(0, "EUR")} tone={totals.overdue.length ? "critical" : undefined} context={`${totals.overdueCount} invoice${totals.overdueCount === 1 ? "" : "s"} past due, all clients`} />
    </section>

    {files.onboarding.length ? <section aria-label="Taking on" className="ll-panel overflow-hidden">
      <header className="border-hairline flex items-center justify-between border-b px-4 py-2"><h2 className="text-ink text-[13.5px] font-semibold">Taking on</h2><Link href="/clients" className="text-brand text-[12.5px] hover:underline">Client files</Link></header>
      <ul className="divide-hairline divide-y">{files.onboarding.map(file => <li key={file.id}><Link href={`/clients/${file.id}`} className="hover:bg-surface-sunken flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-[13px]">
        <span className="text-ink font-medium">{file.company_name}<span className="text-ink-faint font-normal"> · {file.done} of {file.steps.length} steps</span></span>
        <span className={file.ready ? "text-positive font-medium" : "text-ink-muted"}>{file.ready ? "Ready: open the books" : file.next ? `Next: ${inSentence(file.next.todo)}` : ""}</span>
      </Link></li>)}</ul>
    </section> : null}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <RecordFilterLinks label="Clients" options={[{ label: `Needing something · ${needing.length}`, href: href({ view: "attention" }), active: view === "attention" },
        { label: `Yours · ${mine.length}`, href: href({ view: "mine" }), active: view === "mine" }, { label: `All · ${matching.length}`, href: href({ view: "all" }), active: view === "all" }]} />
      <NavigationForm action="/" method="get" className="border-hairline-strong bg-surface flex h-8 w-full items-center gap-2 rounded-md border px-2.5 sm:w-72">
        {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
        <input name="q" defaultValue={query.q ?? ""} placeholder="Find a client: name, HE or VAT number" aria-label="Find a client" className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
      </NavigationForm>
    </div>

    <section aria-label="Clients" className="ll-panel overflow-x-auto">
      {shown.length ? <table className="w-full min-w-[980px] border-collapse">
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
          {shown.map(({ org, vat, bankLines, bankAccountId, toReview, overdue, overdueCount, lastActivity }) => <tr key={org.id} className="hover:bg-surface-sunken group">
            <td className={cell}>
              <Link href={`/c/${org.slug}`} className="text-ink group-hover:text-brand flex items-center gap-1.5 text-[13.5px] font-medium">{org.name}<ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" /></Link>
              <span className="text-ink-faint block text-[12px]">{org.industry} · {org.he_number}</span>
            </td>
            <td className={cell}>
              {!vat ? <span className="text-ink-faint">Not registered for VAT</span> : <Link href={`/c/${org.slug}/reports/vat?range=custom&from=${vat.from}&to=${vat.to}`} className="block hover:underline">
                <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium", vat.state === "open" ? "text-ink" : vat.daysLeft <= 30 ? "text-critical" : "text-caution")}>
                  {vat.state === "open" ? null : <AlertTriangle className="size-3.5" />}
                  {quarterLabel(vat.from, vat.to)} · due {formatDate(vat.due)}
                </span>
                <span className="text-ink-faint block text-[12px]">
                  {vat.state === "open" ? "Quarter running" : vat.state === "overdue" ? `${-vat.daysLeft} days overdue` : `${vat.daysLeft} days left, not filed`} · {(vatToPay.get(org.id) ?? 0) >= 0 ? `${formatAmount(vatToPay.get(org.id) ?? 0, org.currency)} to pay` : `${formatAmount(-(vatToPay.get(org.id) ?? 0), org.currency)} to reclaim`}
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
              {overdue ? <Link href={`/c/${org.slug}/reports/aged-receivables`} className="text-critical font-medium hover:underline">{formatAmount(overdue, org.currency)}</Link> : <span className="text-ink-faint">—</span>}
              {overdueCount ? <span className="text-ink-faint block text-[12px]">{overdueCount} invoice{overdueCount === 1 ? "" : "s"}</span> : null}
            </td>
            <td className={cell}>{org.lock_date ? <span className="text-ink-muted inline-flex items-center gap-1 whitespace-nowrap"><Lock className="size-3" />{formatDate(org.lock_date)}</span> : <span className="text-ink-faint">Not locked</span>}</td>
            <td className={cn(cell, "text-ink-muted whitespace-nowrap")}>{lastActivity ? formatRelative(lastActivity) : "—"}</td>
          </tr>)}
        </tbody>
      </table> : <RecordEmpty title={term ? `No client matches “${query.q}”` : view === "mine" ? "None of your clients needs anything" : "Nothing needs doing"}>{term ? "Try part of the name, or the HE or VAT number." : "Every client is up to date."}</RecordEmpty>}
      {listed.length > PAGE_SIZE ? <RecordPagination page={page} total={listed.length} pageSize={PAGE_SIZE} href={href({})} /> : null}
    </section>
    <p className="text-ink-faint text-[12px]">Each company keeps its own double-entry ledger. A document can only post to its own company&apos;s accounts: the database enforces it.</p>
  </PageBody>;
}
