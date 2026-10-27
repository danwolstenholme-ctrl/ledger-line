import { extendedDue, type ExtendedDue } from "@/lib/domain/extensions";

/**
 * Cyprus VAT periods. The Tax Department staggers quarters: a company's
 * quarters end in January/April/July/October, February/May/August/November
 * or March/June/September/December. Each return is filed and paid by the
 * tenth day of the second month after its quarter ends, unless the Tax
 * Department extends it (lib/domain/extensions). Client-safe.
 */

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const monthEnd = (year: number, month: number) => iso(year, month + 1, 0);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** `extension`: when the date was moved by an official extension, from what and by whom. */
export type VatPeriod = { from: string; to: string; due: string; extension?: ExtendedDue["extension"] };

/** Every quarter that overlaps the books, from their start to the quarter holding `until`. */
export function vatQuarters(quarterEndMonth: number, booksFrom: string, until: string): VatPeriod[] {
  const out: VatPeriod[] = [];
  let [year, month] = booksFrom.split("-").map(Number);
  while ((month - quarterEndMonth) % 3 !== 0) { month += 1; if (month > 12) { month = 1; year += 1; } }
  for (let guard = 0; guard < 40; guard++) {
    const to = monthEnd(year, month);
    const startMonth = month - 2 < 1 ? month + 10 : month - 2, startYear = month - 2 < 1 ? year - 1 : year;
    const from = iso(startYear, startMonth, 1);
    const dueMonth = month + 2 > 12 ? month - 10 : month + 2, dueYear = month + 2 > 12 ? year + 1 : year;
    const due = extendedDue("vat_return", to, iso(dueYear, dueMonth, 10));
    out.push({ from: from < booksFrom ? booksFrom : from, to, due: due.due, extension: due.extension });
    if (to >= until) break;
    month += 3; if (month > 12) { month -= 12; year += 1; }
  }
  return out;
}

export type NextVatReturn = VatPeriod & { state: "overdue" | "due" | "open"; daysLeft: number };

/** The return that needs attention: the oldest finished quarter not yet filed, or else the quarter running now. */
export function nextVatReturn(input: { quarterEndMonth: number; registered: boolean; booksFrom: string; filed: string[]; today: string }): NextVatReturn | null {
  if (!input.registered) return null;
  const quarters = vatQuarters(input.quarterEndMonth, input.booksFrom, input.today);
  const unfiled = quarters.find(quarter => quarter.to < input.today && !input.filed.includes(quarter.to));
  const period = unfiled ?? quarters[quarters.length - 1];
  const daysLeft = daysBetween(input.today, period.due);
  return { ...period, state: !unfiled ? "open" : daysLeft < 0 ? "overdue" : "due", daysLeft };
}

/** The quarter a date falls in, for a VAT page asked about "this return". */
export function quarterContaining(quarterEndMonth: number, date: string): VatPeriod {
  const quarters = vatQuarters(quarterEndMonth, `${Number(date.slice(0, 4)) - 1}-01-01`, date);
  return quarters.find(quarter => quarter.from <= date && date <= quarter.to) ?? quarters[quarters.length - 1];
}

/** "Jul–Sep 2026": a quarter as people say it. */
export function quarterLabel(from: string, to: string) {
  const month = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${month(from)}–${month(to)} ${to.slice(0, 4)}`;
}
