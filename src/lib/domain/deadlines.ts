import { extendedDue, type ExtendedDue } from "@/lib/domain/extensions";
import { quarterLabel, vatQuarters } from "@/lib/domain/vat";
import { ukAnnualPayments, ukVatPeriods, type UkVatSettings } from "@/lib/domain/vat-uk";

/**
 * A company's Cyprus deadlines, worked out from what is already known about
 * it: its VAT quarters, the months it sold services to businesses in other EU
 * states, its tax and financial years, the day it was incorporated, and
 * whether the practice runs its payroll. Nobody types a deadline in; an
 * official extension (lib/domain/extensions) moves one. Client-safe.
 * Checked against the law and the Tax Department's practice on 26 Oct 2026.
 *
 * Tax Department:
 * - VAT return, and the VAT due: the 10th of the second month after the quarter ends.
 * - VIES statement: the 15th of the month after a month with supplies to businesses in other EU states.
 * - Provisional tax: two instalments, 31 July and 31 December of the tax year.
 * - Company tax return (IR4): for tax years to 2025, 31 March of the second year after;
 *   from tax year 2026, 31 January of the second year after (13 months), with the balance of tax.
 * - Balance of corporation tax for tax years to 2025: 1 August of the following year.
 * - Payroll: the monthly TD7, Social Insurance and GESY, and the tax withheld, by the end of the
 *   following month; the employer's annual return (TD7) by 31 May of the following year.
 *
 * Registrar of Companies (Companies Law, Cap. 113):
 * - Financial statements, audited or reviewed, within 12 months of the balance sheet date (s.142(2)).
 * - Annual return (HE32), made up to the company's reference date and filed within 28 days (s.120):
 *   the first reference date is the day after 18 months from incorporation, then each year on.
 *
 * And the practice's own: the AML review of each client, every 1, 2 or 3 years by risk (from its client file).
 *
 * A UK company's (ukObligations, checked on GOV.UK on 27 Oct 2026): the VAT return and its payment, 1 month
 * and 7 days after each period (annual accounting: 2 months, with payments on account); annual accounts to
 * Companies House 9 months after the year end (the first, the later of 21 months from incorporation and 3 months
 * after the period); Corporation Tax 9 months and a day after it, the Company Tax Return 12 months after; and the
 * confirmation statement within 14 days of each anniversary of incorporation.
 */

export const DEADLINE_KINDS = ["vat_return", "vat_payment", "vies", "provisional_tax", "tax_return", "tax_payment", "financial_statements", "accounts_filing", "annual_return", "confirmation_statement", "payroll", "employer_return", "aml_review"] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export const DEADLINE_LABELS: Record<DeadlineKind, string> = {
  vat_return: "VAT return", vies: "VIES statement", provisional_tax: "Provisional tax", tax_return: "Company tax return", tax_payment: "Corporation tax",
  financial_statements: "Financial statements", annual_return: "Annual return (HE32)", payroll: "Payroll returns", employer_return: "Employer’s return", aml_review: "AML review",
  vat_payment: "VAT payment on account", accounts_filing: "Annual accounts", confirmation_statement: "Confirmation statement",
};
/** Closed by marking them done (a VAT return closes when filed, financial statements and UK annual accounts when the year end records them filed, an AML review when the next is approved). */
export const MARKED_KINDS = ["vies", "provisional_tax", "tax_return", "tax_payment", "annual_return", "payroll", "employer_return", "vat_payment", "confirmation_statement"] as const;

export type Obligation = { kind: DeadlineKind; periodStart: string | null; periodEnd: string; due: string; title: string; extension: ExtendedDue["extension"] };

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const monthName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const longDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The same day `months` later; the last day of the month when that day doesn't exist (31 August + 18 months is 28 or 29 February). */
export function addMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(day, last));
}

/** The company tax return's due date for a tax year: 15 months after it to 2025, 13 months after it from 2026. */
export const taxReturnDue = (year: number) => year <= 2025 ? iso(year + 2, 3, 31) : iso(year + 2, 1, 31);

/** The dates an annual return (HE32) is made up to: the day after 18 months from incorporation, then every year on. */
export function annualReturnDates(incorporatedOn: string, from: string, until: string) {
  const out: string[] = [];
  const first = addDays(addMonths(incorporatedOn, 18), 1);
  for (let years = 0; years < 200; years++) {
    const date = addMonths(first, 12 * years);
    if (date > until) break;
    if (addDays(date, 28) >= from) out.push(date);
  }
  return out;
}

/** The end of each financial year that closes on or after `from`, up to `until`. */
export function financialYearEnds(yearEndMonth: number, from: string, until: string) {
  const out: string[] = [];
  for (let year = Number(from.slice(0, 4)) - 1; year <= Number(until.slice(0, 4)); year++) {
    const end = iso(year, yearEndMonth + 1, 0);
    if (end >= from && end <= until) out.push(end);
  }
  return out;
}

export type ObligationInput = {
  registered: boolean; quarterEndMonth: number; booksFrom: string; until: string; euSalesMonths: string[];
  yearEndMonth?: number; incorporatedOn?: string | null; payroll?: boolean;
};

export function obligations(input: ObligationInput): Obligation[] {
  const out: Obligation[] = [];
  const push = (item: Omit<Obligation, "extension">) => {
    const extended = extendedDue(item.kind, item.periodEnd, item.due);
    out.push({ ...item, due: extended.due, extension: extended.extension });
  };
  if (input.registered) {
    for (const quarter of vatQuarters(input.quarterEndMonth, input.booksFrom, input.until)) {
      out.push({ kind: "vat_return", periodStart: quarter.from, periodEnd: quarter.to, due: quarter.due, title: `VAT return, ${quarterLabel(quarter.from, quarter.to)}`, extension: quarter.extension ?? null });
    }
    for (const month of input.euSalesMonths) {
      const [year, number] = month.split("-").map(Number);
      const end = iso(year, number + 1, 0);
      push({ kind: "vies", periodStart: iso(year, number, 1), periodEnd: end, due: iso(number === 12 ? year + 1 : year, number === 12 ? 1 : number + 1, 15), title: `VIES statement, ${monthName(end)}` });
    }
  }
  const firstYear = Number(input.booksFrom.slice(0, 4)), lastYear = Number(input.until.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    for (const [due, which] of [[iso(year, 7, 31), "first"], [iso(year, 12, 31), "second"]] as const) {
      if (due >= input.booksFrom) push({ kind: "provisional_tax", periodStart: null, periodEnd: due, due, title: `Provisional tax ${year}, ${which} instalment` });
    }
    push({ kind: "tax_return", periodStart: iso(year, 1, 1), periodEnd: iso(year, 12, 31), due: taxReturnDue(year),
      title: year <= 2025 ? `Company tax return (IR4), ${year}` : `Company tax return (IR4) and balance of tax, ${year}` });
    if (year <= 2025) push({ kind: "tax_payment", periodStart: iso(year, 1, 1), periodEnd: iso(year, 12, 31), due: iso(year + 1, 8, 1), title: `Corporation tax: the balance for ${year}` });
    if (input.payroll) push({ kind: "employer_return", periodStart: iso(year, 1, 1), periodEnd: iso(year, 12, 31), due: iso(year + 1, 5, 31), title: `Employer’s return (TD7), ${year}` });
  }
  if (input.payroll) {
    for (let month = input.booksFrom.slice(0, 7); `${month}-01` <= input.until; month = addMonths(`${month}-01`, 1).slice(0, 7)) {
      const [year, number] = month.split("-").map(Number);
      const end = iso(year, number + 1, 0);
      push({ kind: "payroll", periodStart: `${month}-01`, periodEnd: end, due: iso(year, number + 2, 0), title: `Payroll returns, ${monthName(end)}` });
    }
  }
  for (const end of financialYearEnds(input.yearEndMonth ?? 12, input.booksFrom, input.until)) {
    const start = addDays(addMonths(end, -12), 1);
    push({ kind: "financial_statements", periodStart: start, periodEnd: end, due: iso(Number(end.slice(0, 4)) + 1, Number(end.slice(5, 7)) + 1, 0),
      title: (input.yearEndMonth ?? 12) === 12 ? `Financial statements ${end.slice(0, 4)} to the Registrar` : `Financial statements to ${longDate(end)} to the Registrar` });
  }
  if (input.incorporatedOn) {
    for (const date of annualReturnDates(input.incorporatedOn, input.booksFrom, input.until)) {
      push({ kind: "annual_return", periodStart: null, periodEnd: date, due: addDays(date, 28), title: `Annual return (HE32), made up to ${longDate(date)}` });
    }
  }
  return out.filter(item => item.due <= input.until).sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

/**
 * `months` after a date as the Companies Act counts a filing period (s.443): the same day of the month, or from
 * the last day of a month, the last day of the month it lands in. 30 June and 9 months is 31 March.
 */
export function filingMonths(date: string, months: number) {
  const [year, month] = date.split("-").map(Number);
  return date === iso(year, month + 1, 0) ? iso(year, month + months + 1, 0) : addMonths(date, months);
}

export type UkObligationInput = {
  registered: boolean; vat: UkVatSettings & { annualPayments: "monthly" | "quarterly" | null }; booksFrom: string; until: string;
  yearEndMonth: number; incorporatedOn: string | null; entity: "company" | "sole_trader";
};

/** A UK company's or sole trader's deadlines with HMRC and Companies House. */
export function ukObligations(input: UkObligationInput): Obligation[] {
  const out: Obligation[] = [];
  const push = (item: Omit<Obligation, "extension">) => out.push({ ...item, extension: null });
  const year = (end: string) => input.yearEndMonth === 12 ? end.slice(0, 4) : `the year to ${longDate(end)}`;
  if (input.registered) {
    for (const period of ukVatPeriods(input.vat, input.booksFrom, input.until)) {
      const annual = input.vat.period === "annual";
      push({ kind: "vat_return", periodStart: period.from, periodEnd: period.to, due: period.due,
        title: annual ? `VAT return (annual), year to ${longDate(period.to)}` : input.vat.period === "monthly" ? `VAT return, ${monthName(period.to)}` : `VAT return, ${quarterLabel(period.from, period.to)}` });
      if (annual && input.vat.annualPayments) for (const payment of ukAnnualPayments(period, input.vat.annualPayments)) {
        if (payment.due >= input.booksFrom) push({ kind: "vat_payment", periodStart: period.from, periodEnd: payment.due, due: payment.due, title: `VAT payment on account, ${payment.share}% (year to ${longDate(period.to)})` });
      }
    }
  }
  if (input.entity === "company") {
    for (const end of financialYearEnds(input.yearEndMonth, input.booksFrom, input.until)) {
      // A first accounting period runs more than 6 months and at most 18: a year end sooner after incorporation isn't one.
      if (input.incorporatedOn && end < addMonths(input.incorporatedOn, 6)) continue;
      // The first accounts, for a first period of more than a year: the later of 21 months from incorporation and 3 months after it.
      const first = input.incorporatedOn && addMonths(end, -12) < addMonths(input.incorporatedOn, 6) && end > addMonths(input.incorporatedOn, 12);
      const accounts = first ? [addMonths(input.incorporatedOn!, 21), filingMonths(end, 3)].sort().at(-1)! : filingMonths(end, 9);
      push({ kind: "accounts_filing", periodStart: null, periodEnd: end, due: accounts, title: `Annual accounts to Companies House, ${year(end)}` });
      push({ kind: "tax_payment", periodStart: null, periodEnd: end, due: addDays(filingMonths(end, 9), 1), title: `Corporation Tax for ${year(end)}` });
      push({ kind: "tax_return", periodStart: null, periodEnd: end, due: filingMonths(end, 12), title: `Company Tax Return (CT600), ${year(end)}` });
    }
    if (input.incorporatedOn) {
      for (let years = 1; years < 200; years++) {
        const date = addMonths(input.incorporatedOn, 12 * years);
        if (date > input.until) break;
        if (addDays(date, 14) >= input.booksFrom) push({ kind: "confirmation_statement", periodStart: null, periodEnd: date, due: addDays(date, 14), title: `Confirmation statement, made up to ${longDate(date)}` });
      }
    }
  }
  return out.filter(item => item.due <= input.until).sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

export const daysUntil = (today: string, date: string) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
