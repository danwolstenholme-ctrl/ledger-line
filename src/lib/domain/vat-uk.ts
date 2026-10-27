import type { ReverseChargeKind } from "@/lib/domain/regimes";

/**
 * The UK VAT return: nine boxes from the ledger's figures for a period, as
 * HMRC's VAT Notice 700/12 and, for the flat rate, VAT Notice 733 set them out
 * (checked 27 Oct 2026). And the UK's VAT periods: every quarter on a stagger,
 * every month, or once a year under annual accounting. Client-safe.
 *
 * - Box 1 VAT on sales, with the VAT a business accounts for itself under a
 *   reverse charge: services bought from abroad, construction services under
 *   the CIS domestic reverse charge, imports under postponed VAT accounting.
 *   On the flat rate, the flat rate of VAT-inclusive turnover instead of the
 *   VAT on sales.
 * - Box 4 VAT reclaimed, with the same reverse charges. On the flat rate, only
 *   single capital purchases of £2,000 or more with VAT.
 * - Box 6 sales before VAT, of every kind, and the value of services bought
 *   from abroad (the deemed supply). On the flat rate, the turnover the rate
 *   was applied to, with its VAT, and those services.
 * - Box 7 purchases before VAT, reverse charges and imports included; nothing
 *   never on a VAT return (wages, PAYE, rates). On the flat rate, the capital
 *   purchases claimed in box 4 and the reverse charges.
 * - Boxes 2, 8 and 9 are Northern Ireland's trade in goods with the EU.
 */

export type UkVatFigures = {
  salesVat: number; purchaseVat: number; salesNet: number; purchasesNet: number;
  reverseCharge: Record<ReverseChargeKind, { net: number; vat: number }>;
  capital: { net: number; vat: number };
};
export type UkVatScheme = { flatRate: number | null; cash: boolean };
export type UkVatBox = { box: string; label: string; amount: number; hint?: string };

const round = (value: number) => Math.round(value * 100) / 100;

export function ukVatReturn(figures: UkVatFigures, scheme: UkVatScheme) {
  const rc = figures.reverseCharge;
  const rcVat = round(rc.services.vat + rc.construction.vat + rc.import.vat);
  const rcNet = round(rc.services.net + rc.construction.net + rc.import.net);
  const flat = scheme.flatRate !== null;
  const turnover = round(figures.salesNet + figures.salesVat);
  const flatVat = flat ? round(turnover * scheme.flatRate! / 100) : 0;
  const box1 = round((flat ? flatVat : figures.salesVat) + rcVat);
  const box2 = 0, box3 = round(box1 + box2);
  const box4 = round((flat ? figures.capital.vat : figures.purchaseVat) + rcVat);
  const box5 = round(box3 - box4);
  const box6 = round(flat ? turnover + rc.services.net : figures.salesNet + rc.services.net);
  const box7 = round(flat ? figures.capital.net + rcNet : figures.purchasesNet);
  const boxes: UkVatBox[] = [
    { box: "1", label: "VAT due on sales and other outputs", amount: box1, hint: flat ? `${scheme.flatRate}% of the VAT-inclusive turnover${rcVat ? ", and reverse charges" : ""}` : rcVat ? "With the VAT you account for under reverse charges" : undefined },
    { box: "2", label: "VAT due on acquisitions of goods from the EU (Northern Ireland)", amount: box2 },
    { box: "3", label: "Total VAT due", amount: box3, hint: "Box 1 plus box 2" },
    { box: "4", label: "VAT reclaimed on purchases and other inputs", amount: box4, hint: flat ? "Capital purchases of £2,000 or more with VAT, and reverse charges" : rcVat ? "With the reverse charges in box 1" : undefined },
    // HMRC's box 5 is the difference either way, never negative: the label says which way.
    { box: "5", label: box5 < 0 ? "Net VAT to reclaim from HMRC" : "Net VAT to pay to HMRC", amount: Math.abs(box5), hint: box5 < 0 ? "Box 4 less box 3" : "Box 3 less box 4" },
    { box: "6", label: "Total value of sales and all other outputs, excluding VAT", amount: box6, hint: flat ? "The flat-rated turnover includes its VAT, as the scheme requires" : undefined },
    { box: "7", label: "Total value of purchases and all other inputs, excluding VAT", amount: box7 },
    { box: "8", label: "Total value of goods supplied to the EU (Northern Ireland)", amount: 0 },
    { box: "9", label: "Total value of goods acquired from the EU (Northern Ireland)", amount: 0 },
  ];
  return {
    boxes, net: box5, turnover, flatVat,
    /** On the flat rate, VAT recorded on everyday purchases is not reclaimable: what the books hold of it. */
    unclaimable: flat ? round(figures.purchaseVat - figures.capital.vat) : 0,
  };
}

// ---------------------------------------------------------------------------
// Periods and due dates
// ---------------------------------------------------------------------------

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const endOfMonth = (year: number, month: number) => iso(year, month + 1, 0);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A return and its payment are due 1 calendar month and 7 days after the period; under annual accounting, 2 months after. */
export function ukVatDue(periodEnd: string, annual = false) {
  const [year, month] = periodEnd.split("-").map(Number);
  return annual ? endOfMonth(year, month + 2) : addDays(endOfMonth(year, month + 1), 7);
}

export type UkVatPeriod = { from: string; to: string; due: string };
export type UkVatSettings = { period: "quarterly" | "monthly" | "annual"; quarterEndMonth: number; yearEndMonth: number | null };

/** Every VAT period that ends on or after `from` and is due by `until`. */
export function ukVatPeriods(settings: UkVatSettings, from: string, until: string): UkVatPeriod[] {
  const out: UkVatPeriod[] = [];
  const length = settings.period === "monthly" ? 1 : settings.period === "annual" ? 12 : 3;
  const endMonth = settings.period === "annual" ? settings.yearEndMonth ?? 3 : settings.period === "quarterly" ? settings.quarterEndMonth : 1;
  const startYear = Number(from.slice(0, 4)) - 1, lastYear = Number(until.slice(0, 4)) + 1;
  for (let year = startYear; year <= lastYear; year++) {
    for (let month = 1; month <= 12; month++) {
      if ((month - endMonth + 12) % length !== 0) continue;
      const to = endOfMonth(year, month);
      const start = new Date(Date.UTC(year, month - length, 1)).toISOString().slice(0, 10);
      const due = ukVatDue(to, settings.period === "annual");
      if (to >= from && due <= until) out.push({ from: start, to, due });
    }
  }
  return out.sort((a, b) => a.to.localeCompare(b.to));
}

/** Under annual accounting, the payments on account: nine of 10% at the end of months 4 to 12, or three of 25% at the end of months 4, 7 and 10. */
export function ukAnnualPayments(period: UkVatPeriod, schedule: "monthly" | "quarterly") {
  const [year, month] = period.from.split("-").map(Number);
  const months = schedule === "monthly" ? [4, 5, 6, 7, 8, 9, 10, 11, 12] : [4, 7, 10];
  return months.map(nth => ({ due: endOfMonth(year, month + nth - 1), share: schedule === "monthly" ? 10 : 25 }));
}
