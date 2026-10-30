"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { getWorkspace } from "@/lib/data/workspace";
import { newFormToken, nextWorkingDay, recordEnquiry } from "@/lib/crm/intake";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import type { MoveState } from "@/lib/actions/state";
import { businessType, fieldsFor, readFieldValue, uses, type Field, type FieldEntity, type Workspace } from "@/lib/domain/business-types";
import { PRIORITIES } from "@/lib/domain/crm";
import { firmToday, validRecordDate } from "@/lib/domain/invoices";
import { getCurrentUser, requireOrg } from "@/lib/org";

/** Writes for the CRM inside one client company. The company comes from the URL, never the form. */

function refresh() { revalidatePath("/", "layout"); }
const fail = (error: unknown, fallback: string): ActionState => ({ ok: false, error: describeDbError(asDbError(error), fallback) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

/**
 * The company's own details typed into a form, checked against its fields.
 * Each is named x_<key>; `extra_fields` lists those the form showed, so a
 * yes-or-no left unticked reads as no and a field not on the form is kept.
 */
function readExtra(p: FormParser, form: FormData, fields: Field[], current: Record<string, unknown> = {}) {
  const shown = new Set(String(form.get("extra_fields") ?? "").split(",").filter(Boolean));
  const extra: Record<string, unknown> = { ...current };
  for (const field of fields.filter(item => shown.has(item.key))) {
    const raw = form.get(`x_${field.key}`);
    const read = readFieldValue(field.kind, typeof raw === "string" ? raw : "", field.options);
    if ("error" in read) p.errors[`x_${field.key}`] = `${field.label} ${read.error}.`;
    else if (read.value === null) delete extra[field.key];
    else extra[field.key] = read.value;
  }
  return extra;
}
const fieldsOf = (workspace: Workspace, entity: FieldEntity) => fieldsFor(workspace, entity);
function day(p: FormParser, name: string, label: string) {
  const value = p.text(name, { max: 10, label });
  if (value && !validRecordDate(value)) p.errors[name] = `${label} is not a valid date.`;
  return value;
}

// ---------------------------------------------------------------------------
// Tasks, notes and next actions: on a deal, a job or a customer
// ---------------------------------------------------------------------------

export async function addTask(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const title = p.text("title", { required: true, max: 300, label: "To-do" });
  if (!title) return { ok: false, error: "Write the to-do first." };
  const due = p.text("due_on", { max: 10 }) || firmToday();
  const priority = p.enum("priority", PRIORITIES, { fallback: "normal" }) ?? "normal";
  const user = await getCurrentUser();
  try {
    await sql("insert into crm_tasks (organisation_id, title, due_on, priority, owner, enquiry_id, job_id, customer_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [org.id, title, due, priority, p.text("owner", { max: 120 }) ?? user.name, p.uuid("enquiry_id"), p.uuid("job_id"), p.uuid("customer_id")]);
  } catch (error) { return fail(error, "The to-do could not be added."); }
  refresh();
  return { ok: true, error: null };
}

export async function toggleTask(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  await sql("update crm_tasks set done_at = case when done_at is null then now() end where id = $1 and organisation_id = $2", [id, org.id]);
  refresh();
}

export async function addActivity(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const body = p.text("body", { required: true, max: 2000, label: "Note" });
  const kind = p.enum("kind", ["note", "call", "email", "meeting"] as const, { fallback: "note" }) ?? "note";
  if (!body) return { ok: false, error: "Write the note first." };
  const user = await getCurrentUser();
  try {
    await sql("insert into crm_activities (organisation_id, enquiry_id, job_id, customer_id, kind, body, actor) values ($1, $2, $3, $4, $5, $6, $7)",
      [org.id, p.uuid("enquiry_id"), p.uuid("job_id"), p.uuid("customer_id"), kind, body, user.name]);
  } catch (error) { return fail(error, "The note could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

export async function setNextAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const action = p.text("next_action", { max: 300 }), due = p.text("next_action_due", { max: 10 });
  if (due && !action) return { ok: false, error: "A follow-up date needs a next action." };
  const enquiry = p.uuid("enquiry_id"), job = p.uuid("job_id");
  try {
    if (enquiry) await sql("update crm_enquiries set next_action = $3, next_action_due = $4 where id = $1 and organisation_id = $2", [enquiry, org.id, action, due || null]);
    if (job) await sql("update crm_jobs set next_action = $3, next_action_due = $4 where id = $1 and organisation_id = $2", [job, org.id, action, due || null]);
  } catch (error) { return fail(error, "The next action could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// The pipeline: enquiries (deals) through the company's own stages
// ---------------------------------------------------------------------------

export async function createEnquiry(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const workspace = await getWorkspace(org.id);
  const p = new FormParser(form);
  const name = p.text("full_name", { required: true, max: 200, label: "Name" });
  const company = p.text("company", { max: 200 }), service = p.text("service", { max: 300 }), source = p.text("source", { max: 60 }) ?? "Website";
  const value = p.money("value", "Value"), expected = day(p, "expected_on", "Expected");
  const extra = readExtra(p, form, fieldsOf(workspace, "deal"));
  if (p.failed || !name) return p.fail();
  const user = await getCurrentUser();
  let id: string;
  try {
    id = (await recordEnquiry(org, { name, company, email: p.email("email"), phone: p.text("phone", { max: 40 }), service, message: p.text("summary", { max: 2000 }), source, value }, "manual", user.name)).id;
    if (expected || Object.keys(extra).length) await sql("update crm_enquiries set expected_on = $3, extra = $4 where id = $1 and organisation_id = $2", [id, org.id, expected, JSON.stringify(extra)]);
  } catch (error) { return fail(error, "It could not be saved."); }
  refresh();
  redirect(`/c/${org.slug}/crm/pipeline/${id}`);
}

/** The deal's details as they are now: who, what, how much, when it is expected, and the company's own details. */
export async function saveDeal(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const workspace = await getWorkspace(org.id);
  const p = new FormParser(form);
  const id = p.uuid("id");
  const name = p.text("full_name", { required: true, max: 200, label: "Name" });
  const current = id ? await one<{ extra: Record<string, unknown> }>("select extra from crm_enquiries where id = $1 and organisation_id = $2", [id, org.id]) : null;
  if (!id || !current) return { ok: false, error: "That could not be found. Reload and try again." };
  const value = p.money("value", "Value"), expected = day(p, "expected_on", "Expected");
  const priority = p.enum("priority", PRIORITIES, { fallback: "normal" }) ?? "normal";
  const extra = readExtra(p, form, fieldsOf(workspace, "deal"), current.extra ?? {});
  if (p.failed || !name) return p.fail();
  try {
    await sql(`update crm_enquiries set full_name = $3, company = $4, email = $5, phone = $6, service = $7, value = $8, expected_on = $9, owner = coalesce($10, owner), priority = $11,
      source = coalesce($12, source), summary = $13, extra = $14 where id = $1 and organisation_id = $2`,
      [id, org.id, name, p.text("company", { max: 200 }), p.email("email"), p.text("phone", { max: 40 }), p.text("service", { max: 300 }), value, expected,
        p.text("owner", { max: 120 }), priority, p.text("source", { max: 60 }), p.text("summary", { max: 2000 }), JSON.stringify(extra)]);
  } catch (error) { return fail(error, "The details could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/**
 * Won: the enquiry's customer in the books (made from it if it has none),
 * and, where the company uses jobs, its first job with its first to-do.
 * Details the deal and the job both keep (a vessel, a site address) go with it.
 */
async function convert(orgId: string, dealId: string, actor: string, workspace: Workspace) {
  return transaction(async run => {
    const [deal] = await run<{ id: string; reference: string; full_name: string; company: string | null; email: string | null; phone: string | null; service: string | null; value: number | null;
      owner: string; customer_id: string | null; summary: string | null; extra: Record<string, unknown> }>("select * from crm_enquiries where id = $1 and organisation_id = $2", [dealId, orgId]);
    if (!deal) throw Object.assign(new Error("crm_missing"), { code: "P0002" });
    // A company that neither quotes nor does jobs (a holding company's investments) isn't selling to its pipeline: a win just closes it.
    const sells = uses(workspace, "quotes") || uses(workspace, "jobs");
    let customer = deal.customer_id;
    if (!customer && sells) {
      const [sales] = await run<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [orgId]);
      customer = (await run<{ id: string }>("insert into customers (organisation_id, name, email, phone, country, default_account_id) values ($1, $2, $3, $4, (select country from organisations where id = $1), $5) returning id",
        [orgId, deal.company || deal.full_name, deal.email, deal.phone, sales?.id ?? null]))[0].id;
      if (deal.company) await run("insert into crm_contacts (organisation_id, customer_id, name, email, phone, role) values ($1, $2, $3, $4, $5, 'Main contact')", [orgId, customer, deal.full_name, deal.email, deal.phone]);
    }
    let job: { id: string; reference: string } | null = null;
    const [existing] = await run<{ id: string; reference: string }>("select id, reference from crm_jobs where enquiry_id = $1 limit 1", [dealId]);
    if (existing) job = existing;
    else if (uses(workspace, "jobs")) {
      const shared = Object.fromEntries(Object.entries(deal.extra ?? {}).filter(([key]) => fieldsFor(workspace, "job").some(field => field.key === key)));
      const [next] = await run<{ n: number }>("select coalesce(max(reference::int) filter (where reference ~ '^[0-9]{1,9}$'), 100) + 1 as n from crm_jobs where organisation_id = $1", [orgId]);
      job = (await run<{ id: string; reference: string }>(`insert into crm_jobs (organisation_id, reference, title, customer_id, enquiry_id, owner, value, summary, extra)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, reference`,
        [orgId, String(next.n), deal.service || `For ${deal.company || deal.full_name}`, customer, dealId, deal.owner, deal.value, deal.summary, JSON.stringify(shared)]))[0];
      await run("insert into crm_tasks (organisation_id, title, due_on, priority, owner, job_id) values ($1, $2, $3, 'normal', $4, $5)",
        [orgId, businessType(workspace.typeKey).firstTask, nextWorkingDay(firmToday()), deal.owner, job.id]);
      await run("insert into crm_activities (organisation_id, job_id, customer_id, kind, body, actor) values ($1, $2, $3, 'note', $4, $5)",
        [orgId, job.id, customer, `Opened from ${lower(workspace.labels.deal[0])} ${deal.reference}.`, actor]);
    }
    const [won] = await run<{ id: string; name: string }>("select id, name from crm_stages where organisation_id = $1 and board = 'deal' and outcome = 'won'", [orgId]);
    await run("update crm_enquiries set stage_id = $3, customer_id = $4, next_action = null, next_action_due = null where id = $1 and organisation_id = $2", [dealId, orgId, won.id, customer]);
    await run("insert into crm_activities (organisation_id, enquiry_id, customer_id, kind, body, actor) values ($1, $2, $3, 'won', $4, $5)",
      [orgId, dealId, customer, customer ? `${won.name}: set up as a ${lower(workspace.labels.customer[0])}${job ? `, with ${lower(workspace.labels.job[0])} #${job.reference}` : ""}.` : `${won.name}.`, actor]);
    return { customer, job };
  });
}

/** A deal into one of the company's deal stages: the board's drag and drop, and the stage form. Won sets it up; lost needs its reason. */
export async function moveDeal(id: string, stageId: string, lostReason?: string): Promise<MoveState> {
  const org = await requireOrg();
  if (!UUID.test(id) || !UUID.test(stageId)) return { ok: false, error: "Choose a stage." };
  const [workspace, user] = await Promise.all([getWorkspace(org.id), getCurrentUser()]);
  const stage = workspace.stages.deal.find(item => item.id === stageId);
  if (!stage) return { ok: false, error: "That stage is not one of this company's." };
  const reason = lostReason?.trim().slice(0, 300) ?? "";
  if (stage.outcome === "lost" && !reason) return { ok: false, error: "Say why it was lost.", fieldErrors: { lost_reason: "Required" } };
  try {
    // In the practice's own pipeline, a win is taken on as a client from the enquiry: its client file, not a customer here.
    if (stage.outcome === "won" && !org.is_practice) {
      const { customer, job } = await convert(org.id, id, user.name, workspace);
      refresh();
      if (!customer) return { ok: true, error: null, notice: `${stage.name}.` };
      return job ? { ok: true, error: null, notice: `Won, and set up as a ${lower(workspace.labels.customer[0])}.`, href: `/c/${org.slug}/crm/jobs/${job.id}`, hrefLabel: `Open ${lower(workspace.labels.job[0])} #${job.reference}` }
        : { ok: true, error: null, notice: `Won, and set up as a ${lower(workspace.labels.customer[0])}.`, href: `/c/${org.slug}/customers/${customer}`, hrefLabel: `Open the ${lower(workspace.labels.customer[0])}` };
    }
    await transaction(async run => {
      await run(`update crm_enquiries set stage_id = $3, lost_reason = $4, next_action = case when $5 then null else next_action end, next_action_due = case when $5 then null else next_action_due end
        where id = $1 and organisation_id = $2`, [id, org.id, stage.id, stage.outcome === "lost" ? reason : null, stage.outcome !== "open"]);
      await run("insert into crm_activities (organisation_id, enquiry_id, kind, body, actor) values ($1, $2, $3, $4, $5)",
        [org.id, id, stage.outcome === "won" ? "won" : "stage", `Moved to ${stage.name}${stage.outcome === "lost" ? `: ${reason}` : ""}.`, user.name]);
    });
  } catch (error) { return fail(error, "The stage could not be changed."); }
  refresh();
  return { ok: true, error: null, ...(stage.outcome === "won" && org.is_practice ? { href: `/c/${org.slug}/crm/pipeline/${id}`, hrefLabel: "Take them on as a client" } : {}) };
}

export async function setDealStage(_previous: ActionState, form: FormData): Promise<ActionState> {
  return moveDeal(String(form.get("id") ?? ""), String(form.get("stage_id") ?? ""), String(form.get("lost_reason") ?? ""));
}

/** "Mark as won" on the deal's page: set up, then straight to the job (or the customer). */
export async function winDeal(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  const [workspace, user] = await Promise.all([getWorkspace(org.id), getCurrentUser()]);
  const { customer, job } = await convert(org.id, id, user.name, workspace);
  refresh();
  redirect(job ? `/c/${org.slug}/crm/jobs/${job.id}` : customer ? `/c/${org.slug}/customers/${customer}` : `/c/${org.slug}/crm/pipeline/${id}`);
}

// ---------------------------------------------------------------------------
// Jobs: the work done for customers, through the company's own stages
// ---------------------------------------------------------------------------

function readJob(p: FormParser, form: FormData, workspace: Workspace, current: Record<string, unknown> = {}) {
  const title = p.text("title", { required: true, max: 200, label: "Title" });
  const starts = day(p, "starts_on", "Start"), due = day(p, "due_on", "Due");
  if (starts && due && due < starts) p.errors.due_on = "The due date can’t be before the start.";
  return {
    title, customer: p.uuid("customer_id"), owner: p.text("owner", { max: 120 }), value: p.money("value", "Value"), starts, due,
    priority: p.enum("priority", PRIORITIES, { fallback: "normal" }) ?? "normal", summary: p.text("summary", { max: 2000 }),
    extra: readExtra(p, form, fieldsOf(workspace, "job"), current),
  };
}

export async function createJob(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const [workspace, user] = await Promise.all([getWorkspace(org.id), getCurrentUser()]);
  const p = new FormParser(form);
  const job = readJob(p, form, workspace);
  if (p.failed || !job.title) return p.fail();
  let id: string;
  try {
    id = await transaction(async run => {
      const [next] = await run<{ n: number }>("select coalesce(max(reference::int) filter (where reference ~ '^[0-9]{1,9}$'), 100) + 1 as n from crm_jobs where organisation_id = $1", [org.id]);
      const [made] = await run<{ id: string }>(`insert into crm_jobs (organisation_id, reference, title, customer_id, owner, value, starts_on, due_on, priority, summary, extra)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [org.id, String(next.n), job.title, job.customer, job.owner ?? user.name, job.value, job.starts, job.due, job.priority, job.summary, JSON.stringify(job.extra)]);
      await run("insert into crm_tasks (organisation_id, title, due_on, priority, owner, job_id) values ($1, $2, $3, 'normal', $4, $5)",
        [org.id, businessType(workspace.typeKey).firstTask, nextWorkingDay(firmToday()), job.owner ?? user.name, made.id]);
      await run("insert into crm_activities (organisation_id, job_id, customer_id, kind, body, actor) values ($1, $2, $3, 'note', 'Opened.', $4)", [org.id, made.id, job.customer, user.name]);
      return made.id;
    });
  } catch (error) { return fail(error, "It could not be saved."); }
  refresh();
  redirect(`/c/${org.slug}/crm/jobs/${id}`);
}

export async function saveJob(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const workspace = await getWorkspace(org.id);
  const p = new FormParser(form);
  const id = p.uuid("id");
  const current = id ? await one<{ extra: Record<string, unknown> }>("select extra from crm_jobs where id = $1 and organisation_id = $2", [id, org.id]) : null;
  if (!id || !current) return { ok: false, error: "That could not be found. Reload and try again." };
  const job = readJob(p, form, workspace, current.extra ?? {});
  if (p.failed || !job.title) return p.fail();
  try {
    await sql(`update crm_jobs set title = $3, customer_id = $4, owner = coalesce($5, owner), value = $6, starts_on = $7, due_on = $8, priority = $9, summary = $10, extra = $11
      where id = $1 and organisation_id = $2`, [id, org.id, job.title, job.customer, job.owner, job.value, job.starts, job.due, job.priority, job.summary, JSON.stringify(job.extra)]);
  } catch (error) { return fail(error, "The details could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/** A job into one of the company's job stages: the board's drag and drop, and the stage form. */
export async function moveJob(id: string, stageId: string): Promise<MoveState> {
  const org = await requireOrg();
  if (!UUID.test(id) || !UUID.test(stageId)) return { ok: false, error: "Choose a stage." };
  const [workspace, user] = await Promise.all([getWorkspace(org.id), getCurrentUser()]);
  const stage = workspace.stages.job.find(item => item.id === stageId);
  if (!stage) return { ok: false, error: "That stage is not one of this company's." };
  try {
    await transaction(async run => {
      const moved = await run("update crm_jobs set stage_id = $3 where id = $1 and organisation_id = $2 and stage_id <> $3 returning id", [id, org.id, stage.id]);
      if (moved.length) await run("insert into crm_activities (organisation_id, job_id, kind, body, actor) values ($1, $2, 'stage', $3, $4)", [org.id, id, `Moved to ${stage.name}.`, user.name]);
    });
  } catch (error) { return fail(error, "The stage could not be changed."); }
  refresh();
  return { ok: true, error: null };
}

export async function setJobStage(_previous: ActionState, form: FormData): Promise<ActionState> {
  return moveJob(String(form.get("id") ?? ""), String(form.get("stage_id") ?? ""));
}

// ---------------------------------------------------------------------------
// A customer's own details, and the website form
// ---------------------------------------------------------------------------

export async function saveCustomerExtra(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const workspace = await getWorkspace(org.id);
  const p = new FormParser(form);
  const id = p.uuid("customer_id");
  const current = id ? await one<{ extra: Record<string, unknown> }>("select extra from customers where id = $1 and organisation_id = $2", [id, org.id]) : null;
  if (!id || !current) return { ok: false, error: "That could not be found. Reload and try again." };
  const extra = readExtra(p, form, fieldsOf(workspace, "customer"), current.extra ?? {});
  if (p.failed) return p.fail();
  try { await sql("update customers set extra = $3 where id = $1 and organisation_id = $2", [id, org.id, JSON.stringify(extra)]); }
  catch (error) { return fail(error, "The details could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/** A new website form key: the old one stops working at once, so a key that has leaked into the wrong hands is dealt with in one press. */
export async function issueFormKey(_previous: ActionState, _form: FormData): Promise<ActionState> {
  void _form;
  const org = await requireOrg();
  try {
    await transaction(async run => {
      await run("update enquiry_form_keys set revoked_at = now() where organisation_id = $1 and revoked_at is null", [org.id]);
      await run("insert into enquiry_form_keys (organisation_id, token) values ($1, $2)", [org.id, newFormToken()]);
    });
  } catch (error) { return fail(error, "A new key could not be made."); }
  refresh();
  return { ok: true, error: null };
}

export async function turnOffFormKey(_previous: ActionState, _form: FormData): Promise<ActionState> {
  void _form;
  const org = await requireOrg();
  try { await sql("update enquiry_form_keys set revoked_at = now() where organisation_id = $1 and revoked_at is null", [org.id]); }
  catch (error) { return fail(error, "The form could not be turned off."); }
  refresh();
  return { ok: true, error: null };
}
