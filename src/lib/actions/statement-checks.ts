"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { balanceOn } from "@/lib/data/statement-checks";
import { validRecordDate } from "@/lib/domain/invoices";
import { plainDecimal } from "@/lib/domain/line-math";
import { orgPath, requireOrg } from "@/lib/org";
import type { StatementCheckItem } from "@/types/database";

const FILE_TYPES: Record<string, (bytes: Buffer) => boolean> = {
  "application/pdf": bytes => bytes.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": bytes => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
};
const cents = (value: number) => Math.round(value * 100);

/** The explanations as the page sent them, each one checked: a side, a date, a reference, an amount that is not nothing. */
function readItems(text: string): StatementCheckItem[] | null {
  let raw: unknown;
  try { raw = JSON.parse(text || "[]"); } catch { return null; }
  if (!Array.isArray(raw) || raw.length > 300) return null;
  const items: StatementCheckItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { side, date, reference, amount, note } = entry as Record<string, unknown>;
    const value = Number(amount);
    if ((side !== "ours" && side !== "theirs") || typeof date !== "string" || !validRecordDate(date) || !Number.isFinite(value) || Math.abs(value) > 1e9 || cents(value) === 0) return null;
    items.push({ side, date, reference: String(reference ?? "").trim().slice(0, 80), amount: cents(value) / 100, note: typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null });
  }
  return items;
}

/**
 * A supplier's statement checked against the books, kept with what explains
 * the difference (and their statement itself, when attached). Our balance is
 * worked out again here, and what is left unexplained with it: what the
 * page showed is not trusted.
 */
export async function saveStatementCheck(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const supplier = p.uuid("supplier_id");
  const date = p.text("statement_date", { required: true, max: 10, label: "Statement date" });
  if (date && !validRecordDate(date)) p.errors.statement_date = "Statement date is not a valid date.";
  // Their balance can be below nothing: a credit they hold for us.
  // Accounting writes a credit in brackets, (1,234.50): a minus.
  const theirsText = plainDecimal(String(form.get("their_balance") ?? "").trim().replace(/^\((.*)\)$/, "-$1"));
  const theirsValue = theirsText === "" ? null : Number(theirsText);
  if (theirsValue === null) p.errors.their_balance = "Their balance is needed: the balance their statement shows.";
  else if (!Number.isFinite(theirsValue) || Math.abs(theirsValue) > 99_999_999) p.errors.their_balance = "Their balance must be a number.";
  const theirs = theirsValue !== null && Number.isFinite(theirsValue) ? cents(theirsValue) / 100 : null;
  const notes = p.text("notes", { max: 2000, label: "Notes" });
  const items = readItems(String(form.get("items") ?? ""));
  if (!items) p.errors.items = "The explanations could not be read. Refresh and try again.";
  const file = form.get("file");
  let kept: { name: string; type: string; bytes: Buffer } | null = null;
  if (file instanceof File && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (file.size > 5 * 1024 * 1024) p.errors.file = "Their statement as a file of 5 MB or less, please.";
    else if (!FILE_TYPES[file.type]?.(bytes)) p.errors.file = "A PDF, PNG or JPEG, please.";
    else kept = { name: file.name.slice(0, 120), type: file.type, bytes };
  }
  if (!supplier) p.errors.supplier_id = "That supplier does not exist.";
  if (p.failed || !supplier || !date || theirs === null || !items) return p.fail();
  let id: string;
  try {
    const ours = await balanceOn(supplier, date);
    if (ours === null) return { ok: false, error: "That supplier does not exist." };
    const unexplained = (cents(theirs) - cents(ours) - items.reduce((sum, item) => sum + cents(item.amount), 0)) / 100;
    id = (await one<{ id: string }>(`
      insert into supplier_statement_checks (organisation_id, supplier_id, statement_date, their_balance, our_balance, explained, unexplained, notes, file_name, file_type, file_content, checked_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, app_user_id()) returning id`,
      [org.id, supplier, date, theirs, ours, JSON.stringify(items), unexplained, notes, kept?.name ?? null, kept?.type ?? null, kept?.bytes ?? null]))!.id;
  } catch (error) {
    const failure = asDbError(error);
    console.error("[statement check] save failed", failure.code);
    return { ok: false, error: describeDbError(failure, "The check could not be saved.") };
  }
  revalidatePath("/", "layout");
  redirect(await orgPath(`/accounts/suppliers/${supplier}/checks/${id}`));
}
