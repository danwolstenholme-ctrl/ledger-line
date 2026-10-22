import { revalidatePath } from "next/cache";

import { sql } from "@/lib/db";
import { allowSubmission, companyForToken, recordEnquiry, type EnquiryInput } from "@/lib/crm/intake";
import { enquiryPage } from "@/lib/crm/form-page";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/enquiries: a new enquiry from outside the app, into the
 * pipeline of the company whose form key it carries. Two kinds of caller:
 *
 * - code, sending JSON with `Authorization: Bearer ll_form_…`, answered in JSON;
 * - a plain HTML form on any website, sending its fields with a hidden `key`,
 *   answered with a thank-you page or sent on to its `redirect`.
 *
 * The key can only add enquiries, so it is safe in a public page. A hidden
 * `_trap` field catches bots: a real person never fills it in.
 */

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

type Fields = Record<string, string>;

async function readBody(request: Request): Promise<{ fields: Fields; json: boolean } | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return null;
      const fields: Fields = {};
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) if (typeof value === "string" || typeof value === "number") fields[key] = String(value);
      return { fields, json: true };
    }
    const form = await request.formData();
    const fields: Fields = {};
    for (const [key, value] of form.entries()) if (typeof value === "string") fields[key] = value;
    return { fields, json: false };
  } catch {
    return null;
  }
}

function read(fields: Fields): { input: EnquiryInput | null; problems: Record<string, string> } {
  const text = (key: string, max: number) => { const value = (fields[key] ?? "").replace(/\s+/g, " ").trim(); return value ? value.slice(0, max) : null; };
  const problems: Record<string, string> = {};
  const name = text("name", 200) ?? text("full_name", 200);
  if (!name) problems.name = "Say who the enquiry is from.";
  const email = text("email", 320);
  if (email && !EMAIL.test(email)) problems.email = "That email address does not look right.";
  const phone = text("phone", 40);
  if (!email && !phone) problems.email = "Leave an email address or a phone number, so someone can reply.";
  const message = (fields.message ?? "").trim().slice(0, 2000) || null;
  if (Object.keys(problems).length || !name) return { input: null, problems };
  return { input: { name, company: text("company", 200), email, phone, service: text("service", 300), message, source: text("source", 60) ?? "Website" }, problems };
}

/** Only a web address, or a path on this site, can be gone on to after a form is sent. */
function safeRedirect(value: string | undefined) {
  if (!value) return null;
  if (/^\/f\/ll_form_[A-Za-z0-9]{24}(\?sent=1)?$/.test(value)) return value;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; }
}

export async function POST(request: Request) {
  const body = await readBody(request);
  const wantsJson = body?.json ?? (request.headers.get("accept") ?? "").includes("application/json");
  const reply = (status: number, json: Record<string, unknown>, html: () => string) => wantsJson
    ? Response.json(json, { status, headers: CORS })
    : new Response(html(), { status, headers: { ...CORS, "content-type": "text/html; charset=utf-8" } });

  if (!body) return reply(400, { error: "unreadable", message: "Send JSON, or a form's fields." }, () => enquiryPage({ state: "problem", message: "The form could not be read. Go back and try again." }));
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const token = bearer ?? body.fields.key ?? new URL(request.url).searchParams.get("key") ?? "";
  const company = await companyForToken(token);
  if (!company) return reply(401, { error: "invalid_key", message: "The form key is missing, mistyped or turned off." }, () => enquiryPage({ state: "problem", message: "This form is not taking enquiries at the moment." }));

  // A bot fills in every field it finds; a person never sees this one. Thank it and keep nothing.
  if (body.fields._trap) return reply(202, { status: "received" }, () => enquiryPage({ state: "sent", company }));
  if (!allowSubmission(company.key_id)) return reply(429, { error: "too_many", message: "Too many enquiries from this form just now. Try again in a few minutes." }, () => enquiryPage({ state: "problem", company, message: "Too many enquiries were sent from this form just now. Try again in a few minutes." }));

  const { input, problems } = read(body.fields);
  if (!input) return reply(422, { error: "invalid", fields: problems }, () => enquiryPage({ state: "problem", company, message: Object.values(problems).join(" ") }));

  const recorded = await recordEnquiry(company, input, body.json ? "api" : "form", "Website");
  await sql("update enquiry_form_keys set last_used_at = now(), uses = uses + 1 where id = $1", [company.key_id]);
  revalidatePath(`/c/${company.slug}`, "layout");

  const next = body.json ? null : safeRedirect(body.fields.redirect);
  if (next) return new Response(null, { status: 303, headers: { ...CORS, location: next } });
  return reply(201, { id: recorded.id, reference: recorded.reference, stage: "new", owner: recorded.owner, next_action: recorded.next_action, next_action_due: recorded.next_action_due },
    () => enquiryPage({ state: "sent", company }));
}
