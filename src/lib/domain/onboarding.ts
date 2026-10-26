import { EU_COUNTRIES, personCountry } from "@/lib/domain/countries";

/**
 * Taking a client on, as a Cyprus practice must: know who the client is and
 * who is behind it, screen them, rate the risk, and only then start work.
 * The risk method is ICPAC's client risk-based approach guidance (updated
 * June 2024): four areas, each the average of the factors considered, scored
 * 1 to 5; summed to 4 to 20; 17 to 20 high, 9 to 16 normal, 4 to 8 low. A
 * politically exposed person, or someone established in an EU high-risk third
 * country, makes a client high risk whatever the score (article 64 of the AML
 * Law). Client-safe.
 */

export const SERVICES = {
  bookkeeping: { label: "Bookkeeping", letter: "Keeping the company’s books: recording its sales, purchases and bank transactions each month, and reconciling its bank accounts." },
  vat: { label: "VAT returns", letter: "Preparing the quarterly VAT return and, for any month with services to businesses in other EU states, the VIES statement, for a director to approve before we submit them through Tax For All." },
  payroll: { label: "Payroll", letter: "Running the monthly payroll: payslips, Social Insurance and GESY contributions, and the employer’s returns." },
  tax_return: { label: "Company tax", letter: "Preparing the company’s tax return for each tax year, and working out the provisional tax instalments due on 31 July and 31 December." },
  annual_accounts: { label: "Annual accounts", letter: "Preparing the annual financial statements from the books, ready for the company’s auditors." },
  secretarial: { label: "Company secretarial", letter: "Preparing the annual return for the Registrar of Companies and keeping the company’s statutory registers." },
} as const;
export type Service = keyof typeof SERVICES;
export const SERVICE_KEYS = Object.keys(SERVICES) as Service[];

export const ROLES = { director: "Director", secretary: "Secretary", shareholder: "Shareholder", beneficial_owner: "Beneficial owner", signatory: "Signatory" } as const;
export type Role = keyof typeof ROLES;
export const PEP = { no: "Not politically exposed", pep: "Politically exposed person", family: "Family member of a PEP", associate: "Close associate of a PEP", former: "Former PEP, out of office 12 months or more" } as const;
export type PepStatus = keyof typeof PEP;

export type Person = {
  id: string; name: string; roles: Role[]; ownership: number | null; date_of_birth: string | null; nationality: string | null; residence: string | null;
  id_kind: "passport" | "id_card" | null; id_number: string | null; id_expires: string | null; pep: PepStatus; pep_detail: string | null;
};

/** A beneficial owner holds more than 25% of the shares or the votes, or otherwise controls the company. */
export const BENEFICIAL_OWNER_THRESHOLD = 25;
/** Who has to prove who they are: the directors, the beneficial owners, and anyone who signs for the company. */
export const needsIdentity = (person: Pick<Person, "roles">) => person.roles.some(role => role === "director" || role === "beneficial_owner" || role === "signatory");

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_KINDS = {
  incorporation: "Certificate of incorporation", registered_office: "Certificate of registered office", officers: "Certificate of directors and secretary",
  shareholders: "Certificate of shareholders", identity: "Passport or identity card", address: "Proof of address", bank_statements: "Bank statements",
  prior_accounts: "Last year’s accounts or trial balance", other: "Other",
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;
/** For the books, not for due diligence: asked for, but taking the client on doesn’t wait for them. */
export const FOR_THE_BOOKS: DocumentKind[] = ["bank_statements", "prior_accounts"];

export type DocumentRequest = { kind: DocumentKind; personId: string | null; label: string };

/** What the practice asks for: the company's certificates from the Registrar, each identified person's ID and address, and what the books start from. */
export function documentRequests(people: Pick<Person, "id" | "name" | "roles">[], booksFrom: string | null): DocumentRequest[] {
  const out: DocumentRequest[] = [
    { kind: "incorporation", personId: null, label: "Certificate of incorporation" },
    { kind: "registered_office", personId: null, label: "Certificate of registered office" },
    { kind: "officers", personId: null, label: "Certificate of directors and secretary" },
    { kind: "shareholders", personId: null, label: "Certificate of shareholders" },
  ];
  for (const person of people.filter(needsIdentity)) {
    out.push({ kind: "identity", personId: person.id, label: `${person.name}: passport or identity card` });
    out.push({ kind: "address", personId: person.id, label: `${person.name}: proof of address, no more than six months old` });
  }
  out.push({ kind: "bank_statements", personId: null, label: booksFrom ? `Bank statements from ${monthYear(booksFrom)}` : "Bank statements" });
  out.push({ kind: "prior_accounts", personId: null, label: "Last year’s accounts or trial balance" });
  return out;
}

/** The order documents are listed in: the company's certificates, each person's in the order the people were added, anything else, then what the books need. */
export function sortDocuments<T extends { kind: DocumentKind; person_id: string | null; requested_at: string }>(documents: T[], personOrder: (string | null)[]) {
  const KIND_ORDER: DocumentKind[] = ["incorporation", "registered_office", "officers", "shareholders", "identity", "address", "other", "bank_statements", "prior_accounts"];
  const group = (document: T) => FOR_THE_BOOKS.includes(document.kind) ? 3 : document.kind === "other" ? 2 : document.person_id ? 1 : 0;
  return [...documents].sort((a, b) => group(a) - group(b) || personOrder.indexOf(a.person_id) - personOrder.indexOf(b.person_id)
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.requested_at.localeCompare(b.requested_at));
}

const monthYear = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "normal" | "high";
export const RISK_LEVELS: Record<RiskLevel, { label: string; diligence: string; short: string; approver: "mlco" | "partner"; approverLabel: string; reviewYears: number }> = {
  low: { label: "Low", diligence: "Simplified due diligence", short: "SDD", approver: "mlco", approverLabel: "the compliance officer", reviewYears: 3 },
  normal: { label: "Normal", diligence: "Customer due diligence", short: "CDD", approver: "mlco", approverLabel: "the compliance officer", reviewYears: 2 },
  high: { label: "High", diligence: "Enhanced due diligence", short: "EDD", approver: "partner", approverLabel: "a partner", reviewYears: 1 },
};
export const RISK_AREAS = {
  client: { label: "Client", hint: "What the client and its owners do, who they are, how they behave" },
  service: { label: "Service", hint: "What we will do for them, and how transparent it is" },
  geography: { label: "Geography", hint: "Where the company, its directors and owners are based, and their nationality" },
  channel: { label: "Delivery channel", hint: "Whether we met them in person, and whether someone introduced them" },
} as const;
export type RiskArea = keyof typeof RISK_AREAS;
export const RISK_AREA_KEYS = Object.keys(RISK_AREAS) as RiskArea[];
export type RiskFactor = { area: RiskArea; label: string; score: number; why?: string };

/** EU high-risk third countries with strategic AML/CFT deficiencies, Delegated Regulation (EU) 2016/1675 as amended: the Commission's list, checked 26 Oct 2026. */
export const EU_HIGH_RISK: Record<string, string> = {
  AF: "Afghanistan", DZ: "Algeria", AO: "Angola", BO: "Bolivia", VG: "British Virgin Islands", CM: "Cameroon", CI: "Côte d’Ivoire", KP: "North Korea",
  CD: "Democratic Republic of the Congo", HT: "Haiti", IR: "Iran", KE: "Kenya", LA: "Laos", LB: "Lebanon", MC: "Monaco", MM: "Myanmar", NA: "Namibia",
  NP: "Nepal", RU: "Russia", SS: "South Sudan", SY: "Syria", TT: "Trinidad and Tobago", VU: "Vanuatu", VE: "Venezuela", VN: "Vietnam", YE: "Yemen",
};
const EEA = new Set([...EU_COUNTRIES, "NO", "IS", "LI"]);

/** An area's score: the average of its factors, rounded up, so a mixed area never scores below what its factors say. */
export const areaScore = (factors: RiskFactor[], area: RiskArea) => {
  const scores = factors.filter(factor => factor.area === area).map(factor => factor.score);
  return scores.length ? Math.min(5, Math.max(1, Math.ceil(scores.reduce((sum, score) => sum + score, 0) / scores.length - 1e-9))) : 1;
};
export const scoredLevel = (total: number): RiskLevel => total >= 17 ? "high" : total >= 9 ? "normal" : "low";

const SECTORS: [RegExp, number, string][] = [
  [/\b(casino|gambl|betting|crypto|virtual currenc|money (exchange|transfer)|precious|jewel|gold|bullion|arms|defen[cs]e|weapon)/i, 5, "a sector ICPAC associates with high money laundering risk"],
  [/\b(real estate|property develop|construction|developer|oil trad|fuel trad|car dealer|art dealer|antique)/i, 4, "a sector ICPAC associates with higher money laundering or corruption risk"],
  [/\b(charity|non-profit|nonprofit|foundation|ngo)\b/i, 4, "a non-profit organisation, which carries a higher terrorist financing risk"],
  [/\b(pharma|health|medical|dental|clinic)/i, 3, "healthcare, which ICPAC associates with higher corruption risk"],
  [/\b(restaurant|bar\b|café|cafe|coffee|kiosk|bakery|clothing|retail|food market|grocer)/i, 3, "a cash-intensive business"],
];

export type FileFacts = {
  business: string; services: Service[]; face_to_face: boolean; introduced_by: string | null; companyCountry?: string;
};

/**
 * Ledgerline's first reading of the risk, factor by factor, from what the file
 * says. The person assessing changes any score they disagree with; the
 * reasons stay with the assessment.
 */
export function suggestFactors(file: FileFacts, people: Person[]): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const sector = SECTORS.find(([pattern]) => pattern.test(file.business));
  factors.push({ area: "client", label: `Client activity: ${file.business || "not described yet"}`, score: sector ? sector[1] : 2, why: sector ? sector[2] : "an ordinary trading business, consistent with what we know" });
  const peps = people.filter(person => person.pep !== "no");
  const current = peps.filter(person => person.pep !== "former");
  factors.push(current.length
    ? { area: "client", label: `Politically exposed: ${current.map(person => person.name).join(", ")}`, score: 5, why: "a PEP client is always high risk" }
    : peps.length ? { area: "client", label: `Former PEP: ${peps.map(person => person.name).join(", ")}`, score: 3, why: "out of office for a year or more; judge whether the influence remains" }
      : { area: "client", label: "Directors and owners: none politically exposed", score: 1 });
  const owners = people.filter(person => person.roles.includes("beneficial_owner"));
  factors.push({ area: "client", label: `Ownership: ${owners.length ? `${owners.length} beneficial owner${owners.length === 1 ? "" : "s"}, held directly` : "beneficial owners not recorded yet"}`, score: owners.length ? 1 : 3,
    why: owners.length ? "a simple structure of natural persons" : "the people behind the company are not known yet" });

  const services = file.services.map(service => inSentence(SERVICES[service].label));
  factors.push({ area: "service", label: `Service offered: ${services.join(", ") || "not chosen yet"}`, score: file.services.includes("secretarial") ? 3 : 2,
    why: file.services.includes("secretarial") ? "acting for the company with the Registrar" : "accounting and tax services, as in ICPAC’s examples" });
  factors.push({ area: "service", label: "Instructions received directly from the directors", score: 2 });

  const companyCountry = file.companyCountry ?? "CY";
  factors.push({ area: "geography", label: `Location of business: ${personCountry(companyCountry)}`, score: geographyScore(companyCountry, "based") });
  const identified = people.filter(person => person.roles.some(role => role === "director" || role === "beneficial_owner"));
  const residences = [...new Set(identified.map(person => person.residence).filter((code): code is string => Boolean(code)))];
  const nationalities = [...new Set(identified.map(person => person.nationality).filter((code): code is string => Boolean(code)))];
  if (residences.length) factors.push({ area: "geography", label: `Residence of directors and owners: ${residences.map(personCountry).join(", ")}`, score: Math.max(...residences.map(code => geographyScore(code, "based"))),
    why: residences.some(code => EU_HIGH_RISK[code]) ? "established in an EU high-risk third country" : undefined });
  if (nationalities.length) factors.push({ area: "geography", label: `Nationality of directors and owners: ${nationalities.map(personCountry).join(", ")}`, score: Math.max(...nationalities.map(code => geographyScore(code, "national"))),
    why: nationalities.some(code => EU_HIGH_RISK[code]) ? `${nationalities.filter(code => EU_HIGH_RISK[code]).map(code => EU_HIGH_RISK[code]).join(", ")} is on the EU’s list of high-risk third countries` : undefined });

  factors.push({ area: "channel", label: file.introduced_by ? `Introduced by a third party: ${file.introduced_by}` : "Came to us directly, not introduced by a third party", score: file.introduced_by ? 3 : 1,
    why: file.introduced_by ? "check that the introducer applies due diligence to our standard" : undefined });
  factors.push({ area: "channel", label: file.face_to_face ? "Identified in person" : "Not met in person for identification", score: file.face_to_face ? 1 : 4,
    why: file.face_to_face ? undefined : "a higher risk of impersonation: verify the documents against their originals or an official source" });
  return factors;
}

function geographyScore(code: string, how: "based" | "national") {
  // ICPAC scores a link to an EU high-risk third country 5. Being established there also makes the client high risk outright; nationality alone does not.
  if (EU_HIGH_RISK[code]) return 5;
  if (code === "CY" || EEA.has(code)) return 1;
  return how === "based" ? 3 : 2;
}

/** What makes a client high risk whatever its score. */
export function forcedHigh(people: Person[]): string | null {
  const pep = people.find(person => person.pep === "pep" || person.pep === "family" || person.pep === "associate");
  if (pep) return `${pep.name} is ${pep.pep === "pep" ? "a politically exposed person" : pep.pep === "family" ? "a family member of a politically exposed person" : "a close associate of a politically exposed person"}`;
  const based = people.find(person => person.roles.some(role => role === "director" || role === "beneficial_owner") && person.residence && EU_HIGH_RISK[person.residence]);
  if (based) return `${based.name} is established in ${EU_HIGH_RISK[based.residence!]}, an EU high-risk third country`;
  return null;
}

export type RiskResult = { scores: Record<RiskArea, number>; total: number; scored: RiskLevel; forced: string | null; level: RiskLevel };
/** The assessment's outcome from its factors, and the level after any override (which can raise it, never lower a forced high). */
export function assessRisk(factors: RiskFactor[], people: Person[], override?: RiskLevel | null): RiskResult {
  const scores = Object.fromEntries(RISK_AREA_KEYS.map(area => [area, areaScore(factors, area)])) as Record<RiskArea, number>;
  const total = RISK_AREA_KEYS.reduce((sum, area) => sum + scores[area], 0);
  const scored = scoredLevel(total);
  const forced = forcedHigh(people);
  const level = forced ? "high" : override ?? scored;
  return { scores, total, scored, forced, level };
}

export const nextReview = (approvedOn: string, level: RiskLevel) => {
  const date = new Date(`${approvedOn}T12:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + RISK_LEVELS[level].reviewYears);
  return date.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// The checklist
// ---------------------------------------------------------------------------

export type ScreeningState = { personId: string | null; result: "clear" | "possible"; resolution: "not_the_same" | "confirmed" | null; listDate: string };
export type FileState = {
  file: { company_name: string; he_number: string | null; business: string; contact_email: string | null; letter_sent_at: string | null; signed_at: string | null; signed_name: string | null; organisation_id: string | null; status: string };
  people: Person[];
  documents: { kind: DocumentKind; person_id: string | null; received_at: string | null }[];
  screenings: ScreeningState[];
  assessment: { level: RiskLevel; approved_at: string | null } | null;
  listDate: string | null;
};
export type StepKey = "details" | "letter" | "people" | "documents" | "screening" | "risk" | "books";
export type Step = { key: StepKey; label: string; short: string; done: boolean; detail: string; todo: string };

/** A label inside a sentence: its first letter lower case, unless it begins an acronym ("VAT returns", "EU list"). */
export const inSentence = (label: string) => label.replace(/^[A-Z](?![A-Z])/, char => char.toLowerCase());

/** Every screened name's latest screening: the company (null) and each person. */
export function latestScreenings(screenings: ScreeningState[]) {
  const latest = new Map<string, ScreeningState>();
  for (const screening of screenings) if (!latest.has(screening.personId ?? "company")) latest.set(screening.personId ?? "company", screening);
  return latest;
}

/** Where a client file stands: seven steps, in the order they are usually done. Taking the client on needs the first six. */
export function fileSteps(state: FileState): { steps: Step[]; ready: boolean; blocked: string | null } {
  const { file, people, documents, screenings, assessment } = state;
  const missingDetails = [!file.he_number && "registration number", !file.business && "what the company does", !file.contact_email && "contact email"].filter(Boolean) as string[];
  const directors = people.filter(person => person.roles.includes("director"));
  const owners = people.filter(person => person.roles.includes("beneficial_owner"));
  const incomplete = people.filter(person => needsIdentity(person) && (!person.date_of_birth || !person.nationality || !person.residence));
  const unflagged = people.filter(person => (person.ownership ?? 0) > BENEFICIAL_OWNER_THRESHOLD && !person.roles.includes("beneficial_owner"));
  const required = documents.filter(document => !FOR_THE_BOOKS.includes(document.kind));
  const outstanding = required.filter(document => !document.received_at);
  const latest = latestScreenings(screenings);
  const unscreened = [...(latest.has("company") ? [] : [file.company_name]), ...people.filter(person => !latest.has(person.id)).map(person => person.name)];
  const open = [...latest.values()].filter(screening => screening.result === "possible" && !screening.resolution);
  const confirmed = [...latest.values()].some(screening => screening.resolution === "confirmed");
  const steps: Step[] = [
    { key: "details", label: "Company details", short: "Details", todo: "Fill in the company details", done: !missingDetails.length, detail: missingDetails.length ? `Still needed: ${missingDetails.join(", ")}` : `${file.he_number} · ${file.business}` },
    { key: "letter", label: "Engagement letter signed", short: "Letter", todo: file.letter_sent_at ? "Wait for the client to sign the letter" : "Send the engagement letter", done: Boolean(file.signed_at), detail: file.signed_at ? `Signed by ${file.signed_name}` : file.letter_sent_at ? "Sent, waiting for a signature" : "Not sent yet" },
    { key: "people", label: "Directors and beneficial owners recorded", short: "People", todo: "Record the directors and beneficial owners", done: Boolean(directors.length && owners.length && !incomplete.length && !unflagged.length),
      detail: !directors.length ? "No director recorded yet" : !owners.length ? "No beneficial owner recorded yet" : unflagged.length ? `${unflagged.map(person => person.name).join(", ")} hold${unflagged.length === 1 ? "s" : ""} more than 25%: mark as beneficial owner`
        : incomplete.length ? `Date of birth, nationality and residence still needed for ${incomplete.map(person => person.name).join(", ")}` : `${directors.length} director${directors.length === 1 ? "" : "s"}, ${owners.length} beneficial owner${owners.length === 1 ? "" : "s"}` },
    { key: "documents", label: "Identity and company documents", short: "Documents", todo: "Collect the documents", done: Boolean(required.length && !outstanding.length), detail: !required.length ? "Nothing requested yet" : outstanding.length ? `${required.length - outstanding.length} of ${required.length} received` : `All ${required.length} received` },
    { key: "screening", label: "EU sanctions screening", short: "Screening", todo: open.length ? "Decide the possible matches" : "Screen the company and its people", done: Boolean(!unscreened.length && !open.length && !confirmed && latest.size),
      detail: confirmed ? "A confirmed match: the client can’t be taken on" : open.length ? `${open.length} possible match${open.length === 1 ? "" : "es"} to look at` : unscreened.length ? `Not screened yet: ${unscreened.join(", ")}` : `Everyone clear, on the list of ${state.listDate ?? "the latest date"}` },
    { key: "risk", label: "Risk assessed and approved", short: "Risk", todo: assessment && !assessment.approved_at ? "Approve the risk rating" : "Assess the risk", done: Boolean(assessment?.approved_at), detail: !assessment ? "Not assessed yet" : assessment.approved_at ? `${RISK_LEVELS[assessment.level].label} risk` : `${RISK_LEVELS[assessment.level].label} risk, waiting for approval by ${RISK_LEVELS[assessment.level].approverLabel}` },
    { key: "books", label: "Books opened", short: "Books", todo: "Open the books", done: Boolean(file.organisation_id), detail: file.organisation_id ? "Open in Ledgerline" : "Once the steps above are done" },
  ];
  const ready = steps.slice(0, 6).every(step => step.done);
  return { steps, ready, blocked: confirmed ? "A sanctions match has been confirmed: the client can’t be taken on." : null };
}

// ---------------------------------------------------------------------------
// The engagement letter
// ---------------------------------------------------------------------------

export type LetterSection = { heading: string; paragraphs: string[]; bullets?: string[] };
export type Letter = { date: string; from: { name: string; address: string | null }; to: { company: string; address: string | null; attention: string | null }; title: string; sections: LetterSection[]; signOff: string };

const euro = (value: number) => `€${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * The engagement letter, written from the file: the same words on the page
 * the client signs, in the PDF, and in the fingerprint kept as evidence.
 */
export function engagementLetter(input: {
  date: string; practice: { name: string; address: string | null; partner: string };
  file: { company_name: string; registered_address: string | null; contact_name: string | null; services: Service[]; monthly_fee: number; hourly_rate: number; app_fee: number; books_from: string | null };
}): Letter {
  const { practice, file } = input;
  const services = SERVICE_KEYS.filter(key => file.services.includes(key));
  const fees = [`${euro(file.monthly_fee)} a month, plus VAT, for the work described above.`];
  if (file.app_fee > 0) fees.push(`${euro(file.app_fee)} a month, plus VAT, for the company’s use of our online books and invoicing.`);
  if (file.hourly_rate > 0) fees.push(`Work outside this letter, which we will agree with you before we start it, at ${euro(file.hourly_rate)} an hour, plus VAT.`);
  return {
    date: input.date,
    from: { name: practice.name, address: practice.address },
    to: { company: file.company_name, address: file.registered_address, attention: file.contact_name },
    title: `Our engagement as accountants to ${file.company_name}`,
    sections: [
      { heading: "", paragraphs: [`Thank you for choosing ${practice.name}. This letter sets out the work we will do for ${file.company_name}${file.books_from ? `, from ${monthYear(file.books_from)}` : ""}, what we need from you, and our fees. Please read it, and sign it to confirm that you agree.`] },
      { heading: "The work we will do", paragraphs: [], bullets: services.map(key => SERVICES[key].letter) },
      { heading: "What we need from you", paragraphs: ["The directors remain responsible for the company’s records, its financial statements and its tax returns. To do our work, we need:"],
        bullets: ["The month’s sales and purchase invoices, receipts and bank statements by the 10th of the following month, uploaded to Ledgerline or sent to us.", "Complete and accurate information, and an answer to our questions in good time.", "A director’s approval of each VAT return and tax return before we submit it.", "The company’s records kept for at least six years, as Cyprus tax law requires."] },
      { heading: "Our fees", paragraphs: ["We invoice our fees monthly in advance. They are due within 14 days."], bullets: fees },
      { heading: "Money laundering and sanctions", paragraphs: ["Cyprus law (the Prevention and Suppression of Money Laundering and Terrorist Financing Law, 188(I)/2007) requires us to identify the company, its directors and its beneficial owners, to verify their identity, to screen them against sanctions lists, and to keep these records for at least five years after our engagement ends. We will ask for documents for this, and from time to time again. If we know or suspect money laundering, the law may require us to report it to MOKAS, the Unit for Combating Money Laundering, without telling you."] },
      { heading: "Your information", paragraphs: [`We process the personal data you give us under the General Data Protection Regulation, only to do this work and to meet our legal obligations. ${practice.name} is the controller of that data.`] },
      { heading: "Ending the engagement", paragraphs: ["Either of us may end this engagement by giving the other 30 days’ notice in writing. Fees for work done up to that date remain due. This letter is governed by the laws of the Republic of Cyprus."] },
    ],
    signOff: `${practice.partner}, for ${practice.name}`,
  };
}

/** The letter as one block of text: what is hashed, so the fingerprint changes if a single word does. */
export function letterText(letter: Letter) {
  return [letter.date, letter.from.name, letter.from.address ?? "", letter.to.company, letter.to.address ?? "", letter.to.attention ?? "", letter.title,
    ...letter.sections.flatMap(section => [section.heading, ...section.paragraphs, ...(section.bullets ?? []).map(bullet => `• ${bullet}`)]), letter.signOff].join("\n");
}

export { longDate as letterDate };
