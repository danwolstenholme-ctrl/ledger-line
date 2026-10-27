import { addDays, addMonths, taxReturnDue } from "@/lib/domain/deadlines";
import { extendedDue } from "@/lib/domain/extensions";

/**
 * A company's year end, as Cyprus law has it. Read from the Companies Law,
 * Cap. 113, as consolidated on CyLaw, on 26 Oct 2026. Client-safe.
 *
 * - Every company's financial statements are audited by a statutory auditor
 *   or audit firm (s.152A(1)(a)).
 * - A private company may instead have them reviewed under ISRE 2400 when, at
 *   the balance sheet date, its turnover (with rent, interest, dividends and
 *   royalties) and its total assets (before liabilities) are within the
 *   limits in at least two consecutive years (s.152A(1)(d)). Turnover: €200,000
 *   for years beginning before 6 February 2026, €300,000 from then; total
 *   assets: €500,000. Not for groups that consolidate (s.152A(1)(e)), nor
 *   companies regulated by the Central Bank, CySEC or the Superintendent of
 *   Insurance, nor those holding a qualifying stake in one (s.152A(1)(g)).
 * - Sizes (s.141A): at most one of the three limits exceeded, at the balance
 *   sheet date; a company changes size after two years either side of a line.
 * - Framework: IFRS as adopted by the EU. A small company may use the
 *   Financial Reporting Standard for small-sized entities instead
 *   (s.142(1)(a1)), once ICPAC issues it; it had not by October 2026.
 * - Filing: with the Registrar within 12 months of the balance sheet date
 *   (s.142(2)(a)), attached to the annual return (s.121).
 * - Annual general meeting: every year, at most 15 months apart; the first
 *   within 18 months of incorporation (s.125). The accounts are laid before it.
 */

export const REVIEW_ASSET_LIMIT = 500_000;
/** The turnover limit for a review: €200,000 for a financial year beginning before 6 February 2026, €300,000 from then. */
export const reviewTurnoverLimit = (yearStart: string) => yearStart >= "2026-02-06" ? 300_000 : 200_000;

export type CompanySize = "micro" | "small" | "medium" | "large";
export const SIZE_LABELS: Record<CompanySize, string> = { micro: "Micro", small: "Small", medium: "Medium-sized", large: "Large" };
const BANDS: { size: CompanySize; assets: number; turnover: number; employees: number }[] = [
  { size: "micro", assets: 450_000, turnover: 900_000, employees: 10 },
  { size: "small", assets: 5_000_000, turnover: 10_000_000, employees: 50 },
  { size: "medium", assets: 25_000_000, turnover: 50_000_000, employees: 250 },
];

/**
 * The company's size by s.141A: the smallest band in which at most one of the
 * three figures is over its limit. With the employee count unknown, the band
 * is only certain when both other figures settle it.
 */
export function companySize(figures: { assets: number; turnover: number; employees: number | null }): { size: CompanySize; certain: boolean } {
  for (const band of BANDS) {
    const over = [figures.assets > band.assets, figures.turnover > band.turnover].filter(Boolean).length;
    if (figures.employees !== null) {
      if (over + (figures.employees > band.employees ? 1 : 0) <= 1) return { size: band.size, certain: true };
    } else if (over === 0) return { size: band.size, certain: true };
    else if (over === 1) return { size: band.size, certain: false };
  }
  return { size: "large", certain: figures.employees !== null };
}

export type YearFigures = { yearStart: string; turnover: number | null; assets: number | null };
export type ReviewCheck = { allowed: boolean | null; reasons: string[] };

/** May this year's financial statements be reviewed instead of audited? Each year is held to its own turnover limit. */
export function reviewEligibility(input: { year: YearFigures; prior: YearFigures | null; regulated: boolean; group: boolean }): ReviewCheck {
  const reasons: string[] = [];
  let allowed: boolean | null = true;
  if (input.regulated) { reasons.push("Regulated by the Central Bank, CySEC or the Superintendent of Insurance (or holds a qualifying stake in such a company): it must be audited."); allowed = false; }
  if (input.group) { reasons.push("Part of a group that consolidates: it must be audited."); allowed = false; }
  const test = (figures: YearFigures, which: string) => {
    if (figures.turnover === null || figures.assets === null) { reasons.push(`${which}: turnover or total assets not known yet.`); if (allowed) allowed = null; return; }
    const limit = reviewTurnoverLimit(figures.yearStart);
    if (figures.turnover > limit) { reasons.push(`${which}: turnover ${euro(figures.turnover)} is over the ${euro(limit)} limit.`); allowed = false; }
    if (figures.assets > REVIEW_ASSET_LIMIT) { reasons.push(`${which}: total assets ${euro(figures.assets)} are over the ${euro(REVIEW_ASSET_LIMIT)} limit.`); allowed = false; }
  };
  test(input.year, "This year");
  if (input.prior) test(input.prior, "The year before");
  else { reasons.push("The year before: not known yet. Both years must be within the limits."); if (allowed) allowed = null; }
  if (allowed) reasons.push("Within the limits in both years: a review under ISRE 2400 may replace the audit, if the company chooses it.");
  return { allowed, reasons };
}

const euro = (value: number) => `€${Math.round(value).toLocaleString("en-GB")}`;

export const FRAMEWORK_NOTE = "IFRS as adopted by the EU. The law now lets a small company use the Financial Reporting Standard for small-sized entities instead (s.142(1)(α1)), but ICPAC has not issued it yet: IFRS until it does.";

/** The steps of a year end, in order, and the date the law or the practice sets for each. */
export type YearEndStepKey = "books_closed" | "sent_to_auditor_on" | "report_signed_on" | "approved_on" | "agm_on" | "filed_on" | "tax_return_filed_on";
export function yearEndSteps(periodEnd: string, assurance: "audit" | "review", previousAgm: string | null) {
  const taxYear = Number(periodEnd.slice(0, 4));
  const taxReturn = extendedDue("tax_return", `${taxYear}-12-31`, taxReturnDue(taxYear));
  return [
    { key: "books_closed" as const, label: "Books closed for the year", due: null as string | null, why: "Lock the period, so nothing can change under the auditor" },
    { key: "sent_to_auditor_on" as const, label: assurance === "review" ? "Financial statements to the reviewer" : "Financial statements to the auditor", due: null, why: assurance === "review" ? "For the review (ISRE 2400)" : "For the audit" },
    // The report is dated no earlier than the directors' approval (ISA 700; ISRE 2400 for a review).
    { key: "approved_on" as const, label: "Approved by the board", due: null, why: "The directors approve and sign the financial statements first" },
    { key: "report_signed_on" as const, label: assurance === "review" ? "Review report signed" : "Auditor’s report signed", due: null, why: "By a statutory auditor or audit firm, on or after the board’s approval" },
    { key: "agm_on" as const, label: "Laid before the annual general meeting", due: previousAgm ? addMonths(previousAgm, 15) : null,
      why: previousAgm ? "At most 15 months after the last one (s.125)" : "Every year, at most 15 months apart (s.125)" },
    { key: "filed_on" as const, label: "Filed with the Registrar, with the annual return", due: addDays(addMonths(addDays(periodEnd, 1), 12), -1), why: "Within 12 months of the year end (s.142(2))" },
    { key: "tax_return_filed_on" as const, label: "Company tax return filed", due: taxReturn.due,
      why: taxReturn.extension ? `Extended by ${taxReturn.extension.by}` : taxYear <= 2025 ? "31 March, two years on" : "31 January, two years on, with the balance of tax" },
  ];
}

export const OPINIONS = { unmodified: "Unmodified", qualified: "Qualified", adverse: "Adverse", disclaimer: "Disclaimer" } as const;
export type Opinion = keyof typeof OPINIONS;

/**
 * The firm that keeps the books also auditing them: the self-review threat.
 * The IESBA Code, which ICPAC applies, prohibits it for a public-interest
 * entity, and otherwise allows it only for work of a routine or mechanical
 * nature, with the threat addressed (section 601).
 */
export const INDEPENDENCE_NOTE = "The practice keeps these books. Auditing them too is a self-review threat: under the IESBA Code that ICPAC applies (section 601), it is not allowed for a public-interest entity, and for any other company only if the bookkeeping is routine or mechanical and the firm addresses the threat, for example with a separate team.";

// ---------------------------------------------------------------------------
// Journals an auditor will ask about (ISA 240): manual entries with the marks of an override.
// ---------------------------------------------------------------------------

export const JOURNAL_FLAGS = {
  opening: "Opening balances: agree them to last year’s signed accounts (ISA 510)",
  after_year_end: "Posted after the year end, dated inside it",
  weekend: "Posted at a weekend",
  round: "A round amount",
  thin: "Little or no explanation",
} as const;
export type JournalFlag = keyof typeof JOURNAL_FLAGS;

export function journalFlags(entry: { entry_date: string; created_at: string; total: number; narration: string | null }, periodEnd: string): JournalFlag[] {
  // Opening balances are round and brief by nature: what matters is that they agree to last year's accounts.
  if (/opening balance/i.test(entry.narration ?? "")) return ["opening"];
  const flags: JournalFlag[] = [];
  const posted = new Date(entry.created_at);
  const postedDay = posted.toLocaleDateString("en-CA", { timeZone: "Asia/Nicosia" });
  if (entry.entry_date <= periodEnd && postedDay > periodEnd) flags.push("after_year_end");
  const weekday = new Date(`${postedDay}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) flags.push("weekend");
  if (entry.total >= 1000 && Math.round(entry.total * 100) % 100_000 === 0) flags.push("round");
  if ((entry.narration ?? "").trim().length < 12) flags.push("thin");
  return flags;
}
