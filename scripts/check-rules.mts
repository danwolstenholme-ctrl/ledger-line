/**
 * The Cyprus rules Ledgerline follows, each pinned to an example and its
 * source, as checked on 26 Oct 2026. If a rule changes, change it in
 * src/lib/domain and here together.
 *
 *   npm run check:rules
 */
import { addMonths, annualReturnDates, obligations, taxReturnDue } from "../src/lib/domain/deadlines";
import { extendedDue } from "../src/lib/domain/extensions";
import { companySize, journalFlags, reviewEligibility, reviewTurnoverLimit, yearEndSteps } from "../src/lib/domain/audit";
import { vatQuarters } from "../src/lib/domain/vat";
import { calendarRange } from "../src/lib/domain/calendar";
import { icsCalendar } from "../src/lib/documents/ics";

const checks: [string, unknown, unknown][] = [];
const expect = (what: string, got: unknown, wanted: unknown) => checks.push([what, got, wanted]);
const find = (list: ReturnType<typeof obligations>, kind: string, periodEnd: string) => list.find(item => item.kind === kind && item.periodEnd === periodEnd);

// Tax Department (PwC Tax Summaries, Cyprus corporate tax administration, reviewed 4 Aug 2026; EY Global Tax News 2026-0140).
expect("Company tax return 2025: 31 March 2027 (15 months)", taxReturnDue(2025), "2027-03-31");
expect("Company tax return 2026: 31 January 2028 (13 months, from the 2026 reform)", taxReturnDue(2026), "2028-01-31");
expect("Company tax return 2024: extended to 30 November 2026 (ΚΔΠ 358/2025, 359/2025)", extendedDue("tax_return", "2024-12-31", taxReturnDue(2024)).due, "2026-11-30");
const company = obligations({ registered: true, quarterEndMonth: 3, booksFrom: "2025-07-01", until: "2027-12-31", euSalesMonths: ["2026-07"], yearEndMonth: 12, incorporatedOn: "2016-05-03", payroll: true });
expect("Balance of tax for 2025: 1 August 2026", find(company, "tax_payment", "2025-12-31")?.due, "2026-08-01");
expect("No separate balance date from 2026: it goes with the return", find(company, "tax_payment", "2026-12-31"), undefined);
expect("Provisional tax: 31 July and 31 December", [find(company, "provisional_tax", "2026-07-31")?.due, find(company, "provisional_tax", "2026-12-31")?.due], ["2026-07-31", "2026-12-31"]);
expect("VAT return: the 10th of the second month after the quarter", vatQuarters(3, "2025-07-01", "2025-10-31")[1], { from: "2025-10-01", to: "2025-12-31", due: "2026-02-10", extension: null });
expect("VAT return for the quarter to 30 June 2026: extended to 20 August 2026 (Tax Commissioner)", find(company, "vat_return", "2026-06-30")?.due, "2026-08-20");
expect("VIES statement: the 15th of the following month; July 2026 extended to 20 August", find(company, "vies", "2026-07-31")?.due, "2026-08-20");
expect("Payroll returns for September 2026: by 31 October", find(company, "payroll", "2026-09-30")?.due, "2026-10-31");
expect("Employer's return for 2025: extended from 31 May to 30 November 2026", [find(company, "employer_return", "2025-12-31")?.due, find(company, "employer_return", "2025-12-31")?.extension?.from], ["2026-11-30", "2026-05-31"]);
expect("Employer's return for 2026: 31 May 2027", find(company, "employer_return", "2026-12-31")?.due, "2027-05-31");

// Registrar of Companies (Cap. 113 on CyLaw: s.120, s.142(2)).
expect("Financial statements for 2025: with the Registrar by 31 December 2026 (12 months)", find(company, "financial_statements", "2025-12-31")?.due, "2026-12-31");
expect("First annual return: the day after 18 months from incorporation", annualReturnDates("2016-05-03", "2016-01-01", "2018-12-31")[0], "2017-11-04");
expect("Annual return made up to 4 November 2026: filed within 28 days", find(company, "annual_return", "2026-11-04")?.due, "2026-12-02");
expect("18 months on from 31 August falls on the last day of February", addMonths("2024-08-31", 18), "2026-02-28");
expect("Financial statements to the year end of 30 June: by 30 June the year after", yearEndSteps("2026-06-30", "audit", null).find(step => step.key === "filed_on")?.due, "2027-06-30");
expect("The board approves before the auditor signs (ISA 700)", yearEndSteps("2025-12-31", "audit", null).map(step => step.key).join(" "), "books_closed sent_to_auditor_on approved_on report_signed_on agm_on filed_on tax_return_filed_on");
expect("Next AGM within 15 months of the last, held 30 June 2025", yearEndSteps("2025-12-31", "audit", "2025-06-30").find(step => step.key === "agm_on")?.due, "2026-09-30");
expect("The 2024 tax return step shows its extension to 30 November 2026", yearEndSteps("2024-12-31", "audit", null).find(step => step.key === "tax_return_filed_on")?.due, "2026-11-30");

// Audit or review (Cap. 113, s.152A(1)(d)-(g) and s.141A).
expect("Review turnover limit for a year beginning 1 January 2026: €200,000", reviewTurnoverLimit("2026-01-01"), 200_000);
expect("Review turnover limit for a year beginning 6 February 2026 or later: €300,000", reviewTurnoverLimit("2026-02-06"), 300_000);
expect("Within both limits two years running: may be reviewed", reviewEligibility({ year: { yearStart: "2025-01-01", turnover: 180_000, assets: 400_000 }, prior: { yearStart: "2024-01-01", turnover: 150_000, assets: 350_000 }, regulated: false, group: false }).allowed, true);
expect("Turnover of €250,000 in 2026: over that year's €200,000 limit", reviewEligibility({ year: { yearStart: "2026-01-01", turnover: 250_000, assets: 400_000 }, prior: { yearStart: "2025-01-01", turnover: 150_000, assets: 350_000 }, regulated: false, group: false }).allowed, false);
expect("Turnover of €250,000 in 2027: within the €300,000 limit", reviewEligibility({ year: { yearStart: "2027-01-01", turnover: 250_000, assets: 400_000 }, prior: { yearStart: "2026-01-01", turnover: 190_000, assets: 350_000 }, regulated: false, group: false }).allowed, true);
expect("Regulated by CySEC: always audited", reviewEligibility({ year: { yearStart: "2025-01-01", turnover: 10_000, assets: 10_000 }, prior: { yearStart: "2024-01-01", turnover: 10_000, assets: 10_000 }, regulated: true, group: false }).allowed, false);
expect("The year before unknown: can't tell yet", reviewEligibility({ year: { yearStart: "2025-01-01", turnover: 10_000, assets: 10_000 }, prior: null, regulated: false, group: false }).allowed, null);
expect("Micro: €300k assets, €500k turnover, 5 people", companySize({ assets: 300_000, turnover: 500_000, employees: 5 }), { size: "micro", certain: true });
expect("Micro on two of three: €600k assets, €500k turnover, 8 people", companySize({ assets: 600_000, turnover: 500_000, employees: 8 }), { size: "micro", certain: true });
expect("Medium-sized: €6m assets and €12m turnover are both over the small limits", companySize({ assets: 6_000_000, turnover: 12_000_000, employees: 40 }), { size: "medium", certain: true });

// Journals an auditor asks about (ISA 240).
expect("A journal dated in 2025, posted on Saturday 10 January 2026, for €5,000, said little", journalFlags({ entry_date: "2025-12-31", created_at: "2026-01-10T09:00:00Z", total: 5000, narration: "adj" }, "2025-12-31"), ["after_year_end", "weekend", "round", "thin"]);
expect("Opening balances: agreed to last year's accounts (ISA 510), not flagged as round", journalFlags({ entry_date: "2025-07-01", created_at: "2025-07-03T09:00:00Z", total: 91_000, narration: "Opening balances on moving the books to Ledgerline" }, "2025-12-31"), ["opening"]);

// The calendar: weeks from Monday; a month shows whole weeks.
expect("October 2026 runs Monday 28 September to Sunday 1 November", (({ from, to }) => [from, to])(calendarRange("month", "2026-10-27")), ["2026-09-28", "2026-11-01"]);
expect("The week of Tuesday 27 October 2026 is Monday 26 October to Sunday 1 November", (({ from, to }) => [from, to])(calendarRange("week", "2026-10-27")), ["2026-10-26", "2026-11-01"]);
expect("From February 2027 back a month is January", calendarRange("month", "2027-02-15").prev, "2027-01-01");
// A subscribed calendar (RFC 5545): all-day events, text escaped, long lines folded at 75 bytes.
const ics = icsCalendar("Ledgerline · Test", [{ uid: "a@ledgerline", date: "2026-11-10", summary: "VAT return, Jul–Sept 2026; Aegean, Λεμεσός and more, a summary long enough that it has to be folded onto a second line" }], new Date("2026-10-27T09:00:00Z"));
expect("An all-day event starts on its day and ends the next", ics.includes("DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111"), true);
expect("Commas and semicolons are escaped", ics.includes("Jul–Sept 2026\\; Aegean\\, Λεμεσός"), true);
expect("No line is longer than 75 bytes", ics.split("\r\n").every(line => Buffer.byteLength(line, "utf8") <= 75), true);

let failed = 0;
for (const [what, got, wanted] of checks) {
  const ok = JSON.stringify(got) === JSON.stringify(wanted);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${what}${ok ? "" : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(wanted)}`}`);
}
console.log(`\n${checks.length - failed} of ${checks.length} rules hold.`);
process.exit(failed ? 1 : 0);
