"use server";

import { revalidatePath } from "next/cache";

import { asDbError, one, sql } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { draftFor, type CaptureDraft } from "@/lib/capture";
import type { CapturedInvoice } from "@/lib/ai/capture";
import { VAT_RATES, type OrganisationRow } from "@/types/database";

/**
 * From a reviewed capture to a bill in the right client's books. The supplier
 * is created with its VAT number when it is new; the bill posts through
 * save_bill like any other, so the ledger is still written only by posting.
 */

function refresh() { revalidatePath("/", "layout"); }

type Item = { id: string; organisation_id: string | null; extraction: CapturedInvoice; draft: CaptureDraft; status: string; file_id: string; file_name: string };
const loadItem = (id: string) => one<Item>("select i.*, f.file_name from capture_items i join capture_files f on f.id = i.file_id where i.id = $1", [id]);

async function post(item: Item, override?: Partial<CaptureDraft> & { organisation_id?: string }) {
  const orgId = override?.organisation_id ?? item.organisation_id;
  if (!orgId) throw Object.assign(new Error("capture_unrouted"), { code: "P0001" });
  // A document captured earlier may not have been drafted yet: draft it in its client's books first.
  const base = "lines" in (item.draft ?? {}) ? item.draft : await draftFor((await one<OrganisationRow>("select * from organisations where id = $1", [orgId]))!, item.extraction);
  const draft = { ...base, ...Object.fromEntries(Object.entries(override ?? {}).filter(([, value]) => value !== undefined)) } as CaptureDraft;
  let supplier = draft.supplier_id;
  if (!supplier) {
    const name = (draft.new_supplier ?? item.extraction.supplier.name_latin ?? item.extraction.supplier.name).trim();
    const existing = await one<{ id: string }>("select id from suppliers where organisation_id = $1 and lower(btrim(name)) = lower(btrim($2)) and is_active", [orgId, name]);
    supplier = existing?.id ?? (await one<{ id: string }>(
      "insert into suppliers (organisation_id, name, greek_name, vat_number, country, default_account_id, reverse_charge) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [orgId, name, item.extraction.language !== "en" ? item.extraction.supplier.name : null, draft.supplier_vat, draft.supplier_country ?? "CY", draft.lines[0]?.account_id ?? null, draft.reverse_charge]))!.id;
  }
  const bill = await one<{ id: string }>("select save_bill($1, null, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) as id",
    [orgId, supplier, draft.number, null, draft.issued_on, draft.due_on, `Captured from ${item.file_name}${item.extraction.pages ? `, page ${item.extraction.pages}` : ""}. Read by Claude, checked and posted by the practice.`,
     `Captured: ${item.file_name}`, JSON.stringify(draft.lines), draft.reverse_charge]);
  await sql("update bills set capture_item_id = $2 where id = $1", [bill!.id, item.id]);
  await sql("update capture_items set status = 'posted', bill_id = $2, organisation_id = $3, supplier_id = $4, posted_at = now() where id = $1", [item.id, bill!.id, orgId, supplier]);
  await sql("select audit_append($1, 'posted', 'captured_bill', $2, $3::jsonb)", [orgId, bill!.id, JSON.stringify({ file: item.file_name, supplier: item.extraction.supplier.name_latin, number: draft.number })]);
  return bill!.id;
}

export async function postCaptureItem(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const id = p.uuid("item_id"), org = p.uuid("organisation_id");
  const item = id ? await loadItem(id) : null;
  if (!item || item.status !== "review") return { ok: false, error: "That document has already been dealt with." };
  if (!org) return { ok: false, error: "Choose which client this invoice belongs to." };
  let lines: CaptureDraft["lines"] = [];
  try {
    lines = (JSON.parse(String(form.get("lines") ?? "[]")) as CaptureDraft["lines"]).map(line => ({ description: String(line.description).trim().slice(0, 300), account_id: String(line.account_id),
      net: Math.round(Number(line.net) * 100) / 100, vat_rate: Number(line.vat_rate), vat_amount: Math.round(Number(line.vat_amount) * 100) / 100 }));
  } catch { lines = []; }
  if (!lines.length || lines.some(line => !line.description || !line.account_id || !Number.isFinite(line.net) || !VAT_RATES.includes(line.vat_rate as (typeof VAT_RATES)[number]))) return { ok: false, error: "Each line needs a description, an account and an amount." };
  const supplierId = p.uuid("supplier_id");
  try {
    await post(item, {
      organisation_id: org, supplier_id: supplierId, new_supplier: supplierId ? null : p.text("new_supplier", { max: 200 }) ?? item.draft.new_supplier,
      number: p.text("number", { max: 60 }), issued_on: p.text("issued_on", { max: 10 }), due_on: p.text("due_on", { max: 10 }) || null,
      reverse_charge: p.boolean("reverse_charge"), lines,
    });
  } catch (error) {
    const failure = asDbError(error);
    return { ok: false, error: failure.message === "capture_unrouted" ? "Choose which client this invoice belongs to." : describeDbError(failure, "The bill could not be posted.") };
  }
  refresh();
  return { ok: true, error: null, notice: "Posted." };
}

/** Every item whose checks all pass and whose client is sure, posted as drafted. */
export async function postReadyItems(_previous: ActionState, form: FormData): Promise<ActionState> {
  let ids: unknown;
  try { ids = JSON.parse(String(form.get("item_ids") ?? "[]")); } catch { ids = []; }
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: "Nothing is ready to post." };
  let posted = 0, failed = 0, first: string | null = null;
  for (const id of ids as string[]) {
    const item = await loadItem(id);
    if (!item || item.status !== "review") continue;
    try { await post(item); posted += 1; } catch (error) { failed += 1; first ??= describeDbError(asDbError(error), "A bill could not be posted."); }
  }
  refresh();
  return failed ? { ok: posted > 0, error: `${posted} posted; ${failed} need a look: ${first}` } : { ok: true, error: null, notice: `${posted} bill${posted === 1 ? "" : "s"} posted to ${posted === 1 ? "its client's" : "their clients'"} books.` };
}

/** Send an item to another client: its supplier and accounts are worked out again in that client's books. */
export async function routeCaptureItem(form: FormData): Promise<void> {
  const p = new FormParser(form);
  const id = p.uuid("item_id"), orgId = p.uuid("organisation_id");
  const item = id ? await loadItem(id) : null;
  if (!item || item.status !== "review" || !orgId) return;
  const org = await one<OrganisationRow>("select * from organisations where id = $1", [orgId]);
  if (!org) return;
  const draft = await draftFor(org, item.extraction);
  await sql("update capture_items set organisation_id = $2, draft = $3::jsonb, supplier_id = $4, routing = routing || $5::jsonb where id = $1",
    [item.id, org.id, JSON.stringify(draft), draft.supplier_id, JSON.stringify({ method: "manual", confidence: "high" })]);
  refresh();
}

export async function discardCaptureItem(form: FormData): Promise<void> {
  const id = new FormParser(form).uuid("item_id");
  if (!id) return;
  await sql("update capture_items set status = 'discarded' where id = $1 and status = 'review'", [id]);
  refresh();
}
