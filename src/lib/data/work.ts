import "server-only";

import { one, sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { getCurrentUser, getPractice } from "@/lib/org";

/**
 * The practice's own work: who is doing what this week against the hours
 * they have, the time logged on each client, and what each client earns the
 * firm for that time, month by month.
 */

export type TimeEntry = { id: string; organisation_id: string; company: string; slug: string; is_practice: boolean; person: string; work: string; started_at: string; ended_at: string | null; minutes: number | null; extra: boolean; invoice_id: string | null; invoice_number: string | null; invoice_slug: string | null };
export type RunningTimer = { id: string; company: string; slug: string; work: string; started_at: string };

const ENTRY_SELECT = `select t.*, o.name as company, o.slug, o.is_practice, i.number as invoice_number, io.slug as invoice_slug
  from time_entries t join organisations o on o.id = t.organisation_id left join invoices i on i.id = t.invoice_id left join organisations io on io.id = i.organisation_id`;

export const mondayOf = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const monthName = (period: string) => new Date(`${period}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const shiftMonth = (period: string, by: number) => {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + by, 1));
  return date.toISOString().slice(0, 10);
};

export async function getPracticeBooks() {
  return one<{ id: string; slug: string; name: string; default_bank_account_id: string | null; payment_terms_days: number; invoice_prefix: string }>("select id, slug, name, default_bank_account_id, payment_terms_days, invoice_prefix from organisations where is_practice");
}

/** The timer this person has running, if any: shown in the top bar on every page. */
export async function getRunningTimer(person: string) {
  return one<RunningTimer>("select t.id, o.name as company, o.slug, t.work, t.started_at from time_entries t join organisations o on o.id = t.organisation_id where t.person = $1 and t.ended_at is null", [person]);
}

/** This week, person by person: hours logged against the hours they have. And the week's entries, newest first. */
export async function getTimeWeek(week?: string) {
  const today = firmToday();
  const from = mondayOf(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today), to = addDays(from, 6);
  const [user, staff, entries, companies] = await Promise.all([
    getCurrentUser(),
    sql<{ name: string; role: string | null; weekly_hours: number }>("select name, role, weekly_hours from practice_staff order by name"),
    sql<TimeEntry>(`${ENTRY_SELECT} where (t.started_at at time zone 'Asia/Nicosia')::date between $1 and $2 order by t.started_at desc`, [from, to]),
    sql<{ id: string; name: string; is_practice: boolean }>("select id, name, is_practice from organisations order by is_practice desc, name"),
  ]);
  const people = staff.map(person => {
    const own = entries.filter(entry => entry.person === person.name);
    const minutes = own.reduce((sum, entry) => sum + Number(entry.minutes ?? 0), 0);
    const client = own.filter(entry => !entry.is_practice).reduce((sum, entry) => sum + Number(entry.minutes ?? 0), 0);
    return { ...person, weekly_hours: Number(person.weekly_hours), hours: minutes / 60, clientHours: client / 60, running: own.find(entry => !entry.ended_at) ?? null };
  });
  return { today, from, to, user, people, entries, companies, isThisWeek: from === mondayOf(today) };
}

export type FeeRow = {
  organisation_id: string; slug: string; name: string; manager: string | null; customer_id: string;
  monthly_fee: number; hourly_rate: number; app_fee: number; minutes: number; extraMinutes: number; extraUnbilled: number; extraValue: number;
  fee: number; perHour: number | null; belowFloor: boolean;
  invoice: { id: string; number: string; status: string; total: number } | null;
};

/** One month: each client's fee against the hours its books took, and whether the month has been invoiced. */
export async function getFees(period?: string) {
  const today = firmToday();
  const month = period && /^\d{4}-\d{2}-01$/.test(period) ? period : `${today.slice(0, 7)}-01`;
  const next = shiftMonth(month, 1);
  const [practice, books, clients, minutes, invoices] = await Promise.all([
    getPractice(),
    getPracticeBooks(),
    sql<{ organisation_id: string; slug: string; name: string; manager: string | null; customer_id: string; monthly_fee: number; hourly_rate: number; app_fee: number }>(`
      select f.organisation_id, o.slug, o.name, o.manager, f.customer_id, f.monthly_fee, f.hourly_rate, f.app_fee
        from client_fees f join organisations o on o.id = f.organisation_id order by o.name`),
    sql<{ organisation_id: string; minutes: number; extra_minutes: number; extra_unbilled: number }>(`
      select organisation_id, coalesce(sum(minutes), 0) as minutes,
             coalesce(sum(minutes) filter (where extra), 0) as extra_minutes,
             coalesce(sum(minutes) filter (where extra and invoice_id is null), 0) as extra_unbilled
        from time_entries where ended_at is not null and (started_at at time zone 'Asia/Nicosia')::date >= $1 and (started_at at time zone 'Asia/Nicosia')::date < $2
       group by organisation_id`, [month, next]),
    sql<{ client_organisation_id: string; id: string; number: string; status: string; total: number }>(`
      select f.client_organisation_id, i.id, i.number, i.status::text as status, i.total
        from fee_invoices f join invoices i on i.id = f.invoice_id where f.period = $1 and i.status <> 'void'`, [month]),
  ]);
  const floor = Number(practice.fee_floor);
  const rows: FeeRow[] = clients.map(client => {
    const time = minutes.find(row => row.organisation_id === client.organisation_id);
    const invoice = invoices.find(row => row.client_organisation_id === client.organisation_id) ?? null;
    const total = Number(time?.minutes ?? 0), extraMinutes = Number(time?.extra_minutes ?? 0);
    const extraValue = Math.round(extraMinutes / 60 * Number(client.hourly_rate) * 100) / 100;
    const fee = Math.round((Number(client.monthly_fee) + extraValue) * 100) / 100;
    const perHour = total ? Math.round(fee / (total / 60) * 100) / 100 : null;
    return { ...client, monthly_fee: Number(client.monthly_fee), hourly_rate: Number(client.hourly_rate), app_fee: Number(client.app_fee), minutes: total, extraMinutes, extraUnbilled: Number(time?.extra_unbilled ?? 0), extraValue, fee, perHour,
      belowFloor: perHour !== null && perHour < floor, invoice: invoice ? { id: invoice.id, number: invoice.number, status: invoice.status, total: Number(invoice.total) } : null };
  });
  // The app fee is what the firm resells Ledgerline for: income on the invoice, but not pay for hours worked, so it stays out of the per-hour figures.
  const unbilled = rows.filter(row => !row.invoice && row.fee + row.app_fee > 0);
  const resold = rows.filter(row => row.app_fee > 0);
  const hours = rows.reduce((sum, row) => sum + row.minutes, 0) / 60;
  const earned = rows.reduce((sum, row) => sum + row.fee, 0);
  return {
    today, month, previous: shiftMonth(month, -1), next, isFuture: month > today, practice, books, floor, rows,
    totals: { fees: earned, hours, perHour: hours ? earned / hours : null, below: rows.filter(row => row.belowFloor).length,
      toRaise: { count: unbilled.length, net: unbilled.reduce((sum, row) => sum + row.fee + row.app_fee, 0) },
      app: { clients: resold.length, monthly: resold.reduce((sum, row) => sum + row.app_fee, 0) } },
  };
}
