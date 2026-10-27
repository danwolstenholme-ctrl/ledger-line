"use server";

import { revalidatePath } from "next/cache";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { setUpWorkspace } from "@/lib/db/workspace-setup";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { getWorkspace } from "@/lib/data/workspace";
import { BUSINESS_TYPE_KEYS, FIELD_ENTITIES, FIELD_KINDS, MODULES, fieldKey, type Board } from "@/lib/domain/business-types";
import { getMembership, requireOrg } from "@/lib/org";

/**
 * How a company works: its business type, what it calls things, the parts
 * it uses, its stages and its own fields. Set by its accountant or its
 * owner; the database holds everyone else to reading them.
 */

function refresh() { revalidatePath("/", "layout"); }
const fail = (error: unknown, fallback: string): ActionState => ({ ok: false, error: describeDbError(asDbError(error), fallback) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_ALLOWED: ActionState = { ok: false, error: "Only the company’s owner or its accountant can change how the company works." };

async function setter() {
  const [org, membership] = await Promise.all([requireOrg(), getMembership()]);
  const allowed = membership.practice || membership.companies.some(company => company.slug === org.slug && company.role === "owner");
  return { org, allowed };
}

export async function changeBusinessType(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { org, allowed } = await setter();
  if (!allowed) return NOT_ALLOWED;
  const type = new FormParser(form).enum("business_type", BUSINESS_TYPE_KEYS, { required: true, label: "Business type" });
  if (!type) return { ok: false, error: "Choose the kind of business." };
  try { await transaction(run => setUpWorkspace(run, run, org.id, type, org.country)); }
  catch (error) { return fail(error, "The business type could not be changed."); }
  refresh();
  return { ok: true, error: null };
}

export async function saveNames(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { org, allowed } = await setter();
  if (!allowed) return NOT_ALLOWED;
  const p = new FormParser(form);
  const names = (["customer_one", "customer_many", "deal_one", "deal_many", "job_one", "job_many"] as const).map(name => p.text(name, { required: true, max: 30, label: "Each name" }));
  if (p.failed || names.some(name => !name)) return p.fail("Each name needs a word or two: what one is called, and what several are.");
  try {
    await sql(`insert into workspace_settings (organisation_id, customer_one, customer_many, deal_one, deal_many, job_one, job_many) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (organisation_id) do update set customer_one = $2, customer_many = $3, deal_one = $4, deal_many = $5, job_one = $6, job_many = $7, updated_at = now()`, [org.id, ...names]);
  } catch (error) { return fail(error, "The names could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

export async function saveModules(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { org, allowed } = await setter();
  if (!allowed) return NOT_ALLOWED;
  const modules = MODULES.filter(module => form.get(`module_${module}`) === "on" && (module !== "payroll" || org.country === "CY"));
  try { await sql("update workspace_settings set modules = $2, updated_at = now() where organisation_id = $1", [org.id, modules]); }
  catch (error) { return fail(error, "The parts could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

type StageInput = { id?: string; name: string; probability?: number | null; outcome: "open" | "won" | "lost" };

/**
 * A board's stages as the editor sends them, in order: renamed, reordered,
 * added and removed. The stage that closes a record well and the one that
 * closes it otherwise stay (they can be renamed), and a stage with records
 * in it can't go until they are moved.
 */
export async function saveStages(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { org, allowed } = await setter();
  if (!allowed) return NOT_ALLOWED;
  const board = String(form.get("board") ?? "") as Board;
  if (board !== "deal" && board !== "job") return { ok: false, error: "That board does not exist." };
  let input: StageInput[];
  try { input = JSON.parse(String(form.get("stages") ?? "[]")); } catch { return { ok: false, error: "The stages could not be read. Reload and try again." }; }
  const workspace = await getWorkspace(org.id);
  const existing = workspace.stages[board];
  const stages = input.map(stage => ({ id: stage.id && UUID.test(stage.id) && existing.some(item => item.id === stage.id) ? stage.id : undefined, name: String(stage.name ?? "").trim(),
    probability: board === "deal" && stage.probability !== undefined && stage.probability !== null && String(stage.probability) !== "" ? Math.round(Number(stage.probability)) : null,
    outcome: existing.find(item => item.id === stage.id)?.outcome ?? "open" }));
  const open = stages.filter(stage => stage.outcome === "open");
  const closing = existing.filter(stage => stage.outcome !== "open").map(stage => stages.find(item => item.id === stage.id) ?? { id: stage.id, name: stage.name, probability: null, outcome: stage.outcome });
  if (!open.length) return { ok: false, error: "Keep at least one stage for what is still open." };
  if (open.length > 10) return { ok: false, error: "Ten open stages at most: a longer board is hard to read." };
  if ([...open, ...closing].some(stage => !stage.name || stage.name.length > 40)) return { ok: false, error: "Each stage needs a name of 40 characters or fewer." };
  const names = [...open, ...closing].map(stage => stage.name.toLowerCase());
  if (new Set(names).size !== names.length) return { ok: false, error: "Two stages have the same name." };
  if (open.some(stage => stage.probability !== null && (!Number.isFinite(stage.probability) || stage.probability < 0 || stage.probability > 100))) return { ok: false, error: "A probability is a percentage from 0 to 100." };
  const kept = new Set([...open, ...closing].map(stage => stage.id).filter(Boolean));
  const removed = existing.filter(stage => !kept.has(stage.id));
  try {
    await transaction(async run => {
      for (const stage of removed) {
        const [used] = await run<{ n: number }>(board === "deal" ? "select count(*)::int as n from crm_enquiries where stage_id = $1" : "select count(*)::int as n from crm_jobs where stage_id = $1", [stage.id]);
        if (Number(used?.n)) throw Object.assign(new Error(`crm_stage_in_use: ${used.n} in ${stage.name}`), { code: "23503", stage: stage.name, count: Number(used.n) });
        await run("delete from crm_stages where id = $1 and organisation_id = $2", [stage.id, org.id]);
      }
      // Names are unique on a board: set aside the old ones first, so two can swap.
      for (const stage of existing.filter(item => kept.has(item.id))) await run("update crm_stages set name = $3 where id = $1 and organisation_id = $2", [stage.id, org.id, `~${stage.id}`]);
      for (const [index, stage] of [...open, ...closing].entries()) {
        const probability = board === "deal" ? stage.outcome === "won" ? 100 : stage.outcome === "lost" ? 0 : stage.probability : null;
        if (stage.id) await run("update crm_stages set name = $3, position = $4, probability = $5 where id = $1 and organisation_id = $2", [stage.id, org.id, stage.name, index + 1, probability]);
        else await run("insert into crm_stages (organisation_id, board, name, position, outcome, probability) values ($1, $2, $3, $4, 'open', $5)", [org.id, board, stage.name, index + 1, probability]);
      }
    });
  } catch (error) {
    const inUse = error as { stage?: string; count?: number };
    if (inUse.stage) return { ok: false, error: `${inUse.count} ${inUse.count === 1 ? "is" : "are"} in ${inUse.stage}. Move ${inUse.count === 1 ? "it" : "them"} to another stage first.` };
    return fail(error, "The stages could not be saved.");
  }
  refresh();
  return { ok: true, error: null };
}

/** Add one of the company's own fields, or change one: its name, its choices, and whether it shows on the cards. */
export async function saveField(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { org, allowed } = await setter();
  if (!allowed) return NOT_ALLOWED;
  const p = new FormParser(form);
  const id = p.uuid("id");
  const label = p.text("label", { required: true, max: 60, label: "Name" });
  const kind = id ? null : p.enum("kind", FIELD_KINDS, { required: true, label: "Kind" });
  const entity = id ? null : p.enum("entity", FIELD_ENTITIES, { required: true, label: "Kept on" });
  const options = String(form.get("options") ?? "").split(/\r?\n/).map(option => option.trim()).filter(Boolean).slice(0, 30);
  if (p.failed || !label) return p.fail();
  const current = id ? await one<{ kind: string; entity: string }>("select kind, entity from custom_fields where id = $1 and organisation_id = $2", [id, org.id]) : null;
  if (id && !current) return { ok: false, error: "That field could not be found. Reload and try again." };
  const choice = (current?.kind ?? kind) === "choice";
  if (choice && !options.length) return { ok: false, error: "A choice needs its choices: one on each line.", fieldErrors: { options: "Required" } };
  try {
    if (id) await sql("update custom_fields set label = $3, options = $4, on_card = $5 where id = $1 and organisation_id = $2", [id, org.id, label, choice ? options : [], p.boolean("on_card")]);
    else {
      const taken = await sql<{ id: string; key: string; kind: string; archived_at: string | null }>("select id, key, kind, archived_at from custom_fields where organisation_id = $1 and entity = $2", [org.id, entity]);
      // The same field, put back: what was recorded in it shows again.
      const archived = taken.find(row => row.key === fieldKey(label) && row.archived_at && row.kind === kind);
      if (archived) {
        await sql("update custom_fields set archived_at = null, label = $3, options = $4, on_card = $5 where id = $1 and organisation_id = $2", [archived.id, org.id, label, choice ? options : [], p.boolean("on_card")]);
        refresh();
        return { ok: true, error: null };
      }
      let key = fieldKey(label);
      for (let n = 2; taken.some(row => row.key === key); n++) key = `${fieldKey(label).slice(0, 36)}_${n}`;
      await sql(`insert into custom_fields (organisation_id, entity, key, label, kind, options, position, on_card)
        values ($1, $2, $3, $4, $5, $6, (select coalesce(max(position), 0) + 1 from custom_fields where organisation_id = $1 and entity = $2), $7)`,
        [org.id, entity, key, label, kind, choice ? options : [], p.boolean("on_card")]);
    }
  } catch (error) { return fail(error, "The field could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/** Stop showing a field. What was recorded in it is kept, and comes back if it is added again under the same name. */
export async function archiveField(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { org, allowed } = await setter();
  if (!allowed) return NOT_ALLOWED;
  const id = new FormParser(form).uuid("id");
  if (!id) return { ok: false, error: "That field could not be found." };
  try { await sql("update custom_fields set archived_at = now() where id = $1 and organisation_id = $2", [id, org.id]); }
  catch (error) { return fail(error, "The field could not be removed."); }
  refresh();
  return { ok: true, error: null };
}
