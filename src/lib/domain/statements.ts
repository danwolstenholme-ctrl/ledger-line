import { REPORT_RANGES, resolvePeriod, toDate } from "./accounts";

/**
 * A statement of account, for a customer or a supplier: what the period it
 * covers is, and which statement. Activity is every invoice or bill,
 * payment, credit and refund in the period with the running balance; open
 * items are what is still unpaid on one date. Client-safe: the page's
 * controls and the downloads read the same address.
 */

export const STATEMENT_RANGES = [
  { key: "last_3_months", label: "Last three months" },
  ...REPORT_RANGES,
  { key: "all", label: "Everything" },
] as const;
export type StatementRange = (typeof STATEMENT_RANGES)[number]["key"] | "custom";

export const STATEMENT_VIEWS = [
  { key: "activity", label: "Activity" },
  { key: "open", label: "Open items" },
] as const;
export type StatementView = (typeof STATEMENT_VIEWS)[number]["key"];
export type StatementParty = "customer" | "supplier";

/** What a line of a statement is, as the screen and a CSV name it. */
export const STATEMENT_KIND_LABELS = {
  invoice: "Invoice", payment: "Payment", credit_note: "Credit note", refund: "Refund",
  bill: "Bill", bill_payment: "Payment", supplier_credit: "Credit note", supplier_refund: "Refund received",
} as const;
export type StatementKind = keyof typeof STATEMENT_KIND_LABELS;

export type StatementPeriod = {
  view: StatementView;
  range: StatementRange;
  /** The first day, or null for everything from the start. Open items have none: they are as at `to`. */
  from: string | null;
  to: string;
  /** Activity newest first, on screen; a document always reads oldest first. */
  order: "oldest" | "newest";
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The first day of the month three months before `to`'s: the last three months, the default. */
export function threeMonthsBefore(to: string) {
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 3, 1);
  return start.toISOString().slice(0, 10);
}

/** The statement asked for in an address's parameters, as of `today`. */
export function statementPeriod(params: Record<string, unknown>, today: string, yearEndMonth: number): StatementPeriod {
  const view: StatementView = params.view === "open" ? "open" : "activity";
  const order = params.order === "newest" ? "newest" : "oldest";
  // Open items stand on one day: today, or the end of a month, quarter or year before it.
  if (view === "open") {
    const period = toDate(resolvePeriod(params, today, yearEndMonth, "this_month"), today);
    return { view, order, range: period.range, from: null, to: period.to };
  }
  // A link with only dates in it (as older ones had) is a custom period.
  const range = params.range ?? (typeof params.from === "string" && DATE.test(params.from) ? "custom" : "last_3_months");
  const dated = typeof params.from === "string" && DATE.test(params.from) && typeof params.to === "string" && DATE.test(params.to) && params.from <= params.to;
  if (range === "all") return { view, order, range: "all", from: null, to: today };
  if ((range === "custom" && dated) || REPORT_RANGES.some(item => item.key === range)) {
    const period = toDate(resolvePeriod({ ...params, range }, today, yearEndMonth), today);
    return { view, order, range: period.range, from: period.from, to: period.to };
  }
  return { view, order, range: "last_3_months", from: threeMonthsBefore(today), to: today };
}

/** The same statement as an address's parameters, for its downloads and its controls. */
export function statementQuery(period: StatementPeriod, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ view: period.view, range: period.range, ...(period.range === "custom" ? { from: period.from ?? "", to: period.to } : {}), ...extra });
  if (period.order === "newest") query.set("order", "newest");
  return query.toString();
}
