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
  format: "csv" | "camt" | "ofx";
  lines: StatementLine[];
  /** The bank's own balance at the end of the statement, when the file gives one. */
  closingBalance: number | null;
  /** For a CSV, the columns read and the choices that can be changed. */
  csv?: CsvLayout;
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
  if (/\b(dr|debit|d)$/i.test(text)) { sign = -1; text = text.replace(/\s*(dr|debit|d)$/i, ""); }
  else if (/\b(cr|credit|c)$/i.test(text)) text = text.replace(/\s*(cr|credit|c)$/i, "");
  if (/^\(.*\)$/.test(text)) { sign = -sign; text = text.slice(1, -1); }
  text = text.replace(/[€$£\s ']/g, "").replace(/^eur|eur$/i, "");
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

/** Give lines without a bank id a stable key; identical lines on one day are told apart by their order. */
function keyed(lines: DraftLine[]): StatementLine[] {
  const seen = new Map<string, number>();
  return lines.map(line => {
    if (line.external_id) return { ...line, external_id: line.external_id.slice(0, 200) };
    const base = lineKey(line, 0);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...line, external_id: lineKey(line, count) };
  });
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export type CsvRole = "date" | "description" | "reference" | "counterparty" | "amount" | "debit" | "credit" | "balance" | "direction" | "id";
export const CSV_ROLES: { key: CsvRole; label: string }[] = [
  { key: "date", label: "Date" }, { key: "description", label: "Description" }, { key: "reference", label: "Reference" },
  { key: "counterparty", label: "Payer or payee" }, { key: "amount", label: "Amount (signed)" }, { key: "debit", label: "Money out" },
  { key: "credit", label: "Money in" }, { key: "balance", label: "Balance" }, { key: "direction", label: "In or out (DR/CR)" }, { key: "id", label: "Bank's transaction id" },
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

const HEADER_WORDS: Record<CsvRole, RegExp> = {
  date: /^(transaction date|posting date|booking date|date|trans\.? date|value date|ημερομηνία( συναλλαγής)?|ημ\/νία|ημερ\.?)$/i,
  description: /^(description|details|narrative|transaction details|particulars|transaction|memo|περιγραφή|αιτιολογία|λεπτομέρειες)$/i,
  reference: /^(reference|ref\.?|payment reference|customer reference|your reference|αναφορά|αρ\.? αναφοράς)$/i,
  counterparty: /^(payee|payer|beneficiary|counterparty|name|ordering party|remitter|δικαιούχος|εντολέας|αντισυμβαλλόμενος)$/i,
  amount: /^(amount|transaction amount|amount \(eur\)|amount eur|ποσό|ποσό συναλλαγής)$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|paid out|out|χρέωση|χρεώσεις|ανάληψη)$/i,
  credit: /^(credit|credits|deposit|deposits|money in|paid in|in|πίστωση|πιστώσεις|κατάθεση)$/i,
  balance: /^(balance|running balance|available balance|ledger balance|υπόλοιπο)$/i,
  direction: /^(dr\/cr|cr\/dr|debit\/credit|type|d\/c|χ\/π)$/i,
  id: /^(transaction id|id|bank reference|reference number|fitid|αρ\.? συναλλαγής)$/i,
};

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
    const known = row.filter(cell => Object.values(HEADER_WORDS).some(pattern => pattern.test(cell.trim()))).length;
    if (known > best) { best = known; headerRow = index; }
  });
  if (best < 2) headerRow = -1;
  const headers = headerRow >= 0 ? rows[headerRow] : (rows[0] ?? []).map((_, index) => `Column ${index + 1}`);
  const columns: Partial<Record<CsvRole, number>> = {};
  headers.forEach((header, index) => {
    for (const role of Object.keys(HEADER_WORDS) as CsvRole[]) {
      // The first date column is the transaction date; a value date comes after it.
      if (columns[role] === undefined && HEADER_WORDS[role].test(header.trim())) { columns[role] = index; break; }
    }
  });
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

export function readCsv(text: string, layout: CsvLayout): ParsedStatement {
  const problems = csvLayoutProblems(layout);
  if (problems.length) return { format: "csv", lines: [], closingBalance: null, csv: layout, problems };
  const rows = parseCsvRows(text, layout.delimiter).slice(layout.headerRow + 1);
  const { columns, decimal, dateOrder } = layout;
  const cell = (row: string[], role: CsvRole) => columns[role] === undefined ? "" : (row[columns[role]!] ?? "").trim();
  const lines: DraftLine[] = [];
  let unreadable = 0, closingBalance: number | null = null;
  for (const row of rows) {
    const date = parseDate(cell(row, "date"), dateOrder);
    let amount: number | null = null;
    if (columns.amount !== undefined) {
      amount = parseAmount(cell(row, "amount"), decimal);
      const direction = cell(row, "direction").toLowerCase();
      if (amount !== null && /^(dr|d|debit|χ|χρέωση)$/.test(direction)) amount = -Math.abs(amount);
      if (amount !== null && /^(cr|c|credit|π|πίστωση)$/.test(direction)) amount = Math.abs(amount);
    } else {
      const out = parseAmount(cell(row, "debit"), decimal), into = parseAmount(cell(row, "credit"), decimal);
      if (out) amount = -Math.abs(out); else if (into) amount = Math.abs(into);
    }
    const description = cell(row, "description") || cell(row, "counterparty") || cell(row, "reference");
    if (!date || amount === null || amount === 0 || !description) {
      // Totals and opening-balance rows are skipped quietly. A row that has a
      // date and an amount written in it, but either will not read, is reported.
      const amountWritten = (["amount", "debit", "credit"] as CsvRole[]).some(role => cell(row, role) !== "");
      if (cell(row, "date") !== "" && amountWritten && (!date || amount === null)) unreadable += 1;
      continue;
    }
    const balance = parseAmount(cell(row, "balance"), decimal);
    lines.push({ date, amount, description: description.slice(0, 500), reference: cell(row, "reference").slice(0, 200) || null,
      counterparty: cell(row, "counterparty").slice(0, 200) || null, balance, external_id: cell(row, "id") || null });
  }
  // Banks list newest first as often as oldest first; the closing balance is the one on the latest line.
  const dated = lines.filter(line => line.balance !== null);
  if (dated.length) {
    const firstDate = dated[0].date, lastDate = dated[dated.length - 1].date;
    closingBalance = (firstDate > lastDate ? dated[0] : dated[dated.length - 1]).balance;
  }
  return { format: "csv", lines: keyed(lines), closingBalance, csv: layout,
    problems: unreadable ? [`${unreadable} row${unreadable === 1 ? "" : "s"} could not be read and will be left out.`] : [] };
}

// ---------------------------------------------------------------------------
// CAMT.053 (ISO 20022) and OFX
// ---------------------------------------------------------------------------

const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1]?.trim() ?? null;
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g"))].map(m => m[1]);
const decode = (text: string | null) => text?.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim() || null;

export function readCamt(xml: string): ParsedStatement {
  const lines: DraftLine[] = [];
  for (const entry of tags(xml, "Ntry")) {
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
  let closingBalance: number | null = null;
  for (const balance of tags(xml, "Bal")) {
    if (/<(?:\w+:)?Cd>CLBD<\/(?:\w+:)?Cd>/.test(balance)) {
      const value = Number(tag(balance, "Amt"));
      if (Number.isFinite(value)) closingBalance = (tag(balance, "CdtDbtInd") === "DBIT" ? -1 : 1) * value;
    }
  }
  return { format: "camt", lines: keyed(lines), closingBalance, problems: lines.length ? [] : ["No transactions were found in this file."] };
}

/** OFX 1.x (SGML) and 2.x (XML): STMTTRN blocks, closing LEDGERBAL. */
export function readOfx(text: string): ParsedStatement {
  const field = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? null;
  const lines: DraftLine[] = [];
  for (const block of text.split(/<STMTTRN>/i).slice(1).map(part => part.split(/<\/STMTTRN>/i)[0])) {
    const date = parseDate(field(block, "DTPOSTED")?.slice(0, 8) ?? null, "ymd");
    const amount = Number(field(block, "TRNAMT"));
    if (!date || !Number.isFinite(amount) || !amount) continue;
    const name = field(block, "NAME"), memo = field(block, "MEMO");
    lines.push({ date, amount: Math.round(amount * 100) / 100, description: (memo || name || "Bank transaction").slice(0, 500),
      reference: field(block, "REFNUM") ?? field(block, "CHECKNUM"), counterparty: name, balance: null, external_id: field(block, "FITID") });
  }
  const ledger = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i)?.[1];
  return { format: "ofx", lines: keyed(lines), closingBalance: ledger ? Number(ledger) : null, problems: lines.length ? [] : ["No transactions were found in this file."] };
}

/** Any statement file: CAMT.053 and OFX by their content, everything else as CSV. */
export function parseStatementFile(text: string): ParsedStatement {
  if (/<(?:\w+:)?BkToCstmrStmt|<(?:\w+:)?BkToCstmrAcctRpt|urn:iso:std:iso:20022:tech:xsd:camt/.test(text)) return readCamt(text);
  if (/<OFX>|OFXHEADER/i.test(text)) return readOfx(text);
  return readCsv(text, detectCsvLayout(text));
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
