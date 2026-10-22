import "server-only";

import fs from "node:fs";
import path from "node:path";

import { one, sql } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/anthropic";
import { CAPTURE_ANSWER, readInvoiceDocument, type CaptureClient, type CapturedInvoice } from "@/lib/ai/capture";
import { nameWords } from "@/lib/domain/bank-statements";
import { firmToday } from "@/lib/domain/invoices";
import type { OrganisationRow } from "@/types/database";

/**
 * Capture: a file dropped at practice level becomes one item per invoice in
 * it, each routed to a client, checked, matched to a supplier and drafted as
 * a bill. Claude reads; Ledgerline checks everything Claude says.
 */

export type CaptureCheck = { key: string; ok: boolean; label: string; detail: string };
export type CaptureDraftLine = { description: string; account_id: string; net: number; vat_rate: number; vat_amount: number };
export type CaptureDraft = { supplier_id: string | null; new_supplier: string | null; supplier_vat: string | null; supplier_country: string; supplier_match: "vat_number" | "name" | "new";
  number: string | null; issued_on: string | null; due_on: string | null; reverse_charge: boolean; lines: CaptureDraftLine[] };
export type CaptureRouting = { method: "vat_number" | "name" | "uploaded" | "none"; confidence: "high" | "medium" | "low"; billed_to: string | null };

export const rehearsalMode = () => process.env.LEDGERLINE_AI_FIXTURES === "1";
export const captureAvailable = () => aiConfigured() || rehearsalMode();

const cents = (value: number) => Math.round(value * 100);
const normalVat = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
const RATES = [0, 3, 5, 9, 19];

async function clientsForCapture(): Promise<(CaptureClient & { org: OrganisationRow })[]> {
  const orgs = await sql<OrganisationRow>("select * from organisations order by name");
  const accounts = await sql<{ organisation_id: string; code: string; name: string }>(
    "select organisation_id, code, name from ledger_accounts where is_active and type in ('direct_costs', 'expense', 'fixed_asset', 'current_asset') and system_role is null order by code");
  return orgs.map((org, index) => ({ org, ref: `C${index + 1}`, name: org.name, greek_name: org.greek_name, vat_number: org.vat_number, industry: org.industry,
    accounts: accounts.filter(account => account.organisation_id === org.id).map(({ code, name }) => ({ code, name })) }));
}

/** The checks a bookkeeper would run on the figures, done by Ledgerline rather than taken from the model. */
export function checkInvoice(invoice: CapturedInvoice, duplicate: boolean): CaptureCheck[] {
  const net = invoice.lines.reduce((sum, line) => sum + cents(line.net), 0);
  const vat = invoice.lines.reduce((sum, line) => sum + cents(line.vat_amount), 0);
  const badRate = invoice.lines.filter(line => !RATES.includes(line.vat_rate));
  const offLine = invoice.lines.filter(line => !invoice.reverse_charge && Math.abs(cents(line.vat_amount) - Math.round(line.net * line.vat_rate)) > 1);
  const vatNumber = normalVat(invoice.supplier.vat_number);
  return [
    { key: "net", ok: net === cents(invoice.totals.net), label: "Lines add up to the net", detail: net === cents(invoice.totals.net) ? `€${(net / 100).toFixed(2)} across ${invoice.lines.length} line${invoice.lines.length === 1 ? "" : "s"}` : `Lines come to €${(net / 100).toFixed(2)}; the invoice says €${invoice.totals.net.toFixed(2)}` },
    { key: "vat", ok: !offLine.length && vat === cents(invoice.totals.vat), label: "VAT agrees with each rate", detail: offLine.length ? `${offLine.length} line${offLine.length === 1 ? "" : "s"} where VAT is not net × rate` : vat === cents(invoice.totals.vat) ? `€${(vat / 100).toFixed(2)} VAT` : `Lines carry €${(vat / 100).toFixed(2)} VAT; the invoice says €${invoice.totals.vat.toFixed(2)}` },
    { key: "total", ok: cents(invoice.totals.net) + cents(invoice.totals.vat) === cents(invoice.totals.total), label: "Net plus VAT is the total", detail: `€${invoice.totals.net.toFixed(2)} + €${invoice.totals.vat.toFixed(2)} = €${invoice.totals.total.toFixed(2)}` },
    { key: "rates", ok: !badRate.length, label: "Cyprus VAT rates", detail: badRate.length ? `${badRate.map(line => `${line.vat_rate}%`).join(", ")} is not a Cyprus rate` : [...new Set(invoice.lines.map(line => `${line.vat_rate}%`))].join(", ") },
    { key: "supplier_vat", ok: Boolean(vatNumber && (/^CY\d{8}[A-Z]$/.test(vatNumber) || /^[A-Z]{2}[0-9A-Z]{8,12}$/.test(vatNumber))), label: "Supplier VAT number", detail: vatNumber ?? "Not printed" },
    { key: "duplicate", ok: !duplicate, label: "Not already in the books", detail: duplicate ? "This supplier's invoice with that number is already recorded" : "No bill with this number from this supplier" },
  ];
}

/** Turn what Claude read into review items: routed, checked, supplier matched, bill drafted. */
export async function itemsFromAnswer(fileId: string, invoices: CapturedInvoice[], clients: Awaited<ReturnType<typeof clientsForCapture>>, uploadedFor: string | null = null) {
  let position = 0;
  for (const invoice of invoices) {
    position += 1;
    const billedVat = normalVat(invoice.bill_to.vat_number);
    const byVat = billedVat ? clients.find(client => normalVat(client.vat_number) === billedVat) : undefined;
    // Uploaded inside a company: that company, unless the document's VAT number says otherwise. A till receipt names nobody.
    const byUpload = uploadedFor ? clients.find(client => client.org.id === uploadedFor) : undefined;
    const byRef = clients.find(client => client.ref === invoice.client_ref);
    const target = byVat ?? byUpload ?? byRef ?? null;
    const routing: CaptureRouting = { method: byVat ? "vat_number" : byUpload ? "uploaded" : byRef ? "name" : "none", confidence: byVat || byUpload ? "high" : byRef ? "medium" : "low", billed_to: invoice.bill_to.name };
    let draft: CaptureDraft | null = null, checks: CaptureCheck[] = checkInvoice(invoice, false);
    if (target) {
      draft = await draftFor(target.org, invoice);
      const duplicate = Boolean(draft.supplier_id && invoice.invoice_number && await one("select 1 from bills where organisation_id = $1 and supplier_id = $2 and lower(btrim(number)) = lower(btrim($3)) and status <> 'void'", [target.org.id, draft.supplier_id, invoice.invoice_number]));
      checks = checkInvoice(invoice, duplicate);
    }
    await sql("insert into capture_items (file_id, position, organisation_id, routing, extraction, checks, supplier_id, draft) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb)",
      [fileId, position, target?.org.id ?? null, JSON.stringify(routing), JSON.stringify(invoice), JSON.stringify(checks), draft?.supplier_id ?? null, JSON.stringify(draft ?? {})]);
  }
}

/** The bill as it would be recorded in one client's books. Also used when an item is moved to another client. */
export async function draftFor(org: OrganisationRow, invoice: CapturedInvoice): Promise<CaptureDraft> {
  const suppliers = await sql<{ id: string; name: string; greek_name: string | null; vat_number: string | null; default_account_id: string | null; reverse_charge: boolean }>(
    "select id, name, greek_name, vat_number, default_account_id, reverse_charge from suppliers where organisation_id = $1 and is_active", [org.id]);
  const accounts = await sql<{ id: string; code: string; type: string; system_role: string | null }>("select id, code, type::text, system_role from ledger_accounts where organisation_id = $1 and is_active", [org.id]);
  const vat = normalVat(invoice.supplier.vat_number);
  const byVat = vat ? suppliers.find(supplier => normalVat(supplier.vat_number) === vat) : undefined;
  const words = new Set([...nameWords(invoice.supplier.name_latin), ...nameWords(invoice.supplier.name)]);
  const byName = byVat ? undefined : suppliers.find(supplier => [...nameWords(supplier.name), ...nameWords(supplier.greek_name ?? "")].filter(word => words.has(word)).length >= 2
    || nameWords(supplier.name).join(" ") === nameWords(invoice.supplier.name_latin).join(" "));
  const supplier = byVat ?? byName ?? null;
  const fallback = accounts.find(account => account.code === "429")?.id ?? accounts.find(account => account.type === "expense")?.id ?? "";
  const foreign = invoice.supplier.country.toUpperCase() !== "CY";
  const reverseCharge = org.vat_registered && (invoice.reverse_charge || (foreign && cents(invoice.totals.vat) === 0)) ;
  const codable = (id: string | undefined) => accounts.find(account => account.id === id && account.type !== "bank" && !["receivable", "payable", "vat"].includes(account.system_role ?? ""))?.id;
  const lines = invoice.lines.map(line => {
    const rate = RATES.includes(line.vat_rate) ? line.vat_rate : 19;
    const account = codable(accounts.find(item => item.code === line.account_code)?.id) ?? codable(supplier?.default_account_id ?? undefined) ?? fallback;
    const vatRate = reverseCharge && rate === 0 ? 19 : rate;
    return { description: (line.description_en || line.description).slice(0, 300), account_id: account, net: line.net, vat_rate: vatRate,
      vat_amount: reverseCharge ? Math.round(line.net * vatRate) / 100 : line.vat_amount };
  });
  return {
    supplier_id: supplier?.id ?? null, new_supplier: supplier ? null : invoice.supplier.name_latin || invoice.supplier.name, supplier_vat: vat, supplier_country: invoice.supplier.country.toUpperCase().slice(0, 2) || "CY",
    supplier_match: byVat ? "vat_number" : byName ? "name" : "new", number: invoice.invoice_number, issued_on: invoice.issue_date,
    due_on: invoice.due_date && invoice.issue_date && invoice.due_date >= invoice.issue_date ? invoice.due_date : null, reverse_charge: reverseCharge, lines,
  };
}

/** Read one uploaded file with Claude (or, in rehearsal mode, a recorded reading of a known demo file). */
export async function readCaptureFile(fileId: string) {
  const file = await one<{ id: string; organisation_id: string | null; file_name: string; media_type: string; sha256: string; content: Uint8Array; status: string }>("select * from capture_files where id = $1", [fileId]);
  if (!file) return { ok: false as const, error: "That file is no longer here." };
  if (file.status === "read") return { ok: true as const, count: Number((await one<{ count: number }>("select count(*) as count from capture_items where file_id = $1", [fileId]))?.count ?? 0) };
  await sql("update capture_files set status = 'reading', error = null where id = $1", [fileId]);
  const clients = await clientsForCapture();
  let invoices: CapturedInvoice[] | null = null, error: string | null = null;
  const fixture = path.join(process.cwd(), "demo-files", "fixtures", `${file.sha256}.json`);
  if (rehearsalMode() && fs.existsSync(fixture)) {
    const parsed = CAPTURE_ANSWER.safeParse(JSON.parse(fs.readFileSync(fixture, "utf8")));
    if (parsed.success) invoices = parsed.data.invoices.map(invoice => ({ ...invoice, client_ref: clients.find(client => client.vat_number && normalVat(client.vat_number) === normalVat(invoice.bill_to.vat_number))?.ref ?? invoice.client_ref }));
  } else if (!aiConfigured()) {
    error = "AI is not set up yet. Add ANTHROPIC_API_KEY to .env.local and restart.";
  } else {
    const answer = await readInvoiceDocument({ mediaType: file.media_type, base64: Buffer.from(file.content).toString("base64"), fileName: file.file_name, clients, today: firmToday() });
    if (answer.ok) invoices = answer.value.invoices; else error = answer.error;
  }
  if (!invoices) {
    await sql("update capture_files set status = 'failed', error = $2 where id = $1", [fileId, error ?? "The file could not be read."]);
    return { ok: false as const, error: error ?? "The file could not be read." };
  }
  await itemsFromAnswer(fileId, invoices, clients, file.organisation_id);
  await sql("update capture_files set status = 'read', read_at = now() where id = $1", [fileId]);
  return { ok: true as const, count: invoices.length };
}
