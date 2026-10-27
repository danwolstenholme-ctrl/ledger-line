import "server-only";

import { one, sql } from "@/lib/db";
import { getWorkspace } from "@/lib/data/workspace";
import type { Outcome } from "@/lib/domain/business-types";
import { firmToday } from "@/lib/domain/invoices";
import { requireOrg } from "@/lib/org";
import type { CustomerRow } from "@/types/database";

/**
 * Reads for the CRM inside one client company, the one the URL names: its
 * pipeline of enquiries (deals), its jobs, tasks and customers, each in the
 * company's own stages and names (lib/data/workspace).
 */

export type CrmTask = { id: string; title: string; due_on: string | null; priority: string; owner: string; done_at: string | null; enquiry_id: string | null; job_id: string | null; customer_id: string | null; link_kind: "deal" | "job" | "customer" | null; link_label: string | null };
export type CrmDeal = {
  id: string; reference: string; full_name: string; company: string | null; email: string | null; phone: string | null; source: string; channel: string; service: string | null;
  stage_id: string; stage_name: string; outcome: Outcome; stage_position: number; probability: number | null; value: number | null; expected_on: string | null; owner: string; priority: string;
  next_action: string | null; next_action_due: string | null; summary: string | null; lost_reason: string | null; customer_id: string | null; extra: Record<string, unknown>;
  stage_changed_at: string; created_at: string; last_activity: string | null; untouched: boolean;
};
export type CrmJob = {
  id: string; reference: string; title: string; customer_id: string | null; customer_name: string | null; enquiry_id: string | null; owner: string;
  stage_id: string; stage_name: string; outcome: Outcome; stage_position: number; priority: string; value: number | null; starts_on: string | null; due_on: string | null;
  next_action: string | null; next_action_due: string | null; summary: string | null; extra: Record<string, unknown>; opened_on: string; closed_on: string | null; stage_changed_at: string; open_tasks: number;
};
export type CrmActivity = { id: string; kind: string; body: string; actor: string; occurred_at: string };

const TASK_SELECT = `select t.*, case when t.enquiry_id is not null then 'deal' when t.job_id is not null then 'job' when t.customer_id is not null then 'customer' end as link_kind,
  coalesce(nullif(e.company, ''), e.full_name, j.title, c.name) as link_label
  from crm_tasks t left join crm_enquiries e on e.id = t.enquiry_id left join crm_jobs j on j.id = t.job_id left join customers c on c.id = t.customer_id`;
// Untouched: still in the first stage, and nobody has called, written or noted anything since it arrived.
const DEAL_SELECT = `select e.*, s.name as stage_name, s.outcome, s.position as stage_position, s.probability,
  (select max(a.occurred_at) from crm_activities a where a.enquiry_id = e.id) as last_activity,
  (s.outcome = 'open' and s.position = (select min(f.position) from crm_stages f where f.organisation_id = e.organisation_id and f.board = 'deal' and f.outcome = 'open')
    and not exists (select 1 from crm_activities a where a.enquiry_id = e.id and a.occurred_at > e.created_at + interval '1 minute')) as untouched
  from crm_enquiries e join crm_stages s on s.id = e.stage_id`;
const JOB_SELECT = `select j.*, c.name as customer_name, s.name as stage_name, s.outcome, s.position as stage_position,
  (select count(*) from crm_tasks t where t.job_id = j.id and t.done_at is null) as open_tasks
  from crm_jobs j join crm_stages s on s.id = j.stage_id left join customers c on c.id = j.customer_id`;

const deal = (row: CrmDeal): CrmDeal => ({ ...row, stage_position: Number(row.stage_position), probability: row.probability === null ? null : Number(row.probability), extra: row.extra ?? {} });
const job = (row: CrmJob): CrmJob => ({ ...row, stage_position: Number(row.stage_position), open_tasks: Number(row.open_tasks ?? 0), extra: row.extra ?? {} });

export async function getMyWork() {
  const org = await requireOrg();
  const [workspace, tasks, deals, jobs] = await Promise.all([
    getWorkspace(org.id),
    sql<CrmTask>(`${TASK_SELECT} where t.organisation_id = $1 and t.done_at is null order by t.due_on nulls last, t.priority desc`, [org.id]),
    sql<CrmDeal>(`${DEAL_SELECT} where e.organisation_id = $1 and s.outcome = 'open' order by e.next_action_due nulls last limit 8`, [org.id]),
    sql<CrmJob>(`${JOB_SELECT} where j.organisation_id = $1 and s.outcome = 'open' order by j.next_action_due nulls last limit 6`, [org.id]),
  ]);
  return { org, workspace, today: firmToday(), tasks, deals: deals.map(deal), jobs: jobs.map(job) };
}

export async function getPipeline() {
  const org = await requireOrg();
  const [workspace, rows] = await Promise.all([getWorkspace(org.id), sql<CrmDeal>(`${DEAL_SELECT} where e.organisation_id = $1 order by e.stage_changed_at desc`, [org.id])]);
  return { org, workspace, rows: rows.map(deal), today: firmToday() };
}

export async function getDeal(id: string) {
  const org = await requireOrg();
  const found = await one<CrmDeal>(`${DEAL_SELECT} where e.id = $1 and e.organisation_id = $2`, [id, org.id]);
  if (!found) return null;
  const [workspace, activities, tasks, customer, jobs] = await Promise.all([
    getWorkspace(org.id),
    sql<CrmActivity>("select * from crm_activities where enquiry_id = $1 order by occurred_at desc", [id]),
    sql<CrmTask>(`${TASK_SELECT} where t.enquiry_id = $1 order by t.done_at nulls first, t.due_on`, [id]),
    found.customer_id ? one<{ id: string; name: string }>("select id, name from customers where id = $1", [found.customer_id]) : null,
    sql<{ id: string; title: string }>("select id, title from crm_jobs where enquiry_id = $1 order by created_at", [id]),
  ]);
  return { org, workspace, deal: deal(found), activities, tasks, customer, jobs, today: firmToday() };
}

/** The company's jobs. `closedSince`: done and cancelled ones closed on or after it are kept too, for the board's last column. */
export async function getJobs(view: "board" | "open" | "closed" | "all" = "board") {
  const org = await requireOrg();
  const today = firmToday();
  const recent = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const filter = view === "board" ? "and (s.outcome = 'open' or (s.outcome = 'won' and j.closed_on >= $2))" : view === "open" ? "and s.outcome = 'open'" : view === "closed" ? "and s.outcome <> 'open'" : "";
  const [workspace, rows] = await Promise.all([getWorkspace(org.id),
    sql<CrmJob>(`${JOB_SELECT} where j.organisation_id = $1 ${filter} order by s.position, j.due_on nulls last, j.created_at`, view === "board" ? [org.id, recent] : [org.id])]);
  return { org, workspace, rows: rows.map(job), today };
}

export async function getJob(id: string) {
  const org = await requireOrg();
  const found = await one<CrmJob>(`${JOB_SELECT} where j.id = $1 and j.organisation_id = $2`, [id, org.id]);
  if (!found) return null;
  const [workspace, tasks, activities, enquiry] = await Promise.all([
    getWorkspace(org.id),
    sql<CrmTask>(`${TASK_SELECT} where t.job_id = $1 order by t.done_at nulls first, t.due_on`, [id]),
    sql<CrmActivity>("select * from crm_activities where job_id = $1 order by occurred_at desc", [id]),
    found.enquiry_id ? one<{ id: string; full_name: string; reference: string }>("select id, full_name, reference from crm_enquiries where id = $1", [found.enquiry_id]) : null,
  ]);
  return { org, workspace, job: job(found), tasks, activities, enquiry, today: firmToday() };
}

export async function getTasks(view: "open" | "done" | "all") {
  const org = await requireOrg();
  const filter = view === "open" ? "and t.done_at is null" : view === "done" ? "and t.done_at is not null" : "";
  const [workspace, rows] = await Promise.all([getWorkspace(org.id),
    sql<CrmTask>(`${TASK_SELECT} where t.organisation_id = $1 ${filter} order by t.done_at nulls first, t.due_on nulls last`, [org.id])]);
  return { org, workspace, today: firmToday(), rows };
}

export async function getClients(q?: string) {
  const org = await requireOrg();
  const term = q?.trim() ? `%${q.trim()}%` : null;
  const rows = await sql<{ id: string; name: string; vat_number: string | null; country: string; eu_business: boolean; contacts: number; jobs: number; owed: number; overdue: number; last_activity: string | null; people: string | null }>(`
    select c.id, c.name, c.vat_number, c.country, c.eu_business,
           (select count(*) from crm_contacts p where p.customer_id = c.id) as contacts,
           (select count(*) from crm_jobs j join crm_stages s on s.id = j.stage_id where j.customer_id = c.id and s.outcome = 'open') as jobs,
           coalesce((select sum(balance) from v_invoice_directory i where i.customer_id = c.id and i.status in ('issued', 'part_paid')), 0) as owed,
           coalesce((select sum(balance) from v_invoice_directory i where i.customer_id = c.id and i.status in ('issued', 'part_paid') and i.days_overdue > 0), 0) as overdue,
           greatest((select max(issued_on)::timestamptz from invoices i where i.customer_id = c.id), (select max(occurred_at) from crm_activities a where a.customer_id = c.id)) as last_activity,
           (select string_agg(p.name, ', ') from crm_contacts p where p.customer_id = c.id) as people
      from customers c where c.organisation_id = $1 ${term ? "and (c.name ilike $2 or exists (select 1 from crm_contacts p where p.customer_id = c.id and p.name ilike $2))" : ""}
     order by c.name`, term ? [org.id, term] : [org.id]);
  return { org, rows };
}

export async function getClient(id: string) {
  const org = await requireOrg();
  const client = await one<CustomerRow & { extra: Record<string, unknown> }>("select * from customers where id = $1 and organisation_id = $2", [id, org.id]);
  if (!client) return null;
  const [workspace, contacts, jobs, tasks, invoices, activities, enquiries, quotes, creditNotes] = await Promise.all([
    getWorkspace(org.id),
    sql<{ id: string; name: string; role: string | null; email: string | null; phone: string | null }>("select * from crm_contacts where customer_id = $1 order by name", [id]),
    sql<CrmJob>(`${JOB_SELECT} where j.customer_id = $1 order by s.outcome <> 'open', j.next_action_due nulls last`, [id]),
    sql<CrmTask>(`${TASK_SELECT} where t.customer_id = $1 or t.job_id in (select id from crm_jobs where customer_id = $1) order by t.done_at nulls first, t.due_on`, [id]),
    sql<{ id: string; number: string; issued_on: string; due_on: string | null; total: number; balance: number; amount_credited: number; status: string; days_overdue: number }>("select id, number, issued_on, due_on, total, balance, amount_credited, status, days_overdue from v_invoice_directory where customer_id = $1 order by issued_on desc limit 6", [id]),
    sql<CrmActivity>("select * from crm_activities where customer_id = $1 or job_id in (select id from crm_jobs where customer_id = $1) or enquiry_id in (select id from crm_enquiries where customer_id = $1) order by occurred_at desc limit 20", [id]),
    sql<CrmDeal>(`${DEAL_SELECT} where e.customer_id = $1`, [id]),
    sql<{ id: string; number: string; issued_on: string; valid_until: string | null; total: number; status: "draft" | "sent" | "accepted" | "declined"; expired: boolean }>("select id, number, issued_on, valid_until, total, status, expired from v_quote_directory where customer_id = $1 and status in ('draft', 'sent') order by issued_on desc", [id]),
    sql<{ id: string; number: string; issued_on: string; total: number; remaining: number; status: "draft" | "issued" | "void"; invoice_number: string | null }>("select id, number, issued_on, total, remaining, status, invoice_number from v_credit_note_directory where customer_id = $1 order by issued_on desc limit 6", [id]),
  ]);
  // Over every invoice, not only the recent ones listed.
  const [balance, billed] = await Promise.all([
    one<{ owed: number; overdue: number }>("select coalesce(sum(balance), 0) as owed, coalesce(sum(balance) filter (where days_overdue > 0), 0) as overdue from v_invoice_directory where customer_id = $1 and status in ('issued', 'part_paid')", [id]),
    one<{ total: number }>("select coalesce(sum(total), 0) as total from invoices where customer_id = $1 and status in ('issued', 'part_paid', 'paid') and issued_on >= date_trunc('year', current_date)", [id]),
  ]);
  return { org, workspace, client: { ...client, extra: client.extra ?? {} }, contacts, jobs: jobs.map(job), tasks, invoices, activities, enquiries: enquiries.map(deal), quotes, creditNotes,
    unusedCredit: creditNotes.filter(note => note.status === "issued").reduce((sum, note) => sum + Number(note.remaining), 0), owed: Number(balance?.owed ?? 0), overdue: Number(balance?.overdue ?? 0), billedThisYear: Number(billed?.total ?? 0), today: firmToday() };
}

/** Who takes on the company's work: whoever already owns some, and its own people. */
export async function getCrmPeople() {
  const org = await requireOrg();
  const staff = await sql<{ owner: string }>(`select owner from crm_enquiries where organisation_id = $1 union select owner from crm_jobs where organisation_id = $1
    union select u.name from company_members m join app_users u on u.id = m.user_id where m.organisation_id = $1 and m.role in ('owner', 'staff') order by 1`, [org.id]);
  return staff.map(row => row.owner);
}

/** The company's customers, to choose one for a job. */
export async function getCustomerChoices() {
  const org = await requireOrg();
  return sql<{ id: string; name: string }>("select id, name from customers where organisation_id = $1 and is_active order by name", [org.id]);
}
