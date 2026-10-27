import "server-only";

import { sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { daysUntil, obligations, ukObligations, type DeadlineKind, type Obligation } from "@/lib/domain/deadlines";
import { RISK_LEVELS, type RiskLevel } from "@/lib/domain/onboarding";
import { getCurrentUser, getOrganisations } from "@/lib/org";

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
  /** An AML review: the client file it belongs to, and the risk it was rated at. */
  review?: { fileId: string; level: RiskLevel } | null;
  /** When an official extension moved the date: from what, by whom, and the source. */
  extension?: Obligation["extension"];
  company: { id: string; slug: string; name: string; manager: string | null; country: string };
};
export const DEADLINE_VIEWS = [{ key: "all", label: "All" }, { key: "mine", label: "Mine" }, { key: "overdue", label: "Overdue" }] as const;
export type DeadlineView = (typeof DEADLINE_VIEWS)[number]["key"];

const BOOKS_FROM = "2025-07-01";
const AHEAD_DAYS = 90;

/** `until` and `keepDone` are the calendar's: any month ahead, and what was done long ago kept on the day it was done for. */
export async function getDeadlines(filters: { view?: DeadlineView; client?: string; until?: string; keepDone?: boolean } = {}) {
  const today = firmToday();
  const until = filters.until ?? new Date(Date.parse(`${today}T12:00:00Z`) + AHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
  const allOrganisations = await getOrganisations();
  // One company's page reads that company's rows only; the practice's pages read every client's, once each.
  const only = filters.client ? allOrganisations.find(org => org.slug === filters.client)?.id ?? null : null;
  if (filters.client && !only) return { today, until, user: await getCurrentUser(), view: filters.view ?? "all", rows: [], counts: { overdue: 0, next30: 0, done: 0, mine: 0 }, clients: [] };
  const scope = (column = "organisation_id") => only ? `${column} = '${only}'` : "true";
  const [user, filed, marks, euMonths, lineMonths, reviews, starts, amlReviews, payrollClients, yearEnds] = await Promise.all([
    getCurrentUser(),
    sql<{ organisation_id: string; period_to: string; filed_on: string }>(`select organisation_id, period_to, filed_on from vat_returns where ${scope()}`),
    sql<{ organisation_id: string; kind: DeadlineKind; period_end: string; done_on: string; done_by: string }>(`select organisation_id, kind, period_end, done_on, done_by from deadline_marks where ${scope()}`),
    sql<{ organisation_id: string; month: string; net: number }>(`
      select i.organisation_id, to_char(i.issued_on, 'YYYY-MM') as month, sum(i.net) as net
        from invoices i join customers c on c.id = i.customer_id
       where i.vat_treatment = 'reverse_charge' and c.eu_business and i.status in ('issued', 'part_paid', 'paid') and ${scope("i.organisation_id")} group by 1, 2`),
    // Bank lines nobody has matched, by month: a VAT return is ready when its quarter's are all matched.
    sql<{ organisation_id: string; month: string; count: number }>(`select organisation_id, to_char(txn_date, 'YYYY-MM') as month, count(*) as count from v_bank_lines_unmatched where ${scope()} group by 1, 2`),
    sql<{ organisation_id: string; count: number }>(`select organisation_id, count(*) as count from capture_items where status = 'review' and organisation_id is not null and ${scope()} group by organisation_id`),
    // Where each company's books begin: its first entry, found through the index rather than by reading every entry.
    sql<{ organisation_id: string; start: string | null }>(`select o.id as organisation_id, to_char(date_trunc('month', (select min(e.entry_date) from journal_entries e where e.organisation_id = o.id)), 'YYYY-MM-DD') as start
      from organisations o where ${scope("o.id")}`),
    // Each client's next AML review: set by its latest approved risk assessment. Approving the next one moves it on.
    sql<{ file_id: string; organisation_id: string; level: RiskLevel; next_review_on: string }>(`select f.id as file_id, f.organisation_id, a.level, a.next_review_on from client_files f
      join lateral (select level, to_char(next_review_on, 'YYYY-MM-DD') as next_review_on from risk_assessments where file_id = f.id and approved_at is not null order by approved_at desc limit 1) a on true
      where f.status = 'active' and f.organisation_id is not null and ${scope("f.organisation_id")}`),
    // Whose payroll the practice runs, or is run in Ledgerline: its monthly and annual payroll returns are deadlines too.
    sql<{ organisation_id: string }>(`select organisation_id from client_files where status = 'active' and organisation_id is not null and 'payroll' = any (services) and ${scope()}
      union select distinct organisation_id from employees where ${scope()}`),
    // Financial statements are filed when the year end says so.
    sql<{ organisation_id: string; period_end: string; filed_on: string | null; updated_by: string | null }>(`select organisation_id, to_char(period_end, 'YYYY-MM-DD') as period_end, to_char(filed_on, 'YYYY-MM-DD') as filed_on, updated_by from year_ends where ${scope()}`),
  ]);
  const organisations = only ? allOrganisations.filter(org => org.id === only) : allOrganisations;
  // Looked up by company, never searched for: at hundreds of clients, every deadline scanning every row is what makes a page slow.
  const grouped = <T extends { organisation_id: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of list) { const own = map.get(row.organisation_id); if (own) own.push(row); else map.set(row.organisation_id, [row]); }
    return map;
  };
  const filedBy = new Map(filed.map(row => [`${row.organisation_id}:${String(row.period_to).slice(0, 10)}`, row]));
  const marksBy = new Map(marks.map(row => [`${row.organisation_id}:${row.kind}:${String(row.period_end).slice(0, 10)}`, row]));
  const yearEndsBy = new Map(yearEnds.filter(row => row.filed_on).map(row => [`${row.organisation_id}:${row.period_end}`, row]));
  const euBy = grouped(euMonths), linesBy = grouped(lineMonths);
  const reviewsBy = new Map(reviews.map(row => [row.organisation_id, Number(row.count)]));
  const startsBy = new Map(starts.map(row => [row.organisation_id, row.start]));
  const payroll = new Set(payrollClients.map(row => row.organisation_id));
  const rows: DeadlineRow[] = [];
  for (const org of organisations) {
    const own = euBy.get(org.id) ?? [];
    const booksFrom = startsBy.get(org.id) ?? (org.books_from ? String(org.books_from).slice(0, 10) : BOOKS_FROM);
    const incorporatedOn = org.incorporated_on ? String(org.incorporated_on).slice(0, 10) : null;
    // A UK company's deadlines are HMRC's and Companies House's; a Cyprus company's, the Tax Department's and the Registrar's.
    const due = org.country === "GB"
      ? ukObligations({ registered: org.vat_registered, booksFrom, until, yearEndMonth: org.year_end_month, incorporatedOn, entity: org.entity,
          vat: { period: org.vat_period, quarterEndMonth: org.vat_quarter_end_month, yearEndMonth: org.vat_year_end_month, annualPayments: org.vat_annual_payments } })
      : obligations({ registered: org.vat_registered, quarterEndMonth: org.vat_quarter_end_month, booksFrom, until, euSalesMonths: own.map(row => row.month),
          yearEndMonth: org.year_end_month, incorporatedOn, payroll: payroll.has(org.id) });
    for (const item of due) {
      let doneOn: string | null = null, doneBy: string | null = null;
      if (item.kind === "vat_return") {
        const done = filedBy.get(`${org.id}:${item.periodEnd}`);
        if (done) { doneOn = done.filed_on; doneBy = "Filed in Ledgerline"; }
      } else if (item.kind === "financial_statements" || item.kind === "accounts_filing") {
        const done = yearEndsBy.get(`${org.id}:${item.periodEnd}`);
        if (done) { doneOn = done.filed_on; doneBy = "Filed, as the year end records"; }
      } else {
        const mark = marksBy.get(`${org.id}:${item.kind}:${item.periodEnd}`);
        if (mark) { doneOn = mark.done_on; doneBy = mark.done_by; }
      }
      const daysLeft = daysUntil(today, item.due);
      const running = item.kind !== "provisional_tax" && item.periodEnd >= today;
      const state: DeadlineState = doneOn ? "done" : running ? "running" : daysLeft < 0 ? "overdue" : "due";
      // Work done more than a month ago is history, not a deadline: what is open, or was dealt with in the last month, is listed.
      if (state === "done" && doneOn && daysUntil(doneOn, today) > 30 && !filters.keepDone) continue;
      const ready = item.kind === "vat_return" && state !== "done"
        ? { bankLines: (linesBy.get(org.id) ?? []).filter(line => line.month >= (item.periodStart ?? "").slice(0, 7) && line.month <= item.periodEnd.slice(0, 7)).reduce((sum, line) => sum + Number(line.count), 0),
            documents: reviewsBy.get(org.id) ?? 0 }
        : null;
      const amount = item.kind === "vies" ? Number(own.find(row => row.month === item.periodEnd.slice(0, 7))?.net ?? 0) : null;
      rows.push({ key: `${org.id}:${item.kind}:${item.periodEnd}`, kind: item.kind, title: item.title, due: item.due, daysLeft, periodStart: item.periodStart, periodEnd: item.periodEnd,
        state, doneOn, doneBy, ready, amount, extension: item.extension, company: { id: org.id, slug: org.slug, name: org.name, manager: org.manager, country: org.country } });
    }
  }
  const organisationBy = new Map(organisations.map(org => [org.id, org]));
  for (const review of amlReviews) {
    const org = organisationBy.get(review.organisation_id);
    if (!org || (filters.client && org.slug !== filters.client) || review.next_review_on > until) continue;
    const daysLeft = daysUntil(today, review.next_review_on);
    rows.push({ key: `${org.id}:aml_review:${review.next_review_on}`, kind: "aml_review", title: `AML review, ${RISK_LEVELS[review.level].label.toLowerCase()} risk`, due: review.next_review_on, daysLeft,
      periodStart: null, periodEnd: review.next_review_on, state: daysLeft < 0 ? "overdue" : "due", doneOn: null, doneBy: null, ready: null, amount: null,
      review: { fileId: review.file_id, level: review.level }, company: { id: org.id, slug: org.slug, name: org.name, manager: org.manager, country: org.country } });
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
