import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";
import { AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, CalendarClock, CheckCircle2, FilePen, FileText, Inbox, Landmark, Percent, Receipt, Repeat, ScanText, type LucideIcon } from "lucide-react";

import { getCompanyHome, getGettingStarted } from "@/lib/data/home";
import { getDeadlines } from "@/lib/data/deadlines";
import { getCurrentUser, getMembership, getPractice } from "@/lib/org";
import { quarterLabel } from "@/lib/domain/vat";
import { firstName, formatAgo, formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel, PanelHeader } from "@/components/common/primitives";
import { AddTodo, TaskCheck } from "@/components/crm/forms";
import { getWorkspace } from "@/lib/data/workspace";
import { uses } from "@/lib/domain/business-types";
import { dueTone } from "@/components/crm/badges";
import { StatTile } from "@/components/reports/report-charts";
import { RecordHeader } from "@/components/records/record-layout";
import { GettingStartedSteps } from "@/components/home/getting-started";

export const metadata: Metadata = { title: "Home" };

type Action = { href: string; label: string; hint: string; icon: LucideIcon };
type Attention = { key: string; href: string; icon: LucideIcon; tone: "critical" | "caution" | "neutral"; title: string; detail: string };

/**
 * One company's home, for the person who runs it: the everyday actions as
 * large buttons, the three figures that matter, the few things that need
 * doing, and the to-dos. The accountant's views are under Reports and More.
 */
export default async function CompanyHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [home, query, membership] = await Promise.all([getCompanyHome(), searchParams, getMembership()]);
  const deadlines = (await getDeadlines({ client: home.org.slug })).rows.filter(row => row.kind !== "vat_return" && (row.state === "overdue" || (row.state === "due" && row.daysLeft <= 14)));
  const { org, today, cash, receivables, payables, vat } = home;
  const [workspace, start] = await Promise.all([getWorkspace(org.id), getGettingStarted(org)]);
  const welcome = query.joined && !membership.practice ? await Promise.all([getCurrentUser(), getPractice()]) : null;
  const capture = `/c/${org.slug}/capture`;
  const actions: Action[] = [
    { href: "/invoices/new", label: "Raise an invoice", hint: "Bill a customer, get the PDF", icon: FileText },
    { href: "/accounts/bills/new", label: "Record a bill", hint: "A supplier's invoice or an expense", icon: Receipt },
    { href: capture, label: "Upload a receipt", hint: "A photo or PDF: read for you", icon: ScanText },
    { href: "/accounts/bank/new?kind=receive", label: "Money in", hint: "Received, not from an invoice", icon: ArrowDownLeft },
    { href: "/accounts/bank/new?kind=spend", label: "Money out", hint: "Spent, without a bill", icon: ArrowUpRight },
    { href: "/accounts/quotes/new", label: "Write a quote", hint: "Becomes the invoice when accepted", icon: FilePen },
  ].filter(action => action.href !== "/accounts/quotes/new" || uses(workspace, "quotes"));

  const attention: Attention[] = [];
  for (const invoice of receivables.late) attention.push({ key: `i${invoice.id}`, href: `/invoices/${invoice.id}`, icon: FileText, tone: "critical",
    title: `${invoice.client_name} owes ${formatAmount(invoice.balance)}`, detail: `Invoice ${invoice.number} · ${invoice.days_overdue} days overdue` });
  if (receivables.overdueCount > receivables.late.length) attention.push({ key: "more-late", href: "/invoices?view=overdue", icon: FileText, tone: "critical",
    title: `${receivables.overdueCount - receivables.late.length} more overdue invoice${receivables.overdueCount - receivables.late.length === 1 ? "" : "s"}`, detail: "Chase them from the invoice list" });
  for (const bill of payables.due) attention.push({ key: `b${bill.id}`, href: `/accounts/bills/${bill.id}`, icon: Receipt, tone: bill.days_overdue > 0 ? "critical" : "caution",
    title: `Pay ${bill.supplier_name} ${formatAmount(bill.balance)}`, detail: `${bill.number ? `Bill ${bill.number} · ` : ""}${bill.days_overdue > 0 ? `${bill.days_overdue} days overdue` : `due ${formatDate(bill.due_on)}`}` });
  for (const row of deadlines) attention.push({ key: row.key, href: row.review ? `/clients/${row.review.fileId}` : `/c/${org.slug}/deadlines`, icon: CalendarClock, tone: row.state === "overdue" ? "critical" : "caution",
    title: row.title, detail: row.state === "overdue" ? `${-row.daysLeft} days overdue: due ${formatDate(row.due)}` : `Due ${formatDate(row.due)}, in ${row.daysLeft} days` });
  const pipelineWords = workspace.labels.deal;
  if (home.waitingEnquiries.count) attention.push({ key: "enquiries", href: `/c/${org.slug}/crm/pipeline`, icon: Inbox, tone: "critical",
    title: `${home.waitingEnquiries.count} ${(home.waitingEnquiries.count === 1 ? pipelineWords[0] : pipelineWords[1]).toLowerCase()} waiting for a reply`, detail: `The oldest arrived ${formatAgo(home.waitingEnquiries.oldest)}: nobody has answered yet` });
  if (home.vatUnconfirmed.length) attention.push({ key: "vies", href: home.vatUnconfirmed.length === 1 ? `/c/${org.slug}/customers/${home.vatUnconfirmed[0].id}` : membership.practice ? "/vat-numbers" : `/c/${org.slug}/customers`, icon: BadgeCheck, tone: "caution",
    title: `${home.vatUnconfirmed.length} EU customer${home.vatUnconfirmed.length === 1 ? "’s VAT number" : "s’ VAT numbers"} to confirm in VIES`,
    detail: `${home.vatUnconfirmed.map(customer => customer.name).join(", ")}: sales to ${home.vatUnconfirmed.length === 1 ? "it" : "them"} are zero-rated` });
  if (home.toReview) attention.push({ key: "capture", href: capture, icon: ScanText, tone: "caution",
    title: `${home.toReview} document${home.toReview === 1 ? "" : "s"} to check`, detail: "Read and drafted as bills: confirm and post" });
  if (home.bankLines.count) attention.push({ key: "bank", href: home.bankLines.bankAccountId ? `/accounts/bank/${home.bankLines.bankAccountId}` : "/accounts/bank", icon: Landmark, tone: "neutral",
    title: `${home.bankLines.count} bank line${home.bankLines.count === 1 ? "" : "s"} to match`, detail: "From the latest statement" });
  if (vat && vat.state !== "open") attention.push({ key: "vat", href: `/accounts/reports/vat?range=custom&from=${vat.from}&to=${vat.to}`, icon: Percent, tone: vat.state === "overdue" || vat.daysLeft <= 14 ? "critical" : "caution",
    title: `VAT return for ${quarterLabel(vat.from, vat.to)}`, detail: vat.state === "overdue" ? `${-vat.daysLeft} days overdue` : `Due ${formatDate(vat.due)}, in ${vat.daysLeft} days` });
  if (home.repeatingDue) attention.push({ key: "repeating", href: "/accounts/repeating", icon: Repeat, tone: "caution",
    title: `${home.repeatingDue} repeating invoice${home.repeatingDue === 1 ? "" : "s"} due`, detail: "Raise them in one press, each on its own date" });
  if (home.unsent) attention.push({ key: "unsent", href: "/invoices?view=unsent", icon: FileText, tone: "neutral",
    title: `${home.unsent} invoice${home.unsent === 1 ? "" : "s"} not sent yet`, detail: "Issued and in the books: send them to the customers" });
  if (home.drafts) attention.push({ key: "drafts", href: "/invoices?view=draft", icon: FileText, tone: "neutral",
    title: `${home.drafts} draft invoice${home.drafts === 1 ? "" : "s"}`, detail: "Not sent and not in the books until issued" });
  if (home.quotes.count) attention.push({ key: "quotes", href: "/accounts/quotes", icon: FilePen, tone: "neutral",
    title: `${home.quotes.count} quote${home.quotes.count === 1 ? "" : "s"} waiting on customers`, detail: `${formatAmount(home.quotes.total)} if accepted` });
  const tasks = home.tasks.slice(0, 6);

  return <PageBody width="6xl" className="space-y-5">
    <RecordHeader title={org.name} description={`${org.industry}${org.vat_registered ? ` · VAT ${org.vat_number}` : " · not registered for VAT"}`} />

    {welcome ? <p role="status" className="border-positive-line bg-positive-soft flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2.5 text-[13px]">
      <CheckCircle2 className="text-positive size-4 shrink-0" /><span className="text-positive font-medium">Welcome to Ledgerline, {firstName(welcome[0].name)}.</span>
      <span className="text-ink-muted">{welcome[1].name} keeps {org.name}’s books, and you see them here as they stand.{start ? " The steps below get you going." : ""}</span>
    </p> : null}

    {query.opened ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2.5 text-[13px]">
      <CheckCircle2 className="size-4 shrink-0" /><span className="font-medium">{org.name} is taken on, and its books are open{org.books_from ? ` from ${formatDate(String(org.books_from).slice(0, 10))}` : ""}.</span>
      <span className="text-ink-muted">Its deadlines and fee are set. Next: <Link href={`/c/${org.slug}/journals/new`} className="text-brand font-medium hover:underline">bring in the opening balances</Link>, or <Link href={`/c/${org.slug}/bank`} className="text-brand font-medium hover:underline">import the first bank statement</Link>.</span>
    </p> : null}

    {start ? <GettingStartedSteps start={start} org={org} practice={Boolean(membership.practice)} customers={workspace.labels.customer[1]} /> : null}

    <nav aria-label="Everyday actions" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {actions.map((action, index) => <Link key={action.label} href={action.href}
        className={cn("group flex min-h-[92px] flex-col gap-2.5 rounded-lg border p-3 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          index === 0 ? "bg-brand border-brand hover:bg-brand-dark text-white" : "bg-surface border-hairline hover:border-brand-200 hover:bg-brand-50")}>
        <action.icon className={cn("size-5", index === 0 ? "text-white" : "text-brand")} />
        <span><span className={cn("block text-[13.5px] leading-tight font-semibold", index === 0 ? "text-white" : "text-ink")}>{action.label}</span>
          <span className={cn("mt-0.5 block text-[12px] leading-snug", index === 0 ? "text-white/80" : "text-ink-muted")}>{action.hint}</span></span>
      </Link>)}
    </nav>

    <section aria-label="Key figures" className="ll-panel bg-hairline grid gap-px overflow-hidden sm:grid-cols-3 [&>*]:bg-surface">
      <StatTile label="In the bank" value={formatAmount(cash.total)} tone={cash.total < 0 ? "critical" : undefined} context={`${cash.accounts} account${cash.accounts === 1 ? "" : "s"}`} href="/accounts/bank" />
      <StatTile label="Customers owe you" value={formatAmount(receivables.owed)} context={receivables.overdue ? `${formatAmount(receivables.overdue)} overdue` : "Nothing overdue"} href="/invoices?view=open" />
      <StatTile label="You owe suppliers" value={formatAmount(payables.owed)} tone={payables.overdue ? "critical" : undefined} context={payables.overdue ? `${formatAmount(payables.overdue)} overdue` : payables.dueThisWeek ? `${formatAmount(payables.dueThisWeek)} due this week` : "Nothing overdue"} href="/accounts/bills" />
    </section>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader title="Needs attention" count={attention.length || undefined} />
        {attention.length ? <ul className="divide-hairline divide-y">{attention.map(item => <li key={item.key}>
          <Link href={item.href} className="hover:bg-surface-sunken group flex items-center gap-3 px-4 py-2.5 touch:min-h-12">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", item.tone === "critical" ? "bg-critical-soft text-critical" : item.tone === "caution" ? "bg-caution-soft text-caution" : "bg-surface-sunken text-ink-muted")}>
              {item.tone === "critical" ? <AlertTriangle className="size-3.5" /> : <item.icon className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1"><span className="text-ink block truncate text-[13.5px] font-medium">{item.title}</span><span className="text-ink-muted block truncate text-[12.5px]">{item.detail}</span></span>
            <ArrowRight className="text-ink-faint group-hover:text-brand size-3.5 shrink-0" />
          </Link>
        </li>)}</ul> : <p className="text-ink-muted flex items-center gap-2 px-4 py-4 text-[13px]"><CheckCircle2 className="text-positive size-4" />Nothing needs attention. The books are up to date.</p>}
      </Panel>

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader title="To-dos" count={home.tasks.length || undefined} action={<Link href={`/c/${org.slug}/crm/tasks`} className="text-brand text-[12.5px]">All tasks</Link>} />
        <div className="p-3"><AddTodo /></div>
        {tasks.length ? <ul className="divide-hairline border-hairline divide-y border-t">{tasks.map(task => <li key={task.id} className="flex items-center gap-3 px-4 py-2">
          <TaskCheck id={task.id} done={Boolean(task.done_at)} />
          <span className="min-w-0 flex-1"><span className="text-ink block truncate text-[13px]">{task.title}</span>{task.link_label ? <span className="text-ink-faint block truncate text-[11.5px]">{task.link_kind ? `${workspace.labels[task.link_kind][0]} · ` : ""}{task.link_label}</span> : null}</span>
          <span className={cn("shrink-0 text-[12.5px] tabular-nums", dueTone(task.due_on, today))}>{task.due_on ? formatDate(task.due_on) : ""}</span>
        </li>)}</ul> : null}
      </Panel>
    </div>
  </PageBody>;
}
