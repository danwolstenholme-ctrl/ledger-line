import { BUSINESS_TYPES, businessType, suggestBusinessType } from "@/lib/domain/business-types";
import { checkUkVatNumber, euVatNumber } from "@/lib/domain/eu-vat";
import { parsePrice } from "@/lib/domain/imports";

/**
 * A practice's client list from a spreadsheet saved as CSV: each row a
 * company whose books open in Ledgerline the same day, shaped to its kind of
 * business. Which column is which is read from its heading, in English or
 * Greek; each row is checked the same way in the browser's preview and on the
 * server. Client-safe.
 */

type FieldSpec = { key: string; label: string; required?: boolean; headings: RegExp };
export const CLIENT_FIELDS: FieldSpec[] = [
  { key: "name", label: "Company name", required: true, headings: /^(company|company name|client|client name|name|επωνυμία|εταιρεία|πελάτης)$/i },
  { key: "country", label: "Country", headings: /^(country|χώρα)$/i },
  { key: "he_number", label: "Registration number", headings: /^(he|he no\.?|he number|registration|registration number|reg\.? no\.?|company number|company no\.?|αρ\.? εγγραφής|αριθμός εγγραφής)$/i },
  { key: "vat_number", label: "VAT number", headings: /^(vat|vat number|vat no\.?|αρ\.? φπα|αριθμός φπα)$/i },
  { key: "tic", label: "Tax identification (TIC)", headings: /^(tic|tin|tax id|tax identification|tax identification code|αφτ|αριθμός φορολογικής ταυτότητας)$/i },
  { key: "incorporated_on", label: "Incorporated", headings: /^(incorporated|incorporation|incorporated on|date of incorporation|incorporation date|ημερομηνία σύστασης)$/i },
  { key: "year_end", label: "Year end", headings: /^(year end|year-end|financial year end|fye|λήξη οικονομικού έτους)$/i },
  { key: "vat_quarter", label: "VAT quarter ends", headings: /^(vat quarter|vat quarters|vat quarter ends?|vat period|vat stagger|τρίμηνο φπα)$/i },
  { key: "business", label: "What it does", headings: /^(business|activity|what it does|industry|sector|δραστηριότητα)$/i },
  { key: "business_type", label: "Kind of business", headings: /^(kind|kind of business|business type|type)$/i },
  { key: "contact_name", label: "Contact", headings: /^(contact|contact name|director|owner|υπεύθυνος|διευθυντής)$/i },
  { key: "contact_email", label: "Email", headings: /^(e-?mail|contact email|email address|ηλ\.? ταχυδρομείο)$/i },
  { key: "contact_phone", label: "Phone", headings: /^(phone|telephone|tel\.?|mobile|τηλέφωνο)$/i },
  { key: "address", label: "Registered office", headings: /^(address|registered office|registered address|διεύθυνση|έδρα)$/i },
  { key: "manager", label: "Looked after by", headings: /^(manager|looked after by|accountant|partner|staff|responsible)$/i },
  { key: "monthly_fee", label: "Monthly fee", headings: /^(fee|monthly fee|retainer|αμοιβή)$/i },
  { key: "books_from", label: "Books from", headings: /^(books from|start|start month|starts|from|in ledgerline from)$/i },
];

export function guessClientColumns(headings: string[]) {
  const mapping: Record<string, number | null> = {};
  for (const field of CLIENT_FIELDS) {
    const index = headings.findIndex(heading => field.headings.test(heading.trim()));
    mapping[field.key] = index >= 0 ? index : null;
  }
  return mapping;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const GREEK_MONTHS = ["ιαν", "φεβ", "μαρ", "απρ", "μα", "ιουν", "ιουλ", "αυγ", "σεπ", "οκτ", "νοε", "δεκ"];
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** A month from "12", "Dec", "December", "31/12", "31 December" or "Δεκέμβριος". */
export function readMonth(raw: string): number | null {
  const text = plain(raw);
  if (!text) return null;
  const dayMonth = /^\d{1,2}[/.\-\s](\d{1,2})$/.exec(text);
  if (dayMonth) { const month = Number(dayMonth[1]); return month >= 1 && month <= 12 ? month : null; }
  if (/^\d{1,2}$/.test(text)) { const month = Number(text); return month >= 1 && month <= 12 ? month : null; }
  const word = text.replace(/^\d{1,2}\s+/, "");
  const english = MONTHS.findIndex(month => word.startsWith(month));
  if (english >= 0) return english + 1;
  // Greek: May (Μάιος) is the one whose stem is shorter than the rest.
  const greek = GREEK_MONTHS.map((month, index) => [month, index] as const).sort((a, b) => b[0].length - a[0].length).find(([month]) => word.startsWith(month));
  return greek ? greek[1] + 1 : null;
}

/** A date from "2014-03-11", "11/03/2014", "11.03.2014" or "11 March 2014". */
export function readDate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text), local = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text), worded = /^(\d{1,2})\s+([^\s\d]+)\s+(\d{4})$/.exec(text);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (local) [day, month, year] = [Number(local[1]), Number(local[2]), Number(local[3])];
  else if (worded && readMonth(worded[2])) [day, month, year] = [Number(worded[1]), readMonth(worded[2])!, Number(worded[3])];
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** The first month Ledgerline keeps a company's books: "2026-11", "11/2026", "Nov 2026", or a date in that month. */
export function readBooksFrom(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const date = readDate(text);
  if (date) return `${date.slice(0, 7)}-01`;
  const yearMonth = /^(\d{4})-(\d{1,2})$/.exec(text), monthYear = /^(\d{1,2})[/.\-](\d{4})$/.exec(text), worded = /^([^\s\d]+)\s+(\d{4})$/.exec(text);
  const [year, month] = yearMonth ? [Number(yearMonth[1]), Number(yearMonth[2])] : monthYear ? [Number(monthYear[2]), Number(monthYear[1])] : worded && readMonth(worded[1]) ? [Number(worded[2]), readMonth(worded[1])!] : [0, 0];
  return year && month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}-01` : null;
}

const COUNTRY_NAMES: Record<string, "CY" | "GB"> = { cy: "CY", cyprus: "CY", "κυπρος": "CY", gb: "GB", uk: "GB", "united kingdom": "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB" };

export type ClientRow = { row: number; values: ClientValues | null; name: string | null; problem: string | null; notes: string[] };
export type ClientValues = {
  name: string; country: "CY" | "GB"; he_number: string | null; vat_number: string | null; vat_registered: boolean; tic: string | null; incorporated_on: string | null;
  year_end_month: number; vat_quarter_end_month: 1 | 2 | 3; business: string; business_type: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  address: string | null; manager: string | null; monthly_fee: number; books_from: string;
};

/** One spreadsheet row as the company it opens, or what is wrong with it. `today`: the firm's day; `staff`: who may look after a client. */
export function readClientRow(cells: string[], mapping: Record<string, number | null>, row: number, today: string, staff: string[]): ClientRow {
  const cell = (key: string) => mapping[key] === null || mapping[key] === undefined ? "" : String(cells[mapping[key]!] ?? "").trim();
  const name = cell("name").replace(/\s+/g, " ").slice(0, 200) || null;
  const fail = (problem: string): ClientRow => ({ row, values: null, name, problem, notes: [] });
  if (!name) return fail("No company name");
  const notes: string[] = [];
  const countryText = plain(cell("country"));
  const country = countryText ? COUNTRY_NAMES[countryText] ?? null : /^GB/i.test(cell("vat_number")) ? "GB" : "CY";
  if (!country) return fail(`Country ${cell("country")}: Ledgerline keeps Cyprus and UK companies`);
  let he = cell("he_number").toUpperCase().replace(/\s+/g, " ") || null;
  if (he && country === "CY") {
    he = he.replace(/^HE\s*/, "HE ").replace(/^(\d)/, "HE $1");
    if (!/^HE \d{3,7}$/.test(he)) return fail(`Registration number ${cell("he_number")}: a Cyprus company's is HE and up to seven digits`);
  }
  if (he && country === "GB" && !/^[A-Z0-9]{8}$/.test(he.replace(/\s+/g, ""))) return fail(`Company number ${cell("he_number")}: Companies House numbers are eight characters`);
  if (he && country === "GB") he = he.replace(/\s+/g, "");
  let vat: string | null = null;
  const vatText = cell("vat_number");
  if (vatText) {
    if (country === "GB") {
      const uk = checkUkVatNumber(/^GB/i.test(vatText) ? vatText : `GB${vatText}`);
      if (!uk.ok) return fail(`VAT number ${vatText}: ${uk.problem.replace(/^./, first => first.toLowerCase())}`);
      vat = uk.display.replace(/\s+/g, "");
    } else {
      const eu = euVatNumber(/^CY/i.test(vatText) ? vatText : `CY${vatText}`, "CY");
      if (eu.problem) return fail(`VAT number ${vatText}: ${eu.problem.replace(/^./, first => first.toLowerCase())}`);
      vat = eu.value;
    }
  }
  const incorporatedText = cell("incorporated_on"), incorporated = readDate(incorporatedText);
  if (incorporatedText && !incorporated) return fail(`Incorporated ${incorporatedText}: not a date (write 11/03/2014 or 2014-03-11)`);
  if (incorporated && incorporated > today) return fail(`Incorporated ${incorporatedText}: that is in the future`);
  const yearEndText = cell("year_end"), yearEnd = yearEndText ? readMonth(yearEndText) : 12;
  if (!yearEnd) return fail(`Year end ${yearEndText}: write the month, such as December or 31/12`);
  const quarterText = cell("vat_quarter");
  const quarterMonth = quarterText ? readMonth(quarterText.split(/[,/;]/)[0]) : null;
  if (quarterText && !quarterMonth) return fail(`VAT quarter ${quarterText}: write a month a quarter ends in, such as March`);
  const quarter = (quarterMonth ? ((quarterMonth - 1) % 3) + 1 : 3) as 1 | 2 | 3;
  const email = cell("contact_email").slice(0, 320) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(`Email ${email} does not look right`);
  const feeText = cell("monthly_fee"), fee = feeText ? parsePrice(feeText) : 0;
  if (fee === null) return fail(`Monthly fee ${feeText}: not an amount`);
  const booksText = cell("books_from"), booksFrom = booksText ? readBooksFrom(booksText) : `${today.slice(0, 7)}-01`;
  if (!booksFrom) return fail(`Books from ${booksText}: write the month, such as November 2026`);
  const business = cell("business").slice(0, 300);
  const typeText = plain(cell("business_type"));
  const named = typeText ? BUSINESS_TYPES.find(type => type.key === typeText || plain(type.label) === typeText || plain(type.label).startsWith(typeText)) : null;
  if (typeText && !named) notes.push(`Kind of business "${cell("business_type")}" not known: ${businessType(suggestBusinessType(business)).label.toLowerCase()} from what it does`);
  const managerText = cell("manager");
  const manager = managerText ? staff.find(person => plain(person) === plain(managerText) || plain(person).startsWith(plain(managerText))) ?? null : null;
  if (managerText && !manager) notes.push(`${managerText} is not one of the practice's people: no one yet`);
  if (!booksText) notes.push("Books from this month");
  return {
    row, name, problem: null, notes,
    values: {
      name, country, he_number: he, vat_number: vat, vat_registered: Boolean(vat), tic: cell("tic").slice(0, 20) || null, incorporated_on: incorporated, year_end_month: yearEnd, vat_quarter_end_month: quarter,
      business, business_type: named?.key ?? suggestBusinessType(business), contact_name: cell("contact_name").slice(0, 200) || null, contact_email: email, contact_phone: cell("contact_phone").slice(0, 40) || null,
      address: cell("address").slice(0, 500) || null, manager, monthly_fee: fee ?? 0, books_from: booksFrom,
    },
  };
}

/** The same company, by its registration number, its VAT number or its name. */
export const clientKeys = (values: Pick<ClientValues, "name" | "he_number" | "vat_number">) =>
  [`name:${plain(values.name).replace(/\b(ltd|limited|plc|llc)\b\.?/g, "").replace(/[^a-z0-9α-ω]+/g, "")}`, values.he_number ? `he:${values.he_number.replace(/\s+/g, "")}` : null, values.vat_number ? `vat:${values.vat_number}` : null].filter((key): key is string => Boolean(key));

/** A template with the headings read best, and one example row. */
export function clientTemplate() {
  const rows = [
    ["Company name", "Country", "Registration number", "VAT number", "TIC", "Incorporated", "Year end", "VAT quarter ends", "What it does", "Kind of business", "Contact", "Email", "Phone", "Registered office", "Looked after by", "Monthly fee", "Books from"],
    ["Seaview Cafe Ltd", "Cyprus", "HE 123456", "", "12123456X", "15/03/2018", "December", "March", "Café and bakery", "Shop, café or restaurant", "Eleni Georgiou", "eleni@seaview.example", "+357 99 000000", "12 Piale Pasha, 6026 Larnaca", "", "250", "November 2026"],
  ];
  return rows.map(row => row.map(value => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join(",")).join("\r\n") + "\r\n";
}
