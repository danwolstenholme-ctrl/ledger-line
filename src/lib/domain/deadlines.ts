import { quarterLabel, vatQuarters } from "@/lib/domain/vat";

/**
 * A company's Cyprus deadlines, worked out from what is already known about
 * it: its VAT quarters, the months it sold services to businesses in other EU
 * states, and the tax year. Nobody types a deadline in. Client-safe.
 *
 * - VAT return: the 10th of the second month after the quarter ends.
 * - VIES statement: the 15th of the month after a month with EU business sales.
 * - Provisional tax: two instalments, 31 July and 31 December.
 * - Company tax return: within 15 months of the tax year's end, so 31 March two years on.
 * - AML review: the client's due diligence and risk rating, every 1, 2 or 3 years by risk (from its client file, not here).
 */

export const DEADLINE_KINDS = ["vat_return", "vies", "provisional_tax", "tax_return", "aml_review"] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export const DEADLINE_LABELS: Record<DeadlineKind, string> = { vat_return: "VAT return", vies: "VIES statement", provisional_tax: "Provisional tax", tax_return: "Company tax return", aml_review: "AML review" };

export type Obligation = { kind: DeadlineKind; periodStart: string | null; periodEnd: string; due: string; title: string };

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const monthName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function obligations(input: { registered: boolean; quarterEndMonth: number; booksFrom: string; until: string; euSalesMonths: string[] }): Obligation[] {
  const out: Obligation[] = [];
  if (input.registered) {
    for (const quarter of vatQuarters(input.quarterEndMonth, input.booksFrom, input.until)) {
      out.push({ kind: "vat_return", periodStart: quarter.from, periodEnd: quarter.to, due: quarter.due, title: `VAT return, ${quarterLabel(quarter.from, quarter.to)}` });
    }
    for (const month of input.euSalesMonths) {
      const [year, number] = month.split("-").map(Number);
      const end = iso(year, number + 1, 0);
      out.push({ kind: "vies", periodStart: iso(year, number, 1), periodEnd: end, due: iso(number === 12 ? year + 1 : year, number === 12 ? 1 : number + 1, 15), title: `VIES statement, ${monthName(end)}` });
    }
  }
  const firstYear = Number(input.booksFrom.slice(0, 4)), lastYear = Number(input.until.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    for (const [due, which] of [[iso(year, 7, 31), "first"], [iso(year, 12, 31), "second"]] as const) {
      if (due >= input.booksFrom) out.push({ kind: "provisional_tax", periodStart: null, periodEnd: due, due, title: `Provisional tax ${year}, ${which} instalment` });
    }
    out.push({ kind: "tax_return", periodStart: iso(year, 1, 1), periodEnd: iso(year, 12, 31), due: iso(year + 2, 3, 31), title: `Company tax return, ${year}` });
  }
  return out.filter(item => item.due <= input.until).sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

export const daysUntil = (today: string, date: string) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
