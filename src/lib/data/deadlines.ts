import "server-only";

import { sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { daysUntil, obligations, type DeadlineKind } from "@/lib/domain/deadlines";
import { getDemoUser, getOrganisations } from "@/lib/org";

/**
 * Every client's deadlines in date order: what is overdue, what is coming in
 * the next three months, and what has just been dealt with. A VAT return is
 * done when it is filed; the rest when someone marks them done. For a VAT
 * return still to file, how ready it is: bank lines in the quarter not yet
 * matched, and documents waiting to be checked.
 */

export type DeadlineState = "overdue" | "due" | "running" | "done";
export type DeadlineRow = {
  key: string; kind: DeadlineKind; title: string; due: string; daysLeft: number; periodStart: string | null; periodEnd: string;
  state: DeadlineState; doneOn: string | null; doneBy: string | null; ready: { bankLines: number; documents: number } | null; amount: number | null;
  company: { id: string; slug: string; name: string; manager: string | null };
};
export const DEADLINE_VIEWS = [{ key: "all", label: "All" }, { key: "mine", label: "Mine" }, { key: "overdue", label: "Overdue" }] as const;
export type DeadlineView = (typeof DEADLINE_VIEWS)[number]["key"];

const BOOKS_FROM = "2025-07-01";
const AHEAD_DAYS = 90;

export async function getDeadlines(filters: { view?: DeadlineView; client?: string } = {}) {
  const today = firmToday();
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + AHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [organisations, user, filed, marks, euMonths, lines, reviews, starts] = await Promise.all([
    getOrganisations(),
    getDemoUser(),
    sql<{ organisation_id: string; period_to: string; filed_on: string }>("select organisation_id, period_to, filed_on from vat_returns"),
    sql<{ organisation_id: string; kind: DeadlineKind; period_end: string; done_on: string; done_by: string }>("select organisation_id, kind, period_end, done_on, done_by from deadline_marks"),
    sql<{ organisation_id: string; month: string; net: number }>(`
      select i.organisation_id, to_char(i.issued_on, 'YYYY-MM') as month, sum(i.net) as net
        from invoices i join customers c on c.id = i.customer_id
       where i.vat_treatment = 'reverse_charge' and c.eu_business and i.status in ('issued', 'part_paid', 'paid') group by 1, 2`),
    sql<{ organisation_id: string; txn_date: string }>("select organisation_id, txn_date from v_bank_statement_lines where status in ('unmatched', 'partial')"),
    sql<{ organisation_id: string; count: number }>("select organisation_id, count(*) as count from capture_items where status = 'review' and organisation_id is not null group by organisation_id"),
    sql<{ organisation_id: string; start: string }>("select organisation_id, to_char(date_trunc('month', min(entry_date)), 'YYYY-MM-DD') as start from journal_entries group by organisation_id"),
  ]);
  const rows: DeadlineRow[] = [];
  for (const org of organisations) {
    if (filters.client && org.slug !== filters.client) continue;
    const own = euMonths.filter(row => row.organisation_id === org.id);
    const booksFrom = starts.find(row => row.organisation_id === org.id)?.start ?? BOOKS_FROM;
    for (const item of obligations({ registered: org.vat_registered, quarterEndMonth: org.vat_quarter_end_month, booksFrom, until, euSalesMonths: own.map(row => row.month) })) {
      let doneOn: string | null = null, doneBy: string | null = null;
      if (item.kind === "vat_return") {
        const done = filed.find(row => row.organisation_id === org.id && row.period_to === item.periodEnd);
        if (done) { doneOn = done.filed_on; doneBy = "Filed in Ledgerline"; }
      } else {
        const mark = marks.find(row => row.organisation_id === org.id && row.kind === item.kind && row.period_end === item.periodEnd);
        if (mark) { doneOn = mark.done_on; doneBy = mark.done_by; }
      }
      const daysLeft = daysUntil(today, item.due);
      const running = item.kind !== "provisional_tax" && item.periodEnd >= today;
      const state: DeadlineState = doneOn ? "done" : running ? "running" : daysLeft < 0 ? "overdue" : "due";
      // Work done more than a month ago is history, not a deadline: what is open, or was dealt with in the last month, is listed.
      if (state === "done" && doneOn && daysUntil(doneOn, today) > 30) continue;
      const ready = item.kind === "vat_return" && state !== "done"
        ? { bankLines: lines.filter(line => line.organisation_id === org.id && line.txn_date >= (item.periodStart ?? "") && line.txn_date <= item.periodEnd).length,
            documents: Number(reviews.find(row => row.organisation_id === org.id)?.count ?? 0) }
        : null;
      const amount = item.kind === "vies" ? Number(own.find(row => row.month === item.periodEnd.slice(0, 7))?.net ?? 0) : null;
      rows.push({ key: `${org.id}:${item.kind}:${item.periodEnd}`, kind: item.kind, title: item.title, due: item.due, daysLeft, periodStart: item.periodStart, periodEnd: item.periodEnd,
        state, doneOn, doneBy, ready, amount, company: { id: org.id, slug: org.slug, name: org.name, manager: org.manager } });
    }
  }
  const view = filters.view ?? "all";
  const shown = rows.filter(row => view === "mine" ? row.company.manager === user.name : view === "overdue" ? row.state === "overdue" : true)
    .sort((a, b) => (a.state === "overdue" ? 0 : 1) - (b.state === "overdue" ? 0 : 1) || a.due.localeCompare(b.due) || a.company.name.localeCompare(b.company.name));
  return {
    today, until, user, view, rows: shown,
    counts: { overdue: rows.filter(row => row.state === "overdue").length, next30: rows.filter(row => row.state !== "done" && row.daysLeft >= 0 && row.daysLeft <= 30).length,
      done: rows.filter(row => row.state === "done").length, mine: rows.filter(row => row.company.manager === user.name && row.state !== "done").length },
    clients: organisations.map(org => ({ slug: org.slug, name: org.name })),
  };
}
