import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";
import { AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, CalendarClock, CheckCircle2, FilePen, FileText, Inbox, Landmark, Percent, Receipt, Repeat, ScanText, type LucideIcon } from "lucide-react";

import { getCompanyHome, getGettingStarted } from "@/lib/data/home";
import { getDeadlines } from "@/lib/data/deadlines";
import { getCurrentUser, getMembership, getPractice } from "@/lib/org";
import { quarterLabel } from "@/lib/domain/vat";
import { firstName } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { deadlineTitle, quarterIn } from "@/lib/i18n/deadlines";
import { cn } from "@/lib/utils";
import { PageBody, Panel, PanelHeader } from "@/components/common/primitives";
import { AddTodo, TaskCheck } from "@/components/crm/forms";
import { getWorkspace } from "@/lib/data/workspace";
import { uses } from "@/lib/domain/business-types";
import { dueTone } from "@/components/crm/badges";
import { StatTile } from "@/components/reports/report-charts";
import { RecordHeader } from "@/components/records/record-layout";
import { GettingStartedSteps } from "@/components/home/getting-started";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Home") };
}

type Action = { href: string; label: string; hint: string; icon: LucideIcon };
/** How much of what needs attention a phone shows before "Show all". */
const PHONE_ATTENTION = 5;
type Attention = { key: string; href: string; icon: LucideIcon; tone: "critical" | "caution" | "neutral"; title: string; detail: string };

/**
 * One company's home, for the person who runs it: the everyday actions as
 * large buttons, the three figures that matter, the few things that need
 * doing, and the to-dos. The accountant's views are under Reports and More.
 */
export default async function CompanyHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [home, query, membership, { t, locale, formatAgo, formatAmount, formatDate }] = await Promise.all([getCompanyHome(), searchParams, getMembership(), getI18n()]);
  const deadlines = (await getDeadlines({ client: home.org.slug })).rows.filter(row => row.kind !== "vat_return" && (row.state === "overdue" || (row.state === "due" && row.daysLeft <= 14)));
  const { org, today, cash, receivables, payables, vat } = home;
  const [workspace, start] = await Promise.all([getWorkspace(org.id), getGettingStarted(org)]);
  const welcome = query.joined && !membership.practice ? await Promise.all([getCurrentUser(), getPractice()]) : null;
  const capture = `/c/${org.slug}/capture`;
  const actions: Action[] = [
    { href: "/invoices/new", label: t("Raise an invoice"), hint: t("Bill a customer, get the PDF"), icon: FileText },
    { href: "/accounts/bills/new", label: t("Record a bill"), hint: t("A supplier's invoice or an expense"), icon: Receipt },
    { href: capture, label: t("Upload a receipt"), hint: t("A photo or PDF: read for you"), icon: ScanText },
    { href: "/accounts/bank/new?kind=receive", label: t("Money in"), hint: t("Received, not from an invoice"), icon: ArrowDownLeft },
    { href: "/accounts/bank/new?kind=spend", label: t("Money out"), hint: t("Spent, without a bill"), icon: ArrowUpRight },
    { href: "/accounts/quotes/new", label: t("Write a quote"), hint: t("Becomes the invoice when accepted"), icon: FilePen },
  ].filter(action => action.href !== "/accounts/quotes/new" || uses(workspace, "quotes"));

  const attention: Attention[] = [];
  for (const invoice of receivables.late) attention.push({ key: `i${invoice.id}`, href: `/invoices/${invoice.id}`, icon: FileText, tone: "critical",
    title: t("{name} owes {amount}", { name: invoice.client_name, amount: formatAmount(invoice.balance) }),
    detail: `${t("Invoice {number}", { number: invoice.number })} · ${t.n(invoice.days_overdue, "{count} day overdue", "{count} days overdue")}` });
  if (receivables.overdueCount > receivables.late.length) attention.push({ key: "more-late", href: "/invoices?view=overdue", icon: FileText, tone: "critical",
    title: t.n(receivables.overdueCount - receivables.late.length, "{count} more overdue invoice", "{count} more overdue invoices"), detail: t("Chase them from the invoice list") });
  for (const bill of payables.due) attention.push({ key: `b${bill.id}`, href: `/accounts/bills/${bill.id}`, icon: Receipt, tone: bill.days_overdue > 0 ? "critical" : "caution",
    title: t("Pay {name} {amount}", { name: bill.supplier_name, amount: formatAmount(bill.balance) }),
    detail: [bill.number ? t("Bill {number}", { number: bill.number }) : null, bill.days_overdue > 0 ? t.n(bill.days_overdue, "{count} day overdue", "{count} days overdue") : t("due {date}", { date: formatDate(bill.due_on) })].filter(Boolean).join(" · ") });
  for (const row of deadlines) attention.push({ key: row.key, href: row.review ? `/clients/${row.review.fileId}` : `/c/${org.slug}/deadlines`, icon: CalendarClock, tone: row.state === "overdue" ? "critical" : "caution",
    title: deadlineTitle(row.title, locale), detail: row.state === "overdue" ? t.n(-row.daysLeft, "{count} day overdue: due {date}", "{count} days overdue: due {date}", { date: formatDate(row.due) })
      : t.n(row.daysLeft, "Due {date}, in {count} day", "Due {date}, in {count} days", { date: formatDate(row.due) }) });
  const pipelineWords = workspace.labels.deal;
  if (home.waitingEnquiries.count) attention.push({ key: "enquiries", href: `/c/${org.slug}/crm/pipeline`, icon: Inbox, tone: "critical",
    title: t("{count} {noun} waiting for a reply", { count: home.waitingEnquiries.count, noun: t(home.waitingEnquiries.count === 1 ? pipelineWords[0] : pipelineWords[1]).toLowerCase() }),
    detail: t("The oldest arrived {ago}: nobody has answered yet", { ago: formatAgo(home.waitingEnquiries.oldest) }) });
  if (home.vatUnconfirmed.length) attention.push({ key: "vies", href: home.vatUnconfirmed.length === 1 ? `/c/${org.slug}/customers/${home.vatUnconfirmed[0].id}` : membership.practice ? "/vat-numbers" : `/c/${org.slug}/customers`, icon: BadgeCheck, tone: "caution",
    title: t.n(home.vatUnconfirmed.length, "{count} EU customer’s VAT number to confirm in VIES", "{count} EU customers’ VAT numbers to confirm in VIES"),
    detail: t.n(home.vatUnconfirmed.length, "{names}: sales to it are zero-rated", "{names}: sales to them are zero-rated", { names: home.vatUnconfirmed.map(customer => customer.name).join(", ") }) });
  if (home.toReview) attention.push({ key: "capture", href: capture, icon: ScanText, tone: "caution",
    title: t.n(home.toReview, "{count} document to check", "{count} documents to check"), detail: t("Read and drafted as bills: confirm and post") });
  if (home.bankLines.count) attention.push({ key: "bank", href: home.bankLines.bankAccountId ? `/accounts/bank/${home.bankLines.bankAccountId}` : "/accounts/bank", icon: Landmark, tone: "neutral",
    title: t.n(home.bankLines.count, "{count} bank line to match", "{count} bank lines to match"), detail: t("From the latest statement") });
  if (vat && vat.state !== "open") attention.push({ key: "vat", href: `/accounts/reports/vat?range=custom&from=${vat.from}&to=${vat.to}`, icon: Percent, tone: vat.state === "overdue" || vat.daysLeft <= 14 ? "critical" : "caution",
    title: t("VAT return for {quarter}", { quarter: quarterIn(quarterLabel(vat.from, vat.to), locale) }),
    detail: vat.state === "overdue" ? t.n(-vat.daysLeft, "{count} day overdue", "{count} days overdue") : t.n(vat.daysLeft, "Due {date}, in {count} day", "Due {date}, in {count} days", { date: formatDate(vat.due) }) });
  if (home.repeatingDue) attention.push({ key: "repeating", href: "/accounts/repeating", icon: Repeat, tone: "caution",
    title: t.n(home.repeatingDue, "{count} repeating invoice due", "{count} repeating invoices due"), detail: t("Raise them in one press, each on its own date") });
  if (home.unsent) attention.push({ key: "unsent", href: "/invoices?view=unsent", icon: FileText, tone: "neutral",
    title: t.n(home.unsent, "{count} invoice not sent yet", "{count} invoices not sent yet"), detail: t("Issued and in the books: send them to the customers") });
  if (home.drafts) attention.push({ key: "drafts", href: "/invoices?view=draft", icon: FileText, tone: "neutral",
    title: t.n(home.drafts, "{count} draft invoice", "{count} draft invoices"), detail: t("Not sent and not in the books until issued") });
  if (home.quotes.count) attention.push({ key: "quotes", href: "/accounts/quotes", icon: FilePen, tone: "neutral",
    title: t.n(home.quotes.count, "{count} quote waiting on customers", "{count} quotes waiting on customers"), detail: t("{amount} if accepted", { amount: formatAmount(home.quotes.total) }) });
  const tasks = home.tasks.slice(0, 6);

  return <PageBody width="6xl" className="space-y-5">
    <RecordHeader title={org.name} description={`${org.industry} · ${org.vat_registered ? t("VAT {number}", { number: org.vat_number }) : t("not registered for VAT")}`} />

    {welcome ? <p role="status" className="border-positive-line bg-positive-soft flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2.5 text-[13px]">
      <CheckCircle2 className="text-positive size-4 shrink-0" /><span className="text-positive font-medium">{t("Welcome to Ledgerline, {name}.", { name: firstName(welcome[0].name) })}</span>
      <span className="text-ink-muted">{t("{practice} keeps {company}’s books, and you see them here as they stand.", { practice: welcome[1].name, company: org.name })}{start ? ` ${t("The steps below get you going.")}` : ""}</span>
    </p> : null}

    {query.opened ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2.5 text-[13px]">
      <CheckCircle2 className="size-4 shrink-0" /><span className="font-medium">{org.books_from ? t("{company} is taken on, and its books are open from {date}.", { company: org.name, date: formatDate(String(org.books_from).slice(0, 10)) }) : t("{company} is taken on, and its books are open.", { company: org.name })}</span>
      <span className="text-ink-muted">{t("Its deadlines and fee are set. Next:")} <Link href={`/c/${org.slug}/journals/new`} className="text-brand font-medium hover:underline">{t("bring in the opening balances")}</Link>{t(", or")} <Link href={`/c/${org.slug}/bank`} className="text-brand font-medium hover:underline">{t("import the first bank statement")}</Link>.</span>
    </p> : null}

    {start ? <GettingStartedSteps start={start} org={org} practice={Boolean(membership.practice)} customers={workspace.labels.customer[1]} /> : null}

    <nav aria-label={t("Everyday actions")} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {/* On a phone, the two done most; the rest are under + at the foot of the screen. */}
      {actions.map((action, index) => <Link key={action.label} href={action.href}
        className={cn("group flex min-h-[92px] flex-col gap-2.5 rounded-xl border p-3 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          index === 0 ? "bg-brand border-brand hover:bg-brand-dark text-white shadow-[0_6px_16px_-8px_var(--brand)]" : "bg-surface border-hairline hover:border-brand-200 hover:bg-brand-50",
          index !== 0 && action.href !== capture && "max-sm:hidden")}>
        <action.icon className={cn("size-5", index === 0 ? "text-white" : "text-brand")} />
        <span><span className={cn("block text-[13.5px] leading-tight font-semibold", index === 0 ? "text-white" : "text-ink")}>{action.label}</span>
          <span className={cn("mt-0.5 block text-[12px] leading-snug", index === 0 ? "text-white/80" : "text-ink-muted")}>{action.hint}</span></span>
      </Link>)}
    </nav>

    <section aria-label={t("Key figures")} className="ll-panel bg-hairline grid gap-px overflow-hidden sm:grid-cols-3 [&>*]:bg-surface">
      <StatTile label={t("In the bank")} value={formatAmount(cash.total)} tone={cash.total < 0 ? "critical" : undefined} context={t.n(cash.accounts, "{count} account", "{count} accounts")} href="/accounts/bank" />
      <StatTile label={t("Customers owe you")} value={formatAmount(receivables.owed)} context={receivables.overdue ? t("{amount} overdue", { amount: formatAmount(receivables.overdue) }) : t("Nothing overdue")} href="/invoices?view=open" />
      <StatTile label={t("You owe suppliers")} value={formatAmount(payables.owed)} tone={payables.overdue ? "critical" : undefined}
        context={payables.overdue ? t("{amount} overdue", { amount: formatAmount(payables.overdue) }) : payables.dueThisWeek ? t("{amount} due this week", { amount: formatAmount(payables.dueThisWeek) }) : t("Nothing overdue")} href="/accounts/bills" />
    </section>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader title={t("Needs attention")} count={attention.length || undefined} />
        {attention.length ? <ul className="group/attention divide-hairline divide-y">{attention.map((item, index) => <li key={item.key} className={cn(index >= PHONE_ATTENTION && "max-sm:hidden max-sm:group-has-[:checked]/attention:block")}>
          <Link href={item.href} className="hover:bg-surface-sunken group flex items-center gap-3 px-4 py-2.5 touch:min-h-12">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", item.tone === "critical" ? "bg-critical-soft text-critical" : item.tone === "caution" ? "bg-caution-soft text-caution" : "bg-surface-sunken text-ink-muted")}>
              {item.tone === "critical" ? <AlertTriangle className="size-3.5" /> : <item.icon className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1"><span className="text-ink block truncate text-[13.5px] font-medium">{item.title}</span><span className="text-ink-muted block truncate text-[12.5px]">{item.detail}</span></span>
            <ArrowRight className="text-ink-faint group-hover:text-brand size-3.5 shrink-0" />
          </Link>
        </li>)}
          {attention.length > PHONE_ATTENTION ? <li className="sm:hidden"><label className="text-brand flex min-h-12 cursor-pointer items-center justify-center text-[14px] font-medium">
            <input type="checkbox" className="peer sr-only" /><span className="peer-checked:hidden">{t("Show all {count}", { count: attention.length })}</span><span className="hidden peer-checked:inline">{t("Show fewer")}</span>
          </label></li> : null}</ul> : <p className="text-ink-muted flex items-center gap-2 px-4 py-4 text-[13px]"><CheckCircle2 className="text-positive size-4" />{t("Nothing needs attention. The books are up to date.")}</p>}
      </Panel>

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader title={t("To-dos")} count={home.tasks.length || undefined} action={<Link href={`/c/${org.slug}/crm/tasks`} className="text-brand text-[12.5px]">{t("All tasks")}</Link>} />
        <div className="p-3"><AddTodo /></div>
        {tasks.length ? <ul className="divide-hairline border-hairline divide-y border-t">{tasks.map(task => <li key={task.id} className="flex items-center gap-3 px-4 py-2">
          <TaskCheck id={task.id} done={Boolean(task.done_at)} />
          <span className="min-w-0 flex-1"><span className="text-ink block truncate text-[13px]">{task.title}</span>{task.link_label ? <span className="text-ink-faint block truncate text-[11.5px]">{task.link_kind ? `${t(workspace.labels[task.link_kind][0])} · ` : ""}{task.link_label}</span> : null}</span>
          <span className={cn("shrink-0 text-[12.5px] tabular-nums", dueTone(task.due_on, today))}>{task.due_on ? formatDate(task.due_on) : ""}</span>
        </li>)}</ul> : null}
      </Panel>
    </div>
  </PageBody>;
}
