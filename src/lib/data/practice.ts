import "server-only";

import { sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { nextVatReturn } from "@/lib/domain/vat";
import { getOrganisations, getPractice } from "@/lib/org";

/**
 * The practice dashboard: every client company on one screen, with what each
 * needs next. Each figure is read from that company's own books.
 */
export async function getPracticeDashboard() {
  const today = firmToday();
  const [practice, allOrganisations, lines, reviews, unrouted, receivables, activity, filed] = await Promise.all([
    getPractice(),
    getOrganisations(),
    sql<{ organisation_id: string; count: number; bank_account_id: string }>("select organisation_id, min(bank_account_id::text) as bank_account_id, count(*) as count from v_bank_statement_lines where status in ('unmatched', 'partial') group by organisation_id"),
    sql<{ organisation_id: string; count: number }>("select organisation_id, count(*) as count from capture_items where status = 'review' and organisation_id is not null group by organisation_id"),
    sql<{ count: number }>("select count(*) as count from capture_items where status = 'review' and organisation_id is null"),
    sql<{ organisation_id: string; overdue: number; overdue_count: number; owed: number }>(`
      select organisation_id, coalesce(sum(balance) filter (where days_overdue > 0), 0) as overdue, count(*) filter (where days_overdue > 0) as overdue_count, coalesce(sum(balance), 0) as owed
        from v_invoice_directory where status in ('issued', 'part_paid') group by organisation_id`),
    sql<{ organisation_id: string; at: string }>(`
      select organisation_id, max(at) as at from (
        select organisation_id, created_at as at from journal_entries
        union all select organisation_id, imported_at from bank_statement_imports
        union all select organisation_id, matched_at from bank_line_matches
        union all select organisation_id, at from audit_log where organisation_id is not null and action not in ('locked', 'filed')
        union all select organisation_id, created_at from capture_items where organisation_id is not null
      ) a group by organisation_id`),
    sql<{ organisation_id: string; period_to: string; filed_on: string }>("select organisation_id, period_to, filed_on from vat_returns order by period_to"),
  ]);
  // The firm's own books are not a client.
  const organisations = allOrganisations.filter(org => !org.is_practice);
  const by = <T extends { organisation_id: string }>(rows: T[]) => new Map(rows.map(row => [row.organisation_id, row]));
  const lineBy = by(lines), reviewBy = by(reviews), receivableBy = by(receivables), activityBy = by(activity);
  const vatNow = await Promise.all(organisations.map(async org => {
    const next = nextVatReturn({ quarterEndMonth: org.vat_quarter_end_month, registered: org.vat_registered, booksFrom: "2025-07-01",
      filed: filed.filter(row => row.organisation_id === org.id).map(row => row.period_to), today });
    if (!next) return null;
    const [summary] = await sql<{ output_vat: number; input_vat: number }>("select * from vat_summary($1, $2, $3)", [org.id, next.from, next.to < today ? next.to : today]);
    return { ...next, net: Math.round(((summary?.output_vat ?? 0) - (summary?.input_vat ?? 0)) * 100) / 100,
      lastFiled: filed.filter(row => row.organisation_id === org.id).at(-1) ?? null };
  }));
  const clients = organisations.map((org, index) => ({
    org,
    vat: vatNow[index],
    bankLines: Number(lineBy.get(org.id)?.count ?? 0),
    bankAccountId: lineBy.get(org.id)?.bank_account_id ?? org.default_bank_account_id,
    toReview: Number(reviewBy.get(org.id)?.count ?? 0),
    overdue: Number(receivableBy.get(org.id)?.overdue ?? 0),
    overdueCount: Number(receivableBy.get(org.id)?.overdue_count ?? 0),
    owed: Number(receivableBy.get(org.id)?.owed ?? 0),
    lastActivity: activityBy.get(org.id)?.at ?? null,
  }));
  const dueSoon = clients.filter(client => client.vat && client.vat.state !== "open" && client.vat.daysLeft <= 30);
  return {
    today, practice, clients,
    totals: {
      clients: clients.length,
      vatDueSoon: dueSoon.length,
      bankLines: clients.reduce((sum, client) => sum + client.bankLines, 0),
      toReview: clients.reduce((sum, client) => sum + client.toReview, 0) + Number(unrouted[0]?.count ?? 0),
      unrouted: Number(unrouted[0]?.count ?? 0),
      overdue: clients.reduce((sum, client) => sum + client.overdue, 0),
      overdueCount: clients.reduce((sum, client) => sum + client.overdueCount, 0),
    },
  };
}
