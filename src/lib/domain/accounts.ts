import { toCents } from "@/lib/domain/invoice-math";
import type { BillStatus, CashMovementRow, JournalSource, LedgerAccountRow, LedgerAccountType, LedgerBalanceRow, VatBreakdownRow, VatSummaryRow } from "@/types/database";

/**
 * The books' vocabulary and the financial statements, built from the ledger's
 * balances. Pure and client-safe: every figure a report shows is computed here
 * from rows, in cents, so each statement can be tested on its own and all of
 * them agree — they come from the same balanced ledger.
 */

export type AccountClass = "asset" | "liability" | "equity" | "income" | "expense";

/** `label` names one account's type; `group` heads a list of them, as the chart and the account pickers do. */
export const ACCOUNT_TYPES: Record<LedgerAccountType, { label: string; group: string; class: AccountClass }> = {
  bank: { label: "Bank", group: "Bank accounts", class: "asset" },
  current_asset: { label: "Current asset", group: "Current assets", class: "asset" },
  fixed_asset: { label: "Fixed asset", group: "Fixed assets", class: "asset" },
  current_liability: { label: "Current liability", group: "Current liabilities", class: "liability" },
  non_current_liability: { label: "Non-current liability", group: "Non-current liabilities", class: "liability" },
  equity: { label: "Equity", group: "Equity", class: "equity" },
  revenue: { label: "Revenue", group: "Revenue", class: "income" },
  other_income: { label: "Other income", group: "Other income", class: "income" },
  direct_costs: { label: "Direct costs", group: "Direct costs", class: "expense" },
  expense: { label: "Expense", group: "Expenses", class: "expense" },
  depreciation: { label: "Depreciation", group: "Depreciation", class: "expense" },
};

/** Income and expense accounts: their balance is a period's result, not something the firm holds. */
export function isResultAccount(type: LedgerAccountType) {
  const kind = ACCOUNT_TYPES[type].class;
  return kind === "income" || kind === "expense";
}

/** 1 where a debit balance is normal (assets, expenses), −1 where a credit is (liabilities, equity, income). */
export function normalSign(type: LedgerAccountType) {
  const kind = ACCOUNT_TYPES[type].class;
  return kind === "asset" || kind === "expense" ? 1 : -1;
}

/** What an account picker needs to know about an account. */
export type PickerAccount = Pick<LedgerAccountRow, "id" | "code" | "name" | "type" | "system_role">;

/**
 * The accounts a document's line can be coded to: never a bank, receivable,
 * payable or VAT account. With `vat`, money spent or received through the bank
 * may also go to the VAT account: that is how VAT is paid to and refunded by
 * the Tax Department. Kept here, not beside the line editor, because the
 * supplier pages filter on the server and a client module's functions cannot
 * be called there.
 */
export function codableAccounts<T extends PickerAccount>(accounts: T[], { vat = false }: { vat?: boolean } = {}) {
  const control = vat ? ["receivable", "payable"] : ["receivable", "payable", "vat"];
  return accounts.filter(account => account.type !== "bank" && !control.includes(account.system_role ?? ""));
}

/** The order the chart of accounts and the account pickers group by. */
export const ACCOUNT_TYPE_ORDER: LedgerAccountType[] = [
  "revenue", "other_income", "direct_costs", "expense", "depreciation",
  "bank", "current_asset", "fixed_asset", "current_liability", "non_current_liability", "equity",
];

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  awaiting_payment: "Awaiting payment", part_paid: "Part paid", paid: "Paid", void: "Void",
};

export const BILL_VIEWS = [
  { key: "to_pay", label: "To pay" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
] as const;
export type BillView = (typeof BILL_VIEWS)[number]["key"];
export function parseBillView(value: unknown): BillView {
  return BILL_VIEWS.some(view => view.key === value) ? (value as BillView) : "to_pay";
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The financial year containing `date`, for a year ending in `yearEndMonth`. */
export function financialYear(date: string, yearEndMonth: number): { from: string; to: string } {
  const [year, month] = date.split("-").map(Number);
  const endYear = month > yearEndMonth ? year + 1 : year;
  const startMonth = yearEndMonth === 12 ? 1 : yearEndMonth + 1;
  const startYear = yearEndMonth === 12 ? endYear : endYear - 1;
  return { from: iso(startYear, startMonth, 1), to: iso(endYear, yearEndMonth, lastDay(endYear, yearEndMonth)) };
}

export const REPORT_RANGES = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "last_quarter", label: "Last quarter" },
  { key: "this_year", label: "This financial year" },
  { key: "last_year", label: "Last financial year" },
] as const;
export type ReportRange = (typeof REPORT_RANGES)[number]["key"] | "custom";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A named range, or a custom from–to, resolved against today and the year end. */
export function resolvePeriod(params: { range?: unknown; from?: unknown; to?: unknown }, today: string, yearEndMonth: number, fallback: ReportRange = "this_year") {
  const [year, month] = today.split("-").map(Number);
  const from = typeof params.from === "string" && DATE.test(params.from) ? params.from : null;
  const to = typeof params.to === "string" && DATE.test(params.to) ? params.to : null;
  if (params.range === "custom" && from && to && from <= to) return { range: "custom" as ReportRange, from, to };
  const range = (REPORT_RANGES.some(item => item.key === params.range) ? params.range : fallback) as ReportRange;
  const quarter = Math.floor((month - 1) / 3);
  switch (range) {
    case "this_month": return { range, from: iso(year, month, 1), to: iso(year, month, lastDay(year, month)) };
    case "last_month": {
      const y = month === 1 ? year - 1 : year, m = month === 1 ? 12 : month - 1;
      return { range, from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) };
    }
    case "this_quarter": return { range, from: iso(year, quarter * 3 + 1, 1), to: iso(year, quarter * 3 + 3, lastDay(year, quarter * 3 + 3)) };
    case "last_quarter": {
      const y = quarter === 0 ? year - 1 : year, q = quarter === 0 ? 3 : quarter - 1;
      return { range, from: iso(y, q * 3 + 1, 1), to: iso(y, q * 3 + 3, lastDay(y, q * 3 + 3)) };
    }
    case "last_year": {
      // The year that holds the day before this one began.
      const current = financialYear(today, yearEndMonth);
      const dayBefore = new Date(Date.parse(`${current.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      return { range, ...financialYear(dayBefore, yearEndMonth) };
    }
    default: return { range: "this_year" as ReportRange, ...financialYear(today, yearEndMonth) };
  }
}

/**
 * A named range that is still running stops at today: "this financial year"
 * on a profit and loss means the year to date, which is also what a
 * comparison with last year has to line up against.
 */
export function toDate(period: { range: ReportRange; from: string; to: string }, today: string) {
  return period.range !== "custom" && period.to > today && period.from <= today ? { ...period, to: today } : period;
}

/** What posted an entry, as the ledger reports name it. */
export const JOURNAL_SOURCE_LABELS: Record<JournalSource, string> = {
  invoice: "Sales invoice", invoice_payment: "Money received", bill: "Bill", bill_payment: "Bill paid", bank: "Bank", manual: "Journal", credit_note: "Credit note", supplier_credit: "Supplier credit", payroll: "Payroll",
};

/** The journal report's filters: everything, or one day book. */
export const JOURNAL_VIEWS = [
  { key: "all", label: "Every entry" },
  { key: "invoice", label: "Sales invoices" },
  { key: "credit_note", label: "Credit notes" },
  { key: "invoice_payment", label: "Money received" },
  { key: "bill", label: "Bills" },
  { key: "supplier_credit", label: "Supplier credits" },
  { key: "bill_payment", label: "Bills paid" },
  { key: "bank", label: "Bank" },
  { key: "manual", label: "Journals" },
] as const;
export type JournalView = (typeof JOURNAL_VIEWS)[number]["key"];
export function parseJournalView(value: unknown): JournalView {
  return JOURNAL_VIEWS.some(view => view.key === value) ? (value as JournalView) : "all";
}

/** A running balance as an accountant reads it: the amount, and which side it is on. */
export function sideBalance(value: number) {
  return value === 0 ? "0.00" : `${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${value > 0 ? "Dr" : "Cr"}`;
}

// ---------------------------------------------------------------------------
// Comparison columns
// ---------------------------------------------------------------------------

export const PNL_COMPARISONS = [
  { key: "none", label: "This period only" },
  { key: "previous_period", label: "Beside the period before" },
  { key: "previous_year", label: "Beside the same period last year" },
  { key: "months", label: "Month by month" },
] as const;
export type PnlComparison = (typeof PNL_COMPARISONS)[number]["key"];
export function parsePnlComparison(value: unknown): PnlComparison {
  return PNL_COMPARISONS.some(item => item.key === value) ? (value as PnlComparison) : "none";
}

export const SHEET_COMPARISONS = [
  { key: "none", label: "This date only" },
  { key: "previous_year", label: "Beside a year earlier" },
] as const;
export type SheetComparison = (typeof SHEET_COMPARISONS)[number]["key"];
export function parseSheetComparison(value: unknown): SheetComparison {
  return SHEET_COMPARISONS.some(item => item.key === value) ? (value as SheetComparison) : "none";
}

const parts = (date: string) => date.split("-").map(Number) as [number, number, number];
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const isMonthEnd = (date: string) => { const [year, month, day] = parts(date); return day === lastDay(year, month); };

/** `date` moved by whole months. A month end stays a month end: 29 February less a year is 28 February. */
export function shiftMonths(date: string, months: number) {
  const [year, month, day] = parts(date);
  const index = year * 12 + month - 1 + months;
  const y = Math.floor(index / 12), m = index - y * 12 + 1;
  return iso(y, m, isMonthEnd(date) ? lastDay(y, m) : Math.min(day, lastDay(y, m)));
}

/** The period of the same length just before this one: whole months step back by months, anything else by days. */
export function previousPeriod(from: string, to: string) {
  if (from.endsWith("-01") && isMonthEnd(to)) {
    const [fromYear, fromMonth] = parts(from), [toYear, toMonth] = parts(to);
    const months = (toYear - fromYear) * 12 + toMonth - fromMonth + 1;
    return { from: shiftMonths(from, -months), to: shiftMonths(to, -months) };
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export function samePeriodLastYear(from: string, to: string) {
  return { from: shiftMonths(from, -12), to: shiftMonths(to, -12) };
}

/** The calendar months a period covers, the first and last cut to the period. Two years at most. */
export function monthsOf(from: string, to: string) {
  const months: { from: string; to: string }[] = [];
  for (let start = from; start <= to && months.length < 24;) {
    const [year, month] = parts(start);
    const end = iso(year, month, lastDay(year, month));
    months.push({ from: start, to: end < to ? end : to });
    start = addDays(end, 1);
  }
  return months;
}

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** A column heading for a period: "Oct 2026", "Jan – Oct 2026", "1 Jan – 20 Oct 2026". */
export function periodHeading(from: string, to: string) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (from.endsWith("-01") && isMonthEnd(to)) {
    if (from.slice(0, 7) === to.slice(0, 7)) return MONTH_YEAR.format(utc(from));
    return `${(sameYear ? MONTH : MONTH_YEAR).format(utc(from))} – ${MONTH_YEAR.format(utc(to))}`;
  }
  if (from === to) return DAY_MONTH_YEAR.format(utc(to));
  return `${(sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(utc(from))} – ${DAY_MONTH_YEAR.format(utc(to))}`;
}

/** A month column's heading: "Oct 2026", even when the month is cut short by the period. */
export function monthHeading(from: string) {
  return MONTH_YEAR.format(utc(from));
}

/** Change from a comparison figure, and the change as a share of it (null when there is nothing to compare with). */
export function variance(current: number, previous: number) {
  const change = (toCents(current) - toCents(previous)) / 100;
  return { change, percent: toCents(previous) === 0 ? null : Math.round((change / Math.abs(previous)) * 1000) / 10 };
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/** `group` orders lines within a section before their codes do: the bank after the debtors, retained profit after capital. */
export type StatementLine = { accountId: string; code: string; name: string; amount: number; group?: number };
export type StatementSection = { key: string; title: string; lines: StatementLine[]; total: number };

const cents = (value: number | string) => toCents(value);
const euros = (value: number) => value / 100;
const closingCents = (row: LedgerBalanceRow) => cents(row.opening) + cents(row.debit) - cents(row.credit);
const movementCents = (row: LedgerBalanceRow) => cents(row.debit) - cents(row.credit);

function section(key: string, title: string, rows: LedgerBalanceRow[], value: (row: LedgerBalanceRow) => number, group = 0): StatementSection {
  const lines = rows.map(row => ({ accountId: row.account_id, code: row.code, name: row.name, cents: value(row) }))
    .filter(line => line.cents !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    key, title,
    lines: lines.map(({ cents: amount, ...line }) => ({ ...line, amount: euros(amount), ...(group ? { group } : {}) })),
    total: euros(lines.reduce((sum, line) => sum + line.cents, 0)),
  };
}
const ofType = (rows: LedgerBalanceRow[], ...types: LedgerAccountType[]) => rows.filter(row => types.includes(row.type));

/**
 * Profit and loss for the period the balances were read for: income less the
 * cost of earning it, then operating expenses. Income is credit-positive,
 * expenses debit-positive.
 */
export function profitAndLoss(rows: LedgerBalanceRow[]) {
  const income = section("income", "Income", ofType(rows, "revenue"), row => -movementCents(row));
  const costOfSales = section("cost_of_sales", "Less cost of sales", ofType(rows, "direct_costs"), movementCents);
  const otherIncome = section("other_income", "Other income", ofType(rows, "other_income"), row => -movementCents(row));
  const expenses = section("expenses", "Operating expenses", ofType(rows, "expense", "depreciation"), movementCents);
  const grossProfit = euros(cents(income.total) - cents(costOfSales.total));
  const netProfit = euros(cents(grossProfit) + cents(otherIncome.total) - cents(expenses.total));
  return { income, costOfSales, grossProfit, otherIncome, expenses, netProfit };
}

/**
 * The balance sheet at the end of the period, laid out as Sage lays it out:
 * fixed assets, current assets (what is owed to the firm, then the bank),
 * current liabilities, net current assets, long-term liabilities, net assets,
 * and the capital and reserves that equal them.
 *
 * Read from balances whose period starts on the first day of the financial
 * year: an income or expense account's opening is then the profit of earlier
 * years, and its movement the profit of this one — both are equity, since no
 * year-end journal closes them.
 */
export function balanceSheet(rows: LedgerBalanceRow[]) {
  const fixedAssets = section("fixed_assets", "Fixed assets", ofType(rows, "fixed_asset"), closingCents);
  const debtors = section("current_assets", "Current assets", ofType(rows, "current_asset"), closingCents);
  const bank = section("bank", "Cash at bank", ofType(rows, "bank"), closingCents, 1);
  const currentAssets: StatementSection = { key: "current_assets", title: "Current assets", lines: [...debtors.lines, ...bank.lines], total: euros(cents(debtors.total) + cents(bank.total)) };
  const currentLiabilities = section("current_liabilities", "Current liabilities", ofType(rows, "current_liability"), row => -closingCents(row));
  const nonCurrentLiabilities = section("non_current_liabilities", "Long-term liabilities", ofType(rows, "non_current_liability"), row => -closingCents(row));
  const profitAndLossAccounts = rows.filter(row => isResultAccount(row.type));
  const priorYears = -profitAndLossAccounts.reduce((sum, row) => sum + cents(row.opening), 0);
  const currentYear = -profitAndLossAccounts.reduce((sum, row) => sum + movementCents(row), 0);
  const equityAccounts = section("equity", "Capital and reserves", ofType(rows, "equity"), row => -closingCents(row));
  const retained = equityAccounts.lines.find(line => rows.find(row => row.account_id === line.accountId)?.system_role === "retained_earnings");
  const equityLines: StatementLine[] = [
    ...equityAccounts.lines.filter(line => line !== retained),
    { accountId: "retained", code: retained?.code ?? "", name: "Retained earnings", amount: euros(cents(retained?.amount ?? 0) + priorYears), group: 1 },
    { accountId: "current", code: "", name: "Current year earnings", amount: euros(currentYear), group: 2 },
  ].filter(line => line.amount !== 0);
  const equity = { key: "equity", title: "Capital and reserves", lines: equityLines, total: euros(equityLines.reduce((sum, line) => sum + cents(line.amount), 0)) };
  const netCurrentAssets = euros(cents(currentAssets.total) - cents(currentLiabilities.total));
  const totalAssetsLessCurrentLiabilities = euros(cents(fixedAssets.total) + cents(netCurrentAssets));
  const totalAssets = euros(cents(fixedAssets.total) + cents(currentAssets.total));
  const totalLiabilities = euros(cents(currentLiabilities.total) + cents(nonCurrentLiabilities.total));
  const netAssets = euros(cents(totalAssets) - cents(totalLiabilities));
  return {
    fixedAssets, currentAssets, bank, currentLiabilities, netCurrentAssets, totalAssetsLessCurrentLiabilities, nonCurrentLiabilities,
    totalAssets, totalLiabilities, netAssets, equity, balanced: cents(netAssets) === cents(equity.total),
  };
}

/**
 * Every account's balance in a debit or a credit column. Read, like the
 * balance sheet, from the first day of the financial year: income and expense
 * accounts show this year only, and earlier years' profit sits in retained
 * earnings, as it would after a year-end close.
 */
export function trialBalance(rows: LedgerBalanceRow[]) {
  const priorYears = rows.filter(row => isResultAccount(row.type)).reduce((sum, row) => sum + cents(row.opening), 0);
  const balance = (row: LedgerBalanceRow) => isResultAccount(row.type) ? movementCents(row) : closingCents(row) + (row.system_role === "retained_earnings" ? priorYears : 0);
  const lines = rows.map(row => ({ row, amount: balance(row) })).filter(item => item.amount !== 0)
    .map(({ row, amount }) => ({ accountId: row.account_id, code: row.code, name: row.name, type: row.type, debit: amount > 0 ? euros(amount) : 0, credit: amount < 0 ? euros(-amount) : 0 }));
  const debit = lines.reduce((sum, line) => sum + cents(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + cents(line.credit), 0);
  return { lines, debit: euros(debit), credit: euros(credit), balanced: debit === credit };
}

/**
 * Cash flow by the direct method: the bank's movement explained by what was on
 * the other side of each bank entry, grouped as operating, investing and
 * financing. Opening plus the net change is the closing balance.
 */
export function cashFlow(movements: CashMovementRow[], bankBalances: LedgerBalanceRow[]) {
  const classify = (row: CashMovementRow) => row.type === "fixed_asset" ? "investing" : row.type === "non_current_liability" || row.type === "equity" ? "financing" : "operating";
  const label = (row: CashMovementRow) =>
    row.system_role === "receivable" ? "Received from clients" : row.system_role === "payable" ? "Paid to suppliers" : row.system_role === "vat" ? "VAT paid or refunded" : row.name;
  const group = (key: "operating" | "investing" | "financing", title: string): StatementSection => {
    const lines = movements.filter(row => classify(row) === key)
      .map(row => ({ accountId: row.account_id, code: row.code, name: label(row), amount: euros(cents(row.amount)) }))
      .sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0) || a.code.localeCompare(b.code));
    return { key, title, lines, total: euros(lines.reduce((sum, line) => sum + cents(line.amount), 0)) };
  };
  const operating = group("operating", "Operating activities");
  const investing = group("investing", "Investing activities");
  const financing = group("financing", "Financing activities");
  const banks = ofType(bankBalances, "bank");
  const opening = euros(banks.reduce((sum, row) => sum + cents(row.opening), 0));
  const closing = euros(banks.reduce((sum, row) => sum + closingCents(row), 0));
  const netChange = euros(cents(operating.total) + cents(investing.total) + cents(financing.total));
  return { operating, investing, financing, netChange, opening, closing, reconciles: cents(opening) + cents(netChange) === cents(closing) };
}

// ---------------------------------------------------------------------------
// Statement layout, shared by each report page and its export
// ---------------------------------------------------------------------------

/** A column of a statement: its heading and the period its figures (and their drill-downs) cover. */
export type StatementColumn = { label: string; from: string; to: string };

/** A statement laid out in columns: one per period being compared. */
export type ReportLine = { accountId: string; code: string; name: string; amounts: number[] };
export type ReportSection = { key: string; title: string; lines: ReportLine[]; totals: number[] };
export type StatementRow =
  | { kind: "section"; section: ReportSection; totalLabel?: string }
  | { kind: "total"; label: string; amounts: number[]; strong?: boolean; tone?: "critical" };

export function sectionTotalLabel(row: Extract<StatementRow, { kind: "section" }>) {
  return row.totalLabel ?? `Total ${row.section.title.toLowerCase().replace(/^less /, "")}`;
}

/**
 * One section across every column: each account that any column shows, with
 * a figure in each (nothing where it had none). Every column reads the same
 * chart, so an account means the same thing in all of them.
 */
function across(sections: StatementSection[]): ReportSection {
  const lines = new Map<string, ReportLine>();
  const groups = new Map<string, number>();
  sections.forEach((item, column) => {
    for (const line of item.lines) {
      if (!lines.has(line.accountId)) {
        lines.set(line.accountId, { accountId: line.accountId, code: line.code, name: line.name, amounts: sections.map(() => 0) });
        groups.set(line.accountId, line.group ?? 0);
      }
      lines.get(line.accountId)!.amounts[column] = line.amount;
    }
  });
  const ordered = [...lines.values()];
  // One column keeps its own order; several are merged back into it.
  if (sections.length > 1) ordered.sort((a, b) => groups.get(a.accountId)! - groups.get(b.accountId)! || a.code.localeCompare(b.code));
  return { key: sections[0].key, title: sections[0].title, lines: ordered, totals: sections.map(item => item.total) };
}

const has = (sections: StatementSection[]) => sections.some(item => item.lines.length > 0);
const critical = (value: number) => value < 0 ? "critical" as const : undefined;

/** Profit and loss in as many columns as there are periods; the first is the one being reported. */
export function profitAndLossRows(columns: ReturnType<typeof profitAndLoss>[]): StatementRow[] {
  const all = <K extends "income" | "costOfSales" | "otherIncome" | "expenses">(key: K) => columns.map(pnl => pnl[key]);
  const rows: StatementRow[] = [{ kind: "section", section: across(all("income")) }];
  if (has(all("costOfSales"))) rows.push({ kind: "section", section: across(all("costOfSales")) }, { kind: "total", label: "Gross profit", amounts: columns.map(pnl => pnl.grossProfit) });
  if (has(all("otherIncome"))) rows.push({ kind: "section", section: across(all("otherIncome")) });
  rows.push({ kind: "section", section: across(all("expenses")) }, { kind: "total", label: "Net profit", amounts: columns.map(pnl => pnl.netProfit), strong: true, tone: critical(columns[0].netProfit) });
  return rows;
}

/** The balance sheet in one column per date. */
export function balanceSheetRows(columns: ReturnType<typeof balanceSheet>[]): StatementRow[] {
  const fixed = columns.map(sheet => sheet.fixedAssets), longTerm = columns.map(sheet => sheet.nonCurrentLiabilities);
  const rows: StatementRow[] = [];
  if (has(fixed)) rows.push({ kind: "section", section: across(fixed) });
  rows.push(
    { kind: "section", section: across(columns.map(sheet => sheet.currentAssets)) },
    { kind: "section", section: across(columns.map(sheet => sheet.currentLiabilities)) },
    { kind: "total", label: "Net current assets", amounts: columns.map(sheet => sheet.netCurrentAssets), tone: critical(columns[0].netCurrentAssets) },
  );
  // Only a different figure from the ones either side of it when there are both fixed assets and long-term debts.
  if (has(fixed) && has(longTerm)) rows.push({ kind: "total", label: "Total assets less current liabilities", amounts: columns.map(sheet => sheet.totalAssetsLessCurrentLiabilities) });
  if (has(longTerm)) rows.push({ kind: "section", section: across(longTerm) });
  rows.push(
    { kind: "total", label: "Net assets", amounts: columns.map(sheet => sheet.netAssets), strong: true, tone: critical(columns[0].netAssets) },
    { kind: "section", section: across(columns.map(sheet => sheet.equity)) },
  );
  return rows;
}

export function cashFlowRows(flow: ReturnType<typeof cashFlow>): StatementRow[] {
  const one = (item: StatementSection) => across([item]);
  return [
    { kind: "section", section: one(flow.operating), totalLabel: "Net cash from operating activities" },
    ...(has([flow.investing]) ? [{ kind: "section", section: one(flow.investing), totalLabel: "Net cash from investing activities" } as const] : []),
    ...(has([flow.financing]) ? [{ kind: "section", section: one(flow.financing), totalLabel: "Net cash from financing activities" } as const] : []),
    { kind: "total", label: "Net change in cash", amounts: [flow.netChange], tone: critical(flow.netChange) },
    { kind: "total", label: "Cash at the start of the period", amounts: [flow.opening] },
    { kind: "total", label: "Cash at the end of the period", amounts: [flow.closing], strong: true },
  ];
}

/**
 * A statement as spreadsheet rows: code, account, a figure per column, and —
 * when one period is compared with another — the change and the change as a
 * percentage.
 */
export function statementCsvRows(rows: StatementRow[], { compared = false }: { compared?: boolean } = {}): string[][] {
  const plain = (value: number) => value.toFixed(2);
  const figures = (amounts: number[]) => {
    if (!compared) return amounts.map(plain);
    const { change, percent } = variance(amounts[0], amounts[1]);
    return [...amounts.map(plain), plain(change), percent === null ? "" : percent.toFixed(1)];
  };
  const blank = (amounts: number[]) => figures(amounts).map(() => "");
  return rows.flatMap(row => row.kind === "total" ? [["", row.label, ...figures(row.amounts)]] : [
    ["", row.section.title, ...blank(row.section.totals)],
    ...row.section.lines.map(line => [line.code, line.name, ...figures(line.amounts)]),
    ["", sectionTotalLabel(row), ...figures(row.section.totals)],
  ]);
}

/** A statement spreadsheet's header row: one figure column is the Amount, several are headed by their periods. */
export function statementCsvHeader(columns: string[], { compared = false }: { compared?: boolean } = {}) {
  return ["Code", "Account", ...(columns.length === 1 ? ["Amount"] : columns), ...(compared ? ["Change", "Change %"] : [])];
}

/** The VAT figures for a return period, and what is owed to or due from the tax authority. */
export function vatReturn(row: VatSummaryRow | undefined) {
  const output = cents(row?.output_vat ?? 0), input = cents(row?.input_vat ?? 0);
  return { outputVat: euros(output), inputVat: euros(input), net: euros(output - input), salesNet: euros(cents(row?.sales_net ?? 0)), purchasesNet: euros(cents(row?.purchases_net ?? 0)) };
}

export type VatBox = { box: string; label: string; amount: number; hint?: string };

/**
 * The return as the Tax Department's form VAT 4 numbers it, from the same
 * figures as vatReturn(). Boxes 1–5 are VAT, 6–11B values before VAT.
 *
 * The reverse charge puts the VAT the firm accounts for on a foreign
 * supplier's services in box 1 and again in box 4, and the services' value in
 * 6, 7 and 11B. The firm buys and sells no goods across borders and makes no
 * zero-rated sales, so 2, 8A, 9 and 11A are nil.
 */
export function vatBoxes(summary: VatSummaryRow | undefined, breakdown: VatBreakdownRow | null) {
  const due = cents(summary?.output_vat ?? 0), reclaimed = cents(summary?.input_vat ?? 0);
  const servicesBought = cents(breakdown?.reverse_charge_purchases ?? 0);
  const net = due - reclaimed;
  const vat: VatBox[] = [
    { box: "1", label: "VAT due on sales and other outputs", amount: euros(due), hint: "On the company's invoices and other money received, and VAT due under the reverse charge" },
    { box: "2", label: "VAT due on acquisitions from other EU member states", amount: 0 },
    { box: "3", label: "Total VAT due", amount: euros(due), hint: "Box 1 plus box 2" },
    { box: "4", label: "VAT reclaimed on purchases and other inputs", amount: euros(reclaimed), hint: "On bills and money spent, and VAT reclaimed under the reverse charge" },
    { box: "5", label: net >= 0 ? "Net VAT to pay" : "Net VAT to reclaim", amount: euros(Math.abs(net)), hint: "Box 3 less box 4" },
  ];
  const values: VatBox[] = [
    { box: "6", label: "Total value of sales and other outputs", amount: euros(cents(summary?.sales_net ?? 0) + servicesBought), hint: `Every sale before VAT, including boxes 8B, 9, 10 and 11B${cents(breakdown?.exempt_sales ?? 0) ? `, and €${(cents(breakdown?.exempt_sales ?? 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })} of exempt sales` : ""}` },
    { box: "7", label: "Total value of purchases and other inputs", amount: euros(cents(summary?.purchases_net ?? 0)), hint: "Bills and money spent before VAT, including box 11B" },
    { box: "8A", label: "Supplies of goods to other EU member states", amount: 0 },
    { box: "8B", label: "Services to businesses in other EU member states", amount: euros(cents(breakdown?.reverse_charge_sales ?? 0)), hint: "Invoices under the reverse charge" },
    { box: "9", label: "Zero-rated sales", amount: euros(cents(breakdown?.zero_rated_sales ?? 0)), hint: "Sales at 0% other than to other EU states" },
    { box: "10", label: "Sales outside the scope of Cyprus VAT", amount: euros(cents(breakdown?.outside_scope_sales ?? 0)), hint: "Invoices to customers outside the EU" },
    { box: "11A", label: "Acquisitions of goods from other EU member states", amount: 0 },
    { box: "11B", label: "Services received from businesses in other EU member states", amount: euros(servicesBought), hint: "Bills and money spent under the reverse charge" },
  ];
  return { vat, values, net: euros(net) };
}

/** A Cyprus VAT return is filed and paid by the tenth day of the second month after its period ends. */
export function vatDueDate(periodEnd: string) {
  return isMonthEnd(periodEnd) ? `${shiftMonths(`${periodEnd.slice(0, 7)}-01`, 2).slice(0, 8)}10` : null;
}

/** VAT on a net amount at a Cyprus rate, to the cent. */
export function vatOn(net: number, rate: number) {
  return Math.round(net * rate) / 100;
}
