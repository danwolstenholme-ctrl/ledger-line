import "server-only";

import { sql, one } from "@/lib/db";
import { requireOrg } from "@/lib/org";
import { AGEING_BUCKETS, ageingBucket, type AgeingBucketKey } from "@/lib/domain/billing";
import {
  balanceSheet, balanceSheetRows, financialYear, isResultAccount, monthHeading, monthsOf, parseBillView, parsePnlComparison, parseSheetComparison,
  parseJournalView, periodHeading, previousPeriod, profitAndLoss, profitAndLossRows, resolvePeriod, samePeriodLastYear, shiftMonths, toDate, vatReturn,
  type BillView, type ReportRange, type StatementColumn,
} from "@/lib/domain/accounts";
import { RESULT_TYPES, ageing, booksChecks, monthlyFigures, positions, results, topExpenses, trailingMonths } from "@/lib/domain/accounts-insights";
import { toCents } from "@/lib/domain/invoice-math";
import { firmToday } from "@/lib/domain/invoices";
import { nextVatReturn, periodContaining, vatSettingsOf } from "@/lib/domain/vat";
import { ukVatReturn, type UkVatFigures } from "@/lib/domain/vat-uk";
import { formatAmount, formatDate } from "@/lib/format";
import type {
  AccountingSettingsRow, BankTransactionDirectoryRow, BankTransactionLineRow, BillDirectoryRow, BillLineRow, BillPaymentRow,
  CashMovementRow, JournalEntryRow, JournalLineViewRow, LedgerAccountRow, LedgerBalanceRow, OrganisationRow, SupplierRow, VatBreakdownRow, VatSummaryRow,
} from "@/types/database";

/**
 * Reads for one company's books, the one named by the URL, read with SQL
 * from the embedded Postgres.
 */

export const BILL_PAGE_SIZE = 50;
type Params = Record<string, string | string[] | undefined>;
const ok = { failed: false };

export async function getLedgerAccounts(options: { activeOnly?: boolean } = {}) {
  const org = await requireOrg();
  const rows = await sql<LedgerAccountRow>(`select * from ledger_accounts where organisation_id = $1 ${options.activeOnly ? "and is_active" : ""} order by code`, [org.id]);
  return { rows, ...ok };
}

export async function getAccountingSettings() {
  const org = await requireOrg();
  const settings: AccountingSettingsRow = {
    id: true, lock_date: org.lock_date, default_bank_account_id: org.default_bank_account_id, year_end_month: org.year_end_month,
    ai_suggestions: org.ai_suggestions, updated_by: null, updated_at: org.created_at, manager: org.manager,
  };
  return { settings, failed: false, today: firmToday(), org };
}

export async function getReportPeriod(params: Params, fallback: ReportRange = "this_year") {
  const { settings, today } = await getAccountingSettings();
  return { ...resolvePeriod(params, today, settings.year_end_month, fallback), today, yearEndMonth: settings.year_end_month };
}

export async function getAsAtPeriod(params: Params) {
  const period = await getReportPeriod(params);
  const asAt = period.range !== "custom" && period.to > period.today ? period.today : period.to;
  return { ...period, asAt, yearFrom: financialYear(asAt, period.yearEndMonth).from };
}

export async function getProfitAndLossReport(params: Params) {
  const base = await getReportPeriod(params);
  const period = toDate(base, base.today);
  const compare = parsePnlComparison(params.compare);
  const months = compare === "months" ? monthsOf(period.from, period.to) : [];
  const columns: StatementColumn[] =
    compare === "previous_period" || compare === "previous_year"
      ? [period, compare === "previous_period" ? previousPeriod(period.from, period.to) : samePeriodLastYear(period.from, period.to)].map(item => ({ label: periodHeading(item.from, item.to), from: item.from, to: item.to }))
    : months.length > 1
      ? [...months.map(month => ({ label: monthHeading(month.from), from: month.from, to: month.to })), { label: "Total", from: period.from, to: period.to }]
    : [{ label: periodHeading(period.from, period.to), from: period.from, to: period.to }];
  const balances = await Promise.all(columns.map(column => getLedgerBalances(column.from, column.to)));
  const statements = balances.map(item => profitAndLoss(item.rows));
  return { period, compare, columns, compared: compare === "previous_period" || compare === "previous_year", rows: profitAndLossRows(statements), netProfit: statements[0].netProfit, failed: false };
}

export async function getBalanceSheetReport(params: Params) {
  const period = await getAsAtPeriod(params);
  const compare = parseSheetComparison(params.compare);
  const dates = compare === "previous_year" ? [period.asAt, shiftMonths(period.asAt, -12)] : [period.asAt];
  const columns: StatementColumn[] = dates.map(date => ({ label: periodHeading(date, date), from: financialYear(date, period.yearEndMonth).from, to: date }));
  const balances = await Promise.all(columns.map(column => getLedgerBalances(column.from, column.to)));
  const sheets = balances.map(item => balanceSheet(item.rows));
  return { period, compare, columns, compared: compare === "previous_year", rows: balanceSheetRows(sheets), balanced: sheets.every(sheet => sheet.balanced), failed: false };
}

export async function getLedgerBalances(from: string, to: string) {
  const org = await requireOrg();
  const rows = await sql<LedgerBalanceRow>("select * from ledger_balances($1, $2, $3)", [org.id, from, to]);
  return { rows, ...ok };
}

export async function getCashMovements(from: string, to: string) {
  const org = await requireOrg();
  return { rows: await sql<CashMovementRow>("select * from cash_movements($1, $2, $3)", [org.id, from, to]), ...ok };
}

export async function getVatSummary(from: string, to: string) {
  const org = await requireOrg();
  const [row, breakdown] = await Promise.all([
    one<VatSummaryRow>("select * from vat_summary($1, $2, $3)", [org.id, from, to]),
    one<VatBreakdownRow>("select * from vat_breakdown($1, $2, $3)", [org.id, from, to]),
  ]);
  return { row: row ?? undefined, breakdown, ...ok };
}

const PURCHASE_TYPES = new Set(["direct_costs", "expense", "depreciation", "fixed_asset", "current_asset"]);

export type UkFiguresRow = Record<"sales_vat" | "purchase_vat" | "sales_net" | "purchases_net" | "rc_services_net" | "rc_services_vat" | "rc_construction_net" | "rc_construction_vat" | "rc_import_net" | "rc_import_vat" | "capital_net" | "capital_vat", number>;

/** A UK company's VAT figures for a period, by invoice date or, under cash accounting, as money moved (uk_vat_figures in the schema). */
export async function getUkVatFigures(org: Pick<OrganisationRow, "id" | "vat_cash_accounting">, from: string, to: string): Promise<UkVatFigures> {
  return ukFiguresOf(await one<UkFiguresRow>("select * from uk_vat_figures($1, $2, $3, $4)", [org.id, from, to, org.vat_cash_accounting]));
}
/** The figures a UK return is made from, as uk_vat_figures gives them. */
export function ukFiguresOf(row: UkFiguresRow | null): UkVatFigures {
  const n = (key: keyof UkFiguresRow) => Math.round(Number(row?.[key] ?? 0) * 100) / 100;
  return {
    salesVat: n("sales_vat"), purchaseVat: n("purchase_vat"), salesNet: n("sales_net"), purchasesNet: n("purchases_net"),
    reverseCharge: { services: { net: n("rc_services_net"), vat: n("rc_services_vat") }, construction: { net: n("rc_construction_net"), vat: n("rc_construction_vat") }, import: { net: n("rc_import_net"), vat: n("rc_import_vat") } },
    capital: { net: n("capital_net"), vat: n("capital_vat") },
  };
}
export const ukSchemeOf = (org: Pick<OrganisationRow, "vat_flat_rate" | "vat_cash_accounting">) => ({ flatRate: org.vat_flat_rate === null ? null : Number(org.vat_flat_rate), cash: org.vat_cash_accounting });

export async function getVatReport(params: Params) {
  const org = await requireOrg();
  // With no period asked for, the return that needs attention, on the company's own staggered quarters.
  const filedPeriods = (await sql<{ period_to: string }>("select period_to from vat_returns where organisation_id = $1", [org.id])).map(row => row.period_to);
  const next = nextVatReturn({ vat: vatSettingsOf(org), registered: true, booksFrom: "2025-07-01", filed: filedPeriods, today: firmToday() });
  const period = params.range ? await getReportPeriod(params, "last_quarter") : { ...(await getReportPeriod({ range: "custom", from: next!.from, to: next!.to })), range: "custom" as ReportRange };
  const [summary, accounts, lines] = await Promise.all([
    getVatSummary(period.from, period.to),
    getLedgerAccounts(),
    sql<Pick<JournalLineViewRow, "id" | "account_id" | "account_type" | "debit" | "credit">>(
      "select id, account_id, account_type, debit, credit from v_journal_lines where organisation_id = $1 and entry_date between $2 and $3 and source in ('bill', 'bank', 'supplier_credit') and not is_tax",
      [org.id, period.from, period.to]),
  ]);
  const byId = new Map(accounts.rows.map(account => [account.id, account]));
  const purchases = new Map<string, number>();
  for (const line of lines) {
    const account = byId.get(line.account_id);
    if (!account || account.system_role || account.outside_vat || !PURCHASE_TYPES.has(line.account_type)) continue;
    purchases.set(line.account_id, (purchases.get(line.account_id) ?? 0) + toCents(line.debit) - toCents(line.credit));
  }
  const boxSeven = [...purchases.entries()].filter(([, amount]) => amount !== 0)
    .map(([id, amount]) => ({ id, code: byId.get(id)!.code, name: byId.get(id)!.name, amount: amount / 100 }))
    .sort((a, b) => b.amount - a.amount);
  const filed = await one<{ filed_on: string; reference: string | null }>("select filed_on, reference from vat_returns where organisation_id = $1 and period_to = $2", [org.id, period.to]);
  // A UK company's nine boxes, from the same ledger by its own rules and scheme.
  const uk = org.country === "GB" ? ukVatReturn(await getUkVatFigures(org, period.from, period.to), ukSchemeOf(org)) : null;
  return { period, summary: summary.row, breakdown: summary.breakdown, boxSeven, filed, org, uk,
    vatAccount: accounts.rows.find(account => account.system_role === "vat") ?? null, failed: false };
}

export function sourceHref(line: Pick<JournalLineViewRow, "source" | "source_id" | "entry_id">, bills: Map<string, string>, payments: Map<string, string>) {
  switch (line.source) {
    case "invoice": return line.source_id ? `/invoices/${line.source_id}` : null;
    case "invoice_payment": return line.source_id && payments.get(line.source_id) ? `/invoices/${payments.get(line.source_id)}` : null;
    case "bill": return line.source_id ? `/accounts/bills/${line.source_id}` : null;
    case "bill_payment": return line.source_id && bills.get(line.source_id) ? `/accounts/bills/${bills.get(line.source_id)}` : null;
    case "bank": return line.source_id ? `/accounts/bank/transactions/${line.source_id}` : null;
    case "manual": return `/accounts/journals/${line.entry_id}`;
    case "credit_note": return line.source_id ? `/accounts/credit-notes/${line.source_id}` : null;
    case "supplier_credit": return line.source_id ? `/accounts/supplier-credits/${line.source_id}` : null;
    case "payroll": return line.source_id ? `/accounts/payroll/${line.source_id}` : null;
  }
}

async function paymentDocuments(lines: Pick<JournalLineViewRow, "source" | "source_id">[]) {
  const ids = (source: JournalLineViewRow["source"]) => [...new Set(lines.filter(line => line.source === source && line.source_id).map(line => line.source_id!))];
  const [bills, invoices] = await Promise.all([
    ids("bill_payment").length ? sql<{ id: string; bill_id: string }>("select id, bill_id from bill_payments where id = any($1::uuid[])", [ids("bill_payment")]) : [],
    ids("invoice_payment").length ? sql<{ id: string; invoice_id: string }>("select id, invoice_id from invoice_payments where id = any($1::uuid[])", [ids("invoice_payment")]) : [],
  ]);
  return { bills: new Map(bills.map(payment => [payment.id, payment.bill_id])), payments: new Map(invoices.map(payment => [payment.id, payment.invoice_id])) };
}

export async function getAccountTransactions(accountId: string, from: string, to: string) {
  const org = await requireOrg();
  const [account, lines, balance] = await Promise.all([
    one<LedgerAccountRow>("select * from ledger_accounts where id = $1 and organisation_id = $2", [accountId, org.id]),
    sql<JournalLineViewRow>("select * from v_journal_lines where account_id = $1 and organisation_id = $2 and entry_date between $3 and $4 order by entry_date, created_at, id", [accountId, org.id, from, to]),
    getLedgerBalances(from, to),
  ]);
  const opening = account && isResultAccount(account.type) ? 0 : balance.rows.find(row => row.account_id === accountId)?.opening ?? 0;
  const { bills, payments } = await paymentDocuments(lines);
  let running = toCents(opening);
  const rows = lines.map(line => {
    running += toCents(line.debit) - toCents(line.credit);
    return { ...line, balance: running / 100, href: sourceHref(line, bills, payments) };
  });
  return { account, rows, opening: toCents(opening) / 100, closing: running / 100, truncated: false, failed: false };
}

export type MonthlyLine = Pick<JournalLineViewRow, "id" | "entry_date" | "account_code" | "account_name" | "account_type" | "debit" | "credit">;

export async function getMonthlyLines(from: string, to: string, codes: string[]) {
  const org = await requireOrg();
  const rows = codes.length
    ? await sql<MonthlyLine>("select id, entry_date, account_code, account_name, account_type, debit, credit from v_journal_lines where organisation_id = $1 and entry_date between $2 and $3 and account_code = any($4::text[])", [org.id, from, to, codes])
    : await sql<MonthlyLine>("select id, entry_date, account_code, account_name, account_type, debit, credit from v_journal_lines where organisation_id = $1 and entry_date between $2 and $3 and account_type::text = any($4::text[])", [org.id, from, to, RESULT_TYPES]);
  return { rows, ...ok };
}

export async function getGeneralLedger(params: Params) {
  const base = await getReportPeriod(params);
  const period = toDate(base, base.today);
  const org = await requireOrg();
  const [balances, lines] = await Promise.all([
    getLedgerBalances(period.from, period.to),
    sql<JournalLineViewRow>("select * from v_journal_lines where organisation_id = $1 and entry_date between $2 and $3 order by account_code, entry_date, created_at, id", [org.id, period.from, period.to]),
  ]);
  const { bills, payments } = await paymentDocuments(lines);
  const byAccount = new Map<string, JournalLineViewRow[]>();
  for (const line of lines) {
    if (!byAccount.has(line.account_id)) byAccount.set(line.account_id, []);
    byAccount.get(line.account_id)!.push(line);
  }
  let debit = 0, credit = 0;
  const accounts = balances.rows.filter(row => byAccount.has(row.account_id)).map(row => {
    const opening = isResultAccount(row.type) ? 0 : toCents(row.opening);
    let running = opening, accountDebit = 0, accountCredit = 0;
    const own = byAccount.get(row.account_id)!.map(line => {
      accountDebit += toCents(line.debit); accountCredit += toCents(line.credit);
      running += toCents(line.debit) - toCents(line.credit);
      return { ...line, balance: running / 100, href: sourceHref(line, bills, payments) };
    });
    debit += accountDebit; credit += accountCredit;
    return { id: row.account_id, code: row.code, name: row.name, type: row.type, opening: opening / 100, debit: accountDebit / 100, credit: accountCredit / 100, closing: running / 100, lines: own };
  });
  return { period, accounts, debit: debit / 100, credit: credit / 100, truncated: false, failed: false };
}

export async function getJournalReport(params: Params) {
  const base = await getReportPeriod(params);
  const period = toDate(base, base.today);
  const view = parseJournalView(params.source);
  const org = await requireOrg();
  const filter = view !== "all" ? "and source = $4" : "";
  const args = view !== "all" ? [org.id, period.from, period.to, view] : [org.id, period.from, period.to];
  const [entries, lines] = await Promise.all([
    sql<JournalEntryRow>(`select * from journal_entries where organisation_id = $1 and entry_date between $2 and $3 ${filter} order by entry_date, created_at, id`, args),
    sql<JournalLineViewRow>(`select * from v_journal_lines where organisation_id = $1 and entry_date between $2 and $3 ${filter} order by entry_date, created_at, id`, args),
  ]);
  const { bills, payments } = await paymentDocuments(lines);
  const byEntry = new Map<string, JournalLineViewRow[]>();
  for (const line of lines) { if (!byEntry.has(line.entry_id)) byEntry.set(line.entry_id, []); byEntry.get(line.entry_id)!.push(line); }
  let debit = 0, credit = 0;
  const rows = entries.map(entry => {
    const own = (byEntry.get(entry.id) ?? []).sort((a, b) => (toCents(b.debit) > 0 ? 1 : 0) - (toCents(a.debit) > 0 ? 1 : 0) || toCents(b.debit) + toCents(b.credit) - toCents(a.debit) - toCents(a.credit));
    for (const line of own) { debit += toCents(line.debit); credit += toCents(line.credit); }
    return { ...entry, postedBy: null, href: own[0] ? sourceHref(own[0], bills, payments) : null, lines: own };
  });
  return { period, view, entries: rows, debit: debit / 100, credit: credit / 100, truncated: false, failed: false };
}

export type ManualJournalRow = { id: string; entry_date: string; reference: string | null; narration: string; created_at: string; lines: number; amount: number };

/** The journals someone wrote by hand, newest first, and the date the books are locked to. */
export async function getManualJournals() {
  const org = await requireOrg();
  const [rows, lock] = await Promise.all([
    sql<ManualJournalRow>(`
      select j.id, j.entry_date, j.reference, j.narration, j.created_at, count(l.id) as lines, coalesce(sum(l.debit), 0) as amount
        from journal_entries j left join journal_lines l on l.entry_id = j.id
       where j.organisation_id = $1 and j.source = 'manual' group by j.id order by j.entry_date desc, j.created_at desc limit 200`, [org.id]),
    one<{ lock: string | null }>("select org_lock_date($1) as lock", [org.id]),
  ]);
  return { org, rows, lockDate: lock?.lock ?? null };
}

/** One manual journal with its lines: debits first, largest first, as the journal report shows them. */
export async function getManualJournal(id: string) {
  const org = await requireOrg();
  const journal = await one<{ id: string; entry_date: string; reference: string | null; narration: string; created_at: string }>(
    "select id, entry_date, reference, narration, created_at from journal_entries where id = $1 and organisation_id = $2 and source = 'manual'", [id, org.id]);
  if (!journal) return null;
  const [lines, lock] = await Promise.all([
    sql<{ id: string; account_id: string; code: string; account_name: string; description: string | null; debit: number; credit: number }>(`
      select l.id, l.account_id, a.code, a.name as account_name, l.description, l.debit, l.credit
        from journal_lines l join ledger_accounts a on a.id = l.account_id where l.entry_id = $1 order by (l.debit > 0) desc, greatest(l.debit, l.credit) desc, a.code`, [id]),
    one<{ lock: string | null }>("select org_lock_date($1) as lock", [org.id]),
  ]);
  const lockDate = lock?.lock ?? null;
  return { org, journal, lines, lockDate, locked: Boolean(lockDate && journal.entry_date <= lockDate) };
}

// ---------------------------------------------------------------------------
// Bills and suppliers
// ---------------------------------------------------------------------------

export async function getSuppliers(options: { activeOnly?: boolean } = {}) {
  const org = await requireOrg();
  return { rows: await sql<SupplierRow>(`select * from suppliers where organisation_id = $1 ${options.activeOnly ? "and is_active" : ""} order by name`, [org.id]), ...ok };
}

/** A supplier with its bills, what it has been paid (newest first), and the statements of theirs checked against the books. */
export async function getSupplier(id: string) {
  const org = await requireOrg();
  const [supplier, bills, payments, checks] = await Promise.all([
    one<SupplierRow>("select * from suppliers where id = $1 and organisation_id = $2", [id, org.id]),
    sql<BillDirectoryRow>("select * from v_bill_directory where supplier_id = $1 and organisation_id = $2 order by issued_on desc limit 100", [id, org.id]),
    sql<{ id: string; paid_on: string; amount: number; reference: string | null; run_id: string | null; bill_id: string; number: string | null }>(`
      select p.id, p.paid_on, p.amount, p.reference, p.run_id, b.id as bill_id, b.number
        from bill_payments p join bills b on b.id = p.bill_id
       where b.supplier_id = $1 and p.organisation_id = $2 order by p.paid_on desc, b.number limit 60`, [id, org.id]),
    sql<{ id: string; statement_date: string; their_balance: number; our_balance: number; unexplained: number; agreed: boolean; created_at: string }>(`
      select id, statement_date, their_balance, our_balance, unexplained, agreed, created_at from supplier_statement_checks
       where supplier_id = $1 and organisation_id = $2 order by statement_date desc, created_at desc limit 6`, [id, org.id]),
  ]);
  return { supplier, bills, payments, checks, ...ok };
}

export async function getBills(filters: { view?: BillView; q?: string; page?: number; supplierId?: string } = {}) {
  const org = await requireOrg();
  const view = parseBillView(filters.view);
  const page = Math.max(1, filters.page ?? 1);
  const where = ["organisation_id = $1"];
  const args: unknown[] = [org.id];
  if (view === "to_pay") where.push("status in ('awaiting_payment', 'part_paid')");
  if (view === "overdue") where.push("status in ('awaiting_payment', 'part_paid') and days_overdue > 0");
  if (view === "paid") where.push("status = 'paid'");
  if (filters.supplierId) { args.push(filters.supplierId); where.push(`supplier_id = $${args.length}`); }
  const term = filters.q?.trim();
  if (term) { args.push(`%${term}%`); where.push(`search_text ilike $${args.length}`); }
  const order = view === "to_pay" || view === "overdue" ? "due_on asc nulls last, id" : "issued_on desc, id";
  const rows = await sql<BillDirectoryRow & { full_count: number }>(`select *, count(*) over () as full_count from v_bill_directory where ${where.join(" and ")} order by ${order} limit ${BILL_PAGE_SIZE} offset ${(page - 1) * BILL_PAGE_SIZE}`, args);
  return { rows, total: rows[0]?.full_count ?? 0, page, view, failed: false };
}

export async function getPayablesSummary() {
  const org = await requireOrg();
  const open = await sql<{ balance: number; days_overdue: number; due_on: string | null }>("select balance, days_overdue, due_on from v_bill_directory where organisation_id = $1 and status in ('awaiting_payment', 'part_paid')", [org.id]);
  const today = firmToday();
  const weekAhead = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  let owed = 0, overdue = 0, dueThisWeek = 0, overdueCount = 0;
  for (const bill of open) {
    const amount = toCents(bill.balance);
    owed += amount;
    if (Number(bill.days_overdue) > 0) { overdue += amount; overdueCount += 1; }
    else if (bill.due_on && bill.due_on <= weekAhead) dueThisWeek += amount;
  }
  return { owed: owed / 100, overdue: overdue / 100, dueThisWeek: dueThisWeek / 100, count: open.length, overdueCount, failed: false };
}

export async function getBill(id: string) {
  const org = await requireOrg();
  const [bill, lines, payments] = await Promise.all([
    one<BillDirectoryRow>("select * from v_bill_directory where id = $1 and organisation_id = $2", [id, org.id]),
    sql<BillLineRow>("select * from bill_lines where bill_id = $1 and organisation_id = $2 order by position", [id, org.id]),
    sql<BillPaymentRow>("select * from bill_payments where bill_id = $1 and organisation_id = $2 order by paid_on", [id, org.id]),
  ]);
  return { bill, lines, payments, ...ok };
}

/**
 * What the company owed each supplier on a day (today, unless asked), by
 * how far past due: each bill as it stood then, after what had been paid and
 * credited by then; and their credit not yet used, which comes off the total.
 */
export async function getAgedPayables(options: { at?: string } = {}) {
  const org = await requireOrg();
  const at = options.at ?? firmToday();
  const [open, credit] = await Promise.all([
    sql<{ supplier_id: string; supplier_name: string; due_on: string | null; balance: number }>(`
      select * from (
        select b.supplier_id, s.name as supplier_name, b.due_on,
               b.total - coalesce((select sum(p.amount) from bill_payments p where p.bill_id = b.id and p.paid_on <= $2), 0)
                       - coalesce((select sum(a.amount) from supplier_credit_allocations a where a.bill_id = b.id and a.allocated_on <= $2), 0) as balance
          from bills b join suppliers s on s.id = b.supplier_id
         where b.organisation_id = $1 and b.status <> 'void' and b.issued_on <= $2) bills
       where balance > 0`, [org.id, at]),
    sql<{ supplier_id: string; supplier_name: string; unused: number }>(`
      select * from (
        select c.supplier_id, s.name as supplier_name,
               sum(c.total - coalesce((select sum(a.amount) from supplier_credit_allocations a where a.supplier_credit_id = c.id and a.allocated_on <= $2), 0)
                           - coalesce((select sum(t.amount) from bank_transactions t where t.supplier_credit_id = c.id and t.txn_date <= $2), 0)) as unused
          from supplier_credits c join suppliers s on s.id = c.supplier_id
         where c.organisation_id = $1 and c.status = 'recorded' and c.issued_on <= $2 group by c.supplier_id, s.name) credits
       where unused > 0`, [org.id, at]),
  ]);
  const empty = () => Object.fromEntries(AGEING_BUCKETS.map(bucket => [bucket.key, 0])) as Record<AgeingBucketKey, number>;
  const totals = empty();
  type Row = { id: string; name: string; buckets: Record<AgeingBucketKey, number>; credit: number; total: number; count: number; oldest: number };
  const suppliers = new Map<string, Row>();
  const row = (id: string, name: string) => suppliers.get(id) ?? suppliers.set(id, { id, name, buckets: empty(), credit: 0, total: 0, count: 0, oldest: 0 }).get(id)!;
  for (const bill of open) {
    const late = bill.due_on ? Math.max(0, Math.round((Date.parse(`${at}T00:00:00Z`) - Date.parse(`${bill.due_on}T00:00:00Z`)) / 86_400_000)) : 0;
    const bucket = ageingBucket(late), amount = toCents(bill.balance), supplier = row(bill.supplier_id, bill.supplier_name);
    supplier.buckets[bucket] += amount; supplier.total += amount; supplier.count += 1; supplier.oldest = Math.max(supplier.oldest, late);
    totals[bucket] += amount;
  }
  let creditTotal = 0;
  for (const item of credit) {
    const supplier = row(item.supplier_id, item.supplier_name), amount = toCents(item.unused);
    supplier.credit += amount; supplier.total -= amount; creditTotal += amount;
  }
  const euros = (record: Record<AgeingBucketKey, number>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value / 100])) as Record<AgeingBucketKey, number>;
  return {
    suppliers: [...suppliers.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total).map(supplier => ({ ...supplier, buckets: euros(supplier.buckets), credit: supplier.credit / 100, total: supplier.total / 100 })),
    totals: euros(totals), credit: creditTotal / 100, total: (Object.values(totals).reduce((sum, value) => sum + value, 0) - creditTotal) / 100,
    count: open.length, failed: false, today: firmToday(), at,
  };
}

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

export async function getBankAccounts() {
  const today = firmToday();
  const { rows } = await getLedgerBalances(today, today);
  return {
    rows: rows.filter(row => row.type === "bank").map(row => ({ id: row.account_id, code: row.code, name: row.name, isActive: row.is_active, balance: (toCents(row.opening) + toCents(row.debit) - toCents(row.credit)) / 100 })),
    failed: false,
  };
}

export async function getBankTransaction(id: string) {
  const org = await requireOrg();
  const [transaction, lines] = await Promise.all([
    one<BankTransactionDirectoryRow>("select * from v_bank_transaction_directory where id = $1 and organisation_id = $2", [id, org.id]),
    sql<BankTransactionLineRow>("select * from bank_transaction_lines where transaction_id = $1 order by position", [id]),
  ]);
  return { transaction, lines, ...ok };
}

export async function getRecentBankTransactions(limit = 50) {
  const org = await requireOrg();
  // What each was, for a list that says more than the bank's name: its first line's description.
  return { rows: await sql<BankTransactionDirectoryRow & { description: string | null }>(`select d.*, (select l.description from bank_transaction_lines l where l.transaction_id = d.id order by l.position limit 1) as description
    from v_bank_transaction_directory d where d.organisation_id = $1 order by d.txn_date desc, d.created_at desc limit $2`, [org.id, limit]), ...ok };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

type OpenInvoice = { id: string; balance: number; days_overdue: number; currency: string; issued_on: string; customer_id: string };
type OpenBill = { id: string; supplier_name: string; number: string | null; balance: number; days_overdue: number; due_on: string | null; issued_on: string };

export async function getAccountsDashboard() {
  const { settings, today, org } = await getAccountingSettings();
  const year = financialYear(today, settings.year_end_month);
  const lastYear = samePeriodLastYear(year.from, today);
  const months = trailingMonths(today);
  const trendFrom = `${months[0]}-01`;
  // The company's own VAT quarter: Cyprus staggers them, so this is not always the calendar quarter.
  const quarterStart = periodContaining(vatSettingsOf(org), today).from;
  const [thisYear, priorYear, trailing, cash, lines, vat, invoices, bills, unreconciled] = await Promise.all([
    getLedgerBalances(year.from, today),
    getLedgerBalances(lastYear.from, lastYear.to),
    getLedgerBalances(trendFrom, today),
    sql<{ month: string; money_in: number; money_out: number }>("select * from cash_by_month($1, $2, $3)", [org.id, trendFrom, today]),
    sql<Pick<JournalLineViewRow, "id" | "entry_date" | "account_type" | "debit" | "credit">>("select id, entry_date, account_type, debit, credit from v_journal_lines where organisation_id = $1 and entry_date between $2 and $3 and account_type::text = any($4::text[])", [org.id, trendFrom, today, RESULT_TYPES]),
    getVatSummary(quarterStart, today),
    sql<OpenInvoice>("select id, balance, days_overdue, currency, issued_on, customer_id from v_invoice_directory where organisation_id = $1 and status in ('issued', 'part_paid')", [org.id]),
    sql<OpenBill>("select id, supplier_name, number, balance, days_overdue, due_on, issued_on from v_bill_directory where organisation_id = $1 and status in ('awaiting_payment', 'part_paid')", [org.id]),
    one<{ count: number }>("select count(*) as count from v_bank_lines_unmatched where organisation_id = $1", [org.id]),
  ]);
  const [unusedCredit, unusedSupplierCredit] = await Promise.all([
    one<{ remaining: number }>("select coalesce(sum(remaining), 0) as remaining from v_credit_note_directory where organisation_id = $1 and status = 'issued' and issued_on <= $2", [org.id, today]),
    one<{ remaining: number }>("select coalesce(sum(remaining), 0) as remaining from v_supplier_credit_directory where organisation_id = $1 and status = 'recorded' and issued_on <= $2", [org.id, today]),
  ]);
  const opening = trailing.rows.filter(row => row.type === "bank").reduce((sum, row) => sum + toCents(row.opening), 0) / 100;
  const postedInvoices = invoices.filter(invoice => invoice.issued_on <= today);
  const postedBills = bills.filter(bill => bill.issued_on <= today);
  const owing = new Map<string, number>();
  for (const invoice of invoices) owing.set(invoice.customer_id, (owing.get(invoice.customer_id) ?? 0) + toCents(invoice.balance));
  const sum = (rows: { balance: number | string }[]) => rows.reduce((total, row) => total + toCents(row.balance), 0) / 100;
  const position = positions(trailing.rows);
  return {
    today, year, lastYear, quarterStart, settings, org,
    thisYear: results(thisYear.rows), priorYear: results(priorYear.rows), expenses: topExpenses(thisYear.rows),
    position,
    banks: trailing.rows.filter(row => row.type === "bank").map(row => ({ id: row.account_id, code: row.code, name: row.name, isActive: row.is_active, balance: closingOf(row) / 100 })),
    months: monthlyFigures({ months, lines, cash, openingCash: opening }),
    vat: vatReturn(vat.row),
    receivables: { ...ageing(invoices), clients: owing.size, largestShare: owing.size ? Math.round((Math.max(...owing.values()) / Math.max(1, [...owing.values()].reduce((a, b) => a + b, 0))) * 1000) / 10 : 0 },
    payables: ageing(bills),
    billsToPay: [...bills].sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.id.localeCompare(b.id)).slice(0, 6),
    checks: booksChecks({
      imbalance: position.imbalance, unreconciled: unreconciled?.count ?? 0, lockDate: settings.lock_date,
      receivable: { ledger: position.receivable, documents: sum(postedInvoices) - Number(unusedCredit?.remaining ?? 0), count: postedInvoices.length, otherCurrencies: 0 },
      payable: { ledger: position.payable, documents: sum(postedBills) - Number(unusedSupplierCredit?.remaining ?? 0), count: postedBills.length },
      formatMoney: value => formatAmount(value), formatDate: value => formatDate(value),
    }),
    failed: false,
  };
}

const closingOf = (row: LedgerBalanceRow) => toCents(row.opening) + toCents(row.debit) - toCents(row.credit);

export async function getPostings(sourceIds: string[]) {
  if (!sourceIds.length) return { entries: [] as { entryId: string; date: string; narration: string; lines: JournalLineViewRow[] }[], failed: false };
  const rows = await sql<JournalLineViewRow>("select * from v_journal_lines where source_id = any($1::uuid[]) order by entry_date, debit desc", [sourceIds.slice(0, 200)]);
  const byEntry = new Map<string, { entryId: string; date: string; narration: string; lines: JournalLineViewRow[] }>();
  for (const line of rows) {
    const entry = byEntry.get(line.entry_id) ?? { entryId: line.entry_id, date: line.entry_date, narration: line.narration, lines: [] };
    entry.lines.push(line);
    byEntry.set(line.entry_id, entry);
  }
  return { entries: [...byEntry.values()], failed: false };
}

// ---------------------------------------------------------------------------
// VIES: services to businesses in other EU states
// ---------------------------------------------------------------------------

/** The member-state prefix VIES uses: ISO country codes, except Greece, which is EL. */
const viesCountry = (country: string) => country === "GR" ? "EL" : country;

/**
 * The recapitulative statement: for a period, each EU business customer's
 * VAT number and the value of services invoiced to it under the reverse
 * charge, less credit notes. It comes to box 8B of the VAT return.
 */
export async function getViesReport(params: Params) {
  const org = await requireOrg();
  const period = await getReportPeriod(params, "last_quarter");
  const [rows, breakdown] = await Promise.all([
    sql<{ customer_id: string; name: string; country: string; vat_number: string | null; invoiced: number; credited: number; invoices: number; credit_notes: number }>(`
      select c.id as customer_id, c.name, c.country, c.vat_number,
             coalesce(sum(s.net) filter (where s.kind = 'invoice'), 0) as invoiced, coalesce(sum(s.net) filter (where s.kind = 'credit'), 0) as credited,
             count(distinct s.document_id) filter (where s.kind = 'invoice') as invoices, count(distinct s.document_id) filter (where s.kind = 'credit') as credit_notes
        from (select 'invoice' as kind, i.id as document_id, i.customer_id, l.net from invoices i join invoice_lines l on l.invoice_id = i.id
               where i.organisation_id = $1 and i.vat_treatment = 'reverse_charge' and i.status in ('issued', 'part_paid', 'paid') and i.issued_on between $2 and $3
              union all
              select 'credit', n.id, n.customer_id, l.net from credit_notes n join credit_note_lines l on l.credit_note_id = n.id
               where n.organisation_id = $1 and n.vat_treatment = 'reverse_charge' and n.status = 'issued' and n.issued_on between $2 and $3) s
        join customers c on c.id = s.customer_id
       group by c.id order by c.country, c.name`, [org.id, period.from, period.to]),
    one<{ reverse_charge_sales: number }>("select reverse_charge_sales from vat_breakdown($1, $2, $3)", [org.id, period.from, period.to]),
  ]);
  const lines = rows.map(row => {
    const prefix = viesCountry(row.country);
    const number = (row.vat_number ?? "").replace(/\s+/g, "").toUpperCase();
    return { ...row, vies_country: prefix, vies_number: number.startsWith(prefix) ? number.slice(prefix.length) : number.replace(/^[A-Z]{2}/, ""),
      value: (toCents(row.invoiced) - toCents(row.credited)) / 100, missingNumber: !row.vat_number };
  });
  return { org, period, lines, total: lines.reduce((sum, line) => sum + toCents(line.value), 0) / 100, boxEightB: Number(breakdown?.reverse_charge_sales ?? 0), failed: false };
}
