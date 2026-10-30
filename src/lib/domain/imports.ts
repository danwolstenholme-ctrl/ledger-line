import { COUNTRIES, EU_COUNTRIES } from "@/lib/domain/countries";
import { regimeOf } from "@/lib/domain/regimes";
import { euVatNumber } from "@/lib/domain/eu-vat";
import { compactIban, validBic, validIban } from "@/lib/domain/iban";

/**
 * Importing customers, suppliers and products from a spreadsheet saved as
 * CSV: which column is which, read from its heading in English or Greek, and
 * each row checked the same way in the browser's preview and on the server.
 * Client-safe.
 */

export const IMPORT_KINDS = ["customers", "suppliers", "items"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

type FieldSpec = { key: string; label: string; required?: boolean; headings: RegExp };
export const IMPORT_FIELDS: Record<ImportKind, FieldSpec[]> = {
  customers: [
    { key: "name", label: "Name", required: true, headings: /^(name|customer|customer name|company|company name|client|client name|επωνυμία|όνομα|πελάτης)$/i },
    { key: "email", label: "Email", headings: /^(e-?mail|email address|ηλ\.? ταχυδρομείο)$/i },
    { key: "phone", label: "Phone", headings: /^(phone|telephone|tel\.?|mobile|τηλέφωνο|τηλ\.?)$/i },
    { key: "vat_number", label: "VAT number", headings: /^(vat|vat number|vat no\.?|vat id|tax id|αφμ|α\.φ\.μ\.|αρ\.? φπα)$/i },
    { key: "country", label: "Country", headings: /^(country|χώρα)$/i },
    { key: "address", label: "Address", headings: /^(address|street|διεύθυνση)$/i },
    { key: "payment_terms_days", label: "Payment terms (days)", headings: /^(payment terms|terms|days|credit days|ημέρες πίστωσης)$/i },
  ],
  suppliers: [
    { key: "name", label: "Name", required: true, headings: /^(name|supplier|supplier name|company|company name|vendor|επωνυμία|όνομα|προμηθευτής)$/i },
    { key: "email", label: "Email", headings: /^(e-?mail|email address)$/i },
    { key: "phone", label: "Phone", headings: /^(phone|telephone|tel\.?|mobile|τηλέφωνο)$/i },
    { key: "vat_number", label: "VAT number", headings: /^(vat|vat number|vat no\.?|vat id|tax id|αφμ|αρ\.? φπα)$/i },
    { key: "country", label: "Country", headings: /^(country|χώρα)$/i },
    { key: "iban", label: "IBAN", headings: /^(iban|bank account|account number)$/i },
    { key: "bic", label: "BIC", headings: /^(bic|swift|bic\/swift|swift code)$/i },
  ],
  items: [
    { key: "name", label: "Name", required: true, headings: /^(name|product|product name|item|item name|service|description|περιγραφή|είδος)$/i },
    { key: "code", label: "Code", headings: /^(code|sku|item code|product code|κωδικός)$/i },
    { key: "unit", label: "Unit", headings: /^(unit|uom|unit of measure|μονάδα)$/i },
    { key: "unit_price", label: "Price before VAT", required: true, headings: /^(price|unit price|sale price|net price|rate|τιμή|τιμή μονάδας)$/i },
    { key: "vat_rate", label: "VAT rate", headings: /^(vat|vat rate|vat %|tax|tax rate|φπα|συντελεστής φπα)$/i },
    { key: "account", label: "Income account code", headings: /^(account|income account|account code|λογαριασμός)$/i },
  ],
};

/** Which column holds which field, from the headings. */
export function guessColumns(kind: ImportKind, headings: string[]) {
  const mapping: Record<string, number | null> = {};
  for (const field of IMPORT_FIELDS[kind]) {
    const index = headings.findIndex(heading => field.headings.test(heading.trim()));
    mapping[field.key] = index >= 0 ? index : null;
  }
  return mapping;
}

const text = (value: string | undefined, max: number) => (value ?? "").trim().slice(0, max) || null;

/** A row's country: as written, or by name, or from its VAT number; else the company's own (a UK company's customers aren't Cypriot). */
function countryOf(value: string | null, vat: string | null, home: string) {
  const given = (value ?? "").trim();
  // Two letters are a country's code, as Greece writes its own (EL) and Britain is often written (UK); any other two letters
  // aren't a country, and the row says so.
  if (/^[A-Za-z]{2}$/.test(given)) { const code = ({ EL: "GR", UK: "GB" } as Record<string, string>)[given.toUpperCase()] ?? given.toUpperCase(); return COUNTRIES.some(([known]) => known === code) ? code : ""; }
  const named = COUNTRIES.find(([, name]) => name.toLowerCase() === given.toLowerCase())?.[0];
  if (named) return named;
  const prefix = vat?.slice(0, 2);
  if (prefix && /^[A-Z]{2}$/.test(prefix)) return prefix === "EL" ? "GR" : prefix;
  return home;
}

/** A price as written in Cyprus or abroad: "18.50", "18,50", "1.234,56", "€1,234.56". Up to four decimals. */
export function parsePrice(raw: string | null | undefined): number | null {
  let value = (raw ?? "").replace(/[€\s]/g, "");
  if (!value) return null;
  if (value.includes(",") && value.includes(".")) value = value.lastIndexOf(",") > value.lastIndexOf(".") ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  else if (value.includes(",")) value = /,\d{3}$/.test(value) && !/^0,/.test(value) ? value.replace(/,/g, "") : value.replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return null;
  return Number(value);
}

export type ImportRow = { row: number; values: Record<string, string | number | boolean | null>; problem: string | null };

/** One spreadsheet row as the record it becomes, or what is wrong with it. */
/** home: the company's country, which a row without one is in, and whose VAT rates an item may have. */
export function readImportRow(kind: ImportKind, cells: string[], mapping: Record<string, number | null>, row: number, home = "CY"): ImportRow {
  const rates = regimeOf(home).vatRates;
  const cell = (key: string) => mapping[key] === null || mapping[key] === undefined ? "" : (cells[mapping[key]!] ?? "").trim();
  const name = text(cell("name"), 200);
  if (!name) return { row, values: {}, problem: "No name" };
  if (kind === "items") {
    const price = parsePrice(cell("unit_price"));
    if (price === null) return { row, values: { name }, problem: "No price, or not a number" };
    const rateText = cell("vat_rate").replace(/[%\s]/g, "").replace(",", ".");
    const rate = rateText === "" ? rates[0] : Number(rateText) > 0 && Number(rateText) < 1 ? Math.round(Number(rateText) * 100) : Number(rateText);
    if (!rates.includes(rate)) return { row, values: { name }, problem: `VAT rate ${cell("vat_rate")} is not a rate of ${regimeOf(home).name}` };
    return { row, values: { name, code: text(cell("code"), 40)?.toUpperCase() ?? null, unit: text(cell("unit"), 20)?.toLowerCase() ?? null, unit_price: price, vat_rate: rate, account: text(cell("account"), 20) }, problem: null };
  }
  const email = text(cell("email"), 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { row, values: { name }, problem: `Email ${email} does not look right` };
  const vat = text(cell("vat_number"), 40)?.toUpperCase().replace(/[\s.-]/g, "") ?? null;
  const country = countryOf(text(cell("country"), 60), vat, home);
  if (!/^[A-Z]{2}$/.test(country)) return { row, values: { name }, problem: `Country ${cell("country")} not recognised` };
  const typedVat = euVatNumber(vat, country);
  if (typedVat.problem) return { row, values: { name }, problem: `VAT number ${vat}: ${typedVat.problem.replace(/^./, first => first.toLowerCase())}` };
  const base = { name, email, phone: text(cell("phone"), 40), vat_number: typedVat.value, country };
  if (kind === "customers") {
    const termsText = cell("payment_terms_days").replace(/\s*days?$/i, "");
    const terms = termsText === "" ? null : Number(termsText);
    if (terms !== null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) return { row, values: { name }, problem: `Payment terms ${cell("payment_terms_days")} are not 0 to 365 days` };
    return { row, values: { ...base, address: text(cell("address"), 500), payment_terms_days: terms, eu_business: home === "CY" && country !== home && EU_COUNTRIES.has(country) && Boolean(vat) }, problem: null };
  }
  const ibanText = cell("iban"), bicText = cell("bic").replace(/\s+/g, "").toUpperCase();
  if (ibanText && !validIban(ibanText)) return { row, values: { name }, problem: `IBAN ${ibanText} does not check out` };
  if (bicText && !validBic(bicText)) return { row, values: { name }, problem: `BIC ${bicText} is not 8 or 11 characters` };
  return { row, values: { ...base, iban: ibanText ? compactIban(ibanText) : null, bic: bicText || null }, problem: null };
}

/** A blank template with the headings this import reads best. */
export function importTemplate(kind: ImportKind) {
  const examples: Record<ImportKind, string[][]> = {
    customers: [["Name", "Email", "Phone", "VAT number", "Country", "Address", "Payment terms"], ["Seaview Cafe Ltd", "accounts@seaview.example", "+357 24 000000", "CY10999999X", "CY", "12 Piale Pasha, 6026 Larnaca", "30"]],
    suppliers: [["Name", "Email", "Phone", "VAT number", "Country", "IBAN", "BIC"], ["Paphos Paper Supplies Ltd", "orders@paphospaper.example", "+357 26 000000", "CY10888888Y", "CY", "", ""]],
    items: [["Code", "Name", "Unit", "Price", "VAT rate", "Account"], ["ESP-500", "House espresso blend, 500 g", "each", "9.80", "5", ""]],
  };
  return examples[kind].map(row => row.map(value => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join(",")).join("\r\n") + "\r\n";
}
