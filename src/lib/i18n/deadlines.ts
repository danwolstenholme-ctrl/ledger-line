import type { Locale } from ".";

/**
 * A Cyprus deadline's title in Greek. lib/domain/deadlines words each title
 * in English, for the calendar feed, the deadlines list and the practice;
 * an owner reading in Greek sees it here in Greek, month names and all.
 * Titles it does not know (the UK's, say) stay as they are.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// en-GB writes September short as "Sept".
const monthIndex = (name: string) => { const index = MONTHS.findIndex(month => month.startsWith(name.slice(0, 3))); return index < 0 ? null : index; };
// May, short, on its own: Μάι, not the Μαΐ of a date.
const greek = (options: Intl.DateTimeFormatOptions, year: number, month: number, day = 15) => new Intl.DateTimeFormat("el-GR", { ...options, timeZone: "UTC" }).format(Date.UTC(year, month, day)).replace(/^Μαΐ$/, "Μάι");
/** "October 2026" as "Οκτώβριος 2026". */
const monthYear = (month: string, year: string) => { const index = monthIndex(month); return index === null ? `${month} ${year}` : greek({ month: "long", year: "numeric" }, Number(year), index); };
/** "31 December 2026" as "31 Δεκεμβρίου 2026". */
const longDate = (text: string) => {
  const [day, month, year] = text.split(" ");
  const index = monthIndex(month ?? "");
  return index === null ? text : greek({ day: "numeric", month: "long", year: "numeric" }, Number(year), index, Number(day));
};
/** "Jul–Sept 2026" as "Ιουλ–Σεπ 2026". */
const quarter = (from: string, to: string, year: string) => {
  const [first, last] = [monthIndex(from), monthIndex(to)];
  return first === null || last === null ? `${from}–${to} ${year}` : `${greek({ month: "short" }, Number(year), first)}–${greek({ month: "short" }, Number(year), last)} ${year}`;
};

const GREEK_TITLES: [RegExp, (...parts: string[]) => string][] = [
  [/^VAT return, (\p{L}+)–(\p{L}+) (\d{4})$/u, (from, to, year) => `Δήλωση ΦΠΑ, ${quarter(from, to, year)}`],
  [/^VAT return, (\p{L}+) (\d{4})$/u, (month, year) => `Δήλωση ΦΠΑ, ${monthYear(month, year)}`],
  [/^VIES statement, (\p{L}+) (\d{4})$/u, (month, year) => `Ανακεφαλαιωτικός πίνακας VIES, ${monthYear(month, year)}`],
  [/^Provisional tax (\d{4}), (first|second) instalment$/, (year, which) => `Προσωρινή φορολογία ${year}, ${which === "first" ? "πρώτη" : "δεύτερη"} δόση`],
  [/^Company tax return \(IR4\), (\d{4})$/, year => `Φορολογική δήλωση εταιρείας (Τ.Φ.4), ${year}`],
  [/^Company tax return \(IR4\) and balance of tax, (\d{4})$/, year => `Φορολογική δήλωση εταιρείας (Τ.Φ.4) και εξόφληση φόρου, ${year}`],
  [/^Corporation tax: the balance for (\d{4})$/, year => `Εταιρικός φόρος: εξόφληση για το ${year}`],
  [/^Employer’s return \(TD7\), (\d{4})$/, year => `Δήλωση εργοδότη (Τ.Φ.7), ${year}`],
  [/^Payroll returns, (\p{L}+) (\d{4})$/u, (month, year) => `Δηλώσεις μισθοδοσίας, ${monthYear(month, year)}`],
  [/^Financial statements (\d{4}) to the Registrar$/, year => `Οικονομικές καταστάσεις ${year} στον Έφορο Εταιρειών`],
  [/^Financial statements to (.+) to the Registrar$/, date => `Οικονομικές καταστάσεις έως ${longDate(date)} στον Έφορο Εταιρειών`],
  [/^Annual return \(HE32\), made up to (.+)$/, date => `Ετήσια έκθεση (ΗΕ32), με ημερομηνία αναφοράς ${longDate(date)}`],
];

export function deadlineTitle(title: string, locale: Locale) {
  if (locale !== "el") return title;
  for (const [pattern, say] of GREEK_TITLES) {
    const match = pattern.exec(title);
    if (match) return say(...match.slice(1));
  }
  return title;
}

/** A VAT quarter as lib/domain/vat's quarterLabel words it ("Jul–Sept 2026"), in the reader's language. */
export function quarterIn(label: string, locale: Locale) {
  const match = locale === "el" ? /^(\p{L}+)–(\p{L}+) (\d{4})$/u.exec(label) : null;
  return match ? quarter(match[1], match[2], match[3]) : label;
}
