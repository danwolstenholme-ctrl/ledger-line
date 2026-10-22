"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { aiConfigured } from "@/lib/ai/anthropic";
import { suggestMatchesWithAi } from "@/lib/ai/bank-matching";
import { getMatchCandidates } from "@/lib/data/bank";
import { codableAccounts } from "@/lib/domain/accounts";
import type { AiSuggestionState } from "@/lib/domain/bank-statements";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { orgPath, requireOrg } from "@/lib/org";
import { VAT_RATES, type BankMatchItem } from "@/types/database";

/**
 * Writes for bank statements. Each checks the shape of what the browser sent
 * and hands it to the database function for it, which checks everything
 * again, including that a match adds up to its bank line.
 */

function refresh() { revalidatePath("/", "layout"); }
function dbFailure(error: unknown, fallback: string): ActionState {
  const failure = asDbError(error);
  console.error("[bank] save failed", failure.code);
  return { ok: false, error: describeDbError(failure, fallback) };
}
const isId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const isMoney = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && Math.round(value * 100) === Math.round(value * 100 * 1000) / 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readItems(raw: unknown): BankMatchItem[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) return null;
  const items: BankMatchItem[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    if (!entry || typeof entry !== "object") return null;
    switch (entry.kind) {
      case "invoice":
        if (!isId(entry.invoice_id) || !isMoney(entry.amount)) return null;
        items.push({ kind: "invoice", invoice_id: entry.invoice_id, amount: entry.amount });
        break;
      case "bill":
        if (!isId(entry.bill_id) || !isMoney(entry.amount)) return null;
        items.push({ kind: "bill", bill_id: entry.bill_id, amount: entry.amount });
        break;
      case "spend":
      case "receive": {
        if (!Array.isArray(entry.lines) || !entry.lines.length || entry.lines.length > 50) return null;
        const lines = [];
        for (const line of entry.lines as Record<string, unknown>[]) {
          const description = typeof line.description === "string" ? line.description.trim().slice(0, 300) : "";
          const rate = Number(line.vat_rate), net = Number(line.net), vat = Number(line.vat_amount);
          if (!description || !isId(line.account_id) || !Number.isFinite(net) || net <= 0 || !VAT_RATES.includes(rate as (typeof VAT_RATES)[number]) || !Number.isFinite(vat) || vat < 0) return null;
          lines.push({ description, account_id: line.account_id, net: Math.round(net * 100) / 100, vat_rate: rate, vat_amount: Math.round(vat * 100) / 100 });
        }
        items.push({ kind: entry.kind, contact: typeof entry.contact === "string" ? entry.contact.trim().slice(0, 200) || null : null, lines });
        break;
      }
      case "transfer":
        if (!isId(entry.account_id)) return null;
        items.push({ kind: "transfer", account_id: entry.account_id });
        break;
      case "invoice_payment":
      case "bill_payment":
      case "bank_transaction":
        if (!isId(entry.id)) return null;
        items.push({ kind: entry.kind, id: entry.id });
        break;
      default:
        return null;
    }
  }
  return items;
}

export async function importStatement(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireOrg();
  const p = new FormParser(form);
  const bank = p.uuid("bank_account_id");
  const fileName = p.text("file_name", { max: 200, label: "File name" });
  let lines: unknown;
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { lines = null; }
  if (!bank) return { ok: false, error: "Choose the bank account this statement is for." };
  if (!Array.isArray(lines) || !lines.length) return { ok: false, error: "The file has no lines to import." };
  if (lines.length > 5000) return { ok: false, error: "That is more than 5,000 lines. Import the statement a few months at a time." };
  const clean = [];
  for (const [index, raw] of (lines as Record<string, unknown>[]).entries()) {
    const amount = Number(raw.amount);
    if (typeof raw.date !== "string" || !ISO_DATE.test(raw.date) || !Number.isFinite(amount) || amount === 0 || typeof raw.description !== "string" || !raw.description.trim()
      || typeof raw.external_id !== "string" || !raw.external_id) {
      return { ok: false, error: `Line ${index + 1} has no readable date, amount or description.` };
    }
    const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
    const balance = raw.balance === null || raw.balance === undefined || raw.balance === "" ? null : Number(raw.balance);
    clean.push({ date: raw.date, amount: Math.round(amount * 100) / 100, description: raw.description.trim().slice(0, 500), reference: text(raw.reference, 200),
      counterparty: text(raw.counterparty, 200), balance: balance !== null && Number.isFinite(balance) ? balance : null, external_id: raw.external_id.slice(0, 200) });
  }
  const closing = form.get("closing_balance");
  const closingBalance = closing === null || closing === "" ? null : Number(closing);
  let result: { added: number; skipped: number };
  try {
    result = (await one<{ result: { added: number; skipped: number } }>("select import_bank_statement($1, 'file', $2, $3, $4::jsonb) as result",
      [bank, fileName, closingBalance !== null && Number.isFinite(closingBalance) ? closingBalance : null, JSON.stringify(clean)]))!.result;
  } catch (error) { return dbFailure(error, "The statement could not be imported."); }
  refresh();
  redirect(await orgPath(`/accounts/bank/${bank}?imported=${result.added}&skipped=${result.skipped}`));
}

export async function reconcileLine(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireOrg();
  const line = new FormParser(form).uuid("line_id");
  let parsed: unknown;
  try { parsed = JSON.parse(String(form.get("items") ?? "[]")); } catch { parsed = null; }
  const items = readItems(parsed);
  if (!line || !items) return { ok: false, error: "Choose what this bank line was." };
  try { await sql("select reconcile_bank_line($1, $2::jsonb)", [line, JSON.stringify(items)]); } catch (error) { return dbFailure(error, "The line could not be matched."); }
  refresh();
  return { ok: true, error: null };
}

export async function matchConfident(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireOrg();
  let parsed: unknown;
  try { parsed = JSON.parse(String(form.get("matches") ?? "[]")); } catch { parsed = null; }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 200) return { ok: false, error: "There is nothing to match." };
  let matched = 0, failedCount = 0, firstError: string | null = null;
  for (const entry of parsed as { line_id?: unknown; items?: unknown }[]) {
    const items = readItems(entry.items);
    if (!isId(entry.line_id) || !items) { failedCount += 1; continue; }
    try { await sql("select reconcile_bank_line($1, $2::jsonb)", [entry.line_id, JSON.stringify(items)]); matched += 1; }
    catch (error) { failedCount += 1; firstError ??= describeDbError(asDbError(error), "A line could not be matched."); }
  }
  refresh();
  if (!failedCount) return { ok: true, error: null, notice: `Matched ${matched}.` };
  return { ok: matched > 0, error: `${matched} matched; ${failedCount} could not be: ${firstError ?? "check them one by one."}` };
}

export async function unmatchLine(form: FormData): Promise<void> {
  await requireOrg();
  const line = new FormParser(form).uuid("line_id");
  if (!line) return;
  try { await sql("select unmatch_bank_line($1)", [line]); } catch (error) { console.error("[bank] unmatch failed", asDbError(error).code); }
  refresh();
}

export async function setLineExcluded(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireOrg();
  const p = new FormParser(form);
  const line = p.uuid("line_id");
  if (!line) return { ok: false, error: "That line is no longer available." };
  try { await sql("select set_bank_line_excluded($1, $2, $3)", [line, p.boolean("excluded"), p.text("reason", { max: 300, label: "Reason" })]); }
  catch (error) { return dbFailure(error, "The line could not be changed."); }
  refresh();
  return { ok: true, error: null };
}

export async function setLinesAside(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireOrg();
  const reason = new FormParser(form).text("reason", { max: 300, label: "Reason" });
  let ids: unknown;
  try { ids = JSON.parse(String(form.get("line_ids") ?? "[]")); } catch { ids = null; }
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(isId)) return { ok: false, error: "Choose the lines to set aside." };
  let failedCount = 0;
  for (const id of ids as string[]) {
    try { await sql("select set_bank_line_excluded($1, true, $2)", [id, reason]); } catch { failedCount += 1; }
  }
  refresh();
  return failedCount ? { ok: failedCount < ids.length, error: `${failedCount} of ${ids.length} could not be set aside. Try them one by one.` } : { ok: true, error: null };
}

export async function undoImport(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireOrg();
  const id = new FormParser(form).uuid("import_id");
  if (!id) return { ok: false, error: "That import is no longer available." };
  try { await sql("select delete_bank_statement_import($1)", [id]); } catch (error) { return dbFailure(error, "The import could not be undone."); }
  refresh();
  return { ok: true, error: null };
}

export async function suggestWithAi(_previous: AiSuggestionState, form: FormData): Promise<AiSuggestionState> {
  const org = await requireOrg();
  let ids: unknown;
  try { ids = JSON.parse(String(form.get("line_ids") ?? "[]")); } catch { ids = null; }
  if (!Array.isArray(ids) || !ids.length || ids.length > 30 || !ids.every(isId)) return { ok: false, error: "Choose up to 30 lines to ask about." };
  if (!aiConfigured()) return { ok: false, error: "AI is not set up yet. Add ANTHROPIC_API_KEY to .env.local." };
  type Line = { id: string; bank_account_id: string; txn_date: string; amount: number; description: string; reference: string | null; counterparty: string | null; status: string };
  const [lines, accounts] = await Promise.all([
    sql<Line>("select id, bank_account_id, txn_date, amount, description, reference, counterparty, status from v_bank_statement_lines where id = any($1::uuid[]) and organisation_id = $2", [ids, org.id]),
    sql<{ id: string; code: string; name: string; type: string; system_role: string | null; is_active: boolean }>("select id, code, name, type::text, system_role, is_active from ledger_accounts where organisation_id = $1 and is_active order by code", [org.id]),
  ]);
  const open = lines.filter(line => line.status === "unmatched");
  if (!open.length) return { ok: true, error: null, suggestions: {} };
  const bank = accounts.find(account => account.id === open[0].bank_account_id);
  const candidates = await getMatchCandidates();
  const result = await suggestMatchesWithAi({
    bank: `${bank?.name ?? "Bank account"} of ${org.name}`, today: firmToday(),
    lines: open.map(line => ({ id: line.id, date: line.txn_date, amount: Number(line.amount), description: line.description, reference: line.reference, counterparty: line.counterparty })),
    invoices: candidates.invoices, bills: candidates.bills,
    accounts: codableAccounts(accounts as Parameters<typeof codableAccounts>[0], { vat: true }).map(account => ({ id: account.id, code: account.code, name: account.name, type: account.type })),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, error: null, suggestions: result.suggestions };
}

export async function setAiSuggestions(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  try { await sql("update organisations set ai_suggestions = $2 where id = $1", [org.id, new FormParser(form).boolean("enabled")]); }
  catch (error) { return dbFailure(error, "The setting could not be saved."); }
  refresh();
  return { ok: true, error: null };
}
