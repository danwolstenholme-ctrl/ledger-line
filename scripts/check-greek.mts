/**
 * Every phrase a translated screen shows has its Greek: each t("…"),
 * t.n(count, "…", "…"), t.also("…") and <T text="…" /> in src is looked up in the dictionary
 * (src/lib/i18n/el.ts), and each Greek phrase keeps its English one's {names}.
 * Words that come from data (a company's own names for its customers, say)
 * are looked up as they are, so they are not listed here.
 *
 *   npm run check:greek
 */
import fs from "node:fs";
import path from "node:path";

import { GREEK } from "../src/lib/i18n/el";
import { i18nFor } from "../src/lib/i18n";
import { deadlineTitle } from "../src/lib/i18n/deadlines";
import { obligations } from "../src/lib/domain/deadlines";
import { plainDecimal } from "../src/lib/domain/line-math";

const root = path.join(import.meta.dirname, "..", "src");
const files: string[] = [];
const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const at = path.join(dir, entry.name); if (entry.isDirectory()) walk(at); else if (/\.(ts|tsx)$/.test(entry.name)) files.push(at); } };
walk(root);

const STRING = String.raw`"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|\x60((?:[^\x60\\$]|\\.|\$(?!\{))*)\x60`;
const single = new RegExp(String.raw`(?<![\w.])t(?:\.also)?\(\s*(?:${STRING})`, "g");
const component = new RegExp(String.raw`<T text=(?:${STRING})`, "g");
const plural = new RegExp(String.raw`(?<![\w.])t\.n\([^,()]+(?:\([^()]*\))?[^,()]*,\s*(?:${STRING})\s*,\s*(?:${STRING})`, "g");
const text = (double?: string, quote?: string, tick?: string) => double !== undefined ? JSON.parse(`"${double}"`) as string : (quote ?? tick ?? "").replace(/\\(.)/g, "$1");

const used = new Map<string, string>();
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const line = (index: number) => `${path.relative(path.join(root, ".."), file)}:${source.slice(0, index).split("\n").length}`;
  for (const match of [...source.matchAll(single), ...source.matchAll(component)]) used.set(text(match[1], match[2], match[3]), line(match.index));
  for (const match of source.matchAll(plural)) {
    used.set(text(match[1], match[2], match[3]), line(match.index));
    used.set(text(match[4], match[5], match[6]), line(match.index));
  }
}

const names = (phrase: string) => [...phrase.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(",");
const missing = [...used].filter(([phrase]) => !Object.hasOwn(GREEK, phrase));
const mismatched = Object.entries(GREEK).filter(([english, greek]) => names(english) !== names(greek));
for (const [phrase, where] of missing) console.log(`  ✗ no Greek for "${phrase}" (${where})`);
for (const [english, greek] of mismatched) console.log(`  ✗ "${english}" names {${names(english)}}, its Greek "${greek}" {${names(greek)}}`);
const unused = Object.keys(GREEK).filter(phrase => !used.has(phrase)).length;
console.log(`${used.size - missing.length}/${used.size} phrases have their Greek${mismatched.length ? `, ${mismatched.length} with the wrong {names}` : ""}. ${Object.keys(GREEK).length} in the dictionary (${unused} looked up from data or unused).`);

// What else a Greek screen relies on: figures typed the Greek way, Greek figures and dates, every Cyprus deadline's title, and messages with values in them.
const { t, formatAmount, formatDate, formatAgo } = i18nFor("el");
const checks: [string, unknown, unknown][] = [
  ["18,50 typed is 18.50", plainDecimal("18,50"), "18.50"],
  ["1.234,50 typed is 1234.50", plainDecimal("1.234,50"), "1234.50"],
  ["1,234.50 typed is 1234.50", plainDecimal("1,234.50"), "1234.50"],
  ["0,035 typed is 0.035", plainDecimal("0,035"), "0.035"],
  ["1,234 typed is a thousand and more", plainDecimal("1,234"), "1234"],
  ["An amount in Greek", formatAmount(1323.4, "EUR"), "1.323,40\u00a0€"],
  ["A date in Greek", formatDate("2026-10-28T12:00:00Z"), "28 Οκτ 2026"],
  ["A week ago, in Greek", formatAgo("2026-10-21T12:00:00Z", new Date("2026-10-28T12:00:00Z")), "πριν από μία εβδομάδα"],
  ["A message with values, in Greek", t.message("Line 2 needs an amount."), "Η γραμμή 2 χρειάζεται ποσό."],
  ["A label inside a message, in Greek", t.message("Invoice number is required."), "Αριθμός τιμολογίου: υποχρεωτικό πεδίο."],
  ["A context is never shown", i18nFor("en").t("Void|action"), "Void"],
];
const titles = obligations({ registered: true, quarterEndMonth: 3, booksFrom: "2025-07-01", until: "2027-12-31", euSalesMonths: ["2026-07"], yearEndMonth: 6, incorporatedOn: "2016-05-03", payroll: true });
const english = [...new Set(titles.map(item => item.title))].filter(title => /[A-Za-z]{4,}/.test(deadlineTitle(title, "el").replace(/VIES/g, "")));
checks.push(["Every Cyprus deadline has a Greek title", english, []]);
const failed = checks.filter(([, got, wanted]) => JSON.stringify(got) !== JSON.stringify(wanted));
for (const [what, got, wanted] of failed) console.log(`  ✗ ${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(wanted)}`);
console.log(`${checks.length - failed.length}/${checks.length} checks of Greek figures, dates, titles and messages pass.`);
if (missing.length || mismatched.length || failed.length) process.exit(1);
