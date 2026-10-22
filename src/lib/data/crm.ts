import "server-only";

import { one, sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { requireOrg } from "@/lib/org";
import type { CustomerRow } from "@/types/database";

/** Reads for the CRM inside one client company: the one the URL names. */

export type CrmTask = { id: string; title: string; due_on: string | null; priority: string; owner: string; done_at: string | null; enquiry_id: string | null; matter_id: string | null; customer_id: string | null; link_kind: string | null; link_label: string | null };
export type CrmEnquiry = { id: string; reference: string; full_name: string; company: string | null; email: string | null; phone: string | null; source: string; channel: string; untouched?: boolean; service: string | null; stage: string; value: number | null; owner: string; priority: string;
  next_action: string | null; next_action_due: string | null; summary: string | null; lost_reason: string | null; customer_id: string | null; stage_changed_at: string; created_at: string };
export type CrmMatter = { id: string; reference: string; title: string; customer_id: string | null; customer_name: string | null; owner: string; status: string; priority: string; value: number | null; next_action: string | null; next_action_due: string | null; summary: string | null; opened_on: string };
export type CrmActivity = { id: string; kind: string; body: string; actor: string; occurred_at: string };

const TASK_SELECT = `select t.*, case when t.enquiry_id is not null then 'Enquiry' when t.matter_id is not null then 'Matter' when t.customer_id is not null then 'Customer' end as link_kind,
  coalesce(nullif(e.company, ''), e.full_name, m.title, c.name) as link_label
  from crm_tasks t left join crm_enquiries e on e.id = t.enquiry_id left join crm_matters m on m.id = t.matter_id left join customers c on c.id = t.customer_id`;

export async function getMyWork() {
  const org = await requireOrg();
  const [tasks, enquiries, matters] = await Promise.all([
    sql<CrmTask>(`${TASK_SELECT} where t.organisation_id = $1 and t.done_at is null order by t.due_on nulls last, t.priority desc`, [org.id]),
    sql<CrmEnquiry>("select * from crm_enquiries where organisation_id = $1 and stage not in ('won', 'lost') order by next_action_due nulls last limit 8", [org.id]),
    sql<CrmMatter>("select m.*, c.name as customer_name from crm_matters m left join customers c on c.id = m.customer_id where m.organisation_id = $1 and m.status <> 'completed' order by m.next_action_due nulls last limit 6", [org.id]),
  ]);
  return { org, today: firmToday(), tasks, enquiries, matters };
}

export async function getEnquiries() {
  const org = await requireOrg();
  // Untouched: still new, and nobody has called, written or noted anything since it arrived.
  return { org, rows: await sql<CrmEnquiry>(`
    select e.*, (e.stage = 'new' and not exists (
      select 1 from crm_activities a where a.enquiry_id = e.id and a.occurred_at > e.created_at + interval '1 minute')) as untouched
      from crm_enquiries e where e.organisation_id = $1 order by e.stage_changed_at desc`, [org.id]), today: firmToday() };
}

export async function getEnquiry(id: string) {
  const org = await requireOrg();
  const enquiry = await one<CrmEnquiry>("select * from crm_enquiries where id = $1 and organisation_id = $2", [id, org.id]);
  if (!enquiry) return null;
  const [activities, tasks, customer] = await Promise.all([
    sql<CrmActivity>("select * from crm_activities where enquiry_id = $1 order by occurred_at desc", [id]),
    sql<CrmTask>(`${TASK_SELECT} where t.enquiry_id = $1 order by t.done_at nulls first, t.due_on`, [id]),
    enquiry.customer_id ? one<{ id: string; name: string }>("select id, name from customers where id = $1", [enquiry.customer_id]) : null,
  ]);
  return { org, enquiry, activities, tasks, customer, today: firmToday() };
}

export async function getClients(q?: string) {
  const org = await requireOrg();
  const term = q?.trim() ? `%${q.trim()}%` : null;
  const rows = await sql<{ id: string; name: string; vat_number: string | null; country: string; eu_business: boolean; contacts: number; matters: number; owed: number; overdue: number; last_activity: string | null; people: string | null }>(`
    select c.id, c.name, c.vat_number, c.country, c.eu_business,
           (select count(*) from crm_contacts p where p.customer_id = c.id) as contacts,
           (select count(*) from crm_matters m where m.customer_id = c.id and m.status <> 'completed') as matters,
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
  const client = await one<CustomerRow>("select * from customers where id = $1 and organisation_id = $2", [id, org.id]);
  if (!client) return null;
  const [contacts, matters, tasks, invoices, activities, enquiries, quotes, creditNotes] = await Promise.all([
    sql<{ id: string; name: string; role: string | null; email: string | null; phone: string | null }>("select * from crm_contacts where customer_id = $1 order by name", [id]),
    sql<CrmMatter>("select m.*, null as customer_name from crm_matters m where m.customer_id = $1 order by m.status = 'completed', m.next_action_due", [id]),
    sql<CrmTask>(`${TASK_SELECT} where t.customer_id = $1 or t.matter_id in (select id from crm_matters where customer_id = $1) order by t.done_at nulls first, t.due_on`, [id]),
    sql<{ id: string; number: string; issued_on: string; due_on: string | null; total: number; balance: number; amount_credited: number; status: string; days_overdue: number }>("select id, number, issued_on, due_on, total, balance, amount_credited, status, days_overdue from v_invoice_directory where customer_id = $1 order by issued_on desc limit 6", [id]),
    sql<CrmActivity>("select * from crm_activities where customer_id = $1 or matter_id in (select id from crm_matters where customer_id = $1) or enquiry_id in (select id from crm_enquiries where customer_id = $1) order by occurred_at desc limit 20", [id]),
    sql<CrmEnquiry>("select * from crm_enquiries where customer_id = $1", [id]),
    sql<{ id: string; number: string; issued_on: string; valid_until: string | null; total: number; status: "draft" | "sent" | "accepted" | "declined"; expired: boolean }>("select id, number, issued_on, valid_until, total, status, expired from v_quote_directory where customer_id = $1 and status in ('draft', 'sent') order by issued_on desc", [id]),
    sql<{ id: string; number: string; issued_on: string; total: number; remaining: number; status: "draft" | "issued" | "void"; invoice_number: string | null }>("select id, number, issued_on, total, remaining, status, invoice_number from v_credit_note_directory where customer_id = $1 order by issued_on desc limit 6", [id]),
  ]);
  // Over every invoice, not only the recent ones listed.
  const [balance, billed] = await Promise.all([
    one<{ owed: number; overdue: number }>("select coalesce(sum(balance), 0) as owed, coalesce(sum(balance) filter (where days_overdue > 0), 0) as overdue from v_invoice_directory where customer_id = $1 and status in ('issued', 'part_paid')", [id]),
    one<{ total: number }>("select coalesce(sum(total), 0) as total from invoices where customer_id = $1 and status in ('issued', 'part_paid', 'paid') and issued_on >= date_trunc('year', current_date)", [id]),
  ]);
  return { org, client, contacts, matters, tasks, invoices, activities, enquiries, quotes, creditNotes,
    unusedCredit: creditNotes.filter(note => note.status === "issued").reduce((sum, note) => sum + Number(note.remaining), 0), owed: Number(balance?.owed ?? 0), overdue: Number(balance?.overdue ?? 0), billedThisYear: Number(billed?.total ?? 0), today: firmToday() };
}

export async function getMatters() {
  const org = await requireOrg();
  return { org, today: firmToday(), rows: await sql<CrmMatter>("select m.*, c.name as customer_name from crm_matters m left join customers c on c.id = m.customer_id where m.organisation_id = $1 order by m.status = 'completed', m.next_action_due nulls last", [org.id]) };
}

export async function getMatter(id: string) {
  const org = await requireOrg();
  const matter = await one<CrmMatter>("select m.*, c.name as customer_name from crm_matters m left join customers c on c.id = m.customer_id where m.id = $1 and m.organisation_id = $2", [id, org.id]);
  if (!matter) return null;
  const [tasks, activities] = await Promise.all([
    sql<CrmTask>(`${TASK_SELECT} where t.matter_id = $1 order by t.done_at nulls first, t.due_on`, [id]),
    sql<CrmActivity>("select * from crm_activities where matter_id = $1 order by occurred_at desc", [id]),
  ]);
  return { org, matter, tasks, activities, today: firmToday() };
}

export async function getTasks(view: "open" | "done" | "all") {
  const org = await requireOrg();
  const filter = view === "open" ? "and t.done_at is null" : view === "done" ? "and t.done_at is not null" : "";
  return { org, today: firmToday(), rows: await sql<CrmTask>(`${TASK_SELECT} where t.organisation_id = $1 ${filter} order by t.done_at nulls first, t.due_on nulls last`, [org.id]) };
}

export async function getCrmPeople() {
  const org = await requireOrg();
  const staff = await sql<{ owner: string }>("select distinct owner from crm_enquiries where organisation_id = $1 union select distinct owner from crm_matters where organisation_id = $1 order by 1", [org.id]);
  return staff.map(row => row.owner);
}
