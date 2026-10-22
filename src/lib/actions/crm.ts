"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { newFormToken, recordEnquiry } from "@/lib/crm/intake";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { CRM_STAGES, PRIORITIES, stageOf } from "@/lib/domain/crm";
import { getDemoUser, requireOrg } from "@/lib/org";

/** Writes for the CRM inside one client company. The org comes from the URL, never the form. */

function refresh() { revalidatePath("/", "layout"); }
const fail = (error: unknown, fallback: string): ActionState => ({ ok: false, error: describeDbError(asDbError(error), fallback) });

export async function addTask(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const title = p.text("title", { required: true, max: 300, label: "To-do" });
  if (!title) return { ok: false, error: "Write the to-do first." };
  const due = p.text("due_on", { max: 10 }) || new Date().toISOString().slice(0, 10);
  const priority = p.enum("priority", PRIORITIES, { fallback: "normal" }) ?? "normal";
  const user = await getDemoUser();
  try {
    await sql("insert into crm_tasks (organisation_id, title, due_on, priority, owner, enquiry_id, matter_id, customer_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [org.id, title, due, priority, p.text("owner", { max: 120 }) ?? user.name, p.uuid("enquiry_id"), p.uuid("matter_id"), p.uuid("customer_id")]);
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

export async function setEnquiryStage(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const stage = p.enum("stage", CRM_STAGES.map(item => item.key), { required: true, label: "Stage" });
  const reason = p.text("lost_reason", { max: 300, label: "Reason" });
  if (!id || !stage) return { ok: false, error: "Choose a stage." };
  if (stage === "lost" && !reason) return { ok: false, error: "Say why it was lost: an enquiry cannot be lost without a reason.", fieldErrors: { lost_reason: "Required" } };
  const user = await getDemoUser();
  try {
    await sql("update crm_enquiries set stage = $3, lost_reason = $4, stage_changed_at = now() where id = $1 and organisation_id = $2", [id, org.id, stage, stage === "lost" ? reason : null]);
    await sql("insert into crm_activities (organisation_id, enquiry_id, kind, body, actor) values ($1, $2, 'stage', $3, $4)", [org.id, id, `Moved to ${stageOf(stage).label}${stage === "lost" ? `: ${reason}` : ""}.`, user.name]);
  } catch (error) { return fail(error, "The stage could not be changed."); }
  refresh();
  return { ok: true, error: null };
}

export async function addActivity(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const body = p.text("body", { required: true, max: 2000, label: "Note" });
  const kind = p.enum("kind", ["note", "call", "email", "meeting"] as const, { fallback: "note" }) ?? "note";
  if (!body) return { ok: false, error: "Write the note first." };
  const user = await getDemoUser();
  try {
    await sql("insert into crm_activities (organisation_id, enquiry_id, matter_id, customer_id, kind, body, actor) values ($1, $2, $3, $4, $5, $6, $7)",
      [org.id, p.uuid("enquiry_id"), p.uuid("matter_id"), p.uuid("customer_id"), kind, body, user.name]);
  } catch (error) { return fail(error, "The note could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

export async function setNextAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const action = p.text("next_action", { max: 300 }), due = p.text("next_action_due", { max: 10 });
  if (due && !action) return { ok: false, error: "A follow-up date needs a next action." };
  const enquiry = p.uuid("enquiry_id"), matter = p.uuid("matter_id");
  try {
    if (enquiry) await sql("update crm_enquiries set next_action = $3, next_action_due = $4 where id = $1 and organisation_id = $2", [enquiry, org.id, action, due || null]);
    if (matter) await sql("update crm_matters set next_action = $3, next_action_due = $4 where id = $1 and organisation_id = $2", [matter, org.id, action, due || null]);
  } catch (error) { return fail(error, "The next action could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

export async function createEnquiry(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const name = p.text("full_name", { required: true, max: 200, label: "Name" });
  const company = p.text("company", { max: 200 }), service = p.text("service", { max: 300 }), source = p.text("source", { max: 60 }) ?? "Website";
  const value = p.money("value", "Value");
  if (p.failed || !name) return p.fail();
  const user = await getDemoUser();
  let id: string;
  try {
    id = (await recordEnquiry(org, { name, company, email: p.email("email"), phone: p.text("phone", { max: 40 }), service, message: p.text("summary", { max: 2000 }), source, value }, "manual", user.name)).id;
  } catch (error) { return fail(error, "The enquiry could not be saved."); }
  refresh();
  redirect(`/c/${org.slug}/crm/enquiries/${id}`);
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

/** Won: the enquiry becomes a customer in this company's books, with its first matter. */
export async function convertEnquiry(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  const enquiry = id ? await one<{ id: string; full_name: string; company: string | null; email: string | null; service: string | null; value: number | null; owner: string; customer_id: string | null }>("select * from crm_enquiries where id = $1 and organisation_id = $2", [id, org.id]) : null;
  if (!enquiry) return;
  const user = await getDemoUser();
  let customer = enquiry.customer_id;
  if (!customer) {
    const sales = await one<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [org.id]);
    customer = (await one<{ id: string }>("insert into customers (organisation_id, name, email, default_account_id) values ($1, $2, $3, $4) returning id", [org.id, enquiry.company || enquiry.full_name, enquiry.email, sales?.id ?? null]))!.id;
    await sql("insert into crm_contacts (organisation_id, customer_id, name, email, role) values ($1, $2, $3, $4, 'Main contact')", [org.id, customer, enquiry.full_name, enquiry.email]);
    const count = await one<{ count: number }>("select count(*) as count from crm_matters where organisation_id = $1", [org.id]);
    const prefix = org.slug.split("-").map(part => part[0]).join("").toUpperCase();
    await sql("insert into crm_matters (organisation_id, reference, title, customer_id, enquiry_id, owner, value, next_action, next_action_due, summary) values ($1, $2, $3, $4, $5, $6, $7, 'Send the engagement letter', current_date + 2, $8)",
      [org.id, `${prefix}-M-${101 + Number(count?.count ?? 0)}`, enquiry.service ?? "New work", customer, enquiry.id, enquiry.owner, enquiry.value, `Opened from enquiry: ${enquiry.service ?? ""}`]);
  }
  await sql("update crm_enquiries set stage = 'won', customer_id = $3, stage_changed_at = now(), next_action = null, next_action_due = null where id = $1 and organisation_id = $2", [enquiry.id, org.id, customer]);
  await sql("insert into crm_activities (organisation_id, enquiry_id, customer_id, kind, body, actor) values ($1, $2, $3, 'won', 'Won: set up as a customer, with its first matter. Invoices can now be raised to it.', $4)", [org.id, enquiry.id, customer, user.name]);
  refresh();
  redirect(`/c/${org.slug}/customers/${customer}`);
}
