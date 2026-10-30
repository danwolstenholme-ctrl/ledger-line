"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { readStyle } from "@/lib/documents/style";
import { orgPath, requireOrg } from "@/lib/org";

/**
 * Writes for how a company's documents look: its logo and language, and its
 * styles (lib/documents/style). One style is always the default; a customer
 * given a style that is removed goes back to the default.
 */

function refresh() { revalidatePath("/", "layout"); }
const fail = (error: unknown, fallback: string): ActionState => {
  const failure = asDbError(error);
  console.error("[document-styles] save failed", failure.code);
  return { ok: false, error: describeDbError(failure, fallback) };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOGO_TYPES: Record<string, (bytes: Buffer) => boolean> = {
  "image/png": bytes => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
};

/** The logo at the head of every document, and the language they are written in (a customer can have its own). */
export async function saveDocumentBasics(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const language = p.enum("document_language", ["en", "el", "en+el"] as const, { label: "Language" }) ?? "en";
  const file = form.get("logo");
  let logo: { type: string; bytes: Buffer } | null = null;
  if (file instanceof File && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (file.size > 1024 * 1024) p.errors.logo = "A logo of 1 MB or less, please.";
    else if (!LOGO_TYPES[file.type]?.(bytes)) p.errors.logo = "A PNG or JPEG image, please.";
    else logo = { type: file.type, bytes };
  }
  if (p.failed) return p.fail();
  try {
    await transaction(async run => {
      await run("update organisations set document_language = $2 where id = $1", [org.id, org.country === "CY" ? language : "en"]);
      if (logo) await run(`insert into organisation_logos (organisation_id, media_type, content) values ($1, $2, $3)
                           on conflict (organisation_id) do update set media_type = excluded.media_type, content = excluded.content, updated_at = now()`, [org.id, logo.type, logo.bytes]);
      if (p.boolean("remove_logo") && !logo) await run("delete from organisation_logos where organisation_id = $1", [org.id]);
    });
  } catch (error) { return fail(error, "The logo and language could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/** A style's name and settings, from the editor. Every setting is read as lib/documents/style reads it, so nothing unknown is kept. */
export async function saveDocumentStyle(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const name = p.text("name", { required: true, max: 60, label: "Name" });
  let settings: unknown = null;
  try { settings = JSON.parse(String(form.get("settings") ?? "")); } catch { p.errors.settings = "The style could not be read. Refresh and try again."; }
  if (!id) p.errors.name = "That style does not exist.";
  if (p.failed || !id || !name) return p.fail();
  try {
    const saved = await one<{ id: string }>("update document_styles set name = $3, settings = $4, updated_at = now() where id = $1 and organisation_id = $2 returning id",
      [id, org.id, name, JSON.stringify(readStyle(settings))]);
    if (!saved) return { ok: false, error: "That style does not exist." };
  } catch (error) {
    if (asDbError(error).code === "23505") return { ok: false, error: null, fieldErrors: { name: "Another style has that name." } };
    return fail(error, "The style could not be saved.");
  }
  refresh();
  return { ok: true, error: null };
}

/** A name not yet taken: "Style 2", or "Standard copy", "Standard copy 2". */
async function freeName(orgId: string, wanted: string) {
  const taken = new Set((await sql<{ name: string }>("select lower(btrim(name)) as name from document_styles where organisation_id = $1", [orgId])).map(row => row.name));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`.toLowerCase())) return `${wanted} ${n}`;
}

/** Another style, starting as a copy of the one named (or the default), opened in the editor. */
export async function addDocumentStyle(form: FormData) {
  const org = await requireOrg();
  const from = String(form.get("from") ?? "");
  const source = await one<{ name: string; settings: unknown }>(
    `select name, settings from document_styles where organisation_id = $1 and ${UUID.test(from) ? "id = $2" : "is_default"} limit 1`, UUID.test(from) ? [org.id, from] : [org.id]);
  const name = await freeName(org.id, source && UUID.test(from) ? `${source.name} copy` : "New style");
  const created = await one<{ id: string }>("insert into document_styles (organisation_id, name, settings) values ($1, $2, $3) returning id",
    [org.id, name, JSON.stringify(readStyle(source?.settings ?? {}))]);
  refresh();
  redirect(await orgPath(`/accounts/settings/documents/${created!.id}`));
}

/** Make a style the one every document takes unless its customer has another. */
export async function makeDefaultDocumentStyle(form: FormData) {
  const org = await requireOrg();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  await transaction(async run => {
    const exists = await run<{ id: string }>("select id from document_styles where id = $1 and organisation_id = $2", [id, org.id]);
    if (!exists.length) return;
    await run("update document_styles set is_default = false where organisation_id = $1 and is_default and id <> $2", [org.id, id]);
    await run("update document_styles set is_default = true, updated_at = now() where id = $1", [id]);
  });
  refresh();
}

/** Remove a style that is not the default. Its customers' documents take the default from now on. */
export async function deleteDocumentStyle(form: FormData) {
  const org = await requireOrg();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  await sql("delete from document_styles where id = $1 and organisation_id = $2 and not is_default", [id, org.id]);
  refresh();
  redirect(await orgPath("/accounts/settings/documents"));
}
