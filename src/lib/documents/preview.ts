import "server-only";

import { one } from "@/lib/db";
import { logoFor } from "@/lib/data/document-styles";
import { getRemittance, type RemittanceData } from "@/lib/data/remittance";
import { getDocumentForPdf } from "@/lib/data/sales";
import { getStatement, type StatementData } from "@/lib/data/statements";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { firmToday } from "@/lib/domain/invoices";
import { threeMonthsBefore } from "@/lib/domain/statements";
import type { OrganisationRow } from "@/types/database";
import { renderDocumentPdf, renderRemittancePdf, renderStatementPdf, type DocumentPdfData } from "./pdf";
import type { DocumentStyle, StyledDocument } from "./style";

/**
 * A document drawn in a style that is not saved yet, for the style editor:
 * the company's own latest invoice, quote, credit note, customer statement
 * or remittance, or a made-up one in its name when it has none.
 */

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const round = (value: number) => Math.round(value * 100) / 100;

export async function previewPdf(org: OrganisationRow, kind: StyledDocument, style: DocumentStyle): Promise<Buffer> {
  if (kind === "statement") {
    const latest = await one<{ customer_id: string }>("select customer_id from invoices where organisation_id = $1 and status in ('issued', 'part_paid', 'paid') order by issued_on desc, number desc limit 1", [org.id]);
    const today = firmToday();
    const data = latest ? await getStatement("customer", latest.customer_id, { view: "activity", from: threeMonthsBefore(today), to: today }) : null;
    return renderStatementPdf({ ...(data ?? await sampleStatement(org)), style });
  }
  if (kind === "remittance") {
    const latest = await one<{ id: string }>("select id from bill_payments where organisation_id = $1 order by paid_on desc limit 1", [org.id]);
    const data = latest ? await getRemittance({ paymentId: latest.id }) : null;
    return renderRemittancePdf({ ...(data ?? await sampleRemittance(org)), style });
  }
  const table = { invoice: "invoices", quote: "quotes", credit_note: "credit_notes" }[kind];
  const latest = await one<{ id: string }>(`select id from ${table} where organisation_id = $1 ${kind === "quote" ? "" : "and status <> 'void'"} order by issued_on desc limit 1`, [org.id]);
  const data = latest ? await getDocumentForPdf(kind, latest.id) : null;
  return renderDocumentPdf({ ...(data ?? await sampleDocument(org, kind)), style });
}

// ---------------------------------------------------------------------------
// Made-up documents, for a company that has none of a kind yet
// ---------------------------------------------------------------------------

const bankOf = (org: OrganisationRow) => org.default_bank_account_id
  ? one<{ name: string; bank_details: string | null }>("select name, bank_details from ledger_accounts where id = $1", [org.default_bank_account_id]) : Promise.resolve(null);

const sampleCustomer = (org: OrganisationRow) => ({
  id: "sample", organisation_id: org.id, name: "Example Customer Ltd", email: null, phone: null, vat_number: null, country: org.country,
  address: org.country === "GB" ? "1 Example Street\nLondon EC1A 1AA" : "1 Example Street\n1010 Nicosia", eu_business: false, default_account_id: null,
  payment_terms_days: null, is_active: true, document_language: null, document_style_id: null,
});

async function sampleDocument(org: OrganisationRow, kind: "invoice" | "quote" | "credit_note") {
  const today = firmToday(), rate = org.vat_registered ? (org.country === "GB" ? 20 : 19) : 0;
  const lines = [
    { description: "Monthly service, as agreed", quantity: 1, unit: null, unit_price: 450, net: 450 },
    { description: "Additional hours", quantity: 6, unit: "hours", unit_price: 40, net: 240 },
  ].map((line, index) => ({ ...line, id: `sample-${index}`, discount_pct: 0, vat_rate: rate, vat_amount: round(line.net * rate / 100), item_id: index ? "sample" : null }));
  const net = lines.reduce((sum, line) => sum + line.net, 0), vat = round(lines.reduce((sum, line) => sum + line.vat_amount, 0));
  const total = round(net + vat);
  const document = {
    id: "sample", number: kind === "quote" ? `${org.invoice_prefix}Q-001` : kind === "credit_note" ? `${org.invoice_prefix}CN-0001` : `${org.invoice_prefix}0001`,
    issued_on: today, due_on: addDays(today, org.payment_terms_days), valid_until: addDays(today, 30), status: kind === "quote" ? "sent" : "issued",
    net, vat_amount: vat, total, amount_paid: 0, amount_credited: 0, amount_allocated: 0, amount_refunded: 0, balance: total, expired: false,
    vat_treatment: "standard", currency: org.currency, reference: null, notes: null, client_name: "Example Customer Ltd", customer_id: null, invoice_id: null,
    reason: "Goods returned",
  };
  const [bank, logo] = await Promise.all([bankOf(org), logoFor(org.id)]);
  return { org, kind, document, lines, customer: sampleCustomer(org), bank, corrects: null, logo, language: org.document_language } as unknown as Omit<DocumentPdfData, "style">;
}

async function sampleStatement(org: OrganisationRow): Promise<Omit<StatementData, "style">> {
  const today = firmToday(), from = threeMonthsBefore(today);
  const rows = [
    { date: addDays(from, 4), kind: "invoice" as const, reference: `${org.invoice_prefix}0001`, against: null, charged: 820.1, settled: 0, due_on: addDays(from, 34) },
    { date: addDays(from, 30), kind: "payment" as const, reference: `${org.invoice_prefix}0001`, against: `${org.invoice_prefix}0001`, charged: 0, settled: 820.1, due_on: null },
    { date: addDays(from, 40), kind: "invoice" as const, reference: `${org.invoice_prefix}0002`, against: null, charged: 535.5, settled: 0, due_on: addDays(from, 70) },
    { date: addDays(today, -10), kind: "invoice" as const, reference: `${org.invoice_prefix}0003`, against: null, charged: 357, settled: 0, due_on: addDays(today, 20) },
  ];
  let running = 0;
  const lines = rows.map(row => { running = round(running + row.charged - row.settled); return { ...row, record_id: "sample", balance: running }; });
  const late = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${addDays(from, 70)}T00:00:00Z`)) / 86_400_000));
  const ageing = Object.fromEntries(AGEING_BUCKETS.map(bucket => [bucket.key, 0])) as StatementData["ageing"];
  ageing.current = 357;
  ageing[late <= 30 ? "d30" : late <= 60 ? "d60" : "d90"] = 535.5;
  const [bank, logo] = await Promise.all([bankOf(org), logoFor(org.id)]);
  return {
    org, party: "customer", view: "activity", account: sampleCustomer(org), from, to: today, everything: false,
    opening: 0, lines, closing: running, charged: 1712.6, settled: 820.1,
    open: [
      { id: "sample-2", number: `${org.invoice_prefix}0002`, issued_on: addDays(from, 40), due_on: addDays(from, 70), total: 535.5, outstanding: 535.5, days_overdue: late },
      { id: "sample-3", number: `${org.invoice_prefix}0003`, issued_on: addDays(today, -10), due_on: addDays(today, 20), total: 357, outstanding: 357, days_overdue: 0 },
    ],
    ageing, overdue: 535.5, unusedCredit: 0, bank, logo, language: org.document_language, today,
  };
}

async function sampleRemittance(org: OrganisationRow): Promise<Omit<RemittanceData, "style">> {
  const today = firmToday();
  const lines = [
    { id: "sample-1", bill_id: "sample", number: "EX-1041", issued_on: addDays(today, -40), total: 1190, amount: 1190 },
    { id: "sample-2", bill_id: "sample", number: "EX-1067", issued_on: addDays(today, -12), total: 446.25, amount: 446.25 },
  ].map(line => ({ ...line, paid_on: today, reference: null, supplier_id: "sample", bank_name: "Bank" }));
  return {
    org, logo: await logoFor(org.id), language: org.document_language, paidOn: today, reference: null, bankName: "Bank",
    supplier: { id: "sample", name: "Example Supplies Ltd", email: null, phone: null, vat_number: null, country: org.country, address: "2 Example Avenue", payment_terms_days: null,
      default_account_id: null, notes: null, is_active: true, reverse_charge: false, iban: null, bic: null, created_by: null, created_at: today, updated_at: today },
    lines, total: 1636.25,
  };
}
