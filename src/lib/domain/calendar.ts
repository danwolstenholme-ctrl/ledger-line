/**
 * The calendar's days. Weeks start on Monday, as in Cyprus and the UK, and
 * every date is a day, YYYY-MM-DD: what is due is due on a day, not at an
 * hour. Client-safe.
 */

export const CALENDAR_VIEWS = [{ key: "month", label: "Month" }, { key: "week", label: "Week" }, { key: "agenda", label: "Agenda" }] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number]["key"];

export const CALENDAR_KINDS = { deadline: "Deadlines", task: "Tasks", invoice: "Invoices due", quote: "Quotes expiring" } as const;
export type CalendarKind = keyof typeof CALENDAR_KINDS;
/** One item's kind, as a row says it. */
export const CALENDAR_KIND_LABEL: Record<CalendarKind, string> = { deadline: "Deadline", task: "Task", invoice: "Invoice", quote: "Quote" };

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const AGENDA_DAYS = 28;

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Monday is 0. */
export const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
export const startOfWeek = (date: string) => addDays(date, -weekday(date));
const firstOfMonth = (date: string, shift = 0) => {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + shift, 1)).toISOString().slice(0, 10);
};
const lastOfMonth = (date: string) => addDays(firstOfMonth(date, 1), -1);

export function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export const parseView = (value: unknown): CalendarView => CALENDAR_VIEWS.some(view => view.key === value) ? value as CalendarView : "month";
export const parseKind = (value: unknown): CalendarKind | null => typeof value === "string" && value in CALENDAR_KINDS ? value as CalendarKind : null;

const long = (date: string, parts: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { ...parts, timeZone: "UTC" });

/**
 * The days a view shows, what it is called, and where the arrows go. A month
 * runs from the Monday of its first week to the Sunday of its last; a week,
 * Monday to Sunday; the agenda, four weeks from the day asked for.
 */
export function calendarRange(view: CalendarView, date: string) {
  if (view === "month") {
    const first = firstOfMonth(date);
    const from = startOfWeek(first), to = addDays(startOfWeek(lastOfMonth(date)), 6);
    return { from, to, month: first.slice(0, 7), label: long(first, { month: "long", year: "numeric" }), prev: firstOfMonth(date, -1), next: firstOfMonth(date, 1) };
  }
  if (view === "week") {
    const from = startOfWeek(date), to = addDays(from, 6);
    return { from, to, month: null, label: `${long(from, { day: "numeric", month: "short" })} – ${long(to, { day: "numeric", month: "short", year: "numeric" })}`, prev: addDays(from, -7), next: addDays(from, 7) };
  }
  const to = addDays(date, AGENDA_DAYS - 1);
  return { from: date, to, month: null, label: `${long(date, { day: "numeric", month: "short" })} – ${long(to, { day: "numeric", month: "short", year: "numeric" })}`, prev: addDays(date, -AGENDA_DAYS), next: addDays(date, AGENDA_DAYS) };
}

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

export const dayHeading = (date: string) => long(date, { weekday: "long", day: "numeric", month: "long" });
