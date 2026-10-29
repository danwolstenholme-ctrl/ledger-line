import Link from "@/components/navigation/navigation-link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { liveFeed } from "@/lib/calendar-feeds";
import { calendarCompanyLabel, getCalendarItems, type CalendarItem } from "@/lib/data/calendar";
import { CALENDAR_KIND_LABEL, CALENDAR_KINDS, CALENDAR_VIEWS, WEEKDAYS, calendarRange, dayHeading, daysBetween, parseKind, parseView, validDay, type CalendarKind } from "@/lib/domain/calendar";
import { daysUntil } from "@/lib/domain/deadlines";
import { firmToday } from "@/lib/domain/invoices";
import { formatDate } from "@/lib/format";
import { getCurrentUser, getOrganisations } from "@/lib/org";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordBadge, RecordFilterLinks, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { SubscribeCalendar } from "@/components/calendar/subscribe";
import { ClientFilter } from "@/components/common/client-filter";

/**
 * The calendar: everything with a date on it, on its day. A practice sees all
 * its clients and can narrow to one; inside a company, that company alone.
 * Month and week put things on their days; the agenda lists them, with what
 * is overdue first. Subscribing puts the same in Google, Outlook or Apple.
 */

const DOT: Record<CalendarKind, string> = { deadline: "bg-brand", task: "bg-ink-muted", invoice: "bg-positive", quote: "bg-caution" };
const tone = (item: CalendarItem) => item.state === "overdue" ? "text-critical" : item.state === "done" ? "text-ink-faint line-through" : "text-ink";
const MONTH_CAP = 3;

function When({ item, today }: { item: CalendarItem; today: string }) {
  if (item.state === "done") return <RecordBadge tone="positive">Done</RecordBadge>;
  const days = daysUntil(today, item.date);
  if (item.state === "overdue") return <RecordBadge tone="critical">{days === -1 ? "1 day overdue" : `${-days} days overdue`}</RecordBadge>;
  return <RecordBadge tone={days <= 7 ? "caution" : "neutral"}>{days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`}</RecordBadge>;
}

function Row({ item, today, everyone, showDate = false }: { item: CalendarItem; today: string; everyone: boolean; showDate?: boolean }) {
  return <li className="flex items-start gap-3 px-4 py-2.5">
    <span aria-hidden className={cn("mt-[7px] size-2 shrink-0 rounded-full", DOT[item.kind])} />
    <div className="min-w-0 flex-1">
      <Link href={item.href} className={cn("text-[13px] font-medium hover:underline", tone(item))}>{item.title}</Link>
      <p className="text-ink-muted text-[12px] leading-snug">
        {showDate ? <>{formatDate(item.date)} · </> : null}
        {everyone && item.company.slug ? <><Link href={`/c/${item.company.slug}`} className="text-ink hover:text-brand hover:underline">{calendarCompanyLabel(item.company.name)}</Link> · </> : null}
        {CALENDAR_KIND_LABEL[item.kind]}{item.detail ? ` · ${item.detail}` : ""}
      </p>
    </div>
    <span className="shrink-0"><When item={item} today={today} /></span>
  </li>;
}

function Chip({ item, everyone }: { item: CalendarItem; everyone: boolean }) {
  const company = calendarCompanyLabel(item.company.name);
  return <Link href={item.href} title={`${item.title}${everyone && company ? ` · ${company}` : ""}${item.detail ? ` · ${item.detail}` : ""}`}
    className={cn("hover:bg-muted flex min-w-0 items-center gap-1.5 rounded px-1 py-[3px] text-[12px] leading-tight", item.kind === "deadline" && "font-medium", tone(item))}>
    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[item.kind])} />
    <span className="truncate">{everyone && company ? <span className="text-ink-muted">{company.split(" ")[0]} · </span> : null}{item.title}</span>
  </Link>;
}

export async function CalendarView({ query, company }: { query: Record<string, string | undefined>; company?: { id: string; slug: string; name: string } }) {
  const [user, organisations] = await Promise.all([getCurrentUser(), getOrganisations()]);
  const view = parseView(query.view);
  const client = company ? company.slug : organisations.some(org => org.slug === query.client) ? query.client! : null;
  const everyone = !company && !client;
  // Across every client, the filing deadlines (their own tasks and invoices are theirs); inside one client, everything.
  const kind: CalendarKind | null = query.kind === "all" ? null : parseKind(query.kind) ?? (everyone ? "deadline" : null);
  const base = company ? `/c/${company.slug}/calendar` : "/calendar";
  const today = firmToday();
  const date = validDay(query.date) ? query.date : today;
  const range = calendarRange(view, date);
  const [data, live] = await Promise.all([
    getCalendarItems({ from: range.from, to: range.to, client, kind, grouped: everyone }),
    liveFeed(user.id, company?.id ?? null),
  ]);
  const href = (next: { view?: string; date?: string | null; client?: string | null; kind?: string | null }) => {
    const params = new URLSearchParams();
    const values = { view, date: query.date, client: query.client, kind: query.kind, ...next };
    if (values.view && values.view !== "month") params.set("view", values.view);
    if (values.date) params.set("date", values.date);
    if (!company && values.client) params.set("client", values.client);
    if (values.kind) params.set("kind", values.kind);
    const search = params.toString();
    return search ? `${base}?${search}` : base;
  };
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of data.items) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  const days = daysBetween(range.from, range.to);
  const shown = days.filter(day => byDay.has(day));
  const overdue = data.overdue;

  return <PageBody className="space-y-4">
    <RecordHeader title="Calendar"
      action={<a href="#subscribe" className={recordOutlineButton}>Subscribe in your calendar</a>} />

    <div className="flex flex-wrap items-center gap-2">
      <Link href={href({ date: null })} className={recordOutlineButton}>Today</Link>
      <span className="flex items-center">
        <Link href={href({ date: range.prev })} aria-label="Earlier" className="text-ink-muted hover:bg-muted grid size-8 place-items-center rounded-md touch:size-11"><ChevronLeft className="size-4" /></Link>
        <Link href={href({ date: range.next })} aria-label="Later" className="text-ink-muted hover:bg-muted grid size-8 place-items-center rounded-md touch:size-11"><ChevronRight className="size-4" /></Link>
      </span>
      <h2 className="text-ink min-w-0 text-[15px] font-semibold">{range.label}</h2>
      <div className="ml-auto"><RecordFilterLinks label="View" options={CALENDAR_VIEWS.map(item => ({ label: item.label, href: href({ view: item.key }), active: view === item.key }))} /></div>
    </div>
    <div className="flex flex-col gap-2">
      {company ? null : <ClientFilter label="Client" options={[{ label: "All clients", href: href({ client: null }), active: !client },
        ...organisations.map(org => ({ label: calendarCompanyLabel(org.name), href: href({ client: org.slug }), active: client === org.slug }))]} />}
      <RecordFilterLinks label="Show" options={[{ label: "Everything", href: href({ kind: everyone ? "all" : null }), active: !kind },
        ...(Object.keys(CALENDAR_KINDS) as CalendarKind[]).map(key => ({ label: CALENDAR_KINDS[key], href: href({ kind: key }), active: kind === key }))]} />
    </div>
    {overdue.length && view !== "agenda" ? <p className="border-critical-line bg-critical-soft text-critical rounded-md border px-3 py-2 text-[13px]">
      {overdue.length} overdue, still open. <Link href={href({ view: "agenda", date: null })} className="font-medium underline-offset-2 hover:underline">See them in the agenda</Link>
    </p> : null}

    {view === "month" ? <>
      <section aria-label={range.label} className="ll-panel hidden overflow-hidden md:block">
        <div className="border-hairline bg-surface-sunken grid grid-cols-7 border-b">{WEEKDAYS.map(day => <p key={day} className="text-ink-faint px-2 py-1.5 text-[11.5px] font-semibold tracking-[0.06em] uppercase">{day}</p>)}</div>
        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const items = byDay.get(day) ?? [], outside = day.slice(0, 7) !== range.month;
            return <div key={day} className={cn("border-hairline min-h-[7.5rem] min-w-0 border-b p-1.5", index % 7 !== 6 && "border-r", outside && "bg-surface-sunken/60")}>
              <p className="mb-1 flex"><span className={cn("grid size-6 place-items-center rounded-full text-[12px] tabular-nums", day === today ? "bg-brand font-semibold text-white" : outside ? "text-ink-faint" : "text-ink-muted")}>{Number(day.slice(8))}</span></p>
              <ul className="space-y-px">{items.slice(0, MONTH_CAP).map(item => <li key={item.key}><Chip item={item} everyone={everyone} /></li>)}</ul>
              {items.length > MONTH_CAP ? <Link href={href({ view: "week", date: day })} className="text-ink-muted hover:text-brand mt-0.5 block px-1 text-[11.5px]">{items.length - MONTH_CAP} more</Link> : null}
            </div>;
          })}
        </div>
      </section>
      <MonthList days={shown.filter(day => day.slice(0, 7) === range.month)} byDay={byDay} today={today} everyone={everyone} empty={`Nothing due in ${range.label}.`} className="md:hidden" />
    </> : null}

    {view === "week" ? <section aria-label={range.label} className="ll-panel grid overflow-hidden md:grid-cols-7">
      {days.map((day, index) => {
        const items = byDay.get(day) ?? [];
        return <div key={day} className={cn("border-hairline min-w-0 border-b md:min-h-[18rem] md:border-b-0", index % 7 !== 6 && "md:border-r", !items.length && "max-md:hidden")}>
          <p className={cn("border-hairline flex items-baseline gap-1.5 border-b px-2.5 py-2 text-[12.5px]", day === today ? "text-brand font-semibold" : "text-ink-muted")}>
            <span className="tracking-[0.06em] uppercase">{WEEKDAYS[index]}</span><span className="tabular-nums">{Number(day.slice(8))}</span>
          </p>
          <ul className="divide-hairline divide-y">{items.map(item => <li key={item.key} className="px-2.5 py-2">
            <Link href={item.href} className={cn("text-[12.5px] leading-snug font-medium hover:underline", tone(item))}>{item.title}</Link>
            <p className="text-ink-muted mt-0.5 text-[11.5px] leading-snug">{everyone && item.company.name ? `${calendarCompanyLabel(item.company.name)} · ` : ""}{item.detail ?? CALENDAR_KIND_LABEL[item.kind]}</p>
          </li>)}</ul>
        </div>;
      })}
      {!data.items.length ? <p className="text-ink-muted px-4 py-4 text-[13px] md:col-span-7">Nothing due this week.</p> : null}
    </section> : null}

    {view === "agenda" ? <section aria-label={range.label} className="ll-panel overflow-hidden">
      {overdue.length ? <div>
        <h3 className="border-hairline bg-critical-soft text-critical border-b px-4 py-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase">Overdue</h3>
        <ul className="divide-hairline divide-y">{overdue.map(item => <Row key={item.key} item={item} today={today} everyone={everyone} showDate />)}</ul>
      </div> : null}
      {shown.map(day => <div key={day}>
        <h3 className={cn("border-hairline bg-surface-sunken border-y px-4 py-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase", day === today ? "text-brand" : "text-ink-faint")}>{day === today ? `Today, ${dayHeading(day)}` : dayHeading(day)}</h3>
        <ul className="divide-hairline divide-y">{(byDay.get(day) ?? []).map(item => <Row key={item.key} item={item} today={today} everyone={everyone} />)}</ul>
      </div>)}
      {!shown.length ? <p className="text-ink-muted px-4 py-4 text-[13px]">Nothing due between {formatDate(range.from)} and {formatDate(range.to)}.</p> : null}
    </section> : null}

    <div id="subscribe" className="scroll-mt-20">
      <RecordSection title="Subscribe in Google, Outlook or Apple Calendar" hint={company ? company.name : "Every client you can see"}>
        <div className="space-y-3 p-4">
          <p className="text-ink-muted max-w-[75ch] text-[13px] leading-relaxed">Your calendar app reads what is still open from a private link and keeps it up to date: two months back to a year ahead. Anyone with the link can read it, so keep it to yourself; make a new one and the old one stops.</p>
          <SubscribeCalendar organisationId={company?.id ?? null} kind={kind} showing={kind ? CALENDAR_KINDS[kind].toLowerCase() : "everything"}
            live={live ? { id: live.id, made: formatDate(live.created_at), used: live.last_used_at ? formatDate(live.last_used_at) : null, showing: live.kind ? CALENDAR_KINDS[live.kind as CalendarKind].toLowerCase() : "everything" } : null} />
        </div>
      </RecordSection>
    </div>
  </PageBody>;
}

function MonthList({ days, byDay, today, everyone, empty, className }: { days: string[]; byDay: Map<string, CalendarItem[]>; today: string; everyone: boolean; empty: string; className?: string }) {
  return <section className={cn("ll-panel overflow-hidden", className)}>
    {days.map(day => <div key={day}>
      <h3 className={cn("border-hairline bg-surface-sunken border-y px-4 py-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase first:border-t-0", day === today ? "text-brand" : "text-ink-faint")}>{dayHeading(day)}</h3>
      <ul className="divide-hairline divide-y">{(byDay.get(day) ?? []).map(item => <Row key={item.key} item={item} today={today} everyone={everyone} />)}</ul>
    </div>)}
    {!days.length ? <p className="text-ink-muted px-4 py-4 text-[13px]">{empty}</p> : null}
  </section>;
}

