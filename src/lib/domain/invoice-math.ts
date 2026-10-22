/**
 * Invoice arithmetic and parsing, with no imports at all.
 *
 * Kept import-free on purpose: the node test runner strips types but does not
 * resolve the `@/` alias, so anything that must be unit-tested directly lives
 * here. Vocabulary that needs the database types is in `./invoices`.
 *
 * All arithmetic is done in integer cents. Invoice figures are compared against
 * a printed document, and `0.1 + 0.2` is not a figure anyone printed.
 */

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** PostgREST returns `numeric` as a string; forms hand back numbers. Both land here. */
export function toCents(value: number | string | null | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
export function fromCents(cents: number) { return cents / 100; }

/** What a person typed into an amount box, in cents, or null when it is not an amount. */
export function parseAmountInput(raw: string): number | null {
  const cleaned = raw.replace(/[€,\s]/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(cleaned)) return null;
  return toCents(cleaned);
}

/** Cyprus standard rate, as a percentage. A suggestion only: the recorded VAT is whatever the invoice charged. */
export const STANDARD_VAT_RATE = 19;
export function standardVatOn(feesCents: number) { return Math.round((feesCents * STANDARD_VAT_RATE) / 100); }

// ---------------------------------------------------------------------------
// Dates. Date-only values never pass through a local timezone.
// ---------------------------------------------------------------------------

/** Today in the given zone as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function dayNumber(date: string) { return Math.round(Date.parse(`${date}T12:00:00Z`) / 86_400_000); }
export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string) { return dayNumber(to) - dayNumber(from); }

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export type InvoiceLineInput = { description: string; fees: number; disbursements: number };
export const MAX_INVOICE_LINES = 200;

/** Validates the JSON the line editor submits. Amounts come back in euros, two places. */
export function parseInvoiceLines(raw: string): { lines: InvoiceLineInput[]; error?: never } | { error: string; lines?: never } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { error: "Add at least one line to the invoice." }; }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Add at least one line to the invoice." };
  if (parsed.length > MAX_INVOICE_LINES) return { error: `An invoice can have at most ${MAX_INVOICE_LINES} lines.` };
  const lines: InvoiceLineInput[] = [];
  for (const [index, item] of parsed.entries()) {
    const row = (item ?? {}) as Record<string, unknown>;
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const fees = parseAmountInput(String(row.fees ?? "") || "0");
    const disbursements = parseAmountInput(String(row.disbursements ?? "") || "0");
    if (!description) return { error: `Line ${index + 1} needs a description.` };
    if (description.length > 1000) return { error: `Line ${index + 1}: keep the description under 1,000 characters.` };
    if (fees === null || disbursements === null) return { error: `Line ${index + 1}: enter amounts as numbers, such as 1500 or 1,500.50.` };
    if (fees + disbursements === 0) return { error: `Line ${index + 1} needs a fee or a disbursement.` };
    lines.push({ description, fees: fromCents(fees), disbursements: fromCents(disbursements) });
  }
  return { lines };
}

/**
 * The next number in the firm's `NNN/YY` sequence, or null when no number this
 * year follows it. A suggestion for the form, never assigned silently: the
 * number that matters is the one printed on the document.
 */
export function suggestNextInvoiceNumber(numbers: string[], today: string): string | null {
  const year = today.slice(2, 4);
  let highest = 0, width = 3;
  for (const number of numbers) {
    const match = /^(\d{1,6})\/(\d{2})$/.exec(number.trim());
    if (!match || match[2] !== year) continue;
    if (Number(match[1]) > highest) { highest = Number(match[1]); width = Math.max(3, match[1].length); }
  }
  return highest ? `${String(highest + 1).padStart(width, "0")}/${year}` : null;
}
