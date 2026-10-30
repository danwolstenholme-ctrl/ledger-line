import { validIban } from "@/lib/domain/iban";
import type { BankMatchItem, UnreconciledBankItemRow } from "@/types/database";

/**
 * Bank statements: reading the files banks export, and suggesting what each
 * line was. Pure and client-safe — the import page parses in the browser so a
 * person sees the lines before anything is saved, and the same code is tested
 * here and runs on the server for a feed.
 *
 * Amounts are worked in cents. Money into the account is positive.
 */

export type StatementLine = {
  date: string; amount: number; description: string; reference: string | null; counterparty: string | null;
  balance: number | null; external_id: string;
};
export type ParsedStatement = {
  format: "csv" | "camt" | "mt940" | "ofx";
  lines: StatementLine[];
  /** The bank's own balance before the statement's first line and after its last, when the file gives them. */
  openingBalance: number | null;
  closingBalance: number | null;
  /** For a CSV, the columns read and the choices that can be changed. */
  csv?: CsvLayout;
  /** The account the file says it is for, when it says: an IBAN, or the bank's own account number. */
  account?: string | null;
  problems: string[];
};

const cents = (value: number) => Math.round(value * 100);

// ---------------------------------------------------------------------------
// Amounts and dates
// ---------------------------------------------------------------------------

/** "1,234.56", "1.234,56", "-12.50", "12.50-", "(12.50)", "€ 12,50", "12.50 CR". Null when it is not an amount. */
export function parseAmount(raw: string | null | undefined, decimal: "." | "," = "."): number | null {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text) return null;
  let sign = 1;
  if (/(?:\b|(?<=\d))(dr|debit|d)$/i.test(text)) { sign = -1; text = text.replace(/\s*(dr|debit|d)$/i, ""); }
  else if (/(?:\b|(?<=\d))(cr|credit|c)$/i.test(text)) text = text.replace(/\s*(cr|credit|c)$/i, "");
  if (/^\(.*\)$/.test(text)) { sign = -sign; text = text.slice(1, -1); }
  text = text.replace(/[€$£\s ']/g, "").replace(/^[a-z]{3}(?=[\d(+-])|(?<=[\d)])[a-z]{3}$/i, "");
  if (text.endsWith("-")) { sign = -sign; text = text.slice(0, -1); }
  if (text.startsWith("+")) text = text.slice(1);
  if (text.startsWith("-")) { sign = -sign; text = text.slice(1); }
  if (!/^[\d.,]+$/.test(text)) return null;
  const normal = decimal === ","
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  return sign * Math.round(Number(normal) * 100) / 100;
}

export type DateOrder = "dmy" | "mdy" | "ymd";
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  ιαν: 1, φεβ: 2, μαρ: 3, απρ: 4, μαι: 5, μαϊ: 5, ιουν: 6, ιουλ: 7, αυγ: 8, σεπ: 9, οκτ: 10, νοε: 11, δεκ: 12,
};

/** A date as YYYY-MM-DD, or null. Day-first unless told otherwise, as Cypriot banks write it. */
export function parseDate(raw: string | null | undefined, order: DateOrder = "dmy"): string | null {
  if (raw == null) return null;
  const text = String(raw).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  if (!text) return null;
  let year: number, month: number, day: number;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) ?? text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
  else if ((match = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) {
    const [a, b] = [Number(match[1]), Number(match[2])];
    year = Number(match[3]); if (year < 100) year += 2000;
    if (order === "mdy") { month = a; day = b; } else { day = a; month = b; }
  } else if ((match = text.match(/^(\d{1,2})[\s\-]([^\s\-\d]+)[\s\-](\d{2,4})$/))) {
    day = Number(match[1]); month = MONTHS[match[2].toLowerCase().slice(0, 4)] ?? MONTHS[match[2].toLowerCase().slice(0, 3)] ?? 0;
    year = Number(match[3]); if (year < 100) year += 2000;
  } else return null;
  if (!month || month > 12 || !day || day > 31 || year < 1990 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** A key for a line the bank gave no id for: the same line in a re-exported statement gets the same key. */
export function lineKey(line: Pick<StatementLine, "date" | "amount" | "description" | "reference">, occurrence: number) {
  const words = `${line.description} ${line.reference ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
  return `${line.date}|${line.amount.toFixed(2)}|${words}|${occurrence}`.slice(0, 200);
}

type DraftLine = Omit<StatementLine, "external_id"> & { external_id?: string | null };

/**
 * Give lines without a bank id a stable key; identical lines on one day are
 * told apart by their order. A bank id that comes twice in one file (a
 * payment and its fee, say) keeps both lines: the second is told apart by its
 * place, as it will be when the same file comes again.
 */
function keyed(lines: DraftLine[]): StatementLine[] {
  const seen = new Map<string, number>(), ids = new Map<string, number>();
  return lines.map(line => {
    if (line.external_id) {
      const id = line.external_id.slice(0, 190), count = (ids.get(id) ?? 0) + 1;
      ids.set(id, count);
      return { ...line, external_id: count === 1 ? id : `${id}#${count}` };
    }
    const base = lineKey(line, 0);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...line, external_id: lineKey(line, count) };
  });
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * What reading a statement needs to know of the books it goes into: their
 * currency, so that lines in any other are left out; and the account's IBAN,
 * so that a file holding statements for several accounts gives this one's.
 */
export type ReadOptions = { currency?: string; iban?: string | null };
const compact = (value: string | null) => value?.replace(/[\s-]/g, "").toUpperCase() ?? null;
/** The IBAN a file names, spaced or not, with a currency after it or not: null when it names none. */
export function ibanOf(value: string | null) {
  const plain = compact(value);
  if (!plain) return null;
  if (validIban(plain)) return plain;
  return /[A-Z]{3}$/.test(plain) && validIban(plain.slice(0, -3)) ? plain.slice(0, -3) : null;
}
const othersNote = (count: number) => count ? `${count} line${count === 1 ? "" : "s"} for another account in the same file left out.` : null;

const listed = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";
/** What to say of lines left out for being in a currency the books aren't kept in. */
function leftOutNote(elsewhere: Map<string, number>, kept: number, books: string | null) {
  if (!elsewhere.size || !books) return null;
  const currencies = listed([...elsewhere.keys()].sort()), count = [...elsewhere.values()].reduce((sum, value) => sum + value, 0);
  return kept ? `${count} line${count === 1 ? "" : "s"} in ${currencies} left out: these books are kept in ${books}.`
    : `This statement is in ${currencies}, and these books are kept in ${books}: none of it can be imported here.`;
}

export type CsvRole = "date" | "description" | "reference" | "counterparty" | "amount" | "debit" | "credit" | "balance" | "direction" | "id" | "currency" | "status";
export const CSV_ROLES: { key: CsvRole; label: string }[] = [
  { key: "date", label: "Date" }, { key: "description", label: "Description" }, { key: "reference", label: "Reference" },
  { key: "counterparty", label: "Payer or payee" }, { key: "amount", label: "Amount (signed)" }, { key: "debit", label: "Money out" },
  { key: "credit", label: "Money in" }, { key: "balance", label: "Balance" }, { key: "direction", label: "In or out (DR/CR)" }, { key: "id", label: "Bank's transaction id" },
  { key: "currency", label: "Currency" }, { key: "status", label: "Status (completed, pending…)" },
];
export type CsvLayout = {
  delimiter: string; headerRow: number; headers: string[]; columns: Partial<Record<CsvRole, number>>;
  dateOrder: DateOrder; decimal: "." | ",";
  /** The first rows as read, for checking the columns. */
  sample: string[][];
};

/**
 * Split CSV text into rows, honouring quotes. Blank rows are dropped unless
 * kept, which an import needs so that its row numbers are the spreadsheet's.
 */
export function parseCsvRows(text: string, delimiter: string, keepBlank = false): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.trim() === "") { quoted = true; field = ""; }
    else if (char === delimiter) { row.push(field.trim()); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (keepBlank || row.some(cell => cell !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(cell => cell !== "")) rows.push(row);
  return rows;
}

// The headings banks give each column, the likelier kind first: where a file has two that would do (Airwallex's Account
// Balance and Available Balance, Revolut's Date started and Date completed), the one listed first is read. A currency
// after a heading, "Amount (GBP)" as Starling writes it, is no part of it.
const HEADER_WORDS: Record<CsvRole, RegExp[]> = {
  date: [
    /^(transaction date|posting date|booking date|booked date|date|trans\.? date|date completed|completed date|ημερομηνια( συναλλαγης)?|ημ\/νια|ημερ\.?)$/i,
    /^(value date|time|date and time|date ?time|created at|created on|date started|started date)$/i,
  ],
  description: [/^(description|details|narrative|transaction details|transaction description|payment details|narration|particulars|transaction|memo|περιγραφη|αιτιολογια|λεπτομερειες)$/i],
  reference: [/^(reference|ref\.?|payment reference|customer reference|your reference|reference number|αναφορα|αρ\.? αναφορας)$/i],
  counterparty: [/^(payee|payer|beneficiary|counterparty|counter party|name|ordering party|remitter|other party|payer name|payee name|beneficiary name|remitter name|counterparty name|merchant|δικαιουχος|εντολεας|αντισυμβαλλομενος)$/i],
  amount: [/^total amount$/i, /^(amount|transaction amount|amount eur|value|ποσο|ποσο συναλλαγης)$/i],
  debit: [/^(debit|debits|debit amount|debit net amount|withdrawal|withdrawals|money out|paid out|amount out|out|χρεωση|χρεωσεις|αναληψη)$/i],
  credit: [/^(credit|credits|credit amount|credit net amount|deposit|deposits|money in|paid in|amount in|in|πιστωση|πιστωσεις|καταθεση)$/i],
  balance: [/^(balance|running balance|account balance|ledger balance|book balance|balance after|υπολοιπο)$/i, /^available balance$/i],
  direction: [/^(dr\/cr|cr\/dr|debit\/credit|credit\/debit|d\/c|c\/d|direction|χ\/π)$/i, /^type$/i],
  id: [/^(transaction id|id|bank reference|fitid|transferwise id|αρ\.? συναλλαγης)$/i],
  currency: [/^(currency|wallet currency|account currency|payment currency|ccy|νομισμα)$/i],
  status: [/^(state|status|transaction status|transaction state)$/i],
};
const ROLE_ORDER: CsvRole[] = ["date", "id", "reference", "description", "counterparty", "debit", "credit", "amount", "balance", "currency", "status", "direction"];
const heading = (header: string) => header.trim().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s*\((?:[a-z]{3}|[€£$])\)$/i, "");
// The currency a heading names, "Amount (EUR)" or "Balance (£)": a file that gives its currency only so.
const SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP", "$": "USD" };
const headingCurrency = (header: string) => { const code = /\(([a-z]{3}|[€£$])\)\s*$/i.exec(header.trim())?.[1]; return code ? SYMBOLS[code] ?? code.toUpperCase() : null; };
const isHeading = (cell: string) => ROLE_ORDER.some(role => HEADER_WORDS[role].some(pattern => pattern.test(heading(cell))));

/** Each role's column: the first heading of the likeliest kind, no column read twice. */
function columnsOf(headers: string[]) {
  const columns: Partial<Record<CsvRole, number>> = {};
  const taken = new Set<number>();
  for (const role of ROLE_ORDER) for (const pattern of HEADER_WORDS[role]) {
    const index = headers.findIndex((header, at) => !taken.has(at) && pattern.test(heading(header)));
    if (index >= 0) { columns[role] = index; taken.add(index); break; }
  }
  // Money in and money out in columns of their own say which way each line went. An amount beside them is the same money
  // unsigned (Airwallex's Amount is positive both ways, and before its fee), so it is not read.
  if (columns.debit !== undefined && columns.credit !== undefined) { delete columns.amount; delete columns.direction; }
  return columns;
}

/**
 * The delimiter that gives the most rows of one consistent width. Counting
 * rows alone is fooled by decimal commas in a semicolon file; a header and its
 * rows splitting to the same width is what a real delimiter does.
 */
export function detectDelimiter(text: string) {
  const sample = text.split(/\r?\n/).slice(0, 25).join("\n");
  const scored = [",", ";", "\t", "|"].map(delimiter => {
    const widths = parseCsvRows(sample, delimiter).map(row => row.length).filter(width => width >= 3);
    const counts = new Map<number, number>();
    for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1);
    const [width, rows] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
    return { delimiter, rows, width };
  });
  return scored.sort((a, b) => b.rows - a.rows || b.width - a.width)[0].delimiter;
}

/** Read a bank's CSV: find the header row, recognise the columns, and work out its dates and decimals. */
export function detectCsvLayout(text: string): CsvLayout {
  const delimiter = detectDelimiter(text);
  const rows = parseCsvRows(text, delimiter);
  let headerRow = -1, best = 0;
  rows.slice(0, 25).forEach((row, index) => {
    const known = row.filter(isHeading).length;
    if (known > best) { best = known; headerRow = index; }
  });
  if (best < 2) headerRow = -1;
  const headers = headerRow >= 0 ? rows[headerRow] : (rows[0] ?? []).map((_, index) => `Column ${index + 1}`);
  const columns = headerRow >= 0 ? columnsOf(headers) : {};
  const body = rows.slice(headerRow + 1);
  // Day or month first: a first part over 12 settles it.
  const dates = columns.date !== undefined ? body.map(row => row[columns.date!] ?? "").filter(Boolean).slice(0, 50) : [];
  let dateOrder: DateOrder = "dmy";
  if (dates.some(value => /^\d{4}-/.test(value))) dateOrder = "ymd";
  else if (dates.some(value => { const m = value.match(/^(\d{1,2})[/.\-](\d{1,2})/); return m && Number(m[2]) > 12; })) dateOrder = "mdy";
  // Decimal comma when amounts look like 1.234,56 or 12,50.
  const amountColumns = (["amount", "debit", "credit", "balance"] as CsvRole[]).map(role => columns[role]).filter((value): value is number => value !== undefined);
  const amounts = body.slice(0, 50).flatMap(row => amountColumns.map(index => row[index] ?? "")).filter(Boolean);
  const decimal: "." | "," = amounts.some(value => /\d,\d{2}(\D|$)/.test(value) && !/\d\.\d{2}(\D|$)/.test(value)) ? "," : ".";
  return { delimiter, headerRow, headers, columns, dateOrder, decimal, sample: body.slice(0, 6) };
}

/** What a CSV layout still needs before its lines can be read. */
export function csvLayoutProblems(layout: Pick<CsvLayout, "columns">): string[] {
  const { columns } = layout;
  const problems: string[] = [];
  if (columns.date === undefined) problems.push("Choose the column with the date.");
  if (columns.description === undefined && columns.counterparty === undefined && columns.reference === undefined) problems.push("Choose the column that describes each line.");
  if (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined) problems.push("Choose the amount column, or the money in and money out columns.");
  return problems;
}

// A payment that never moved the balance: still pending, declined, reverted. And an amount Airwallex only holds back,
// which its Balance Activity Report lists from version 1.2 and its own bank-feed guide leaves out.
const NOT_BOOKED = /^(pending|declined|reverted|failed|cancell?ed|rejected|expired)$/;
const HOLDS = /^(hold|hold_release|payment_reserve_hold|payment_reserve_release|issuing_authori[sz]ation_hold|issuing_authori[sz]ation_release)$/;
const KIND_HEADINGS = /^(type|financial transaction type|transaction type)$/i;
const plain = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");

export function readCsv(text: string, layout: CsvLayout, options: ReadOptions = {}): ParsedStatement {
  const problems = csvLayoutProblems(layout);
  if (problems.length) return { format: "csv", lines: [], openingBalance: null, closingBalance: null, csv: layout, problems };
  const rows = parseCsvRows(text, layout.delimiter).slice(layout.headerRow + 1);
  const { columns, decimal, dateOrder } = layout;
  // NatWest puts an apostrophe before a cell's text, so that a spreadsheet keeps it as text: it is no part of it.
  const at = (row: string[], index: number | undefined) => index === undefined ? "" : (row[index] ?? "").trim().replace(/^'/, "");
  const cell = (row: string[], role: CsvRole) => at(row, columns[role]);
  // The payer in one column and the payee in another (Wise): each line's is whichever is filled.
  const parties = columns.counterparty === undefined ? [] : layout.headers.flatMap((header, index) =>
    index !== columns.counterparty && HEADER_WORDS.counterparty.some(pattern => pattern.test(heading(header))) ? [index] : []);
  const kinds = layout.headers.flatMap((header, index) => KIND_HEADINGS.test(heading(header)) ? [index] : []);
  const books = options.currency?.toUpperCase() ?? null;
  // A file that gives its currency only in its headings, "Amount (EUR)" as Starling writes them: every line is in it.
  const named = columns.currency !== undefined ? null : (["amount", "debit", "credit", "balance"] as CsvRole[]).map(role => columns[role])
    .filter((index): index is number => index !== undefined).map(index => headingCurrency(layout.headers[index] ?? "")).find(Boolean) ?? null;
  // Money in and money out in columns of their own, when both are chosen, say which way each line went: an amount beside them isn't read.
  const split = columns.debit !== undefined && columns.credit !== undefined;
  const lines: DraftLine[] = [];
  const elsewhere = new Map<string, number>();
  let unreadable = 0, notBooked = 0;
  for (const row of rows) {
    if (NOT_BOOKED.test(plain(cell(row, "status"))) || kinds.some(index => HOLDS.test(plain(at(row, index))))) { if (cell(row, "date")) notBooked += 1; continue; }
    const currency = (cell(row, "currency") || named || "").toUpperCase();
    if (books && /^[A-Z]{3}$/.test(currency) && currency !== books) { elsewhere.set(currency, (elsewhere.get(currency) ?? 0) + 1); continue; }
    const date = parseDate(cell(row, "date"), dateOrder);
    let amount: number | null = null;
    if (!split && columns.amount !== undefined) {
      amount = parseAmount(cell(row, "amount"), decimal);
      const direction = cell(row, "direction").toLowerCase();
      if (amount !== null && /^(dr|d|debit|out|χ|χρέωση|χρεωση)$/.test(direction)) amount = -Math.abs(amount);
      if (amount !== null && /^(cr|c|credit|in|π|πίστωση|πιστωση)$/.test(direction)) amount = Math.abs(amount);
    } else {
      // Money in keeps its sign (a returned payment written -100.00 under it went out); money out is out however it is written.
      const out = parseAmount(cell(row, "debit"), decimal), into = parseAmount(cell(row, "credit"), decimal);
      if (out !== null || into !== null) amount = (cents(into ?? 0) - cents(Math.abs(out ?? 0))) / 100;
    }
    if (!date || amount === null || amount === 0) {
      // Totals and opening-balance rows are skipped quietly. A row that has a
      // date and an amount written in it, but either will not read, is reported.
      const amountWritten = (["amount", "debit", "credit"] as CsvRole[]).some(role => cell(row, role) !== "");
      if (cell(row, "date") !== "" && amountWritten && (!date || amount === null)) unreadable += 1;
      continue;
    }
    // A line with nothing said of it is a line all the same: called what its type says, or a bank transaction.
    const description = cell(row, "description") || cell(row, "counterparty") || cell(row, "reference") || kinds.map(index => at(row, index)).find(Boolean) || "Bank transaction";
    const party = cell(row, "counterparty") || parties.map(index => at(row, index)).find(Boolean) || "";
    lines.push({ date, amount, description: description.slice(0, 500), reference: cell(row, "reference").slice(0, 200) || null,
      counterparty: party.slice(0, 200) || null, balance: parseAmount(cell(row, "balance"), decimal), external_id: cell(row, "id") || null });
  }
  // The bank's id, when its column holds one: different on every line, a digit in it, and not Excel's shortened number
  // (2.05901E+20 on every row). A column whose values repeat can't tell lines apart, nor this month's from last month's:
  // each line's own key is used instead.
  const ids = lines.map(line => line.external_id).filter((id): id is string => Boolean(id));
  if (ids.length && (new Set(ids).size !== ids.length || ids.some(id => !/\d/.test(id) || /^\d(?:\.\d+)?e[+-]?\d+$/i.test(id)))) for (const line of lines) line.external_id = null;
  if (unreadable) problems.push(`${unreadable} row${unreadable === 1 ? "" : "s"} could not be read and will be left out.`);
  if (notBooked) problems.push(`${notBooked} line${notBooked === 1 ? "" : "s"} still pending, declined or on hold left out.`);
  const currencyNote = leftOutNote(elsewhere, lines.length + unreadable, books);
  if (currencyNote) problems.push(currencyNote);

  // The balance after each line, where the file gives it, says which way the file runs and whether its amounts carry the
  // right signs: between two lines next to each other, the balance moves by the later one's amount. Which way it runs is
  // judged by size alone, so wrong signs can't hide it; banks list newest first as often as oldest first.
  const dated = lines.filter(line => line.balance !== null);
  let forward = 0, backward = 0;
  for (let i = 1; i < dated.length; i++) {
    const moved = Math.abs(cents(dated[i].balance!) - cents(dated[i - 1].balance!));
    if (moved === Math.abs(cents(dated[i].amount))) forward += 1;
    if (moved === Math.abs(cents(dated[i - 1].amount))) backward += 1;
  }
  const newestFirst = backward > forward || (backward === forward && lines.length > 1 && lines[0].date > lines[lines.length - 1].date);
  const inOrder = newestFirst ? [...dated].reverse() : dated;
  let right = 0, wrong = 0;
  for (let i = 1; i < inOrder.length; i++) {
    const moved = cents(inOrder[i].balance!) - cents(inOrder[i - 1].balance!), amount = cents(inOrder[i].amount);
    if (moved === amount) right += 1; else if (moved === -amount) wrong += 1;
  }
  if (wrong >= 2 && wrong * 10 > right + wrong) problems.push(`On ${wrong} lines the balance moves the other way to the amount: money in and money out look the wrong way round. Check the columns.`);
  // The closing balance is the latest line's, and the opening the earliest line's before its own amount: when those lines
  // give a balance. A day's lines may be listed either way, whichever way its days are: the day's first line is the one
  // none of that day's others leads to, its last the one that leads to none; failing that, the file's order says.
  const end = (which: "first" | "last") => {
    if (!lines.length) return undefined;
    const day = lines.reduce((best, line) => (which === "first" ? line.date < best : line.date > best) ? line.date : best, lines[0].date);
    const same = lines.filter(line => line.date === day);
    if (same.some(line => line.balance === null)) return undefined;
    const before = (line: DraftLine) => cents(line.balance!) - cents(line.amount);
    const found = which === "first" ? same.filter(line => !same.some(other => other !== line && cents(other.balance!) === before(line)))
      : same.filter(line => !same.some(other => other !== line && before(other) === cents(line.balance!)));
    return found.length === 1 ? found[0] : undefined;
  };
  const [first, last] = newestFirst ? [lines[lines.length - 1], lines[0]] : [lines[0], lines[lines.length - 1]];
  const earliest = end("first") ?? first, latest = end("last") ?? last;
  const openingBalance = earliest?.balance != null ? (cents(earliest.balance) - cents(earliest.amount)) / 100 : null;
  const closingBalance = latest?.balance ?? null;
  return balanced({ format: "csv", lines: keyed(lines), openingBalance, closingBalance, csv: layout, problems });
}

/**
 * A statement whose lines don't add up to the move between its opening and
 * closing balances is missing a line, or has one read wrong: it says so, with
 * the figures, before anything is imported.
 */
function balanced(parsed: ParsedStatement): ParsedStatement {
  if (parsed.openingBalance === null || parsed.closingBalance === null || !parsed.lines.length) return parsed;
  const moved = cents(parsed.closingBalance) - cents(parsed.openingBalance), sum = parsed.lines.reduce((total, line) => total + cents(line.amount), 0);
  if (moved === sum) return parsed;
  const figure = (value: number) => (value / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { ...parsed, problems: [...parsed.problems, `Its lines come to ${figure(sum)}, but its balance goes from ${figure(cents(parsed.openingBalance))} to ${figure(cents(parsed.closingBalance))}: a line may be missing or read wrong.`] };
}

// ---------------------------------------------------------------------------
// CAMT.053 (ISO 20022), MT940 (SWIFT) and OFX
// ---------------------------------------------------------------------------

const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1]?.trim() ?? null;
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g"))].map(m => m[1]);
const decode = (text: string | null) => text?.replace(/<[^>]+>/g, " ").replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim() || null;

/**
 * A CAMT.053 file holds one statement or several (a day each, or an account
 * each): the file opens on its first statement's opening balance and closes on
 * its last's. A statement in a currency the books aren't kept in is left out.
 */
export function readCamt(xml: string, options: ReadOptions = {}): ParsedStatement {
  const books = options.currency?.toUpperCase() ?? null;
  const lines: DraftLine[] = [];
  const elsewhere = new Map<string, number>();
  let openingBalance: number | null = null, closingBalance: number | null = null, account: string | null = null, notBooked = 0, others = 0, otherAccount: string | null = null;
  const iban = compact(options.iban ?? null);
  const blocks = tags(xml, "Stmt");
  // In date order (a bank may list a month's daily statements newest first): from their period, or when they were made.
  const statements = (blocks.length ? blocks : tags(xml, "Rpt").length ? tags(xml, "Rpt") : [xml])
    .map(statement => ({ statement, from: tag(tag(statement, "FrToDt") ?? "", "FrDtTm") ?? tag(statement, "CreDtTm") ?? "" }))
    .sort((a, b) => a.from.localeCompare(b.from)).map(item => item.statement);
  for (const statement of statements) {
    const entries = tags(statement, "Ntry"), held = tag(statement, "Acct") ?? "";
    const currency = tag(held, "Ccy") ?? /<(?:\w+:)?Amt\b[^>]*\bCcy="([A-Z]{3})"/.exec(statement)?.[1] ?? null;
    if (books && currency && currency !== books) { if (entries.length) elsewhere.set(currency, (elsewhere.get(currency) ?? 0) + entries.length); continue; }
    const named = decode(tag(held, "IBAN")) ?? decode(tag(tag(held, "Othr") ?? "", "Id"));
    if (iban && ibanOf(named) && ibanOf(named) !== iban) { others += entries.length; otherAccount ??= named; continue; }
    account ??= named;
    for (const entry of entries) {
      // Booked entries only: one pending (PDNG) or for information (INFO) may never happen.
      const status = tag(entry, "Sts"), booked = status === null ? "BOOK" : (tag(status, "Cd") ?? status).trim();
      if (booked !== "BOOK") { notBooked += 1; continue; }
      const amount = Number(tag(entry, "Amt"));
      const sign = tag(entry, "CdtDbtInd") === "DBIT" ? -1 : 1;
      const date = parseDate(tag(tag(entry, "BookgDt") ?? "", "Dt") ?? tag(tag(entry, "BookgDt") ?? "", "DtTm") ?? tag(tag(entry, "ValDt") ?? "", "Dt"), "ymd");
      if (!date || !Number.isFinite(amount) || !amount) continue;
      const party = sign > 0 ? tag(tag(entry, "Dbtr") ?? "", "Nm") : tag(tag(entry, "Cdtr") ?? "", "Nm");
      const remittance = decode(tags(entry, "Ustrd").join(" ")) ?? decode(tag(entry, "AddtlNtryInf"));
      const reference = decode(tag(entry, "EndToEndId")) ?? decode(tag(tag(entry, "Strd") ?? "", "Ref"));
      lines.push({
        date, amount: sign * Math.round(amount * 100) / 100,
        description: (remittance ?? decode(party) ?? reference ?? "Bank transaction").slice(0, 500),
        reference: reference && reference !== "NOTPROVIDED" ? reference.slice(0, 200) : null,
        counterparty: decode(party)?.slice(0, 200) ?? null, balance: null,
        external_id: decode(tag(entry, "AcctSvcrRef")) ?? decode(tag(entry, "NtryRef")),
      });
    }
    // The booked balances: closing (CLBD), and opening (OPBD, or the previous statement's closing, PRCD).
    let opening: number | null = null, closing: number | null = null;
    for (const balance of tags(statement, "Bal")) {
      const code = /<(?:\w+:)?Cd>(CLBD|OPBD|PRCD)<\/(?:\w+:)?Cd>/.exec(balance)?.[1];
      const value = Number(tag(balance, "Amt"));
      if (!code || !Number.isFinite(value)) continue;
      const signed = (tag(balance, "CdtDbtInd") === "DBIT" ? -1 : 1) * value;
      if (code === "CLBD") closing = signed;
      else if (code === "OPBD" || opening === null) opening = signed;
    }
    openingBalance ??= opening;
    if (closing !== null) closingBalance = closing;
  }
  const problems = [leftOutNote(elsewhere, lines.length, books), notBooked ? `${notBooked} entr${notBooked === 1 ? "y" : "ies"} not booked yet left out.` : null, lines.length ? othersNote(others) : null].filter((note): note is string => Boolean(note));
  return balanced({ format: "camt", lines: keyed(lines), openingBalance, closingBalance, account: account ?? otherAccount, problems: problems.length || lines.length || others ? problems : ["No transactions were found in this file."] });
}

const mtAmount = (value: string) => Math.round(Number(value.replace(",", ".")) * 100) / 100;
/** A :60F: or :62F: balance: credit or debit, YYMMDD, currency, amount. */
function mtBalance(value: string) {
  const match = /^([CD])\d{6}([A-Z]{3})(\d+,\d*)/.exec(value.trim());
  return match ? { currency: match[2], amount: (match[1] === "D" ? -1 : 1) * mtAmount(match[3]) } : null;
}
const MT_CODES = "TRTP|IBAN|BIC|NAME|REMI|EREF|MARF|CSID|ORDP|BENM|PREF|RTRN|CREF|ULTC|ULTD|PURP|ADDR|CNTP|USTD|STRD|ISDT";
/**
 * What an :86: says: free text, or one of the two layouts banks structure it
 * in. Subfields after ?NN (?20 to ?29 the remittance, ?32 and ?33 the other
 * party's name), or SWIFT's /CODE/ pairs (/NAME/, /REMI/, /EREF/).
 */
function mtDetails(text: string) {
  const parts = text.split("\n").map(part => part.trim()).filter(Boolean), flat = parts.join("");
  if (/\?\d{2}/.test(flat)) {
    const fields = new Map<string, string>();
    for (const [, code, value] of flat.matchAll(/\?(\d{2})([^?]*)/g)) fields.set(code, `${fields.get(code) ?? ""}${value}`);
    // ?20 to ?29 are one text cut into pieces of 27: a full piece runs on into the next, a shorter one ends where it ends.
    const pick = (codes: string[]) => codes.map(code => fields.get(code) ?? "").filter(Boolean)
      .reduce((joined, piece, index, pieces) => joined + (index && pieces[index - 1].length < 27 ? " " : "") + piece, "").replace(/\s+/g, " ").trim() || null;
    return { text: pick(["20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "60", "61", "62", "63"]) ?? pick(["00"]), name: pick(["32", "33"]), reference: null };
  }
  if (new RegExp(`^/(?:${MT_CODES})/`).test(flat)) {
    const value = (code: string) => new RegExp(`/${code}/(.*?)(?=/(?:${MT_CODES})/|$)`).exec(flat)?.[1]?.replace(/\/+/g, " ").trim() || null;
    const reference = value("EREF");
    return { text: value("REMI")?.replace(/^(USTD|STRD)\s*/, "") ?? value("TRTP"), name: value("NAME"), reference: reference && reference !== "NOTPROVIDED" ? reference : null };
  }
  return { text: parts.join(" ").replace(/\s+/g, " ") || null, name: null, reference: null };
}

/**
 * SWIFT MT940, as banks across Europe export it (Airwallex a file a day,
 * Revolut and Wise for any dates): statement lines (:61:), each with its
 * details (:86:), between the opening (:60F:) and closing (:62F:) balances.
 * One file may hold several statements, a day each; the file opens on its
 * first and closes on its last.
 */
export function readMt940(text: string, options: ReadOptions = {}): ParsedStatement {
  // The SWIFT envelope, when the file keeps it: headers {1:…}{2:…}{3:…}, the text inside {4: … -}.
  const body = text.replace(/\r\n?/g, "\n").replace(/\{[1-3]:[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "").replace(/\{4:/g, "\n").replace(/^-\}?\s*$/gm, "");
  const books = options.currency?.toUpperCase() ?? null;
  const lines: DraftLine[] = [];
  const elsewhere = new Map<string, number>();
  let openingBalance: number | null = null, closingBalance: number | null = null, currency: string | null = null, current: DraftLine | null = null, account: string | null = null;
  let otherAccount: string | null = null, others = 0, skipping = false;
  const iban = compact(options.iban ?? null);
  for (const [, field, raw] of body.matchAll(/^:(\d{2}[A-Z]?):([\s\S]*?)(?=^:\d{2}[A-Z]?:|(?![\s\S]))/gm)) {
    const value = raw.replace(/\s+$/, "");
    if (field === "25") {
      // The account: an IBAN, or the bank's code and the account number (BANKCODE/123456), the currency sometimes after.
      // Each statement says it; one for another account is left out, until the next statement.
      const parts = value.trim().split(/[/\s]+/).map(part => part.trim()).filter(Boolean);
      const named = parts.map(ibanOf).find(Boolean) ?? ibanOf(parts.join("")) ?? value.trim().split("/").pop()?.trim() ?? null;
      skipping = Boolean(iban && ibanOf(named) && ibanOf(named) !== iban);
      if (skipping) otherAccount ??= named; else account ??= named;
      current = null;
    } else if (skipping) {
      if (field === "61") others += 1;
      current = null;
    } else if (field === "60F" || field === "60M") {
      const balance = mtBalance(value);
      currency = balance?.currency ?? currency;
      if (balance && openingBalance === null && (!books || balance.currency === books)) openingBalance = balance.amount;
      current = null;
    } else if (field === "62F" || field === "62M") {
      const balance = mtBalance(value);
      if (balance && (!books || balance.currency === books)) closingBalance = balance.amount;
      current = null;
    } else if (field === "61") {
      current = null;
      const [first, ...more] = value.split("\n");
      // Value date YYMMDD, booking date MMDD, C or D (RC and RD reverse them), the third letter of the currency, the amount,
      // the kind of transaction, the account owner's reference, and after // the bank's.
      const match = /^(\d{2})(\d{2})(\d{2})(\d{4})?(RC|RD|C|D)[A-Z]?(\d+,\d*)(?:[NFS][A-Z0-9]{3})?(.*?)(?:\/\/(.*))?$/.exec(first.trim());
      if (!match) continue;
      if (books && currency && currency !== books) { elsewhere.set(currency, (elsewhere.get(currency) ?? 0) + 1); continue; }
      // The booking date when the line gives one, in the value date's year (or the one before or after, across New Year).
      const year = 2000 + Number(match[1]), month = Number(match[2]), booked = match[4] ? Number(match[4].slice(0, 2)) : null;
      const bookedYear = booked === null ? year : booked - month > 6 ? year - 1 : month - booked > 6 ? year + 1 : year;
      const date = parseDate(booked === null ? `${year}${match[2]}${match[3]}` : `${bookedYear}${match[4]}`, "ymd");
      const amount = (match[5] === "D" || match[5] === "RC" ? -1 : 1) * mtAmount(match[6]);
      if (!date || !amount) continue;
      const own = match[7].trim(), bank = match[8]?.trim() ?? "";
      current = { date, amount, description: more.join(" ").trim() || "Bank transaction", reference: own && own !== "NONREF" ? own.slice(0, 200) : null,
        counterparty: null, balance: null, external_id: bank && bank !== "NONREF" ? `${date}|${amount.toFixed(2)}|${bank}` : null };
      lines.push(current);
    } else if (field === "86" && current) {
      const details = mtDetails(value);
      if (details.text) current.description = details.text.slice(0, 500);
      if (details.name) current.counterparty = details.name.slice(0, 200);
      if (details.reference && !current.reference) current.reference = details.reference.slice(0, 200);
      current = null;
    }
  }
  const problems = [leftOutNote(elsewhere, lines.length, books), lines.length ? othersNote(others) : null].filter((note): note is string => Boolean(note));
  return balanced({ format: "mt940", lines: keyed(lines), openingBalance, closingBalance, account: account ?? otherAccount, problems: problems.length || lines.length || others ? problems : ["No transactions were found in this file."] });
}

/**
 * OFX 1.x (SGML) and 2.x (XML), and QFX and QBO, which are OFX. A file may
 * hold a statement for each of several accounts (STMTRS): each is read on its
 * own, in the currency its CURDEF names, and one for another account or in
 * another currency is left out. Its closing balance is LEDGERBAL, when dated
 * within the statement: one as at the day of the download may hold later lines.
 */
export function readOfx(text: string, options: ReadOptions = {}): ParsedStatement {
  const field = (block: string, name: string) => decode(block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1] ?? null);
  const books = options.currency?.toUpperCase() ?? null, iban = compact(options.iban ?? null);
  const lines: DraftLine[] = [];
  const elsewhere = new Map<string, number>();
  let closingBalance: number | null = null, account: string | null = null, otherAccount: string | null = null, others = 0;
  const statements = text.split(/<(?:STMTRS|CCSTMTRS)>/i).slice(1);
  for (const statement of statements.length ? statements : [text]) {
    const blocks = statement.split(/<STMTTRN>/i).slice(1).map(part => part.split(/<\/STMTTRN>/i)[0]);
    const currency = field(statement, "CURDEF")?.toUpperCase() ?? null, named = field(statement, "ACCTID");
    if (books && currency && /^[A-Z]{3}$/.test(currency) && currency !== books) { if (blocks.length) elsewhere.set(currency, (elsewhere.get(currency) ?? 0) + blocks.length); continue; }
    if (iban && named && otherAccount === null && otherAccountOf(named, iban)?.sure) { others += blocks.length; otherAccount = named; continue; }
    account ??= named;
    let last: string | null = null;
    for (const block of blocks) {
      const date = parseDate(field(block, "DTPOSTED")?.slice(0, 8) ?? null, "ymd");
      // The amount with either decimal mark: the specification allows a comma.
      const written = field(block, "TRNAMT") ?? "", amount = parseAmount(written, /,\d{1,2}$/.test(written) && !written.includes(".") ? "," : ".");
      if (!date || amount === null || !amount) continue;
      const name = field(block, "NAME") ?? field(block, "PAYEE"), memo = field(block, "MEMO");
      lines.push({ date, amount, description: (memo || name || "Bank transaction").slice(0, 500),
        reference: field(block, "REFNUM") ?? field(block, "CHECKNUM"), counterparty: name, balance: null, external_id: field(block, "FITID") });
      if (!last || date > last) last = date;
    }
    const ledger = statement.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|$)/i)?.[1] ?? "";
    const amount = parseAmount(field(ledger, "BALAMT"), "."), asOf = parseDate(field(ledger, "DTASOF")?.slice(0, 8) ?? null, "ymd");
    const end = parseDate(field(statement, "DTEND")?.slice(0, 8) ?? null, "ymd") ?? last;
    if (amount !== null && (!asOf || !end || asOf <= end)) closingBalance = amount;
  }
  const problems = [leftOutNote(elsewhere, lines.length, books), lines.length ? othersNote(others) : null].filter((note): note is string => Boolean(note));
  return { format: "ofx", lines: keyed(lines), openingBalance: null, closingBalance: lines.length ? closingBalance : null, account: account ?? otherAccount,
    problems: problems.length || lines.length || others ? problems : ["No transactions were found in this file."] };
}

/** Any statement file: CAMT.053, MT940 and OFX by their content, everything else as CSV. */
export function parseStatementFile(text: string, options: ReadOptions = {}): ParsedStatement {
  if (/<(?:\w+:)?BkToCstmrStmt|<(?:\w+:)?BkToCstmrAcctRpt|urn:iso:std:iso:20022:tech:xsd:camt/.test(text)) return readCamt(text, options);
  if (/^:(?:20|25):/m.test(text) && /^:(?:60[FM]|61|62[FM]):/m.test(text)) return readMt940(text, options);
  if (/<OFX>|OFXHEADER/i.test(text)) return readOfx(text, options);
  return readCsv(text, detectCsvLayout(text), options);
}

// ---------------------------------------------------------------------------
// Several statements at once
// ---------------------------------------------------------------------------

/** One of several statements imported together: its first and last dates, its balances when the file gives them, and what kind of file it is. */
export type ChainLink = { key: string; first: string | null; last: string | null; opening: number | null; closing: number | null; format?: ParsedStatement["format"] };
/** twice: lines in both statements that would come in twice, as two kinds of file key them apart. */
export type ChainNote = { tone: "positive" | "caution" | "critical"; text: string; twice?: boolean };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
// A month's statement can start days after the last one ended, when nothing went through in between; a month without one is a gap.
const MISSING_AFTER_DAYS = 20;

/**
 * Statements imported together, each set against what comes before it: the
 * statement before it in date order, or the last one already imported when
 * that ended later (one older than the import fills in history, and the
 * statements after it still follow on from the import). Does it follow on,
 * its opening balance the other's closing; does it overlap it; or is there a
 * gap long enough to be a statement missing.
 */
export function statementChain(links: ChainLink[], before: { last: string | null; closing: number | null; format?: ChainLink["format"] | null } | null, money: (value: number) => string) {
  type Prior = { last: string; closing: number | null; label: string; format: ChainLink["format"] | null };
  const notes = new Map<string, ChainNote[]>();
  const ordered = links.filter(link => link.first && link.last).sort(chainOrder);
  const imported: Prior | null = before?.last ? { last: before.last, closing: before.closing, label: "the last statement imported", format: before.format ?? null } : null;
  // What comes before: of the statements checked so far, the one ending latest (one this sits inside is an overlap), or the
  // last one imported when that ended later still, but not after this one ends (this is history older than the import).
  const checked: Prior[] = [];
  for (const link of ordered) {
    const list: ChainNote[] = [];
    const prior = [...checked, ...(imported && imported.last <= link.last! ? [imported] : [])].sort((a, b) => b.last.localeCompare(a.last))[0] ?? null;
    if (prior && link.first! <= prior.last) {
      // Lines in both are skipped the second time when both files name them alike: the same kind of file from the same bank.
      const days = daysBetween(link.first!, prior.last < link.last! ? prior.last : link.last!) + 1, span = `${days} day${days === 1 ? "" : "s"}`;
      list.push(prior.format && link.format && prior.format !== link.format
        ? { tone: "critical", twice: true, text: `Overlaps ${prior.label} by ${span}, and is a different kind of file: the lines in both would come in twice.` }
        : prior.format && link.format ? { tone: "caution", text: `Overlaps ${prior.label} by ${span}: lines already there are skipped.` }
        : { tone: "caution", text: `Overlaps ${prior.label} by ${span}: lines already there are skipped if it was the same kind of file, and come in twice if not.` });
    } else if (prior && prior.closing !== null && link.opening !== null) {
      list.push(cents(prior.closing) === cents(link.opening)
        ? { tone: "positive", text: `Follows on from ${prior.label}, at ${money(link.opening)}.` }
        : { tone: "critical", text: `Doesn’t follow on: ${prior.label} ended at ${money(prior.closing)}, this starts at ${money(link.opening)}. Is a statement missing, or one there twice?` });
    } else if (prior && daysBetween(prior.last, link.first!) > MISSING_AFTER_DAYS) {
      list.push({ tone: "caution", text: `Nothing for ${daysBetween(prior.last, link.first!) - 1} days after ${prior.label}: is a statement missing?` });
    }
    notes.set(link.key, list);
    checked.push({ last: link.last!, closing: link.closing, label: "the statement before", format: link.format ?? null });
  }
  return notes;
}

/**
 * Whether a statement is for another account than this one: the account its
 * file names against the IBAN in this account's details. Sure when the file
 * names an IBAN; when it names only an account number, a doubt if this
 * account's IBAN doesn't hold it. Null when they agree, or either is unknown.
 */
export function otherAccount(named: string | null | undefined, iban: string | null) {
  return otherAccountOf(named, iban);
}
function otherAccountOf(named: string | null | undefined, iban: string | null) {
  if (!named || !iban) return null;
  const theirs = named.replace(/[\s-]/g, "").toUpperCase(), asIban = ibanOf(theirs);
  if (asIban) return asIban === iban ? null : { account: asIban, sure: true };
  const digits = theirs.replace(/\D/g, "");
  return digits.length >= 6 && !iban.includes(digits.slice(-8)) ? { account: named.trim(), sure: false } : null;
}

/** The order statements are set against each other in, and listed in: by first date, then last. */
export function chainOrder(a: Pick<ChainLink, "first" | "last">, b: Pick<ChainLink, "first" | "last">) {
  return (a.first ?? "9999").localeCompare(b.first ?? "9999") || (a.last ?? "9999").localeCompare(b.last ?? "9999");
}

/** What kind of statement a file was, from its name: for the last one imported, which is kept by name only. */
export function formatFromName(name: string | null): ParsedStatement["format"] | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name ?? "")?.[1]?.toLowerCase();
  return extension === "csv" ? "csv" : extension === "xml" || extension === "053" ? "camt" : extension === "sta" || extension === "940" || extension === "mt940" ? "mt940"
    : extension === "ofx" || extension === "qfx" ? "ofx" : null;
}

// ---------------------------------------------------------------------------
// A live feed (Enable Banking)
// ---------------------------------------------------------------------------

/** One transaction as the feed reports it. Amounts arrive unsigned, with the direction beside them. */
export type FeedTransaction = {
  entry_reference?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: string;
  status?: string | null;
  booking_date?: string | null; value_date?: string | null; transaction_date?: string | null;
  remittance_information?: string[] | null;
  creditor?: { name?: string | null } | null; debtor?: { name?: string | null } | null;
  reference_number?: string | null;
  balance_after_transaction?: { amount: string; currency: string } | null;
};

/**
 * The feed's transactions as statement lines. Only booked ones in the
 * account's currency: a pending card payment can still change or vanish. The
 * bank's own reference is the key, so fetching the same days again adds nothing.
 */
export function readFeed(transactions: FeedTransaction[], currency = "EUR"): { lines: StatementLine[]; skipped: number } {
  const drafts: DraftLine[] = [];
  let skipped = 0;
  for (const item of transactions) {
    const sign = item.credit_debit_indicator === "CRDT" ? 1 : item.credit_debit_indicator === "DBIT" ? -1 : 0;
    const value = Math.abs(Number(item.transaction_amount?.amount));
    const date = parseDate(item.booking_date ?? item.value_date ?? item.transaction_date ?? null, "ymd");
    if ((item.status && item.status !== "BOOK") || !sign || !date || !Number.isFinite(value) || !value || item.transaction_amount?.currency !== currency) { skipped += 1; continue; }
    const party = (sign > 0 ? item.debtor?.name : item.creditor?.name)?.trim() || null;
    const remittance = (item.remittance_information ?? []).join(" ").replace(/\s+/g, " ").trim();
    const balance = item.balance_after_transaction?.currency === currency ? Number(item.balance_after_transaction.amount) : NaN;
    drafts.push({
      date, amount: sign * Math.round(value * 100) / 100,
      description: (remittance || party || item.reference_number?.trim() || "Bank transaction").slice(0, 500),
      reference: item.reference_number?.trim().slice(0, 200) || null, counterparty: party?.slice(0, 200) ?? null,
      balance: Number.isFinite(balance) ? balance : null,
      external_id: item.entry_reference ? `feed:${item.entry_reference}` : null,
    });
  }
  return { lines: keyed(drafts), skipped };
}

const shiftDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Where a fetch starts. A week before the last day the feed brought in, to
 * catch payments the bank books late; never on or before a day already
 * imported from a file, which would bring the same payments in twice under
 * different keys; and ninety days back the first time.
 */
export function feedFrom(input: { feedLast: string | null; fileLast: string | null; today: string }) {
  const starts = [input.feedLast ? shiftDays(input.feedLast, -7) : null, input.fileLast ? shiftDays(input.fileLast, 1) : null].filter((day): day is string => Boolean(day));
  const from = starts.length ? starts.sort().at(-1)! : shiftDays(input.today, -90);
  return from > input.today ? input.today : from;
}

/** "CY17 0020 0128 0000 0012 0052 7600" → "CY17 ···· 7600": enough to tell the firm's accounts apart. */
export function maskIban(iban: string | null | undefined) {
  const plain = (iban ?? "").replace(/\s+/g, "").toUpperCase();
  return plain.length > 8 ? `${plain.slice(0, 4)} ···· ${plain.slice(-4)}` : plain || null;
}

/**
 * The balance to compare with the books: a booked one only — an available
 * balance counts pending payments and overdraft — and only if it is dated no
 * earlier than the last line fetched, or it would leave that day's lines out.
 */
export function feedBalance(balances: { balance_amount: { amount: string; currency: string }; balance_type: string; reference_date?: string | null }[], lastLine: string | null, currency = "EUR") {
  for (const type of ["ITBD", "CLBD"]) {
    const found = balances.find(item => item.balance_type === type && item.balance_amount.currency === currency);
    const amount = found ? Number(found.balance_amount.amount) : NaN;
    if (!found || !Number.isFinite(amount)) continue;
    if (found.reference_date && lastLine && found.reference_date.slice(0, 10) < lastLine) continue;
    return Math.round(amount * 100) / 100;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type OpenInvoice = { id: string; number: string; client: string; balance: number; due_on: string | null };
export type OpenBill = { id: string; number: string | null; supplier: string; balance: number; due_on: string | null };
/** How an earlier line like this one was coded: money spent or received, to an account. */
export type CodedExample = { signature: string; kind: "spend" | "receive"; account_id: string; account_label: string; vat_rate: number };
export type SuggestionLine = Pick<StatementLine, "date" | "amount" | "description" | "reference" | "counterparty">;
export type Suggestion = {
  items: BankMatchItem[];
  label: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  source: "rules" | "ai";
};

const STOP = new Set(["ltd", "limited", "llc", "plc", "inc", "the", "and", "company", "holdings", "group", "services", "trading", "co", "sa", "ab", "gmbh", "bv", "nv", "srl", "spa", "of", "for", "partners", "international", "cyprus"]);
/** The distinctive words of a name: "Pallas Maritime Ltd" → pallas, maritime. */
export function nameWords(name: string) {
  return [...new Set(name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9α-ω]+/).filter(word => word.length >= 3 && !STOP.has(word)))];
}
const textOf = (line: SuggestionLine) => `${line.description} ${line.reference ?? ""} ${line.counterparty ?? ""}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Whether a document number like 118/26 or INV-2041 is written in the bank text, allowing other separators. */
export function mentionsNumber(text: string, number: string | null) {
  if (!number) return false;
  const parts = number.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!parts.length || parts.join("").length < 3) return false;
  const pattern = parts.map(part => part.replace(/^0+(?=\d)/, "0*")).join("[\\s/\\-._]*");
  return new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`).test(text);
}

/** The words of a bank line that stay the same month to month: no digits, dates or references. */
export function lineSignature(line: Pick<SuggestionLine, "description" | "counterparty">) {
  return `${line.counterparty ?? ""} ${line.description}`.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zα-ω ]+/g, " ").split(/\s+/).filter(word => word.length >= 3).slice(0, 6).join(" ");
}

const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
const money = (value: number) => `€${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * What a bank line most likely was, best first. Certain only when the evidence
 * is: a payment already recorded for the same amount and date, or an invoice
 * or bill whose number is in the bank's text and whose balance is the amount.
 * Everything else is offered for a person to judge.
 */
export function suggestMatches(line: SuggestionLine, context: {
  unreconciled: Pick<UnreconciledBankItemRow, "kind" | "id" | "item_date" | "amount" | "label" | "reference">[];
  invoices: OpenInvoice[]; bills: OpenBill[]; examples: CodedExample[];
}): Suggestion[] {
  const amount = cents(line.amount), text = textOf(line), out: Suggestion[] = [];
  const push = (suggestion: Omit<Suggestion, "source">) => out.push({ ...suggestion, source: "rules" });

  // 1. Already recorded: the same amount, the same way, within ten days.
  const recorded = context.unreconciled.filter(item => cents(Number(item.amount)) === amount && daysApart(item.item_date, line.date) <= 10)
    .sort((a, b) => daysApart(a.item_date, line.date) - daysApart(b.item_date, line.date));
  recorded.slice(0, 2).forEach((item, index) => push({
    items: [{ kind: item.kind, id: item.id }], label: `${item.label} · already recorded`,
    reason: `${money(line.amount)} recorded on ${day(item.item_date)}${recorded.length > 1 ? `, one of ${recorded.length} the same` : ""}`,
    confidence: recorded.length === 1 && index === 0 ? "high" : "medium",
  }));

  if (amount > 0) {
    const named = context.invoices.filter(invoice => mentionsNumber(text, invoice.number));
    const total = named.reduce((sum, invoice) => sum + cents(invoice.balance), 0);
    if (named.length && total === amount) {
      push({ items: named.map(invoice => ({ kind: "invoice" as const, invoice_id: invoice.id, amount: invoice.balance })),
        label: named.length === 1 ? `Invoice ${named[0].number} · ${named[0].client}` : `Invoices ${named.map(i => i.number).join(", ")}`,
        reason: `The bank's text names ${named.length === 1 ? "the invoice" : "each invoice"} and the amount is what is owed`, confidence: "high" });
    } else if (named.length === 1 && amount < cents(named[0].balance)) {
      push({ items: [{ kind: "invoice", invoice_id: named[0].id, amount: line.amount }], label: `Invoice ${named[0].number} · ${named[0].client} · part payment`,
        reason: `The bank's text names the invoice; ${money(named[0].balance)} is owed`, confidence: "medium" });
    }
    const exact = context.invoices.filter(invoice => cents(invoice.balance) === amount && !named.includes(invoice));
    const byName = exact.filter(invoice => nameWords(invoice.client).some(word => text.includes(word)));
    for (const invoice of (byName.length ? byName : exact).slice(0, 3)) {
      push({ items: [{ kind: "invoice", invoice_id: invoice.id, amount: invoice.balance }], label: `Invoice ${invoice.number} · ${invoice.client}`,
        reason: byName.includes(invoice) ? "The amount owed, and the client's name is in the bank's text" : exact.length === 1 ? "The only invoice owing exactly this" : `One of ${exact.length} invoices owing exactly this`,
        confidence: byName.length === 1 && byName[0] === invoice ? "high" : "medium" });
    }
    // Everything one client owes, paid at once.
    const clients = new Map<string, OpenInvoice[]>();
    for (const invoice of context.invoices) clients.set(invoice.client, [...(clients.get(invoice.client) ?? []), invoice]);
    for (const [client, open] of clients) {
      if (open.length < 2 || open.reduce((sum, invoice) => sum + cents(invoice.balance), 0) !== amount) continue;
      push({ items: open.map(invoice => ({ kind: "invoice" as const, invoice_id: invoice.id, amount: invoice.balance })), label: `${client} · ${open.length} invoices`,
        reason: "Everything this client owes, together", confidence: nameWords(client).some(word => text.includes(word)) ? "high" : "low" });
    }
  } else {
    const named = context.bills.filter(bill => mentionsNumber(text, bill.number));
    const total = named.reduce((sum, bill) => sum + cents(bill.balance), 0);
    if (named.length && total === -amount) {
      push({ items: named.map(bill => ({ kind: "bill" as const, bill_id: bill.id, amount: bill.balance })),
        label: named.length === 1 ? `Bill ${named[0].number} · ${named[0].supplier}` : `Bills ${named.map(b => b.number).join(", ")}`,
        reason: "The bank's text names the bill and the amount is what is owed", confidence: "high" });
    }
    const exact = context.bills.filter(bill => cents(bill.balance) === -amount && !named.includes(bill));
    const byName = exact.filter(bill => nameWords(bill.supplier).some(word => text.includes(word)));
    for (const bill of (byName.length ? byName : exact).slice(0, 3)) {
      push({ items: [{ kind: "bill", bill_id: bill.id, amount: bill.balance }], label: `Bill${bill.number ? ` ${bill.number}` : ""} · ${bill.supplier}`,
        reason: byName.includes(bill) ? "The amount owed, and the supplier's name is in the bank's text" : exact.length === 1 ? "The only bill owing exactly this" : `One of ${exact.length} bills owing exactly this`,
        confidence: byName.length === 1 && byName[0] === bill ? "high" : "medium" });
    }
  }

  // 3. Coded like the last lines that looked like this one.
  const signature = lineSignature(line);
  const kind = amount > 0 ? "receive" : "spend";
  const alike = context.examples.filter(example => example.kind === kind && signature && example.signature === signature);
  if (alike.length) {
    const counts = new Map<string, { example: CodedExample; times: number }>();
    for (const example of alike) counts.set(example.account_id, { example, times: (counts.get(example.account_id)?.times ?? 0) + 1 });
    const [top] = [...counts.values()].sort((a, b) => b.times - a.times);
    const net = Math.abs(line.amount) / (1 + top.example.vat_rate / 100);
    const netCents = Math.round(net * 100), vatCents = Math.abs(amount) - netCents;
    push({ items: [{ kind, contact: line.counterparty, lines: [{ description: line.description.slice(0, 300), account_id: top.example.account_id, net: netCents / 100, vat_rate: top.example.vat_rate, vat_amount: vatCents / 100 }] }],
      label: `${kind === "spend" ? "Spent" : "Received"} · ${top.example.account_label}`,
      reason: `Coded this way ${top.times === 1 ? "once before" : `${top.times} times before`}`,
      confidence: top.times >= 2 && counts.size === 1 ? "high" : "medium" });
  }

  // Best first, and one suggestion per set of items.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const seen = new Set<string>();
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence])
    .filter(suggestion => { const key = JSON.stringify(suggestion.items); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 4);
}

// ---------------------------------------------------------------------------
// Suggestions from AI
// ---------------------------------------------------------------------------

/** What the reconcile screen holds after asking: the suggestions by line, or why there are none. */
export type AiSuggestionState = { ok: boolean; error: string | null; suggestions?: Record<string, Suggestion[]> };

export type AiLine = Pick<StatementLine, "amount" | "description" | "reference" | "counterparty"> & { id: string; date: string };
export type AiAccount = { id: string; code: string; name: string; type: string };
/** The model's answer, in the shape the request asked for. Every ref is one the request listed. */
export type AiAnswer = {
  suggestions: { line: string; documents: { ref: string; amount: number }[]; account: string | null; vat_rate: number | null; reason: string; confidence: "high" | "medium" | "low" }[];
};

const AI_CANDIDATES = 200;

/**
 * Only what the question needs leaves the CRM: invoices when money came in,
 * bills when it went out, and when there are many, those owing amounts
 * closest to the lines asked about.
 */
export function aiCandidates(lines: AiLine[], invoices: OpenInvoice[], bills: OpenBill[]) {
  const closest = <T extends { balance: number }>(documents: T[], amounts: number[]) => !amounts.length ? []
    : documents.length <= AI_CANDIDATES ? documents
    : [...documents].sort((a, b) => Math.min(...amounts.map(amount => Math.abs(cents(a.balance) - amount))) - Math.min(...amounts.map(amount => Math.abs(cents(b.balance) - amount)))).slice(0, AI_CANDIDATES);
  return {
    invoices: closest(invoices, lines.filter(line => line.amount > 0).map(line => cents(line.amount))),
    bills: closest(bills, lines.filter(line => line.amount < 0).map(line => -cents(line.amount))),
  };
}

const field = (text: string | null | undefined, max = 200) => (text ?? "").replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The question, with short refs (L1, I1, B1) the answer must use, and the map back to the records. */
export function aiQuestion(input: { bank: string; today: string; lines: AiLine[]; invoices: OpenInvoice[]; bills: OpenBill[]; accounts: AiAccount[] }) {
  const lines = new Map(input.lines.map((line, index) => [`L${index + 1}`, line]));
  const invoices = new Map(input.invoices.map((invoice, index) => [`I${index + 1}`, invoice]));
  const bills = new Map(input.bills.map((bill, index) => [`B${index + 1}`, bill]));
  const accounts = new Map(input.accounts.map(account => [account.code, account]));
  const amount = (value: number) => `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
  const text = [
    `Bank account: ${field(input.bank)}. Today: ${input.today}. Amounts are in euros.`,
    "",
    "Statement lines (ref | date | amount, money in positive | bank's text | payer or payee | reference):",
    ...[...lines].map(([ref, line]) => [ref, line.date, amount(line.amount), field(line.description, 300), field(line.counterparty), field(line.reference)].join(" | ")),
    "",
    "Open sales invoices, for money in (ref | number | client | owed | due):",
    ...(invoices.size ? [...invoices].map(([ref, invoice]) => [ref, field(invoice.number), field(invoice.client), invoice.balance.toFixed(2), invoice.due_on ?? "no due date"].join(" | ")) : ["none"]),
    "",
    "Unpaid supplier bills, for money out (ref | number | supplier | owed | due):",
    ...(bills.size ? [...bills].map(([ref, bill]) => [ref, field(bill.number) || "no number", field(bill.supplier), bill.balance.toFixed(2), bill.due_on ?? "no due date"].join(" | ")) : ["none"]),
    "",
    "Accounts a line can be coded to (code | name | type):",
    ...[...accounts.values()].map(account => [account.code, field(account.name), account.type].join(" | ")),
  ].join("\n");
  return { text, refs: { lines, invoices, bills, accounts } };
}

/**
 * The model's answer, checked against the records before anyone sees it: every
 * ref must be one that was listed, invoices only for money in and bills only
 * for money out, no more than is owed, and the amounts must add up to the line
 * to the cent. Anything else is dropped. Never "sure": a person decides.
 */
export function readAiAnswer(answer: AiAnswer, refs: ReturnType<typeof aiQuestion>["refs"]): Record<string, Suggestion[]> {
  const out: Record<string, Suggestion[]> = {};
  for (const suggestion of answer.suggestions) {
    const line = refs.lines.get(suggestion.line.trim());
    if (!line) continue;
    const target = cents(Math.abs(line.amount)), moneyIn = line.amount > 0;
    let items: BankMatchItem[] | null = null, label = "";
    if (suggestion.documents.length && !suggestion.account) {
      const chosen: BankMatchItem[] = [], names: string[] = [], seen = new Set<string>();
      let total = 0, valid = true;
      for (const document of suggestion.documents) {
        const ref = document.ref.trim(), share = cents(document.amount);
        const invoice = moneyIn ? refs.invoices.get(ref) : undefined, bill = moneyIn ? undefined : refs.bills.get(ref);
        const owed = invoice ? cents(invoice.balance) : bill ? cents(bill.balance) : 0;
        if (seen.has(ref) || share <= 0 || share > owed) { valid = false; break; }
        seen.add(ref); total += share;
        if (invoice) { chosen.push({ kind: "invoice", invoice_id: invoice.id, amount: share / 100 }); names.push(`Invoice ${invoice.number} · ${invoice.client}`); }
        if (bill) { chosen.push({ kind: "bill", bill_id: bill.id, amount: share / 100 }); names.push(`Bill${bill.number ? ` ${bill.number}` : ""} · ${bill.supplier}`); }
      }
      if (valid && total === target) { items = chosen; label = names.join(" + "); }
    } else if (suggestion.account && !suggestion.documents.length) {
      const account = refs.accounts.get(suggestion.account.trim()), rate = suggestion.vat_rate ?? 0;
      if (account && [0, 3, 5, 9, 19].includes(rate)) {
        const net = Math.round(target / (1 + rate / 100));
        items = [{ kind: moneyIn ? "receive" : "spend", contact: line.counterparty, lines: [{ description: line.description.slice(0, 300), account_id: account.id, net: net / 100, vat_rate: rate, vat_amount: (target - net) / 100 }] }];
        label = `${moneyIn ? "Received" : "Spent"} · ${account.code} · ${account.name}${rate ? ` · ${rate}% VAT` : ""}`;
      }
    }
    if (!items) continue;
    (out[line.id] ??= []).push({ items, label, reason: suggestion.reason.trim().slice(0, 240) || "Suggested by AI", confidence: suggestion.confidence === "low" ? "low" : "medium", source: "ai" });
  }
  return out;
}

/**
 * The reconciliation in one sum: what the books say is in the account, less
 * what has been recorded but is not on a statement yet, plus statement lines
 * not yet matched, is what the bank should be showing. Reconciled when the
 * bank agrees and every line is matched; a payment recorded after the last
 * statement is simply waiting for the next one.
 */
export function reconciliation(input: { bookBalance: number; unreconciled: number[]; unmatchedLines: number[]; bankBalance: number | null }) {
  const sum = (values: number[]) => values.reduce((total, value) => total + cents(value), 0);
  const expected = cents(input.bookBalance) - sum(input.unreconciled) + sum(input.unmatchedLines);
  const difference = input.bankBalance === null ? null : cents(input.bankBalance) - expected;
  return { expected: expected / 100, difference: difference === null ? null : difference / 100, reconciled: difference === 0 && input.unmatchedLines.length === 0 };
}
