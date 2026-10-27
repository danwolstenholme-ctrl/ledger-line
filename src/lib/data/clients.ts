import "server-only";

import { one, sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { daysUntil } from "@/lib/domain/deadlines";
import {
  assessRisk, engagementLetter, fileSteps, latestScreenings, sortDocuments, suggestFactors, type DocumentKind, type Letter, type Person, type RiskFactor, type RiskLevel, type Service,
} from "@/lib/domain/onboarding";
import { getCurrentUser, getPractice } from "@/lib/org";
import { currentList, refreshState, type ScreeningRow } from "@/lib/sanctions";

/**
 * Client files: who the practice is taking on, and who it has taken on, with
 * where each stands. The list of files, and one file with everything its page
 * needs: people, documents, screenings, the risk assessment and the letter.
 */

export type ClientFileRow = {
  /** Its country, whose terms its books are opened in. */
  country: "CY" | "GB";
  id: string; practice_id: string; organisation_id: string | null; enquiry_id: string | null; status: "onboarding" | "active" | "declined";
  company_name: string; he_number: string | null; incorporated_on: string | null; registered_address: string | null; business: string;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null; services: Service[];
  monthly_fee: number; hourly_rate: number; app_fee: number; vat_registered: boolean; vat_number: string | null; vat_quarter_end_month: number; year_end_month: number;
  books_from: string | null; manager: string | null; face_to_face: boolean; introduced_by: string | null; client_token: string | null;
  letter_sent_at: string | null; letter_text: string | null; letter_hash: string | null; signed_at: string | null; signed_name: string | null; signed_position: string | null;
  signed_ip: string | null; signed_agent: string | null; signed_hash: string | null; opened_at: string | null; opened_by: string | null; declined_reason: string | null;
  created_by: string; created_at: string;
};
export type DocumentRow = { id: string; file_id: string; person_id: string | null; kind: DocumentKind; label: string; requested_at: string; file_name: string | null; media_type: string | null; size_bytes: number | null; received_at: string | null; received_from: string | null };
export type AssessmentRow = {
  id: string; file_id: string; factors: RiskFactor[]; client_score: number; service_score: number; geography_score: number; channel_score: number; total: number;
  scored_level: RiskLevel; forced_reason: string | null; level: RiskLevel; override_reason: string | null; notes: string | null; assessed_by: string; assessed_at: string;
  approved_by: string | null; approved_as: "mlco" | "partner" | null; approved_at: string | null; next_review_on: string | null;
};
export type StaffRow = { name: string; role: string | null; mlco: boolean };

const FILE_COLUMNS = `f.*, to_char(f.books_from, 'YYYY-MM-DD') as books_from, to_char(f.incorporated_on, 'YYYY-MM-DD') as incorporated_on`;
const DOCUMENT_COLUMNS = "id, file_id, person_id, kind, label, requested_at, file_name, media_type, size_bytes, received_at, received_from";
const PERSON_COLUMNS = "id, file_id, name, roles, ownership, to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth, nationality, residence, id_kind, id_number, to_char(id_expires, 'YYYY-MM-DD') as id_expires, pep, pep_detail";
const ASSESSMENT_COLUMNS = "*, to_char(next_review_on, 'YYYY-MM-DD') as next_review_on";

export const getStaff = async () => sql<StaffRow>("select name, role, mlco from practice_staff order by mlco desc, name");

/** The practice's people who may approve a risk rating: the compliance officer for low and normal risk, a partner for high. */
export function approverFor(level: RiskLevel, staff: StaffRow[], user: string) {
  const me = staff.find(person => person.name === user);
  if (level === "high") return me?.role === "Partner" ? "partner" as const : null;
  return me?.mlco ? "mlco" as const : me?.role === "Partner" ? "partner" as const : null;
}

/** Every file, onboarding first, with its steps, risk and next review. */
export async function getClientFiles() {
  const today = firmToday();
  const [files, people, documents, screenings, assessments, list] = await Promise.all([
    sql<ClientFileRow & { slug: string | null }>(`select ${FILE_COLUMNS}, o.slug from client_files f left join organisations o on o.id = f.organisation_id order by f.status, f.company_name`),
    sql<Person & { file_id: string }>(`select ${PERSON_COLUMNS} from client_people order by created_at`),
    sql<DocumentRow>(`select ${DOCUMENT_COLUMNS} from client_documents`),
    sql<ScreeningRow>("select id, file_id, person_id, name, to_char(list_date, 'YYYY-MM-DD') as list_date, result, matches, resolution, resolved_note, resolved_by, resolved_at, screened_by, screened_at from sanctions_screenings order by screened_at desc"),
    sql<AssessmentRow>(`select ${ASSESSMENT_COLUMNS} from risk_assessments order by assessed_at desc`),
    currentList(),
  ]);
  const rows = files.map(file => {
    const own = people.filter(person => person.file_id === file.id);
    const latest = assessments.find(row => row.file_id === file.id) ?? null;
    const approved = assessments.find(row => row.file_id === file.id && row.approved_at) ?? null;
    const progress = fileSteps({
      file, people: own, documents: documents.filter(document => document.file_id === file.id),
      screenings: screenings.filter(row => row.file_id === file.id).map(row => ({ personId: row.person_id, result: row.result, resolution: row.resolution, listDate: row.list_date })),
      assessment: latest ? { level: latest.level, approved_at: latest.approved_at } : null, listDate: list?.generated_on ?? null,
    });
    const screened = latestScreenings(screenings.filter(row => row.file_id === file.id).map(row => ({ personId: row.person_id, result: row.result, resolution: row.resolution, listDate: row.list_date })));
    const openMatches = [...screened.values()].filter(row => row.result === "possible" && !row.resolution).length;
    const lastScreened = screenings.find(row => row.file_id === file.id)?.list_date ?? null;
    const review = approved?.next_review_on ?? null;
    return {
      ...file, people: own.length, steps: progress.steps, ready: progress.ready, done: progress.steps.filter(step => step.done).length,
      next: progress.steps.find(step => !step.done) ?? null, level: approved?.level ?? latest?.level ?? null, review, reviewIn: review ? daysUntil(today, review) : null,
      openMatches, lastScreened, screenedOnCurrent: Boolean(list && lastScreened && lastScreened >= list.generated_on),
    };
  });
  return {
    today, list, refreshing: refreshState(),
    onboarding: rows.filter(row => row.status === "onboarding"),
    active: rows.filter(row => row.status === "active"),
    declined: rows.filter(row => row.status === "declined"),
    counts: {
      reviewsDue: rows.filter(row => row.status === "active" && row.reviewIn !== null && row.reviewIn <= 30).length,
      openMatches: rows.reduce((sum, row) => sum + row.openMatches, 0),
      notOnCurrentList: rows.filter(row => row.status !== "declined" && !row.screenedOnCurrent).length,
    },
  };
}

/** One file, as its page shows it. */
export async function getClientFile(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const file = await one<ClientFileRow & { slug: string | null; enquiry_reference: string | null }>(`select ${FILE_COLUMNS}, o.slug, e.reference as enquiry_reference
    from client_files f left join organisations o on o.id = f.organisation_id left join crm_enquiries e on e.id = f.enquiry_id where f.id = $1`, [id]);
  if (!file) return null;
  const [people, documents, screenings, assessments, list, practice, practiceOrg, staff, user] = await Promise.all([
    sql<Person>(`select ${PERSON_COLUMNS} from client_people where file_id = $1 order by created_at`, [id]),
    sql<DocumentRow>(`select ${DOCUMENT_COLUMNS} from client_documents where file_id = $1 order by person_id nulls first, requested_at`, [id]),
    sql<ScreeningRow>("select id, file_id, person_id, name, to_char(list_date, 'YYYY-MM-DD') as list_date, result, matches, resolution, resolved_note, resolved_by, resolved_at, screened_by, screened_at from sanctions_screenings where file_id = $1 order by screened_at desc", [id]),
    sql<AssessmentRow>(`select ${ASSESSMENT_COLUMNS} from risk_assessments where file_id = $1 order by assessed_at desc`, [id]),
    currentList(),
    getPractice(),
    one<{ name: string; address: string | null }>("select name, address from organisations where is_practice limit 1"),
    getStaff(),
    getCurrentUser(),
  ]);
  const today = firmToday();
  const ordered = sortDocuments(documents, people.map(person => person.id));
  const progress = fileSteps({
    file, people, documents: ordered,
    screenings: screenings.map(row => ({ personId: row.person_id, result: row.result, resolution: row.resolution, listDate: row.list_date })),
    assessment: assessments[0] ? { level: assessments[0].level, approved_at: assessments[0].approved_at } : null, listDate: list?.generated_on ?? null,
  });
  const latestBySubject = new Map<string, ScreeningRow>();
  for (const row of screenings) if (!latestBySubject.has(row.person_id ?? "company")) latestBySubject.set(row.person_id ?? "company", row);
  const partner = staff.find(person => person.role === "Partner")?.name ?? user.name;
  const draft = engagementLetter({ date: today, practice: { name: practiceOrg?.name ?? practice.name, address: practiceOrg?.address ?? null, partner }, file });
  const sent: Letter | null = file.letter_text ? JSON.parse(file.letter_text) : null;
  // The letter as it would be written today, against the one sent: if the terms changed since, it has to go again.
  const changed = Boolean(sent && !file.signed_at && JSON.stringify({ ...sent, date: "" }) !== JSON.stringify({ ...draft, date: "" }));
  const suggested = suggestFactors({ business: file.business, services: file.services, face_to_face: file.face_to_face, introduced_by: file.introduced_by }, people);
  return {
    file, people, documents: ordered, screenings, latestBySubject, assessments, current: assessments[0] ?? null, approved: assessments.find(row => row.approved_at) ?? null,
    list, refreshing: refreshState(), steps: progress.steps, ready: progress.ready, blocked: progress.blocked,
    letter: { draft, sent, changed }, suggested, suggestedResult: assessRisk(suggested, people), staff, user, partner, today,
    approverForMe: (level: RiskLevel) => approverFor(level, staff, user.name),
  };
}
export type ClientFileData = NonNullable<Awaited<ReturnType<typeof getClientFile>>>;
