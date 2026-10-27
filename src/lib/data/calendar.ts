import "server-only";

import { sql } from "@/lib/db";
import { getDeadlines, type DeadlineRow } from "@/lib/data/deadlines";
import type { CalendarKind } from "@/lib/domain/calendar";
import { firmToday } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";

/**
 * What is due, on the day it is due: the deadlines (VAT, tax, the Registrar,
 * payroll, AML reviews), tasks, invoices falling due and quotes running out.
 * Read as the person asking, so a practice sees all its clients and a
 * company's own people see that company. Across many clients, invoices due
 * on the same day are one line per client, so the month stays readable.
 */

export type CalendarState = "overdue" | "due" | "done";
export type CalendarItem = {
  key: string; date: string; kind: CalendarKind; title: string; detail: string | null; state: CalendarState; href: string;
  company: { slug: string; name: string };
};

const short = (name: string) => name.replace(/ (Ltd|Limited)$/, "");

function deadlineHref(row: DeadlineRow) {
  const base = `/c/${row.company.slug}`;
  if (row.kind === "vat_return") return `${base}/reports/vat?range=custom&from=${row.periodStart}&to=${row.periodEnd}`;
  if (row.kind === "vies") return `${base}/reports/vies?range=custom&from=${row.periodStart}&to=${row.periodEnd}`;
  if (row.kind === "financial_statements" || row.kind === "accounts_filing") return `${base}/year-end?period=${row.periodEnd}`;
  if (row.kind === "aml_review" && row.review) return `/clients/${row.review.fileId}`;
  return `${base}/deadlines`;
}

/** From this many clients with the same deadline on the same day, the all-clients calendar shows them as one line. */
const GROUP_FROM = 8;

export async function getCalendarItems(input: { from: string; to: string; client?: string | null; kind?: CalendarKind | null; grouped: boolean }) {
  const today = firmToday();
  const until = input.to > today ? input.to : today;
  const want = (kind: CalendarKind) => !input.kind || input.kind === kind;
  const scope = input.client ? "and o.slug = $4" : "";
  const params = (extra: unknown[]) => input.client ? [...extra, input.client] : extra;
  const [deadlines, tasks, invoices, quotes] = await Promise.all([
    want("deadline") ? getDeadlines({ client: input.client ?? undefined, until, keepDone: true }) : null,
    want("task") ? sql<{ id: string; title: string; due_on: string; owner: string; priority: string; done: boolean; slug: string; company: string }>(`
      select t.id, t.title, to_char(t.due_on, 'YYYY-MM-DD') as due_on, t.owner, t.priority, t.done_at is not null as done, o.slug, o.name as company
        from crm_tasks t join organisations o on o.id = t.organisation_id
       where t.due_on is not null and (t.due_on between $1 and $2 or (t.done_at is null and t.due_on < $3)) ${scope}`, params([input.from, input.to, today])) : [],
    want("invoice") ? sql<{ id: string; number: string; due_on: string; balance: number; customer: string; slug: string; company: string; currency: string }>(`
      select i.id, i.number, to_char(i.due_on, 'YYYY-MM-DD') as due_on, i.total - i.amount_paid - i.amount_credited as balance, c.name as customer, o.slug, o.name as company, i.currency
        from invoices i join customers c on c.id = i.customer_id join organisations o on o.id = i.organisation_id
       where i.status in ('issued', 'part_paid') and i.due_on is not null and (i.due_on between $1 and $2 or i.due_on < $3) ${scope}`, params([input.from, input.to, today])) : [],
    want("quote") ? sql<{ id: string; number: string; valid_until: string; total: number; customer: string; slug: string; company: string; currency: string }>(`
      select q.id, q.number, to_char(q.valid_until, 'YYYY-MM-DD') as valid_until, q.total, c.name as customer, o.slug, o.name as company, o.currency
        from quotes q join customers c on c.id = q.customer_id join organisations o on o.id = q.organisation_id
       where q.status = 'sent' and q.valid_until is not null and (q.valid_until between $1 and $2 or q.valid_until < $3) ${scope}`, params([input.from, input.to, today])) : [],
  ]);

  const all: CalendarItem[] = [];
  // Across many clients, the same deadline on the same day is one line: "VAT return, July to September: 287 clients",
  // opening the deadlines due that day. A handful stay one line each.
  const sameDay = new Map<string, DeadlineRow[]>();
  for (const row of deadlines?.rows ?? []) {
    const key = `${row.due}|${row.title}`;
    sameDay.set(key, [...(sameDay.get(key) ?? []), row]);
  }
  for (const group of input.grouped ? [...sameDay.values()].filter(rows => rows.length >= GROUP_FROM) : []) {
    const first = group[0], open = group.filter(row => row.state !== "done"), late = group.filter(row => row.state === "overdue");
    all.push({ key: `deadline-group:${first.due}:${first.title}`, date: first.due, kind: "deadline", title: `${first.title}: ${group.length} clients`, href: `/deadlines?due=${first.due}`,
      company: { slug: "", name: "" }, state: late.length ? "overdue" : open.length ? "due" : "done",
      detail: open.length ? `${open.length} still open${late.length ? `, ${late.length} overdue` : ""}` : "All done" });
  }
  for (const row of (deadlines?.rows ?? []).filter(row => !input.grouped || (sameDay.get(`${row.due}|${row.title}`)?.length ?? 0) < GROUP_FROM)) {
    all.push({ key: `deadline:${row.key}`, date: row.due, kind: "deadline", title: row.title, href: deadlineHref(row), company: { slug: row.company.slug, name: row.company.name },
      state: row.state === "done" ? "done" : row.state === "overdue" ? "overdue" : "due",
      detail: [row.state === "done" && row.doneOn ? `Done ${formatDate(row.doneOn)}` : row.company.manager, row.extension ? `extended by ${row.extension.by}` : null].filter(Boolean).join(" · ") || null });
  }
  for (const task of tasks) {
    all.push({ key: `task:${task.id}`, date: task.due_on, kind: "task", title: task.title, href: `/c/${task.slug}/crm/tasks`, company: { slug: task.slug, name: task.company },
      state: task.done ? "done" : task.due_on < today ? "overdue" : "due", detail: [task.owner, task.priority !== "normal" ? task.priority : null].filter(Boolean).join(" · ") });
  }
  // One client's invoices due on one day: each on its own inside the company, one line across many clients.
  const byDay = new Map<string, typeof invoices>();
  for (const invoice of invoices) {
    const key = input.grouped ? `${invoice.slug}:${invoice.due_on}` : invoice.id;
    byDay.set(key, [...(byDay.get(key) ?? []), invoice]);
  }
  for (const group of byDay.values()) {
    const first = group[0], total = group.reduce((sum, item) => sum + Number(item.balance), 0);
    const late = first.due_on < today;
    all.push({ key: `invoice:${input.grouped ? `${first.slug}:${first.due_on}` : first.id}`, date: first.due_on, kind: "invoice", company: { slug: first.slug, name: first.company },
      state: late ? "overdue" : "due",
      title: group.length > 1 ? `${group.length} invoices ${late ? "overdue" : "due"}` : `Invoice ${first.number} ${late ? "overdue" : "due"}`,
      detail: group.length > 1 ? `${formatAmount(total, first.currency)} to collect` : `${first.customer} · ${formatAmount(total, first.currency)}`,
      href: group.length > 1 ? `/c/${first.slug}/sales?view=${late ? "overdue" : "open"}` : `/c/${first.slug}/sales/${first.id}` });
  }
  for (const quote of quotes) {
    const gone = quote.valid_until < today;
    all.push({ key: `quote:${quote.id}`, date: quote.valid_until, kind: "quote", title: `Quote ${quote.number} ${gone ? "expired" : "expires"}`, href: `/c/${quote.slug}/quotes/${quote.id}`,
      company: { slug: quote.slug, name: quote.company }, state: gone ? "overdue" : "due", detail: `${quote.customer} · ${formatAmount(Number(quote.total), quote.currency)}` });
  }

  const order = (a: CalendarItem, b: CalendarItem) => a.date.localeCompare(b.date) || a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title);
  const items = all.filter(item => item.date >= input.from && item.date <= input.to).sort(order);
  // What is past its date and still open, wherever it falls: across many clients, a client's late invoices are one line.
  const late = all.filter(item => item.state === "overdue");
  const overdue: CalendarItem[] = late.filter(item => item.kind !== "invoice" || !input.grouped);
  if (input.grouped) {
    const lateInvoices = invoices.filter(invoice => invoice.due_on < today);
    for (const slug of new Set(lateInvoices.map(invoice => invoice.slug))) {
      const own = lateInvoices.filter(invoice => invoice.slug === slug).sort((a, b) => a.due_on.localeCompare(b.due_on));
      overdue.push({ key: `invoice:${slug}:overdue`, date: own[0].due_on, kind: "invoice", state: "overdue", company: { slug, name: own[0].company },
        title: own.length > 1 ? `${own.length} invoices overdue` : `Invoice ${own[0].number} overdue`, href: `/c/${slug}/sales?view=overdue`,
        detail: `${formatAmount(own.reduce((sum, item) => sum + Number(item.balance), 0), own[0].currency)} to collect${own.length > 1 ? `, the oldest due ${formatDate(own[0].due_on)}` : ` from ${own[0].customer}`}` });
    }
  }
  overdue.sort(order);
  return { today, items, overdue };
}

export const calendarCompanyLabel = short;
