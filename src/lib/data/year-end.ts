import "server-only";

import { one, sql } from "@/lib/db";
import { companySize, journalFlags, reviewEligibility, yearEndSteps, type JournalFlag, type Opinion, type YearFigures } from "@/lib/domain/audit";
import { addDays, addMonths, financialYearEnds } from "@/lib/domain/deadlines";
import { firmToday } from "@/lib/domain/invoices";
import { vatQuarters } from "@/lib/domain/vat";
import { getBooksStart, getMembership, requireOrg } from "@/lib/org";

/**
 * A company's year end: each financial year in Ledgerline, and for one of
 * them, the figures company law looks at (from the books, and what the books
 * can't know), audit or review, its size, the steps with their dates, and
 * the checks an auditor makes first.
 */

export type YearEndRow = {
  id: string; organisation_id: string; period_end: string; assurance: "audit" | "review"; framework: "ifrs" | "frs_small"; average_employees: number | null;
  turnover_before_books: number | null; prior_turnover: number | null; prior_total_assets: number | null; sent_to_auditor_on: string | null; report_signed_on: string | null;
  opinion: Opinion | null; approved_on: string | null; agm_on: string | null; filed_on: string | null; tax_return_filed_on: string | null; notes: string | null; updated_by: string | null; updated_at: string;
};
const COLUMNS = `id, organisation_id, to_char(period_end, 'YYYY-MM-DD') as period_end, assurance, framework, average_employees, turnover_before_books, prior_turnover, prior_total_assets,
  to_char(sent_to_auditor_on, 'YYYY-MM-DD') as sent_to_auditor_on, to_char(report_signed_on, 'YYYY-MM-DD') as report_signed_on, opinion, to_char(approved_on, 'YYYY-MM-DD') as approved_on,
  to_char(agm_on, 'YYYY-MM-DD') as agm_on, to_char(filed_on, 'YYYY-MM-DD') as filed_on, to_char(tax_return_filed_on, 'YYYY-MM-DD') as tax_return_filed_on, notes, updated_by, updated_at`;

export const yearStartOf = (periodEnd: string) => addDays(addMonths(periodEnd, -12), 1);

/** The year's turnover as the review test counts it (sales, and rent, interest, dividends and royalties: revenue and other income), and its total assets at the end, before liabilities. */
async function ledgerFigures(organisationId: string, from: string, to: string) {
  const row = await one<{ turnover: number; assets: number }>(`
    with balances as (
      select a.type, coalesce(sum(l.debit - l.credit) filter (where e.entry_date <= $3), 0) as balance,
             coalesce(sum(l.credit - l.debit) filter (where e.entry_date between $2 and $3), 0) as moved
        from ledger_accounts a left join journal_lines l on l.account_id = a.id left join journal_entries e on e.id = l.entry_id
       where a.organisation_id = $1 group by a.id, a.type)
    select coalesce(sum(moved) filter (where type in ('revenue', 'other_income')), 0) as turnover,
           -- An overdraft is a liability, not less of an asset.
           coalesce(sum(greatest(balance, 0)) filter (where type in ('bank', 'current_asset', 'fixed_asset')), 0) as assets
      from balances`, [organisationId, from, to]);
  return { turnover: Number(row?.turnover ?? 0), assets: Number(row?.assets ?? 0) };
}

export async function getYearEnd(requested?: string) {
  const org = await requireOrg();
  const [booksFrom, membership] = await Promise.all([getBooksStart(org.id), getMembership()]);
  const today = firmToday();
  const ends = financialYearEnds(org.year_end_month, booksFrom, addMonths(today, 12)).filter(end => yearStartOf(end) <= today);
  const rows = await sql<YearEndRow>(`select ${COLUMNS} from year_ends where organisation_id = $1 order by period_end`, [org.id]);
  const finished = ends.filter(end => end < today);
  const periodEnd = requested && ends.includes(requested) ? requested : finished.at(-1) ?? ends[0];
  const yearStart = yearStartOf(periodEnd);
  const row = rows.find(item => item.period_end === periodEnd) ?? null;
  const priorEnd = addDays(yearStart, -1);
  const priorRow = rows.find(item => item.period_end === priorEnd) ?? null;

  // The figures: from the books, and for any part of a year before them, what was entered.
  const inBooks = await ledgerFigures(org.id, yearStart, periodEnd);
  const startsBeforeBooks = yearStart < booksFrom;
  const year: YearFigures = { yearStart, assets: inBooks.assets,
    turnover: startsBeforeBooks ? row?.turnover_before_books === null || row?.turnover_before_books === undefined ? null : inBooks.turnover + Number(row.turnover_before_books) : inBooks.turnover };
  let prior: YearFigures | null;
  if (priorEnd < booksFrom) {
    prior = { yearStart: yearStartOf(priorEnd), turnover: row?.prior_turnover ?? null, assets: row?.prior_total_assets ?? null };
  } else {
    const before = await ledgerFigures(org.id, yearStartOf(priorEnd), priorEnd);
    const priorStartsBefore = yearStartOf(priorEnd) < booksFrom;
    prior = { yearStart: yearStartOf(priorEnd), assets: before.assets,
      turnover: priorStartsBefore ? priorRow?.turnover_before_books === null || priorRow?.turnover_before_books === undefined ? null : before.turnover + Number(priorRow.turnover_before_books) : before.turnover };
  }
  const review = reviewEligibility({ year, prior, regulated: org.regulated, group: org.consolidated_group });
  const size = year.turnover === null ? null : companySize({ assets: year.assets ?? 0, turnover: year.turnover, employees: row?.average_employees ?? null });
  const assurance = row?.assurance ?? "audit";
  const steps = yearEndSteps(periodEnd, assurance, priorRow?.agm_on ?? null).map(step => ({
    ...step, doneOn: step.key === "books_closed" ? (org.lock_date && String(org.lock_date).slice(0, 10) >= periodEnd ? String(org.lock_date).slice(0, 10) : null) : (row?.[step.key] ?? null),
  }));

  // What an auditor looks at first.
  const [unmatched, vatFiled, journals, chain, totals] = await Promise.all([
    one<{ count: number }>("select count(*) as count from v_bank_statement_lines where organisation_id = $1 and txn_date between $2 and $3 and status in ('unmatched', 'partial')", [org.id, yearStart, periodEnd]),
    sql<{ period_to: string; filed_on: string }>("select to_char(period_to, 'YYYY-MM-DD') as period_to, to_char(filed_on, 'YYYY-MM-DD') as filed_on from vat_returns where organisation_id = $1", [org.id]),
    sql<{ id: string; entry_date: string; reference: string | null; narration: string; created_at: string; total: number }>(`
      select e.id, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.reference, e.narration, e.created_at, coalesce(sum(l.debit), 0) as total
        from journal_entries e join journal_lines l on l.entry_id = e.id
       where e.organisation_id = $1 and e.source = 'manual' and e.entry_date between $2 and $3 group by e.id order by e.entry_date, e.created_at`, [org.id, yearStart, periodEnd]),
    one<{ checked: number; broken_at: number | null }>("select * from audit_verify()"),
    one<{ debit: number; credit: number }>(`select coalesce(sum(l.debit), 0) as debit, coalesce(sum(l.credit), 0) as credit from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.organisation_id = $1 and e.entry_date <= $2`, [org.id, periodEnd]),
  ]);
  const quarters = org.vat_registered ? vatQuarters(org.vat_quarter_end_month, booksFrom > yearStart ? booksFrom : yearStart, periodEnd).filter(quarter => quarter.to <= periodEnd && quarter.to >= yearStart) : [];
  const missingVat = quarters.filter(quarter => !vatFiled.some(filed => filed.period_to === quarter.to));
  const manual = journals.map(entry => ({ ...entry, total: Number(entry.total), flags: journalFlags({ ...entry, total: Number(entry.total) }, periodEnd) as JournalFlag[] }));
  const flagged = manual.filter(entry => entry.flags.length);

  return {
    org, today, booksFrom, periodEnd, yearStart, startsBeforeBooks, priorEnd, priorInBooks: priorEnd >= booksFrom, row, priorRow, year, prior, review, size, assurance, steps,
    years: ends.map(end => {
      const item = rows.find(entry => entry.period_end === end);
      return { periodEnd: end, label: org.year_end_month === 12 ? end.slice(0, 4) : `To ${end}`,
        status: item?.filed_on ? "Filed" : item?.report_signed_on ? "Signed" : item?.sent_to_auditor_on ? `With the ${item.assurance === "review" ? "reviewer" : "auditor"}` : end >= today ? "Running" : "To do" };
    }),
    checks: {
      balanced: Math.abs(Number(totals?.debit ?? 0) - Number(totals?.credit ?? 0)) < 0.005,
      unmatched: Number(unmatched?.count ?? 0),
      vatQuarters: quarters.length, missingVat,
      manualJournals: journals.length, manual, flagged,
      locked: Boolean(org.lock_date && String(org.lock_date).slice(0, 10) >= periodEnd), lockDate: org.lock_date ? String(org.lock_date).slice(0, 10) : null,
      debit: Number(totals?.debit ?? 0), credit: Number(totals?.credit ?? 0),
      chain: { checked: Number(chain?.checked ?? 0), intact: chain?.broken_at === null || chain?.broken_at === undefined },
    },
    practice: membership.practice,
  };
}
export type YearEndData = Awaited<ReturnType<typeof getYearEnd>>;
