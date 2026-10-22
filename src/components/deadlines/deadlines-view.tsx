import Link from "@/components/navigation/navigation-link";

import { markDeadlineDone, reopenDeadline } from "@/lib/actions/deadlines";
import { DEADLINE_VIEWS, getDeadlines, type DeadlineRow } from "@/lib/data/deadlines";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { InlineSubmit, SubmitButton } from "@/components/common/form-fields";
import { StatTile } from "@/components/reports/report-charts";
import { RecordBadge, RecordEmpty, RecordFilterLinks, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const monthOf = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function Status({ row }: { row: DeadlineRow }) {
  if (row.state === "done") return <RecordBadge tone="positive">Done {formatDate(row.doneOn).replace(/ \d{4}$/, "")}</RecordBadge>;
  if (row.state === "overdue") return <RecordBadge tone="critical">{-row.daysLeft} day{row.daysLeft === -1 ? "" : "s"} overdue</RecordBadge>;
  if (row.state === "running") return <RecordBadge>Period running</RecordBadge>;
  return <RecordBadge tone={row.daysLeft <= 14 ? "caution" : "neutral"}>{row.daysLeft === 0 ? "Due today" : `In ${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"}`}</RecordBadge>;
}

function Detail({ row }: { row: DeadlineRow }) {
  const base = `/c/${row.company.slug}`;
  if (row.state === "done") return <span>{row.kind === "vat_return" ? row.doneBy : `Marked done by ${row.doneBy}`}</span>;
  if (row.kind === "vat_return") {
    if (row.state === "running") return <span>The quarter ends {formatDate(row.periodEnd)}</span>;
    const { bankLines, documents } = row.ready ?? { bankLines: 0, documents: 0 };
    if (!bankLines && !documents) return <span className="text-positive">Ready to file: every bank line in the quarter is matched</span>;
    return <span>{bankLines ? <Link href={`${base}/bank`} className="hover:text-brand underline-offset-2 hover:underline">{bankLines} bank line{bankLines === 1 ? "" : "s"} to match</Link> : null}
      {bankLines && documents ? " · " : null}{documents ? <Link href={`${base}/capture`} className="hover:text-brand underline-offset-2 hover:underline">{documents} document{documents === 1 ? "" : "s"} to check</Link> : null}</span>;
  }
  if (row.kind === "vies") return <span>{formatAmount(row.amount)} of services to EU businesses</span>;
  if (row.kind === "provisional_tax") return <span>Estimate the year’s profit and pay the instalment</span>;
  return <span>For the tax year {row.periodEnd.slice(0, 4)}</span>;
}

function Action({ row }: { row: DeadlineRow }) {
  const base = `/c/${row.company.slug}`;
  const hidden = <><input type="hidden" name="organisation_id" value={row.company.id} /><input type="hidden" name="kind" value={row.kind} /><input type="hidden" name="period_end" value={row.periodEnd} /></>;
  if (row.kind === "vat_return") return row.state === "done" ? null
    : <Link href={`${base}/reports/vat?range=custom&from=${row.periodStart}&to=${row.periodEnd}`} className={recordOutlineButton}>Open the return</Link>;
  if (row.state === "done") return <form action={reopenDeadline}>{hidden}<InlineSubmit title="Open this deadline again">Undo</InlineSubmit></form>;
  return <div className="flex flex-wrap items-center justify-end gap-2">
    {row.kind === "vies" ? <Link href={`${base}/reports/vies?range=custom&from=${row.periodStart}&to=${row.periodEnd}`} className="text-brand text-[12px] hover:underline">Statement</Link> : null}
    {row.state !== "running" ? <form action={markDeadlineDone}>{hidden}<SubmitButton size="sm" variant="outline" pendingLabel="Saving…">Mark done</SubmitButton></form> : null}
  </div>;
}

/**
 * Deadlines, worked out from the books: every client's at practice level, or
 * one company's inside it. `company` fixes the client and hides the choice.
 */
export async function DeadlinesView({ query, company }: { query: Record<string, string | undefined>; company?: string }) {
  const view = DEADLINE_VIEWS.find(item => item.key === query.view)?.key ?? "all";
  const data = await getDeadlines({ view, client: company ?? query.client });
  const path = company ? `/c/${company}/deadlines` : "/deadlines";
  const client = company ? null : data.clients.find(item => item.slug === query.client);
  const groups = new Map<string, DeadlineRow[]>();
  for (const row of data.rows) {
    const group = row.state === "overdue" ? "Overdue" : monthOf(row.due);
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  const href = (next: { view?: string; client?: string | null }) => {
    const params = new URLSearchParams();
    const v = next.view ?? view, c = company ? null : next.client === undefined ? query.client : next.client;
    if (v !== "all") params.set("view", v);
    if (c) params.set("client", c);
    return `${path}${params.size ? `?${params}` : ""}`;
  };

  return <PageBody className="space-y-4">
    <RecordHeader title={client ? `Deadlines: ${client.name}` : "Deadlines"}
      description={company ? "This company’s VAT returns, VIES statements, provisional tax and tax returns, worked out from its VAT quarters and tax year. Filing a VAT return closes its deadline; mark the rest done as you go." : "Every VAT return, VIES statement, provisional tax instalment and company tax return, worked out from each company’s VAT quarters and tax year. Filing a VAT return closes its deadline; mark the rest done as you go."} />

    <section aria-label="Deadlines at a glance" className="ll-panel bg-hairline grid grid-cols-2 gap-px overflow-hidden lg:grid-cols-4 [&>*]:bg-surface">
      <StatTile label="Overdue" value={String(data.counts.overdue)} tone={data.counts.overdue ? "critical" : undefined} context={data.counts.overdue ? "Past the date, still open" : "Nothing past its date"} href={href({ view: "overdue" })} />
      <StatTile label="Due in 30 days" value={String(data.counts.next30)} context="Across every client" />
      <StatTile label="Yours" value={String(data.counts.mine)} context={`Open, for the companies ${data.user.name.split(" ")[0]} looks after`} href={href({ view: "mine" })} />
      <StatTile label="Done this month" value={String(data.counts.done)} context="Filed in Ledgerline or marked done" />
    </section>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <RecordFilterLinks label="Show" options={DEADLINE_VIEWS.map(item => ({ label: item.label, href: href({ view: item.key }), active: view === item.key }))} />
      {company ? null : <RecordFilterLinks label="Client" options={[{ label: "All clients", href: href({ client: null }), active: !client }, ...data.clients.map(item => ({ label: item.name.replace(/ (Ltd|Limited)$/, ""), href: href({ client: item.slug }), active: client?.slug === item.slug }))]} />}
    </div>

    {data.rows.length ? [...groups].map(([group, rows]) => <Panel key={group} className="overflow-hidden">
      <h2 className={cn("border-hairline bg-surface-sunken border-b px-4 py-2 text-[11px] font-semibold tracking-[0.06em] uppercase", group === "Overdue" ? "text-critical" : "text-ink-faint")}>{group}</h2>
      <ul className="divide-hairline divide-y">{rows.map(row => <li key={row.key} className={cn("grid items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_9rem_8.5rem_8.5rem]", row.state === "done" && "opacity-70")}>
        <span className="text-ink-faint flex items-baseline gap-1.5 text-[11.5px] sm:block"><b className="text-ink block text-[17px] leading-tight font-semibold tabular-nums">{formatDate(row.due).replace(/ \d{4}$/, "")}</b>{weekday(row.due)}</span>
        <span className="min-w-0">
          <span className="text-ink block text-[13px] font-medium">{row.title}</span>
          <span className="text-ink-muted block text-[12px]"><Link href={`/c/${row.company.slug}`} className="text-ink hover:text-brand hover:underline">{row.company.name}</Link> · <Detail row={row} /></span>
        </span>
        <span className="text-ink-muted text-[12px]">{row.company.manager ?? "No one yet"}</span>
        <span><Status row={row} /></span>
        <span className="sm:text-right"><Action row={row} /></span>
      </li>)}</ul>
    </Panel>) : <Panel><RecordEmpty title={view === "overdue" ? "Nothing is overdue" : "No deadlines here"}>{view === "overdue" ? "Every deadline past its date has been dealt with." : "Nothing falls due in the next three months for this choice."}</RecordEmpty></Panel>}
    <p className="text-ink-faint text-[12px]">Showing what is overdue and what falls due by {formatDate(data.until)}. VIES statements appear for the months a company sold services to businesses in other EU states.</p>
  </PageBody>;
}
