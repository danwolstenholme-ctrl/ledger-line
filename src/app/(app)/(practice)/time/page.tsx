import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { deleteTime } from "@/lib/actions/work";
import { getTimeWeek } from "@/lib/data/work";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { InlineSubmit } from "@/components/common/form-fields";
import { RecordBadge, RecordEmpty, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { AddTimeForm } from "@/components/work/forms";

export const metadata: Metadata = { title: "Time" };

const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const localDay = (instant: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Nicosia" }).format(new Date(instant));

/** Every hour the practice puts in: each person's week against the hours they have, and what it went on. */
export default async function TimePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { week } = await searchParams;
  const data = await getTimeWeek(week);
  const days = new Map<string, typeof data.entries>();
  for (const entry of data.entries) days.set(localDay(entry.started_at), [...(days.get(localDay(entry.started_at)) ?? []), entry]);
  const total = data.people.reduce((sum, person) => sum + person.hours, 0), onClients = data.people.reduce((sum, person) => sum + person.clientHours, 0);

  return <PageBody className="space-y-4">
    <RecordHeader title="Time" description="Every hour the practice puts in, on each client and on its own work. Start the clock on any client from the top bar, on any page."
      action={<div className="flex items-center gap-1.5">
        <Link href={`/time?week=${addDays(data.from, -7)}`} aria-label="The week before" className={recordOutlineButton}><ChevronLeft className="size-3.5" /></Link>
        <span className="text-ink px-1 text-[12.5px] font-medium tabular-nums">{data.isThisWeek ? "This week" : `Week of ${formatDate(data.from)}`}</span>
        {data.isThisWeek ? null : <Link href={`/time?week=${addDays(data.from, 7)}`} aria-label="The week after" className={recordOutlineButton}><ChevronRight className="size-3.5" /></Link>}
      </div>} />

    <RecordSection title={data.isThisWeek ? "This week" : `Week of ${formatDate(data.from)}`} hint={`${total.toFixed(1)} hours logged, ${onClients.toFixed(1)} on clients`}>
      <ul className="divide-hairline divide-y">{data.people.map(person => {
        const share = person.hours / person.weekly_hours, over = share > 1;
        return <li key={person.name} className="grid items-center gap-x-5 gap-y-2 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)_9rem]">
          <span className="min-w-0"><span className="text-ink block text-[13px] font-medium">{person.name}</span><span className="text-ink-faint block text-[11.5px]">{person.role}{person.running ? " · timer running" : ""}</span></span>
          <span className="relative block h-2.5 rounded-full bg-[var(--surface-sunken)] shadow-[inset_0_0_0_1px_var(--hairline)]" role="img" aria-label={`${person.hours.toFixed(1)} of ${person.weekly_hours} hours`}>
            <span className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-caution" : "bg-brand")} style={{ width: `${Math.min(100, share * 100)}%` }} />
            <span className="bg-brand-200 absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, person.clientHours / person.weekly_hours * 100)}%`, opacity: 0.55 }} />
          </span>
          <span className={cn("text-right text-[12.5px] tabular-nums", over ? "text-caution font-medium" : "text-ink")}>{person.hours.toFixed(1)}h <span className="text-ink-faint font-normal">of {person.weekly_hours}</span>{over ? <span className="block text-[11px]">{(person.hours - person.weekly_hours).toFixed(1)}h over</span> : null}</span>
        </li>;
      })}</ul>
      <p className="border-hairline text-ink-faint border-t px-4 py-2 text-[11.5px]">The lighter part of each bar is time on clients; the rest is the firm’s own work.</p>
    </RecordSection>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <RecordSection title="Add time" hint="Worked without the timer">
        <div className="p-4"><AddTimeForm companies={data.companies} people={data.people.map(person => person.name)} user={data.user.name} today={data.today} /></div>
      </RecordSection>
      <RecordSection title="Logged" hint={`${data.entries.length} entr${data.entries.length === 1 ? "y" : "ies"}`}>
        {data.entries.length ? <div className="divide-hairline divide-y">{[...days].map(([day, entries]) => <div key={day}>
          <p className="bg-surface-sunken text-ink-faint px-4 py-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase">{dayLabel(day)}</p>
          <ul className="divide-hairline divide-y">{entries.map(entry => <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[12.5px]">
            <span className="text-ink w-12 shrink-0 font-medium tabular-nums">{entry.minutes ? hours(entry.minutes) : <span className="text-critical">now</span>}</span>
            <span className="min-w-0 flex-1"><Link href={`/c/${entry.slug}`} className="text-ink hover:text-brand font-medium hover:underline">{entry.is_practice ? "The firm" : entry.company.replace(/ (Ltd|Limited)$/, "")}</Link><span className="text-ink-muted"> · {entry.work}</span>
              <span className="text-ink-faint block text-[11.5px]">{entry.person}</span></span>
            {entry.extra ? <RecordBadge tone="caution">Extra</RecordBadge> : null}
            {entry.invoice_id ? <Link href={`/c/${entry.invoice_slug}/sales/${entry.invoice_id}`} className="text-brand font-mono text-[11.5px] hover:underline">{entry.invoice_number}</Link>
              : entry.ended_at ? <form action={deleteTime}><input type="hidden" name="id" value={entry.id} /><InlineSubmit destructive title="Take this time off">Remove</InlineSubmit></form> : null}
          </li>)}</ul>
        </div>)}</div> : <RecordEmpty title="Nothing logged">Start the clock from the top bar, or add time worked without it.</RecordEmpty>}
      </RecordSection>
    </div>
  </PageBody>;
}
