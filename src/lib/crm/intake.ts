import "server-only";

import { randomInt } from "node:crypto";

import { one, transaction } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import type { OrganisationRow } from "@/types/database";

/**
 * How an enquiry gets into a company's pipeline, whoever sends it: someone
 * typing it in, the company's website form, or another site posting to the
 * API. Every one arrives the same way: a reference, the person with the
 * fewest open enquiries as its owner, a call-back task due the next working
 * day, and a line in its activity saying where it came from.
 */

export type EnquiryChannel = "manual" | "form" | "api";
export type EnquiryInput = {
  name: string; company: string | null; email: string | null; phone: string | null;
  service: string | null; message: string | null; source: string; value?: number | null;
};
export type RecordedEnquiry = { id: string; reference: string; owner: string; next_action: string; next_action_due: string };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function newFormToken() {
  return `ll_form_${Array.from({ length: 24 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
}
export const FORM_TOKEN_PATTERN = /^ll_form_[A-Za-z0-9]{24}$/;

/** The next day a person is in the office: Saturday and Sunday roll on to Monday. */
export function nextWorkingDay(from: string) {
  const date = new Date(`${from}T12:00:00Z`);
  do date.setUTCDate(date.getUTCDate() + 1); while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

const prefixOf = (slug: string) => slug.split("-").map(part => part[0]).join("").toUpperCase();

export async function recordEnquiry(org: Pick<OrganisationRow, "id" | "slug">, input: EnquiryInput, channel: EnquiryChannel, actor: string): Promise<RecordedEnquiry> {
  const today = firmToday();
  const due = nextWorkingDay(today);
  const first = input.name.split(/\s+/)[0];
  const nextAction = `Call ${first} back`;
  const year = today.slice(0, 4);
  const prefix = `${prefixOf(org.slug)}-${year}-`;
  return transaction(async run => {
    // Whoever has the fewest open enquiries takes the next one; the people are those who already own the company's work.
    const [owner] = await run<{ owner: string }>(`
      with people as (select owner from crm_enquiries where organisation_id = $1 union select owner from crm_matters where organisation_id = $1)
      select p.owner, (select count(*) from crm_enquiries e where e.organisation_id = $1 and e.owner = p.owner and e.stage not in ('won', 'lost')) as open
        from people p order by open, p.owner limit 1`, [org.id]);
    const ownerName = owner?.owner ?? actor;
    const [last] = await run<{ n: number | null }>("select max(substring(reference from '(\\d+)$')::int) as n from crm_enquiries where organisation_id = $1 and reference like $2", [org.id, `${prefix}%`]);
    const reference = `${prefix}${String((last?.n ?? 0) + 1).padStart(4, "0")}`;
    const [row] = await run<{ id: string }>(`
      insert into crm_enquiries (organisation_id, reference, full_name, company, email, phone, source, channel, service, value, owner, next_action, next_action_due, summary)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
      [org.id, reference, input.name, input.company, input.email, input.phone, input.source, channel, input.service, input.value ?? null, ownerName, nextAction, due, input.message]);
    const said = channel === "form" ? "Sent from the website form" : channel === "api" ? "Posted to the enquiries API" : "Enquiry recorded";
    await run("insert into crm_activities (organisation_id, enquiry_id, kind, body, actor) values ($1, $2, $3, $4, $5)",
      [org.id, row.id, channel === "manual" ? "note" : "email", `${said}${input.service ? `: ${input.service}` : ""}.${input.message ? `\n\n“${input.message}”` : ""}`, channel === "manual" ? actor : input.name]);
    await run("insert into crm_tasks (organisation_id, title, due_on, priority, owner, enquiry_id) values ($1, $2, $3, 'normal', $4, $5)",
      [org.id, `${nextAction}${input.company ? ` (${input.company})` : ""}`, due, ownerName, row.id]);
    return { id: row.id, reference, owner: ownerName, next_action: nextAction, next_action_due: due };
  });
}

/** The company a form key belongs to, while the key is live. */
export async function companyForToken(token: string) {
  if (!FORM_TOKEN_PATTERN.test(token)) return null;
  return one<OrganisationRow & { key_id: string }>(`
    select o.*, k.id as key_id from enquiry_form_keys k join organisations o on o.id = k.organisation_id
     where k.token = $1 and k.revoked_at is null`, [token]);
}

export async function liveFormKey(orgId: string) {
  return one<{ id: string; token: string; created_at: string; last_used_at: string | null; uses: number }>(
    "select id, token, created_at, last_used_at, uses from enquiry_form_keys where organisation_id = $1 and revoked_at is null", [orgId]);
}

// A form on a public website will be found by bots: a few a minute per key is plenty for people.
const recent = new Map<string, number[]>();
export function allowSubmission(keyId: string, now = Date.now()) {
  const window = (recent.get(keyId) ?? []).filter(at => now - at < 10 * 60_000);
  if (window.length >= 20) { recent.set(keyId, window); return false; }
  recent.set(keyId, [...window, now]);
  return true;
}
