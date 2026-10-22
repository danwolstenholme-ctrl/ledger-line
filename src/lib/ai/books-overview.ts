import "server-only";

import { z } from "zod";

import type { getAccountsDashboard } from "@/lib/data/accounts";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { debtorDays, monthsCovered, type BooksOverview } from "@/lib/domain/accounts-insights";
import { completeStructured } from "./anthropic";

/**
 * The model reads the overview's figures and says what stands out. It is
 * given totals only — accounts, months, ages of debt, the checks — never a
 * client's or supplier's name, and nothing is stored: each press is a fresh
 * read of the books as they are.
 */

const ANSWER: z.ZodType<BooksOverview> = z.object({
  headline: z.string().describe("One sentence on how the company is doing, naming the figure that matters most."),
  points: z.array(z.object({
    tone: z.enum(["good", "watch", "concern"]).describe("good: going well; watch: worth keeping an eye on; concern: needs action now."),
    title: z.string().describe("A few words naming the point."),
    detail: z.string().describe("One or two sentences with the figures behind it."),
  })).describe("Three to six observations, the most important first."),
  actions: z.array(z.string()).describe("Up to three practical next steps for the directors or whoever keeps the books."),
  questions: z.array(z.string()).describe("Up to three questions worth putting to the company's accountant."),
});

const SYSTEM = `You are the management accountant of a company in Cyprus, reading its books for its directors and its accounting practice. You are given the company's figures as JSON: totals already worked out from a double-entry ledger, in euros, with what the company does. Write an overview a director can take in within a minute.

- Ground every statement in the figures given, quoted in euros (e.g. €12,400). Never invent figures, names, dates or causes the data does not show; where a cause is uncertain, say what to check instead.
- Compare this year to date with the same months last year only when same_period_last_year is given; when it is null the books began part-way through last year, so do not compare with last year at all (say the books have been in Ledgerline since the date given).
- Look at: income, profit and margin and their trend over the twelve months; the costs that move the result; cash in the bank against recent monthly spending; what customers owe, how late it is, debtor days and how much rests on one client; what the company owes and anything overdue; the VAT building up this quarter; and any check that does not pass.
- British English, plain words, plain text with no markdown, no preamble, no sign-off. Say "the company"; there are no names in the data and you must not suggest any.`;

type Dashboard = Awaited<ReturnType<typeof getAccountsDashboard>>;

/** The figures the model is given: the overview's own, and nothing that names anyone. */
export function booksFacts(dashboard: Dashboard) {
  const yearIncome = dashboard.months.reduce((sum, month) => sum + month.income, 0);
  const byAge = (buckets: Record<string, number>) => Object.fromEntries(AGEING_BUCKETS.map(bucket => [bucket.label.toLowerCase(), buckets[bucket.key]]));
  const result = (figures: Dashboard["thisYear"]) => ({ income: figures.income, expenses: figures.expenses, net_profit: figures.profit, net_margin_percent: figures.margin });
  return {
    today: dashboard.today,
    company: { activity: dashboard.org.industry, vat_registered: dashboard.org.vat_registered },
    financial_year: dashboard.year,
    year_to_date: { from: dashboard.year.from, to: dashboard.today, ...result(dashboard.thisYear) },
    // The books begin on 1 July 2025: a "same period last year" they only half cover is not a comparison.
    books_in_ledgerline_since: "2025-07-01",
    same_period_last_year: dashboard.lastYear.from >= "2025-07-01" ? { ...dashboard.lastYear, ...result(dashboard.priorYear) } : null,
    largest_expenses_this_year: dashboard.expenses.top.map(item => ({ account: `${item.code} ${item.name}`, amount: item.amount, share_of_expenses_percent: item.share })),
    other_expenses_this_year: dashboard.expenses.other,
    last_twelve_months: dashboard.months.map(month => ({ month: month.key, income: month.income, expenses: month.expenses, profit: month.profit, money_in: month.moneyIn, money_out: month.moneyOut, bank_balance_at_month_end: month.cash })),
    position_today: {
      cash_in_bank: dashboard.position.cash, months_of_recent_spending_covered: monthsCovered(dashboard.position.cash, dashboard.months),
      owed_to_the_company: dashboard.position.receivable, owed_by_the_company: dashboard.position.payable, vat_owed_to_the_tax_department: dashboard.position.vat,
      net_current_assets: Math.round((dashboard.position.currentAssets - dashboard.position.currentLiabilities) * 100) / 100,
    },
    receivables: {
      total: dashboard.receivables.total, overdue: dashboard.receivables.overdue, by_days_overdue: byAge(dashboard.receivables.buckets),
      open_invoices: dashboard.receivables.count, clients_owing: dashboard.receivables.clients, largest_single_client_share_percent: dashboard.receivables.largestShare,
      debtor_days: debtorDays(dashboard.receivables.total, yearIncome),
    },
    payables: { total: dashboard.payables.total, overdue: dashboard.payables.overdue, by_days_overdue: byAge(dashboard.payables.buckets), unpaid_bills: dashboard.payables.count },
    vat_this_quarter: { from: dashboard.quarterStart, to: dashboard.today, vat_on_sales: dashboard.vat.outputVat, vat_on_costs: dashboard.vat.inputVat, net_to_pay: dashboard.vat.net },
    checks: dashboard.checks.filter(check => check.state !== "info").map(check => ({ check: check.title, passes: check.state === "ok", detail: check.detail })),
  };
}

export async function explainBooks(facts: ReturnType<typeof booksFacts>) {
  return completeStructured({ system: SYSTEM, user: `The company's figures:\n\n${JSON.stringify(facts, null, 1)}`, schema: ANSWER, effort: "medium" });
}
