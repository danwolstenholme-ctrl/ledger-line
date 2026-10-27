/**
 * Official extensions of Cyprus filing deadlines. When the Tax Department,
 * the Tax Commissioner or the Council of Ministers moves a date, the deadline
 * moves with it here, saying who moved it and from when, with the source.
 * Ledgerline keeps this list from the published announcements: add each new
 * one as it is announced (checked 26 Oct 2026). Client-safe.
 */

export type ExtendedKind = "vat_return" | "vies" | "tax_return" | "tax_payment" | "employer_return";
export type Extension = { kind: ExtendedKind; periodEnd: string; due: string; by: string; source: string };

export const EXTENSIONS: Extension[] = [
  // VAT return for the quarter ended 30 November 2025, and the VIES statement for December 2025.
  { kind: "vat_return", periodEnd: "2025-11-30", due: "2026-01-20", by: "the Tax Department", source: "https://kpmg.com/cy/en/home/insights/2026/1/deadline-extension-vat-return-for-the-period-ending-30-november-2025.html" },
  { kind: "vies", periodEnd: "2025-12-31", due: "2026-01-20", by: "the Tax Department", source: "https://kpmg.com/cy/en/home/insights/2026/1/deadline-extension-vat-return-for-the-period-ending-30-november-2025.html" },
  // VAT return for the quarter ended 30 June 2026, and the VIES statement for July 2026: the summer holidays.
  { kind: "vat_return", periodEnd: "2026-06-30", due: "2026-08-20", by: "the Tax Commissioner", source: "https://www.oeb.org.cy/en/?p=54658" },
  { kind: "vies", periodEnd: "2026-07-31", due: "2026-08-20", by: "the Tax Commissioner", source: "https://www.oeb.org.cy/en/?p=54658" },
  // Company tax returns for tax year 2024 (with audited or reviewed accounts).
  { kind: "tax_return", periodEnd: "2024-12-31", due: "2026-11-30", by: "the Council of Ministers (decrees ΚΔΠ 358/2025 and 359/2025)", source: "https://www.pwc.com.cy/en/publications/direct-tax-updates-2025/dtu-n16-2025.pdf" },
  // The employer's annual return (TD7) for 2025.
  { kind: "employer_return", periodEnd: "2025-12-31", due: "2026-11-30", by: "the Tax Department", source: "https://cy.andersen.com/news/extension-of-employers-return-form-td7-for-tax-year-2025/" },
];

export type ExtendedDue = { due: string; extension: { from: string; by: string; source: string } | null };

/** A deadline's due date, after any official extension. */
export function extendedDue(kind: string, periodEnd: string, due: string): ExtendedDue {
  const found = EXTENSIONS.find(item => item.kind === kind && item.periodEnd === periodEnd);
  return found && found.due > due ? { due: found.due, extension: { from: due, by: found.by, source: found.source } } : { due, extension: null };
}
