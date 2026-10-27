import "server-only";

import { createHash } from "node:crypto";

import { sql } from "@/lib/db";
import { getBalanceSheetReport, getGeneralLedger, getJournalReport, getLedgerBalances, getProfitAndLossReport } from "@/lib/data/accounts";
import { getYearEnd, yearStartOf } from "@/lib/data/year-end";
import { ACCOUNT_TYPES, JOURNAL_SOURCE_LABELS, statementCsvHeader, statementCsvRows, trialBalance } from "@/lib/domain/accounts";
import { FRAMEWORK_NOTE, INDEPENDENCE_NOTE, JOURNAL_FLAGS, OPINIONS, SIZE_LABELS, UK_FRAMEWORK_NOTE } from "@/lib/domain/audit";
import { regimeOf } from "@/lib/domain/regimes";
import { toCsv } from "@/lib/domain/billing";
import { getCurrentUser, getPractice } from "@/lib/org";
import { zip } from "@/lib/documents/zip";

/**
 * The audit file: everything an auditor asks for first about one financial
 * year, in one download. The trial balance, the statements, the ledgers, the
 * invoices and bills still open at the year end, the bank, VAT, every manual
 * journal with what an auditor will ask about it, and the audit trail, each as
 * a CSV; and a read-me saying what was checked and each file's SHA-256, so
 * anyone can tell later that a file is the one Ledgerline produced.
 */

const long = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const euro = (value: number) => `€${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (value: number) => value ? value.toFixed(2) : "";
const csv = (header: readonly string[], rows: string[][]) => `﻿${toCsv(header, rows)}`;

export async function auditFile(requested: string) {
  const data = await getYearEnd(requested);
  const { org, periodEnd, yearStart } = data;
  const [user, practice] = await Promise.all([getCurrentUser(), getPractice()]);
  const range = { range: "custom", from: yearStart, to: periodEnd };
  // Comparatives only for a year the books hold whole: half a year beside a full one misleads.
  const priorWhole = yearStartOf(data.priorEnd) >= data.booksFrom;
  const [balances, pnl, sheet, ledger, journal, receivables, payables, banks, unmatched, vat, trail] = await Promise.all([
    getLedgerBalances(yearStart, periodEnd),
    getProfitAndLossReport({ ...range, compare: priorWhole ? "previous_year" : undefined }),
    getBalanceSheetReport({ ...range, compare: data.priorInBooks ? "previous_year" : undefined }),
    getGeneralLedger(range),
    getJournalReport(range),
    // What each customer still owed at the year end: invoices issued by then, less what was paid or credited by then.
    sql<{ number: string; issued_on: string; due_on: string | null; customer: string; total: number; settled: number }>(`
      select i.number, to_char(i.issued_on, 'YYYY-MM-DD') as issued_on, to_char(i.due_on, 'YYYY-MM-DD') as due_on, c.name as customer, i.total,
             coalesce((select sum(p.amount) from invoice_payments p where p.invoice_id = i.id and p.received_on <= $2), 0)
               + coalesce((select sum(a.amount) from credit_allocations a where a.invoice_id = i.id and a.allocated_on <= $2), 0) as settled
        from invoices i join customers c on c.id = i.customer_id
       where i.organisation_id = $1 and i.status not in ('draft', 'void') and i.issued_on <= $2 order by c.name, i.issued_on, i.number`, [org.id, periodEnd]),
    sql<{ number: string | null; issued_on: string; due_on: string | null; supplier: string; total: number; settled: number }>(`
      select b.number, to_char(b.issued_on, 'YYYY-MM-DD') as issued_on, to_char(b.due_on, 'YYYY-MM-DD') as due_on, s.name as supplier, b.total,
             coalesce((select sum(p.amount) from bill_payments p where p.bill_id = b.id and p.paid_on <= $2), 0)
               + coalesce((select sum(a.amount) from supplier_credit_allocations a where a.bill_id = b.id and a.allocated_on <= $2), 0) as settled
        from bills b join suppliers s on s.id = b.supplier_id
       where b.organisation_id = $1 and b.status <> 'void' and b.issued_on <= $2 order by s.name, b.issued_on`, [org.id, periodEnd]),
    sql<{ id: string; code: string; name: string; statement: number | null; statement_date: string | null }>(`
      select a.id, a.code, a.name, last.balance as statement, to_char(last.txn_date, 'YYYY-MM-DD') as statement_date
        from ledger_accounts a
        left join lateral (select l.balance, l.txn_date from bank_statement_lines l where l.bank_account_id = a.id and l.txn_date <= $2 and l.balance is not null
                            order by l.txn_date desc, l.created_at desc limit 1) last on true
       where a.organisation_id = $1 and a.type = 'bank' order by a.code`, [org.id, periodEnd]),
    sql<{ txn_date: string; account: string; description: string; reference: string | null; counterparty: string | null; amount: number; matched_amount: number; status: string }>(`
      select to_char(l.txn_date, 'YYYY-MM-DD') as txn_date, a.code || ' ' || a.name as account, l.description, l.reference, l.counterparty, l.amount, l.matched_amount, l.status
        from v_bank_statement_lines l join ledger_accounts a on a.id = l.bank_account_id
       where l.organisation_id = $1 and l.txn_date between $2 and $3 and l.status in ('unmatched', 'partial') order by l.txn_date, l.amount`, [org.id, yearStart, periodEnd]),
    sql<{ period_from: string; period_to: string; filed_on: string; net_vat: number }>(`
      select to_char(period_from, 'YYYY-MM-DD') as period_from, to_char(period_to, 'YYYY-MM-DD') as period_to, to_char(filed_on, 'YYYY-MM-DD') as filed_on, net_vat
        from vat_returns where organisation_id = $1 and period_to between $2 and $3 order by period_to`, [org.id, yearStart, periodEnd]),
    // The trail from the start of the year to today: the year itself, and what happened to its figures after.
    sql<{ seq: number; at: string; actor: string; action: string; entity: string; detail: unknown; prev_hash: string; hash: string }>(`
      select seq, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at, actor, action, entity, detail, prev_hash, hash
        from audit_log where organisation_id = $1 and at >= $2::date order by seq`, [org.id, yearStart]),
  ]);

  const tb = trialBalance(balances.rows);
  const owed = <T extends { total: number; settled: number }>(rows: T[]) => rows.map(row => ({ ...row, open: Math.round((Number(row.total) - Number(row.settled)) * 100) / 100 })).filter(row => row.open > 0.004);
  const openInvoices = owed(receivables), openBills = owed(payables);
  const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
  const control = (role: string) => {
    const row = balances.rows.find(item => item.system_role === role);
    return row ? Math.round((Number(row.opening) + Number(row.debit) - Number(row.credit)) * 100) / 100 : 0;
  };
  const ledgerBank = (id: string) => {
    const row = balances.rows.find(item => item.account_id === id);
    return row ? Math.round((Number(row.opening) + Number(row.debit) - Number(row.credit)) * 100) / 100 : 0;
  };
  const yearName = org.year_end_month === 12 ? periodEnd.slice(0, 4) : `to ${periodEnd}`;
  const postedAt = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Nicosia", dateStyle: "short", timeStyle: "short" });

  const files: { name: string; content: string; about: string }[] = [
    { name: `01 Trial balance at ${periodEnd}.csv`, about: "every account with a balance at the year end; income and costs are the year's",
      content: csv(["Code", "Account", "Type", "Debit", "Credit"], [...tb.lines.map(line => [line.code, line.name, ACCOUNT_TYPES[line.type].label, plain(line.debit), plain(line.credit)]), ["", "Total", "", tb.debit.toFixed(2), tb.credit.toFixed(2)]]) },
    { name: `02 Profit and loss ${yearName}.csv`, about: priorWhole ? "the year, beside the year before" : "the year (the year before is not in Ledgerline whole, so no comparatives)",
      content: csv(statementCsvHeader(pnl.columns.map(column => column.label), pnl), statementCsvRows(pnl.rows, pnl)) },
    { name: `03 Balance sheet at ${periodEnd}.csv`, about: data.priorInBooks ? "at the year end, beside a year earlier" : "at the year end",
      content: csv(statementCsvHeader(sheet.columns.map(column => column.label), sheet), statementCsvRows(sheet.rows, sheet)) },
    { name: `04 General ledger ${yearName}.csv`, about: "every posted line, by account, with the balance brought and carried forward",
      content: csv(["Date", "Code", "Account", "Type", "Reference", "Detail", "Debit", "Credit", "Balance (debit positive)"], ledger.accounts.flatMap(account => [
        [ledger.period.from, account.code, account.name, "", "", "Brought forward", "", "", account.opening.toFixed(2)],
        ...account.lines.map(line => [line.entry_date, account.code, account.name, JOURNAL_SOURCE_LABELS[line.source], line.reference ?? "", line.description ?? line.narration, plain(Number(line.debit)), plain(Number(line.credit)), line.balance.toFixed(2)]),
        [ledger.period.to, account.code, account.name, "", "", "Carried forward", account.debit.toFixed(2), account.credit.toFixed(2), account.closing.toFixed(2)],
      ])) },
    { name: `05 Journal ${yearName}.csv`, about: "every entry, line by line, with when it was posted: for journal entry testing",
      content: csv(["Date", "Type", "Reference", "Narration", "Code", "Account", "Line detail", "Debit", "Credit", "Posted at (Cyprus time)"], journal.entries.flatMap(entry => entry.lines.map(line => [
        entry.entry_date, JOURNAL_SOURCE_LABELS[entry.source], entry.reference ?? "", entry.narration, line.account_code, line.account_name, line.description ?? "", plain(Number(line.debit)), plain(Number(line.credit)), postedAt(entry.created_at),
      ]))) },
    { name: `06 Manual journals ${yearName}.csv`, about: "the journals people posted by hand, each with what an auditor will ask about it (ISA 240)",
      content: csv(["Date", "Reference", "Narration", "Amount", "Posted at (Cyprus time)", "To ask about"], data.checks.manual.map(entry => [
        entry.entry_date, entry.reference ?? "", entry.narration, entry.total.toFixed(2), postedAt(entry.created_at), entry.flags.map(flag => JOURNAL_FLAGS[flag]).join("; "),
      ])) },
    { name: `07 Receivables at ${periodEnd}.csv`, about: `invoices still owed at the year end: ${euro(sum(openInvoices.map(row => row.open)))}, against ${euro(control("receivable"))} in the receivables account`,
      content: csv(["Customer", "Invoice", "Issued", "Due", "Total", "Paid or credited by the year end", "Owed at the year end", "Days past due at the year end"], openInvoices.map(row => [
        row.customer, row.number, row.issued_on, row.due_on ?? "", Number(row.total).toFixed(2), Number(row.settled).toFixed(2), row.open.toFixed(2), row.due_on && row.due_on < periodEnd ? String(Math.round((Date.parse(periodEnd) - Date.parse(row.due_on)) / 86_400_000)) : "",
      ])) },
    { name: `08 Payables at ${periodEnd}.csv`, about: `bills still unpaid at the year end: ${euro(sum(openBills.map(row => row.open)))}, against ${euro(-control("payable"))} in the payables account`,
      content: csv(["Supplier", "Their invoice", "Dated", "Due", "Total", "Paid or credited by the year end", "Owed at the year end"], openBills.map(row => [
        row.supplier, row.number ?? "", row.issued_on, row.due_on ?? "", Number(row.total).toFixed(2), Number(row.settled).toFixed(2), row.open.toFixed(2),
      ])) },
    { name: `09 Bank at ${periodEnd}.csv`, about: "each bank account: the books against the bank's own statement balance at the year end",
      content: csv(["Code", "Account", "In the books", "On the statement", "Statement balance dated", "Difference"], banks.map(bank => {
        const books = ledgerBank(bank.id), statement = bank.statement === null ? null : Number(bank.statement);
        return [bank.code, bank.name, books.toFixed(2), statement === null ? "" : statement.toFixed(2), bank.statement_date ?? "", statement === null ? "" : (Math.round((books - statement) * 100) / 100).toFixed(2)];
      })) },
    { name: `10 Bank lines not matched ${yearName}.csv`, about: unmatched.length ? `${unmatched.length} statement line${unmatched.length === 1 ? "" : "s"} in the year not matched to the books` : "none: every statement line in the year is matched",
      content: csv(["Date", "Account", "Description", "Reference", "Counterparty", "Amount", "Matched", "Status"], unmatched.map(line => [
        line.txn_date, line.account, line.description, line.reference ?? "", line.counterparty ?? "", Number(line.amount).toFixed(2), Number(line.matched_amount).toFixed(2), line.status === "partial" ? "Partly matched" : "Not matched",
      ])) },
    { name: `11 VAT returns ${yearName}.csv`, about: org.vat_registered ? `${vat.length} of ${data.checks.vatQuarters} returns for the year's quarters filed` : "not registered for VAT",
      content: csv(["Period from", "Period to", "Filed on", "Net VAT (payable positive)"], [
        ...vat.map(row => [row.period_from, row.period_to, row.filed_on, Number(row.net_vat).toFixed(2)]),
        ...data.checks.missingVat.map(quarter => [quarter.from, quarter.to, "Not filed", ""]),
      ].sort((a, b) => a[1].localeCompare(b[1]))) },
    { name: `12 Audit trail from ${yearStart}.csv`, about: "every posting, match, lock and filing from the start of the year to today, with its SHA-256 chain",
      content: csv(["Entry", "At (UTC)", "By", "Action", "What", "Detail", "Hash of the entry before", "Hash"], trail.map(row => [
        String(row.seq), row.at, row.actor, row.action, row.entity, JSON.stringify(row.detail ?? {}), row.prev_hash, row.hash,
      ])) },
  ];

  const review = data.assurance === "review", uk = org.country === "GB", regime = regimeOf(org.country);
  const today = data.today;
  const steps = data.steps.filter(step => step.doneOn).map(step => `- ${step.label}: ${long(step.doneOn!)}`);
  const lines = [
    org.name + (org.greek_name ? ` (${org.greek_name})` : ""),
    [org.he_number ? `${regime.labels.registration} ${org.he_number}` : null, org.tic ? `${regime.labels.taxId} ${org.tic}` : null, org.vat_number ? `VAT ${org.vat_number}` : null].filter(Boolean).join(" · "),
    `Financial year ${long(yearStart)} to ${long(periodEnd)}`,
    "",
    `Prepared in Ledgerline by ${user.name}, ${practice.name}, on ${long(today)}.`,
    data.checks.locked ? `The books are locked up to ${long(data.checks.lockDate!)}: nothing dated in this year can be added, changed or removed.` : `The books are not locked to the year end yet${data.checks.lockDate ? ` (locked up to ${long(data.checks.lockDate)})` : ""}: the figures can still change.`,
    data.startsBeforeBooks ? `The books in Ledgerline begin on ${long(data.booksFrom)}, with opening balances; the year's earlier months are in the previous records.` : null,
    "",
    "THE YEAR END",
    uk ? (data.assurance === "exempt" ? "- Exempt from audit as a small company (Companies Act 2006): these accounts are for the directors and Companies House." : "- Audit by a registered auditor (Companies Act 2006).")
      : review ? "- Review: the company has chosen a review under ISRE 2400 instead of an audit (Companies Law, Cap. 113, s.152A(1)(d))." : "- Audit by a statutory auditor or audit firm (Companies Law, Cap. 113, s.152A).",
    ...data.review.reasons.map(reason => `  ${reason}`),
    data.size ? `- Size (s.141A): ${SIZE_LABELS[data.size.size]}${data.size.certain ? "" : ", subject to the average number of employees"}.` : null,
    `- Framework: ${uk ? UK_FRAMEWORK_NOTE : FRAMEWORK_NOTE}`,
    org.auditor_name ? `- ${review ? "Reviewer" : "Auditor"}: ${org.auditor_name}${org.auditor_is_practice ? `, the practice itself. ${INDEPENDENCE_NOTE}` : ""}` : null,
    data.row?.opinion ? `- ${review ? "Conclusion" : "Opinion"}: ${OPINIONS[data.row.opinion]}${data.row.report_signed_on ? `, signed ${long(data.row.report_signed_on)}` : ""}.` : null,
    ...steps,
    "",
    "WHAT LEDGERLINE CHECKED",
    `- Trial balance: debits ${euro(tb.debit)}, credits ${euro(tb.credit)}: ${tb.balanced ? "it balances" : "IT DOES NOT BALANCE"}.`,
    `- Bank: ${unmatched.length ? `${unmatched.length} statement line${unmatched.length === 1 ? "" : "s"} in the year not matched to the books (file 10)` : "every statement line in the year is matched to the books"}.`,
    org.vat_registered ? `- VAT: ${vat.length} of ${data.checks.vatQuarters} returns for the year's quarters filed${data.checks.missingVat.length ? `; not filed: ${data.checks.missingVat.map(quarter => `${quarter.from} to ${quarter.to}`).join(", ")}` : ""}.` : "- VAT: the company is not registered for VAT.",
    `- Manual journals: ${data.checks.manualJournals} in the year, ${data.checks.flagged.length} with something to ask about (file 06).`,
    `- Receivables: open invoices ${euro(sum(openInvoices.map(row => row.open)))}; receivables account ${euro(control("receivable"))}. A difference is money received or credited and not yet set against an invoice.`,
    `- Payables: open bills ${euro(sum(openBills.map(row => row.open)))}; payables account ${euro(-control("payable"))}.`,
    `- Audit trail: ${data.checks.chain.checked.toLocaleString("en-GB")} entries across the practice recomputed on ${long(today)}: ${data.checks.chain.intact ? "the chain is intact" : "THE CHAIN IS BROKEN: a row was changed outside Ledgerline"}.`,
    "  Each entry's hash is the SHA-256 of the hash before it and the entry itself, so a change to any entry breaks every hash after it.",
    "",
    "THE FILES",
    ...files.map(file => `${file.name}\n  ${file.about}.`),
    "",
    "Each CSV opens in Excel or any spreadsheet: UTF-8, comma-separated, amounts in euro with a full stop for the decimals.",
    "",
    "FINGERPRINTS (SHA-256)",
    ...files.map(file => `${createHash("sha256").update(file.content, "utf8").digest("hex")}  ${file.name}`),
  ];
  const readme = lines.filter(line => line !== null).join("\r\n") + "\r\n";
  const name = `${org.name.replace(/[^\p{L}\p{N} .-]+/gu, "").trim()} audit file ${yearName}`.replace(/\s+/g, " ");
  return { name, archive: zip([{ name: "00 Read me.txt", content: readme }, ...files]) };
}
