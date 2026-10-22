import { AGEING_BUCKETS, ageingBucket, type AgeingBucketKey } from "@/lib/domain/billing";
import { toCents } from "@/lib/domain/invoice-math";
import type { LedgerAccountType, LedgerBalanceRow } from "@/types/database";

/**
 * The overview's figures, worked out from the same ledger the statements
 * read: income and expenses by month, the bank balance month by month, what
 * is owed each way by age, how this year compares with the same months of
 * the last, and the checks an accountant runs before trusting any of it.
 * Pure and client-safe, in cents until the end.
 */

const INCOME: LedgerAccountType[] = ["revenue", "other_income"];
const EXPENSES: LedgerAccountType[] = ["direct_costs", "expense", "depreciation"];
export const RESULT_TYPES: LedgerAccountType[] = [...INCOME, ...EXPENSES];

const closing = (row: LedgerBalanceRow) => toCents(row.opening) + toCents(row.debit) - toCents(row.credit);

/** The calendar months ending with today's, oldest first, as YYYY-MM keys. */
export function trailingMonths(today: string, count = 12) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1)).toISOString().slice(0, 7));
}

export type MonthFigures = { key: string; income: number; expenses: number; profit: number; moneyIn: number; moneyOut: number; cash: number };

/**
 * Each month's income and expenses (from lines posted to income and expense
 * accounts), money in and out of the bank, and the bank balance at its end,
 * which starts from the balance the first month opened with.
 */
export function monthlyFigures(input: {
  months: string[];
  lines: { entry_date: string; account_type: LedgerAccountType; debit: number | string; credit: number | string }[];
  cash: { month: string; money_in: number | string; money_out: number | string }[];
  openingCash: number;
}): MonthFigures[] {
  const income = new Map<string, number>(), expenses = new Map<string, number>();
  for (const line of input.lines) {
    const key = line.entry_date.slice(0, 7), movement = toCents(line.debit) - toCents(line.credit);
    if (INCOME.includes(line.account_type)) income.set(key, (income.get(key) ?? 0) - movement);
    else if (EXPENSES.includes(line.account_type)) expenses.set(key, (expenses.get(key) ?? 0) + movement);
  }
  const cash = new Map(input.cash.map(row => [row.month.slice(0, 7), row]));
  let balance = toCents(input.openingCash);
  return input.months.map(key => {
    const moneyIn = toCents(cash.get(key)?.money_in ?? 0), moneyOut = toCents(cash.get(key)?.money_out ?? 0);
    balance += moneyIn - moneyOut;
    const earned = income.get(key) ?? 0, spent = expenses.get(key) ?? 0;
    return { key, income: earned / 100, expenses: spent / 100, profit: (earned - spent) / 100, moneyIn: moneyIn / 100, moneyOut: moneyOut / 100, cash: balance / 100 };
  });
}

export type Ageing = { buckets: Record<AgeingBucketKey, number>; total: number; overdue: number; count: number };

/** Open balances by how far past due they are. */
export function ageing(rows: { balance: number | string; days_overdue: number | string }[]): Ageing {
  const buckets = Object.fromEntries(AGEING_BUCKETS.map(bucket => [bucket.key, 0])) as Record<AgeingBucketKey, number>;
  for (const row of rows) buckets[ageingBucket(Math.max(0, Number(row.days_overdue) || 0))] += toCents(row.balance);
  const total = Object.values(buckets).reduce((sum, value) => sum + value, 0);
  return {
    buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value / 100])) as Record<AgeingBucketKey, number>,
    total: total / 100, overdue: (total - buckets.current) / 100, count: rows.length,
  };
}

/** A year-on-year change, or null when last year had nothing to compare with. */
export function yearOnYear(current: number, previous: number) {
  return toCents(previous) === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Income, expenses and profit from balances read for a period. */
export function results(rows: LedgerBalanceRow[]) {
  let income = 0, expenses = 0;
  for (const row of rows) {
    const movement = toCents(row.debit) - toCents(row.credit);
    if (INCOME.includes(row.type)) income -= movement;
    else if (EXPENSES.includes(row.type)) expenses += movement;
  }
  return { income: income / 100, expenses: expenses / 100, profit: (income - expenses) / 100, margin: income > 0 ? Math.round(((income - expenses) / income) * 1000) / 10 : null };
}

/** The expense accounts that took the most this year, largest first, with everything else summed. */
export function topExpenses(rows: LedgerBalanceRow[], count = 6) {
  const spent = rows.filter(row => EXPENSES.includes(row.type))
    .map(row => ({ accountId: row.account_id, code: row.code, name: row.name, amount: toCents(row.debit) - toCents(row.credit) }))
    .filter(row => row.amount > 0).sort((a, b) => b.amount - a.amount);
  const total = spent.reduce((sum, row) => sum + row.amount, 0);
  const top = spent.slice(0, count).map(row => ({ ...row, amount: row.amount / 100, share: total ? Math.round((row.amount / total) * 1000) / 10 : 0 }));
  const rest = spent.slice(count).reduce((sum, row) => sum + row.amount, 0);
  return { top, other: rest / 100, otherCount: Math.max(0, spent.length - count), total: total / 100 };
}

/** Closing balances by system role, and of the banks, as at the end of the period the rows were read for. */
export function positions(rows: LedgerBalanceRow[]) {
  const role = (name: string) => rows.filter(row => row.system_role === name).reduce((sum, row) => sum + closing(row), 0);
  const ofType = (...types: LedgerAccountType[]) => rows.filter(row => types.includes(row.type)).reduce((sum, row) => sum + closing(row), 0);
  return {
    cash: ofType("bank") / 100,
    receivable: role("receivable") / 100,
    payable: -role("payable") / 100,
    vat: -role("vat") / 100,
    currentAssets: ofType("bank", "current_asset") / 100,
    currentLiabilities: -ofType("current_liability") / 100,
    /** Every account's closing balance, debit-positive, adds up to nothing in a ledger that balances. */
    imbalance: rows.reduce((sum, row) => sum + closing(row), 0) / 100,
  };
}

export type BooksCheck = { key: string; state: "ok" | "attention" | "info"; title: string; detail: string; href?: string };

/**
 * The checks an accountant runs before trusting the figures: the ledger
 * balances, the debtors and creditors control accounts agree with the open
 * invoices and bills behind them, the bank is reconciled, and whether a
 * period has been closed.
 */
export function booksChecks(input: {
  imbalance: number;
  receivable: { ledger: number; documents: number; count: number; otherCurrencies: number };
  payable: { ledger: number; documents: number; count: number };
  unreconciled: number | null;
  lockDate: string | null;
  formatMoney: (value: number) => string;
  formatDate: (value: string) => string;
}): BooksCheck[] {
  const money = input.formatMoney;
  const agree = (a: number, b: number) => toCents(a) === toCents(b);
  const checks: BooksCheck[] = [
    agree(input.imbalance, 0)
      ? { key: "ledger", state: "ok", title: "The ledger balances", detail: "Every entry's debits equal its credits.", href: "/accounts/reports/trial-balance" }
      : { key: "ledger", state: "attention", title: "The ledger does not balance", detail: `Debits and credits differ by ${money(Math.abs(input.imbalance))}.`, href: "/accounts/reports/trial-balance" },
    agree(input.receivable.ledger, input.receivable.documents)
      ? { key: "receivable", state: "ok", title: "Debtors agree", detail: `Accounts receivable is ${money(input.receivable.ledger)}, the total of ${input.receivable.count} open invoice${input.receivable.count === 1 ? "" : "s"}.${input.receivable.otherCurrencies ? ` ${input.receivable.otherCurrencies} in another currency stay${input.receivable.otherCurrencies === 1 ? "s" : ""} outside the books.` : ""}`, href: "/invoices/ageing" }
      : { key: "receivable", state: "attention", title: "Debtors do not agree", detail: `Accounts receivable is ${money(input.receivable.ledger)}; open invoices total ${money(input.receivable.documents)}.`, href: "/invoices/ageing" },
    agree(input.payable.ledger, input.payable.documents)
      ? { key: "payable", state: "ok", title: "Creditors agree", detail: `Accounts payable is ${money(input.payable.ledger)}, the total of ${input.payable.count} unpaid bill${input.payable.count === 1 ? "" : "s"}.`, href: "/accounts/reports/aged-payables" }
      : { key: "payable", state: "attention", title: "Creditors do not agree", detail: `Accounts payable is ${money(input.payable.ledger)}; unpaid bills total ${money(input.payable.documents)}.`, href: "/accounts/reports/aged-payables" },
  ];
  if (input.unreconciled !== null) checks.push(input.unreconciled === 0
    ? { key: "bank", state: "ok", title: "The bank is reconciled", detail: "Every imported statement line is matched or set aside.", href: "/accounts/bank" }
    : { key: "bank", state: "attention", title: `${input.unreconciled} bank line${input.unreconciled === 1 ? "" : "s"} to reconcile`, detail: "Imported from the bank and not yet matched to the books.", href: "/accounts/bank" });
  checks.push(input.lockDate
    ? { key: "lock", state: "info", title: `Locked up to ${input.formatDate(input.lockDate)}`, detail: "Nothing dated on or before it can change.", href: "/accounts/settings" }
    : { key: "lock", state: "info", title: "No period is locked", detail: "Filing a VAT return in Ledgerline locks its period.", href: "/accounts/settings" });
  return checks;
}

/** How many days of income the firm is owed: what clients owe against a year's income. */
export function debtorDays(owed: number, yearIncome: number) {
  return yearIncome > 0 ? Math.round((owed / yearIncome) * 365) : null;
}

/** How many months of the firm's recent spending the bank balance covers. */
export function monthsCovered(cash: number, months: { moneyOut: number }[]) {
  const recent = months.slice(-3);
  const spending = recent.reduce((sum, month) => sum + month.moneyOut, 0) / Math.max(1, recent.length);
  return spending > 0 ? Math.round((cash / spending) * 10) / 10 : null;
}

// ---------------------------------------------------------------------------
// The AI overview's answer, as the page shows it
// ---------------------------------------------------------------------------

export type OverviewTone = "good" | "watch" | "concern";
export type BooksOverview = {
  headline: string;
  points: { tone: OverviewTone; title: string; detail: string }[];
  actions: string[];
  questions: string[];
};
export type OverviewState = { ok: boolean; error: string | null; available: boolean; overview: BooksOverview | null; at: string | null };
export const idleOverview: OverviewState = { ok: false, error: null, available: true, overview: null, at: null };

/** A question put to the books, and what came back. */
export const BOOKS_QUESTION_MAX = 400;
export type QuestionState = { ok: boolean; error: string | null; available: boolean; question: string | null; answer: string | null; looked: string[]; at: string | null };
export const idleQuestion: QuestionState = { ok: false, error: null, available: true, question: null, answer: null, looked: [], at: null };
