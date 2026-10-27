import "server-only";

import { sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { nextVatReturn, vatSettingsOf } from "@/lib/domain/vat";
import { ukVatReturn } from "@/lib/domain/vat-uk";
import { ukFiguresOf, ukSchemeOf, type UkFiguresRow } from "@/lib/data/accounts";
import type { OrganisationRow } from "@/types/database";
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
    sql<{ organisation_id: string; count: number; bank_account_id: string }>("select organisation_id, min(bank_account_id::text) as bank_account_id, count(*) as count from v_bank_lines_unmatched group by organisation_id"),
    sql<{ organisation_id: string; count: number }>("select organisation_id, count(*) as count from capture_items where status = 'review' and organisation_id is not null group by organisation_id"),
    sql<{ count: number }>("select count(*) as count from capture_items where status = 'review' and organisation_id is null"),
    sql<{ organisation_id: string; overdue: number; overdue_count: number; owed: number }>(`
      select organisation_id, coalesce(sum(balance) filter (where days_overdue > 0), 0) as overdue, count(*) filter (where days_overdue > 0) as overdue_count, coalesce(sum(balance), 0) as owed
        from v_invoice_directory where status in ('issued', 'part_paid') group by organisation_id`),
    // Each client's last activity: the latest entry, statement, match, audited change or captured document, each found through
    // its index rather than by reading every row of every client.
    sql<{ organisation_id: string; at: string | null }>(`
      select o.id as organisation_id, greatest(
        (select max(e.created_at) from journal_entries e where e.organisation_id = o.id),
        (select max(i.imported_at) from bank_statement_imports i where i.organisation_id = o.id),
        (select max(m.matched_at) from bank_line_matches m where m.organisation_id = o.id),
        (select max(a.at) from audit_log a where a.organisation_id = o.id and a.action not in ('locked', 'filed')),
        (select max(c.created_at) from capture_items c where c.organisation_id = o.id)) as at
        from organisations o where not o.is_practice`),
    sql<{ organisation_id: string; period_to: string; filed_on: string }>("select organisation_id, period_to, filed_on from vat_returns order by period_to"),
  ]);
  // The firm's own books are not a client.
  const organisations = allOrganisations.filter(org => !org.is_practice);
  const by = <T extends { organisation_id: string }>(rows: T[]) => new Map(rows.map(row => [row.organisation_id, row]));
  const lineBy = by(lines), reviewBy = by(reviews), receivableBy = by(receivables), activityBy = by(activity);
  // Each client's VAT return to come, from its periods and what it has filed: no query per client. What each comes to so far
  // is worked out for the clients on screen only (getVatToPay).
  const filedBy = new Map<string, typeof filed>();
  for (const row of filed) filedBy.set(row.organisation_id, [...(filedBy.get(row.organisation_id) ?? []), row]);
  const vatNow = organisations.map(org => {
    const next = nextVatReturn({ vat: vatSettingsOf(org), registered: org.vat_registered, booksFrom: "2025-07-01", filed: (filedBy.get(org.id) ?? []).map(row => row.period_to), today });
    return next ? { ...next, end: next.to < today ? next.to : today, lastFiled: (filedBy.get(org.id) ?? []).at(-1) ?? null } : null;
  });
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
      // In each client's own currency: euros and pounds don't add up.
      overdue: Object.entries(clients.reduce<Record<string, number>>((sums, client) => ({ ...sums, [client.org.currency]: (sums[client.org.currency] ?? 0) + client.overdue }), {})).filter(([, sum]) => sum > 0),
      overdueCount: clients.reduce((sum, client) => sum + client.overdueCount, 0),
    },
  };
}

/**
 * What each client's VAT return to come amounts to so far: VAT out less VAT in for a Cyprus client, and by its own scheme
 * (the flat rate, cash accounting) for a UK one. One query for all the Cyprus clients asked about and one for the UK ones.
 */
export async function getVatToPay(clients: { org: OrganisationRow; vat: { from: string; end: string } | null }[]) {
  const due = clients.filter((client): client is { org: OrganisationRow; vat: { from: string; end: string } } => Boolean(client.vat));
  const cyprus = due.filter(client => client.org.country !== "GB"), uk = due.filter(client => client.org.country === "GB");
  const [cyprusSums, ukSums] = await Promise.all([
    cyprus.length ? sql<{ organisation_id: string; output_vat: number; input_vat: number }>(`select x.org as organisation_id, s.output_vat, s.input_vat
      from unnest($1::uuid[], $2::date[], $3::date[]) as x (org, period_from, period_to) cross join lateral vat_summary(x.org, x.period_from, x.period_to) s`,
      [cyprus.map(client => client.org.id), cyprus.map(client => client.vat.from), cyprus.map(client => client.vat.end)]) : [],
    uk.length ? sql<UkFiguresRow & { organisation_id: string }>(`select x.org as organisation_id, f.*
      from unnest($1::uuid[], $2::date[], $3::date[], $4::boolean[]) as x (org, period_from, period_to, cash) cross join lateral uk_vat_figures(x.org, x.period_from, x.period_to, x.cash) f`,
      [uk.map(client => client.org.id), uk.map(client => client.vat.from), uk.map(client => client.vat.end), uk.map(client => client.org.vat_cash_accounting)]) : [],
  ]);
  const toPay = new Map<string, number>();
  for (const row of cyprusSums) toPay.set(row.organisation_id, Math.round((Number(row.output_vat ?? 0) - Number(row.input_vat ?? 0)) * 100) / 100);
  for (const row of ukSums) {
    const org = uk.find(client => client.org.id === row.organisation_id)!.org;
    toPay.set(row.organisation_id, ukVatReturn(ukFiguresOf(row), ukSchemeOf(org)).net);
  }
  return toPay;
}
