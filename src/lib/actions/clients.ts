"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { approverFor, getClientFile, getStaff } from "@/lib/data/clients";
import { OPENING_ACCOUNTS, chartFor } from "@/lib/domain/chart";
import { regimeOf } from "@/lib/domain/regimes";
import { PERSON_COUNTRIES } from "@/lib/domain/countries";
import { euVatNumber } from "@/lib/domain/eu-vat";
import { firmToday } from "@/lib/domain/invoices";
import {
  BENEFICIAL_OWNER_THRESHOLD, documentRequests, letterText, nextReview, assessRisk, PEP, RISK_AREA_KEYS, ROLES, SERVICE_KEYS,
  type PepStatus, type RiskArea, type RiskFactor, type RiskLevel, type Role,
} from "@/lib/domain/onboarding";
import { getCurrentUser, getPractice } from "@/lib/org";
import { keepDocument } from "@/lib/client-documents";
import { screen, startRefresh } from "@/lib/sanctions";

/**
 * Taking a client on, step by step, and keeping its file current. Each
 * action checks the file is still in a state where the step makes sense: a
 * signed letter's terms don't change, a declined file takes no more work.
 */

function refresh() { revalidatePath("/", "layout"); }
const fail = (error: unknown, fallback: string): ActionState => ({ ok: false, error: describeDbError(asDbError(error), fallback) });
const COUNTRY_CODES = new Set(PERSON_COUNTRIES.map(([code]) => code));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clientToken = () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return `ll_cf_${[...randomBytes(24)].map(byte => alphabet[byte % alphabet.length]).join("")}`;
};

type FileState = { id: string; status: string; signed_at: string | null; organisation_id: string | null; company_name: string; books_from: string | null };
async function fileFor(id: string | null) {
  return id && UUID.test(id) ? one<FileState>("select id, status, signed_at, organisation_id, company_name, books_from from client_files where id = $1", [id]) : null;
}

/** The documents every file asks for, kept in step with its people: each new director or owner is asked for an ID and proof of address. */
async function syncRequests(fileId: string) {
  const [people, existing, file] = await Promise.all([
    sql<{ id: string; name: string; roles: Role[] }>("select id, name, roles from client_people where file_id = $1", [fileId]),
    sql<{ id: string; kind: string; person_id: string | null; received_at: string | null }>("select id, kind, person_id, received_at from client_documents where file_id = $1", [fileId]),
    one<{ books_from: string | null }>("select books_from from client_files where id = $1", [fileId]),
  ]);
  const wanted = documentRequests(people, file?.books_from ?? null);
  for (const request of wanted) {
    const match = existing.find(row => row.kind === request.kind && row.person_id === request.personId);
    if (!match) await sql("insert into client_documents (file_id, person_id, kind, label) values ($1, $2, $3, $4)", [fileId, request.personId, request.kind, request.label]);
    else if (!match.received_at) await sql("update client_documents set label = $2 where id = $1", [match.id, request.label]);
  }
  // A person who no longer needs to be identified: their requests go, unless something was already sent.
  for (const row of existing) {
    if (row.person_id && !row.received_at && !wanted.some(request => request.kind === row.kind && request.personId === row.person_id)) await sql("delete from client_documents where id = $1", [row.id]);
  }
}

// ---------------------------------------------------------------------------
// Starting a file
// ---------------------------------------------------------------------------

/** A new client: from a won enquiry in the practice's own pipeline, or typed in. */
export async function startClientFile(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const name = p.text("company_name", { required: true, max: 200, label: "Company name" });
  const contact = p.text("contact_name", { max: 200, label: "Contact" }), email = p.email("contact_email"), phone = p.text("contact_phone", { max: 40, label: "Phone" });
  const business = p.text("business", { max: 300, label: "What the company does" }) ?? "";
  const enquiry = p.uuid("enquiry_id");
  if (p.failed || !name) return p.fail();
  const [practice, user] = await Promise.all([getPractice(), getCurrentUser()]);
  let id: string;
  try {
    id = (await one<{ id: string }>(`insert into client_files (practice_id, enquiry_id, company_name, contact_name, contact_email, contact_phone, business, manager, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`, [practice.id, enquiry, name, contact, email, phone, business, user.name]))!.id;
    await syncRequests(id);
  } catch (error) { return fail(error, "The client file could not be started."); }
  refresh();
  redirect(`/clients/${id}`);
}

/** "Take on as a client" from a won enquiry: the file starts with what the enquiry already knows. */
export async function takeOnFromEnquiry(form: FormData) {
  const id = String(form.get("enquiry_id") ?? "");
  if (!UUID.test(id)) return;
  const existing = await one<{ id: string }>("select id from client_files where enquiry_id = $1", [id]);
  if (existing) redirect(`/clients/${existing.id}`);
  const enquiry = await one<{ organisation_id: string; stage: string; full_name: string; company: string | null; email: string | null; phone: string | null; service: string | null }>(
    "select e.organisation_id, e.stage, e.full_name, e.company, e.email, e.phone, e.service from crm_enquiries e join organisations o on o.id = e.organisation_id and o.is_practice where e.id = $1", [id]);
  if (!enquiry || enquiry.stage === "lost") return;
  const [practice, user] = await Promise.all([getPractice(), getCurrentUser()]);
  if (enquiry.stage !== "won") {
    await sql("update crm_enquiries set stage = 'won', stage_changed_at = now(), next_action = null, next_action_due = null where id = $1", [id]);
    await sql("insert into crm_activities (organisation_id, enquiry_id, kind, body, actor) values ($1, $2, 'won', 'Won: taking them on as a client.', $3)", [enquiry.organisation_id, id, user.name]);
  }
  const file = (await one<{ id: string }>(`insert into client_files (practice_id, enquiry_id, company_name, contact_name, contact_email, contact_phone, manager, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`, [practice.id, id, enquiry.company ?? enquiry.full_name, enquiry.full_name, enquiry.email, enquiry.phone, user.name]))!.id;
  await syncRequests(file);
  refresh();
  redirect(`/clients/${file}`);
}

// ---------------------------------------------------------------------------
// Details and terms
// ---------------------------------------------------------------------------

export async function saveClientDetails(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const file = await fileFor(p.uuid("id"));
  if (!file) return { ok: false, error: "That client file no longer exists." };
  if (file.status === "declined") return { ok: false, error: "This client was declined: the file is closed." };
  const name = p.text("company_name", { required: true, max: 200, label: "Company name" });
  const he = p.text("he_number", { max: 20, label: "Registration number" })?.toUpperCase().replace(/^HE\s*/, "HE ").replace(/^(\d)/, "HE $1") ?? null;
  if (he && !/^HE \d{3,7}$/.test(he)) p.errors.he_number = "A Cyprus company number is HE and up to seven digits, e.g. HE 431776.";
  const incorporated = p.text("incorporated_on", { max: 10 });
  const address = p.text("registered_address", { max: 500, label: "Registered office" });
  const business = p.text("business", { max: 300, label: "What the company does" }) ?? "";
  const contact = p.text("contact_name", { max: 200, label: "Contact" }), email = p.email("contact_email"), phone = p.text("contact_phone", { max: 40, label: "Phone" });
  const quarter = Number(p.enum("vat_quarter_end_month", ["1", "2", "3"], { fallback: "3" }));
  const yearEnd = Number(p.text("year_end_month", { max: 2 }) ?? 12);
  if (!Number.isInteger(yearEnd) || yearEnd < 1 || yearEnd > 12) p.errors.year_end_month = "Choose the month the financial year ends.";
  const registered = p.boolean("vat_registered");
  const country = p.enum("country", ["CY", "GB"] as const, { fallback: "CY", label: "Country" })!;
  const vat = euVatNumber(p.text("vat_number", { max: 20, label: "VAT number" }), country);
  if (vat.problem) p.errors.vat_number = vat.problem;
  if (registered && !vat.value) p.errors.vat_number = "A VAT-registered company has a VAT number.";
  const booksMonth = p.text("books_from", { max: 7 });
  if (booksMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(booksMonth)) p.errors.books_from = "Choose the first month the books start.";
  const manager = p.text("manager", { max: 200 });
  const faceToFace = p.boolean("face_to_face"), introducedBy = p.text("introduced_by", { max: 200, label: "Introduced by" });
  const services = SERVICE_KEYS.filter(key => form.getAll("services").includes(key));
  const fee = p.money("monthly_fee", "Monthly fee") ?? 0, rate = p.money("hourly_rate", "Hourly rate") ?? 0, app = p.money("app_fee", "Online books") ?? 0;
  if (!file.signed_at && !services.length) p.errors.services = "Choose at least one service.";
  if (incorporated && (!/^\d{4}-\d{2}-\d{2}$/.test(incorporated) || incorporated > firmToday())) p.errors.incorporated_on = "Not a date in the past.";
  if (p.failed || !name) return p.fail();
  try {
    await sql(`update client_files set company_name = $2, he_number = $3, incorporated_on = $4, registered_address = $5, business = $6, contact_name = $7, contact_email = $8, contact_phone = $9,
        vat_registered = $10, vat_number = $11, vat_quarter_end_month = $12, year_end_month = $13, books_from = $14, manager = $15, face_to_face = $16, introduced_by = $17, country = $18 where id = $1`,
      [file.id, name, he, incorporated, address, business, contact, email, phone, registered, registered ? vat.value : null, quarter, yearEnd, booksMonth ? `${booksMonth}-01` : null, manager, faceToFace, introducedBy, country]);
    // Once signed, the services and fees are what the client agreed to: they are not changed here.
    if (!file.signed_at) await sql("update client_files set services = $2, monthly_fee = $3, hourly_rate = $4, app_fee = $5 where id = $1", [file.id, services, fee, rate, app]);
    await syncRequests(file.id);
  } catch (error) { return fail(error, "The details could not be saved."); }
  refresh();
  return { ok: true, error: null, notice: "Saved." };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export async function savePerson(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const file = await fileFor(p.uuid("file_id"));
  if (!file || file.status === "declined") return { ok: false, error: "This client file is closed." };
  const id = p.uuid("id");
  const name = p.text("name", { required: true, max: 200, label: "Full name" });
  const roles = (Object.keys(ROLES) as Role[]).filter(role => form.getAll("roles").includes(role));
  const ownershipText = p.text("ownership", { max: 6 });
  const ownership = ownershipText === null ? null : Number(ownershipText.replace(",", ".").replace("%", ""));
  if (ownership !== null && (!Number.isFinite(ownership) || ownership < 0 || ownership > 100)) p.errors.ownership = "A percentage from 0 to 100.";
  if (ownership && ownership > BENEFICIAL_OWNER_THRESHOLD && !roles.includes("beneficial_owner")) roles.push("beneficial_owner");
  if (ownership && !roles.includes("shareholder")) roles.push("shareholder");
  if (!roles.length) p.errors.roles = "Choose what this person is to the company.";
  const born = p.text("date_of_birth", { max: 10 });
  if (born && (!/^\d{4}-\d{2}-\d{2}$/.test(born) || born > firmToday() || born < "1900-01-01")) p.errors.date_of_birth = "Not a date of birth.";
  const nationality = p.text("nationality", { max: 2 }), residence = p.text("residence", { max: 2 });
  if (nationality && !COUNTRY_CODES.has(nationality)) p.errors.nationality = "Choose a country.";
  if (residence && !COUNTRY_CODES.has(residence)) p.errors.residence = "Choose a country.";
  const idKind = p.enum("id_kind", ["passport", "id_card"] as const), idNumber = p.text("id_number", { max: 40, label: "Document number" }), idExpires = p.text("id_expires", { max: 10 });
  if (idExpires && idExpires < firmToday()) p.errors.id_expires = "This document has expired: ask for a current one.";
  const pep = p.enum("pep", Object.keys(PEP) as PepStatus[], { fallback: "no" })!;
  const pepDetail = p.text("pep_detail", { max: 300, label: "The public function" });
  if (pep !== "no" && !pepDetail) p.errors.pep_detail = "Say what the public function is, and whose.";
  if (p.failed || !name) return p.fail();
  const values = [name, roles, ownership, born, nationality, residence, idKind, idNumber, idExpires, pep, pep === "no" ? null : pepDetail];
  try {
    if (id) await sql(`update client_people set name = $3, roles = $4, ownership = $5, date_of_birth = $6, nationality = $7, residence = $8, id_kind = $9, id_number = $10, id_expires = $11, pep = $12, pep_detail = $13
      where id = $1 and file_id = $2`, [id, file.id, ...values]);
    else await sql(`insert into client_people (file_id, name, roles, ownership, date_of_birth, nationality, residence, id_kind, id_number, id_expires, pep, pep_detail)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [file.id, ...values]);
    await syncRequests(file.id);
  } catch (error) { return fail(error, "The person could not be saved."); }
  refresh();
  return { ok: true, error: null, notice: ownership && ownership > BENEFICIAL_OWNER_THRESHOLD ? `Saved. Holding ${ownership}%, ${name} is recorded as a beneficial owner.` : "Saved." };
}

export async function removePerson(form: FormData) {
  const id = String(form.get("id") ?? ""), fileId = String(form.get("file_id") ?? "");
  const file = await fileFor(fileId);
  if (!file || !UUID.test(id) || file.organisation_id) return;
  await sql("delete from client_people where id = $1 and file_id = $2", [id, file.id]);
  await syncRequests(file.id);
  refresh();
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function uploadDocument(_previous: ActionState, form: FormData): Promise<ActionState> {
  const file = await fileFor(String(form.get("file_id") ?? ""));
  const documentId = String(form.get("document_id") ?? "");
  const upload = form.get("file");
  if (!file || !UUID.test(documentId)) return { ok: false, error: "That request is no longer on the file." };
  if (!(upload instanceof File) || !upload.size) return { ok: false, error: "Choose the file first." };
  const user = await getCurrentUser();
  const problem = await keepDocument(documentId, file.id, upload, user.name);
  if (problem) return { ok: false, error: problem };
  refresh();
  return { ok: true, error: null };
}

export async function requestDocument(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const file = await fileFor(p.uuid("file_id"));
  const label = p.text("label", { required: true, max: 200, label: "What to ask for" });
  if (!file || file.status === "declined") return { ok: false, error: "This client file is closed." };
  if (p.failed || !label) return p.fail();
  await sql("insert into client_documents (file_id, kind, label) values ($1, 'other', $2)", [file.id, label]);
  refresh();
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// The engagement letter
// ---------------------------------------------------------------------------

/** Send the letter: it is written from the file as it stands, kept word for word, and fingerprinted. The client's link opens it. */
export async function sendLetter(_previous: ActionState, form: FormData): Promise<ActionState> {
  const data = await getClientFile(String(form.get("id") ?? ""));
  if (!data) return { ok: false, error: "That client file no longer exists." };
  const { file } = data;
  if (file.signed_at) return { ok: false, error: "The letter is already signed." };
  if (file.status === "declined") return { ok: false, error: "This client was declined: the file is closed." };
  const missing = [!file.services.length && "the services", !(file.monthly_fee > 0) && "the monthly fee", !file.contact_email && "the contact’s email", !file.contact_name && "who it is for"].filter(Boolean);
  if (missing.length) return { ok: false, error: `Add ${missing.join(", ")} to the client details first.` };
  const letter = data.letter.draft;
  const hash = createHash("sha256").update(letterText(letter)).digest("hex");
  try {
    await sql("update client_files set client_token = coalesce(client_token, $2), letter_text = $3, letter_hash = $4, letter_sent_at = now() where id = $1",
      [file.id, clientToken(), JSON.stringify(letter), hash]);
  } catch (error) { return fail(error, "The letter could not be sent."); }
  refresh();
  return { ok: true, error: null, notice: "Sent." };
}

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------

async function screenFileNow(fileId: string, actor: string) {
  const [file, people] = await Promise.all([
    one<{ company_name: string }>("select company_name from client_files where id = $1", [fileId]),
    sql<{ id: string; name: string; date_of_birth: string | null }>("select id, name, date_of_birth from client_people where file_id = $1 order by created_at", [fileId]),
  ]);
  if (!file) return 0;
  await screen(fileId, { personId: null, name: file.company_name, kind: "enterprise", dateOfBirth: null }, actor);
  for (const person of people) await screen(fileId, { personId: person.id, name: person.name, kind: "person", dateOfBirth: person.date_of_birth }, actor);
  return people.length + 1;
}

/** Screen the company and everyone on the file against the current list. */
export async function screenFile(_previous: ActionState, form: FormData): Promise<ActionState> {
  const file = await fileFor(String(form.get("id") ?? ""));
  if (!file || file.status === "declined") return { ok: false, error: "This client file is closed." };
  const user = await getCurrentUser();
  let count: number;
  try { count = await screenFileNow(file.id, user.name); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The screening could not be done." }; }
  refresh();
  return { ok: true, error: null, notice: `${count} name${count === 1 ? "" : "s"} screened.` };
}

/** Every client and everyone behind them, against the current list: after the list changes, or as the regular check. */
export async function screenEveryone() {
  const user = await getCurrentUser();
  const files = await sql<{ id: string }>("select id from client_files where status <> 'declined'");
  let count = 0;
  for (const file of files) count += await screenFileNow(file.id, user.name);
  refresh();
  redirect(`/clients?screened=${count}`);
}

/** Close a possible match: not the same (with the reason), or confirmed. */
export async function resolveScreening(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const id = p.uuid("id");
  const resolution = p.enum("resolution", ["not_the_same", "confirmed"] as const, { required: true, label: "The decision" });
  const note = p.text("note", { required: true, max: 1000, label: "The reason" });
  if (p.failed || !id || !resolution || !note) return p.fail("Say why: the reason is what an inspector reads.");
  const user = await getCurrentUser();
  const row = await one<{ id: string }>("update sanctions_screenings set resolution = $2, resolved_note = $3, resolved_by = $4, resolved_at = now() where id = $1 and result = 'possible' and resolution is null returning id",
    [id, resolution, note, user.name]);
  if (!row) return { ok: false, error: "That match was already dealt with." };
  refresh();
  return { ok: true, error: null };
}

export async function updateSanctionsList() {
  startRefresh();
  refresh();
  redirect("/clients?updating=1");
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

/** Record a risk assessment from the factors as scored. The level follows the score unless a reason is given; a forced high stays high. */
export async function saveAssessment(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const file = await fileFor(p.uuid("file_id"));
  if (!file || file.status === "declined") return { ok: false, error: "This client file is closed." };
  const areas = form.getAll("factor_area").map(String), labels = form.getAll("factor_label").map(String), scores = form.getAll("factor_score").map(Number);
  const factors: RiskFactor[] = areas.map((area, index) => ({ area: area as RiskArea, label: (labels[index] ?? "").trim().slice(0, 300), score: scores[index] }))
    .filter(factor => RISK_AREA_KEYS.includes(factor.area) && factor.label && Number.isInteger(factor.score) && factor.score >= 1 && factor.score <= 5);
  if (RISK_AREA_KEYS.some(area => !factors.some(factor => factor.area === area))) return { ok: false, error: "Score at least one factor in each of the four areas." };
  const override = p.enum("override_level", ["low", "normal", "high"] as const);
  const overrideReason = p.text("override_reason", { max: 1000, label: "The reason" });
  const notes = p.text("notes", { max: 2000, label: "Notes" });
  const people = await sql<Parameters<typeof assessRisk>[1][number]>("select id, name, roles, ownership, date_of_birth, nationality, residence, id_kind, id_number, id_expires, pep, pep_detail from client_people where file_id = $1", [file.id]);
  const result = assessRisk(factors, people, override);
  if (override && override !== result.scored && !result.forced && !overrideReason) p.errors.override_reason = "A rating different from the score needs the reason written down.";
  if (result.forced && override && override !== "high") p.errors.override_level = "This client is high risk whatever the score.";
  if (p.failed) return p.fail();
  const user = await getCurrentUser();
  try {
    await sql(`insert into risk_assessments (file_id, factors, client_score, service_score, geography_score, channel_score, scored_level, forced_reason, level, override_reason, notes, assessed_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [file.id, JSON.stringify(factors), result.scores.client, result.scores.service, result.scores.geography, result.scores.channel, result.scored, result.forced, result.level,
       result.level !== result.scored && !result.forced ? overrideReason : null, notes, user.name]);
  } catch (error) { return fail(error, "The assessment could not be saved."); }
  refresh();
  return { ok: true, error: null, notice: "Assessed." };
}

/** Approve the latest assessment: the compliance officer for low and normal risk, a partner for high. The next review is set from the level. */
export async function approveAssessment(_previous: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const assessment = UUID.test(id) ? await one<{ id: string; level: RiskLevel; approved_at: string | null; file_id: string }>("select id, level, approved_at, file_id from risk_assessments where id = $1", [id]) : null;
  if (!assessment) return { ok: false, error: "That assessment no longer exists." };
  if (assessment.approved_at) return { ok: false, error: "Already approved." };
  const [user, staff] = await Promise.all([getCurrentUser(), getStaff()]);
  const as = approverFor(assessment.level, staff, user.name);
  if (!as) return { ok: false, error: assessment.level === "high" ? "A high risk client is approved by a partner." : "Low and normal risk clients are approved by the compliance officer." };
  const review = nextReview(firmToday(), assessment.level);
  await sql("update risk_assessments set approved_by = $2, approved_as = $3, approved_at = now(), next_review_on = $4 where id = $1", [assessment.id, user.name, as, review]);
  refresh();
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// Opening the books, or declining
// ---------------------------------------------------------------------------

const slugFor = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(ltd|limited|plc|llc)\b\.?/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
const prefixFor = (name: string) => `${name.replace(/\b(Ltd|Limited|Co|PLC)\b\.?/gi, "").trim().split(/\s+/).slice(0, 3).map(word => word[0]).join("").toUpperCase() || "INV"}-`;

/** The client is taken on: its company is created with the standard chart, its fee set, and it becomes a customer in the practice's books. */
export async function openBooks(_previous: ActionState, form: FormData): Promise<ActionState> {
  const data = await getClientFile(String(form.get("id") ?? ""));
  if (!data) return { ok: false, error: "That client file no longer exists." };
  const { file } = data;
  if (file.organisation_id) redirect(`/c/${file.slug}`);
  if (!data.ready) return { ok: false, error: data.blocked ?? "Finish the steps above first: the books open once due diligence is done and the letter is signed." };
  const user = await getCurrentUser();
  let slug = slugFor(file.company_name);
  for (let n = 2; await one("select 1 from organisations where slug = $1", [slug]); n++) slug = `${slugFor(file.company_name)}-${n}`;
  const booksFrom = file.books_from ?? `${firmToday().slice(0, 7)}-01`;
  try {
    await transaction(async run => {
      const org = randomUUID(), bank = randomUUID();
      const practiceOrg = (await run<{ id: string }>("select id from organisations where is_practice limit 1"))[0];
      // In its own country's terms: currency, chart of accounts, VAT and deadlines.
      await run(`insert into organisations (id, practice_id, slug, name, industry, he_number, vat_number, vat_registered, vat_quarter_end_month, year_end_month, contact_name, contact_email, address,
          invoice_prefix, manager, books_from, incorporated_on, country, currency) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [org, file.practice_id, slug, file.company_name, file.business || "Client company", file.he_number, file.vat_registered ? file.vat_number : null, file.vat_registered,
         file.vat_quarter_end_month, file.year_end_month, file.contact_name, file.contact_email, file.registered_address, prefixFor(file.company_name), file.manager ?? user.name, booksFrom,
         file.incorporated_on, file.country, regimeOf(file.country).currency]);
      const accounts = [...OPENING_ACCOUNTS, ...chartFor(file.country)].map(account => ({ id: account.code === "090" ? bank : randomUUID(), organisation_id: org, code: account.code, name: account.name,
        type: account.type, system_role: account.role ?? null, description: account.description ?? null, bank_details: null, outside_vat: Boolean(account.outsideVat) }));
      await run(`insert into ledger_accounts (id, organisation_id, code, name, type, system_role, description, bank_details, outside_vat)
        select id, organisation_id, code, name, type, system_role, description, bank_details, outside_vat from jsonb_populate_recordset(null::ledger_accounts, $1::jsonb)`, [JSON.stringify(accounts)]);
      await run("update organisations set default_bank_account_id = $2 where id = $1", [org, bank]);
      if (practiceOrg) {
        const fees = (await run<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [practiceOrg.id]))[0];
        const customer = (await run<{ id: string }>(`insert into customers (organisation_id, name, email, vat_number, country, address, default_account_id) values ($1, $2, $3, $4, 'CY', $5, $6) returning id`,
          [practiceOrg.id, file.company_name, file.contact_email, file.vat_registered ? file.vat_number : null, file.registered_address, fees?.id ?? null]))[0];
        await run("insert into client_fees (organisation_id, customer_id, monthly_fee, hourly_rate, app_fee) values ($1, $2, $3, $4, $5)", [org, customer.id, file.monthly_fee, file.hourly_rate, file.app_fee]);
      }
      await run("update client_files set organisation_id = $2, status = 'active', opened_at = now(), opened_by = $3 where id = $1", [file.id, org, user.name]);
    });
  } catch (error) { return fail(error, "The books could not be opened."); }
  refresh();
  redirect(`/c/${slug}?opened=1`);
}

export async function declineClient(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const file = await fileFor(p.uuid("id"));
  const reason = p.text("reason", { required: true, max: 1000, label: "The reason" });
  if (!file) return { ok: false, error: "That client file no longer exists." };
  if (file.organisation_id) return { ok: false, error: "This client’s books are open: end the engagement instead." };
  if (p.failed || !reason) return p.fail("Write down why: the file keeps it.");
  await sql("update client_files set status = 'declined', declined_reason = $2 where id = $1", [file.id, reason]);
  refresh();
  redirect("/clients");
}

