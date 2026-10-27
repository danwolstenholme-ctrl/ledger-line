import fs from "node:fs";
import path from "node:path";
import { createHash, randomInt, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";

import { gunzipSync } from "node:zlib";

import { STANDARD_CHART, chartFor } from "@/lib/domain/chart";
import { annualReturnDates, ukObligations } from "@/lib/domain/deadlines";
import { checkUkVatNumber, checkVatNumber } from "@/lib/domain/eu-vat";
import { assessRisk, documentRequests, engagementLetter, letterText, nextReview, suggestFactors, type Person, type Role, type Service } from "@/lib/domain/onboarding";
import { NO_YEAR, addToYear, cyMonth } from "@/lib/domain/payroll-cy";
import { businessType } from "@/lib/domain/business-types";
import { setUpWorkspace, type WorkspaceChanges } from "@/lib/db/workspace-setup";
import { SANCTIONS_INSERT, type SanctionsEntry } from "@/lib/domain/sanctions";

/**
 * The demo practice: fictional through and through. One practice, six client
 * companies, Jul 2025 – Oct 2026. Generated from a fixed seed, so a reset
 * always rebuilds the same books. Every historical bank line is reconciled;
 * October's lines are imported and left to match in the meeting.
 */

const START = "2025-07-01";
const LAST_LINE = "2026-10-20";
const RECONCILED_TO = "2026-09-30";

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(22102026);
const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
const between = (low: number, high: number) => low + rand() * (high - low);
const money = (low: number, high: number, step = 1) => Math.round(between(low, high) / step) * step;
const r2 = (value: number) => Math.round(value * 100) / 100;
const vatOn = (net: number, rate: number) => Math.round(net * rate) / 100;
const uuid = () => randomUUID();
/**
 * A fictional IBAN with correct check digits, made from a name so a reset gives
 * the same one: a made-up account number at a real bank code, never a real account.
 */
function fictionalIban(seed: string, country = "CY") {
  const digits = createHash("sha256").update(`ledgerline-demo:${seed}`).digest("hex").replace(/[a-f]/g, "").padEnd(32, "4");
  const bban = country === "CY" ? `${["002", "005", "018"][Number(digits[0]) % 3]}${digits.slice(1, 6)}${digits.slice(6, 22)}`
    : country === "NL" ? `ABNA${digits.slice(0, 10)}` : country === "DE" ? digits.slice(0, 18) : country === "GR" ? digits.slice(0, 23)
    : country === "GB" ? `${["LOYD", "NWBK", "BARC"][Number(digits[0]) % 3]}${digits.slice(1, 15)}` : null;
  if (!bban) return null;
  let remainder = 0;
  for (const digit of `${bban}${country}00`.replace(/[A-Z]/g, letter => String(letter.charCodeAt(0) - 55))) remainder = (remainder * 10 + Number(digit)) % 97;
  return `${country}${String(98 - remainder).padStart(2, "0")}${bban}`;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const day = (month: string, d: number) => `${month}-${String(Math.min(d, lastDay(month))).padStart(2, "0")}`;
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const MONTHS: string[] = [];
for (let y = 2025, m = 7; y < 2026 || (y === 2026 && m <= 10); m === 12 ? (y++, m = 1) : m++) MONTHS.push(`${y}-${String(m).padStart(2, "0")}`);

type Rate = 0 | 3 | 5 | 9 | 19 | 20;
type Account = { code: string; name: string; type: string; role?: string; description?: string; bank?: string; outsideVat?: boolean };
type CustomerSpec = { name: string; vat?: string; country?: string; eu?: boolean; treatment?: "standard" | "exempt" | "reverse_charge" | "outside_scope"; lines: { code: string; rate: Rate; range: [number, number]; text: string[] }[]; perMonth: number; payDays: [number, number]; terms: number };
type SupplierSpec = { name: string; greek?: string; vat?: string; country?: string; code: string; rate: Rate; range: [number, number]; perMonth: number; text: string; number: (seq: number, month: string) => string;
  /** A reverse charge: true for services from abroad, or the UK's construction (CIS) or imports. */
  reverseCharge?: boolean | "construction" | "import"; payDays: [number, number]; months?: string[] };
type CardSpec = { text: string; code: string; rate: Rate; range: [number, number]; perMonth: number; kind?: "spend" | "receive" };
type Profile = {
  slug: string; name: string; greek: string; industry: string; he: string; vat: string | null; tic: string; registered: boolean; quarterEnd: 1 | 2 | 3;
  address: string; contact: string; email: string; bank: { name: string; details: string }; prefix: string; lock: string;
  accounts: Account[]; customers: CustomerSpec[]; suppliers: SupplierSpec[]; card: CardSpec[];
  payroll?: { salaries: number; social: number; socialText?: string; socialCode?: string }; bankFee: number;
  /** A UK company (lib/domain/regimes): its year end, the flat rate it pays VAT at, and who VAT is paid to. */
  country?: "GB"; yearEnd?: number; flatRate?: number;
  opening: { bank: number; capital: number; fixed?: [string, number][]; loan?: number; directors?: number };
  filed?: { periodTo: string; filedOn: string }[];
  /** Sales are scaled so each company earns a believable margin. */
  scale?: number;
};

// ---------------------------------------------------------------------------
// The demo at a big practice's scale. LEDGERLINE_DEMO_COMPANIES=300 adds
// client companies until there are that many: each a variant of one of the
// eight, with its own name, numbers and bank account and its books generated
// the same way, its CRM, staff, file and fee following the one it varies.
// For seeing and timing Ledgerline with hundreds of clients; the demo has eight.
// ---------------------------------------------------------------------------

const VARIANT_PLACES: Record<string, string[]> = {
  CY: ["Akamas", "Kition", "Lefkara", "Kourion", "Amathus", "Salamis", "Tamassos", "Idalion", "Soloi", "Marion", "Chytri", "Lapithos", "Omodos", "Lania", "Pissouri", "Zygi", "Platres", "Polis", "Agros", "Lefkonico"],
  GB: ["Reading", "Bristol", "Oxford", "Bath", "Swindon", "Newbury", "Henley", "Wantage", "Didcot", "Thatcham", "Marlow", "Abingdon"],
};
const VARIANT_KINDS: Record<string, string[]> = {
  "aegean-blue-marine": ["Marine Services", "Shipping", "Yacht Management", "Ship Agency"], "troodos-gold": ["Olive Oil", "Winery", "Foods", "Farms"],
  "kalamies-dental": ["Dental Clinic", "Physiotherapy", "Medical Centre", "Eye Clinic"], "larnaka-roast": ["Coffee Co", "Bakery", "Taverna", "Café"],
  "pixelforge": ["Digital", "Software", "Studio", "Media"], "mesogeios-holdings": ["Holdings", "Investments", "Capital", "Estates"],
  "thames-edge-joinery": ["Joinery", "Builders", "Carpentry", "Interiors"], "willow-wren-design": ["Design", "Creative", "Branding", "Print"],
};
/** Each variant's original, whose CRM, people, file and fee it follows. */
const TEMPLATE = new Map<string, string>();
const base = (slug: string) => TEMPLATE.get(slug) ?? slug;
let ALL_PROFILES: Profile[] = [];
const profileOf = (slug: string) => ALL_PROFILES.find(profile => profile.slug === slug);
/** A made-up VAT number whose check letter (Cyprus) or check digits (UK) agree, so the books treat it as real. */
function variantVat(country: string, n: number) {
  if (country === "GB") {
    for (let check = 0; check < 100; check++) { const number = `GB${String(4000000 + n)}${String(check).padStart(2, "0")}`; if (checkUkVatNumber(number).ok) return number; }
    return null;
  }
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") { const number = `CY${String(10000000 + n * 7).slice(0, 8)}${letter}`; if (checkVatNumber(number).ok) return number; }
  return null;
}
function variants(total: number): Profile[] {
  const made: Profile[] = [];
  const slugs = new Set(PROFILES.map(profile => profile.slug));
  for (let n = 0; PROFILES.length + made.length < total && n < 20_000; n++) {
    const template = PROFILES[n % PROFILES.length];
    const country = template.country ?? "CY";
    const places = VARIANT_PLACES[country], kinds = VARIANT_KINDS[template.slug];
    const round = Math.floor(n / PROFILES.length), lap = Math.floor(round / (places.length * kinds.length));
    const name = `${places[round % places.length]} ${kinds[Math.floor(round / places.length) % kinds.length]}${lap ? ` ${lap + 1}` : ""} Ltd`;
    const slug = name.toLowerCase().replace(/ ltd$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
    if (slugs.has(slug)) continue;
    slugs.add(slug);
    TEMPLATE.set(slug, template.slug);
    made.push({ ...template, slug, name, greek: "", he: country === "GB" ? String(13000000 + n) : `HE ${500000 + n}`,
      vat: template.vat ? variantVat(country, n) : null, tic: country === "GB" ? String(5000000000 + n) : `${String(90000000 + n).slice(0, 8)}T`,
      email: `accounts@${slug.replace(/-/g, "")}.example`, bank: { name: template.bank.name, details: `IBAN ${fictionalIban(`variant:${slug}`, country)}` },
      prefix: `${name.split(" ").slice(0, 2).map(word => word[0]).join("").toUpperCase()}-` });
  }
  return made;
}

const BASE: Account[] = STANDARD_CHART;

const seqNumber = (prefix: string) => (seq: number, month: string) => `${prefix}${month.slice(2, 4)}${month.slice(5, 7)}-${String(seq).padStart(3, "0")}`;
const UTILITIES = (registered = true): SupplierSpec[] => [
  { name: "Island Energy Supply Ltd", greek: "ΑΙΛΑΝΤ ΕΝΕΡΤΖΙ ΣΑΠΛΑΪ ΛΤΔ", vat: "CY10411252B", code: "445", rate: 19, range: registered ? [380, 620] : [180, 320], perMonth: 1, text: "ISLAND ENERGY SUPPLY", number: (seq, month) => `IES-${month.replace("-", "")}-${4400 + seq}`, payDays: [12, 20] },
  { name: "AstraNet Telecom Ltd", vat: "CY10299881L", code: "489", rate: 19, range: [96, 96], perMonth: 1, text: "ASTRANET TELECOM", number: (seq, month) => `AT${month.replace("-", "")}${String(seq).padStart(4, "0")}`, payDays: [5, 10] },
];

const PROFILES: Profile[] = [
  {
    slug: "aegean-blue-marine", scale: 1.42, name: "Aegean Blue Marine Services Ltd", greek: "ΑΙΓΑΙΟ ΜΠΛΟΥ ΘΑΛΑΣΣΙΕΣ ΥΠΗΡΕΣΙΕΣ ΛΤΔ", industry: "Marine services and yacht management",
    he: "HE 412907", vat: "CY10412907G", tic: "12412907K", registered: true, quarterEnd: 3, lock: "2026-06-30",
    address: "14 Franklin Roosevelt Avenue, 3011 Limassol", contact: "Christos Panayiotou", email: "accounts@aegeanblue.example",
    bank: { name: "Bank of Cyprus current account", details: "IBAN CY74 0020 0128 0000 0012 0063 8415\nBIC BCYPCY2N" }, prefix: "ABM-",
    accounts: [
      { code: "200", name: "Port agency services", type: "revenue", role: "sales" },
      { code: "205", name: "Yacht management fees", type: "revenue" },
      { code: "210", name: "Crew and logistics services", type: "revenue" },
      { code: "310", name: "Port dues and pilotage", type: "direct_costs" },
      { code: "315", name: "Marine fuel and lubricants", type: "direct_costs" },
      { code: "320", name: "Chandlery and provisions", type: "direct_costs" },
    ],
    customers: [
      { name: "Akrotiri Yacht Charters Ltd", vat: "CY10388412O", perMonth: 1.6, payDays: [18, 40], terms: 30, lines: [{ code: "205", rate: 19, range: [1800, 4200], text: ["Yacht management, monthly fee", "Berth coordination and crew changes"] }] },
      { name: "Blue Horizon Shipping Ltd", vat: "CY10277610J", perMonth: 2.2, payDays: [20, 45], terms: 30, lines: [{ code: "200", rate: 19, range: [1200, 3900], text: ["Port agency, MV Horizon Star call", "Husbandry services and clearance"] }, { code: "210", rate: 19, range: [400, 1400], text: ["Crew transfers Larnaca airport"] }] },
      { name: "Kourion Bay Tours Ltd", vat: "CY10519933C", perMonth: 1.2, payDays: [10, 30], terms: 14, lines: [{ code: "210", rate: 19, range: [600, 1800], text: ["Logistics for charter season", "Provisioning coordination"] }] },
      { name: "Meridian Ship Management Ltd", vat: "CY10104477L", perMonth: 1.6, payDays: [25, 55], terms: 30, lines: [{ code: "200", rate: 19, range: [2500, 6800], text: ["Port agency, tanker call Vassiliko", "Agency fee and disbursements handling"] }] },
    ],
    suppliers: [
      { name: "Harbour Pilotage Services Ltd", greek: "ΧΑΡΜΠΟΥΡ ΠΙΛΟΤΑΖ ΣΕΡΒΙΣΙΣ ΛΤΔ", vat: "CY10233190L", code: "310", rate: 19, range: [900, 2600], perMonth: 1.4, text: "HARBOUR PILOTAGE", number: seqNumber("HP"), payDays: [14, 30] },
      { name: "Island Marine Fuels Ltd", greek: "ΑΙΛΑΝΤ ΜΑΡΙΝ ΦΙΟΥΛΣ ΛΤΔ", vat: "CY10355021F", code: "315", rate: 19, range: [1400, 3800], perMonth: 1.2, text: "ISLAND MARINE FUELS", number: (seq, month) => `IMF/${month.slice(0, 4)}/${1200 + seq * 7}`, payDays: [10, 28] },
      { name: "Limassol Ship Chandlers Ltd", vat: "CY10166734N", code: "320", rate: 19, range: [300, 1500], perMonth: 1.5, text: "LIMASSOL SHIP CHANDLERS", number: seqNumber("LSC"), payDays: [7, 21] },
      { name: "Neapolis Business Centre Ltd", vat: "CY10455510G", code: "469", rate: 19, range: [1650, 1650], perMonth: 1, text: "NEAPOLIS BUSINESS CENTRE RENT", number: (seq, month) => `NBC-R-${month.replace("-", "")}`, payDays: [1, 4] },
      ...UTILITIES(),
      { name: "Kypros General Insurance Ltd", vat: "CY10090451D", code: "433", rate: 0, range: [310, 310], perMonth: 1, text: "KYPROS GENERAL INSURANCE", number: (seq, month) => `POL-77812-${month.replace("-", "")}`, payDays: [5, 12] },
    ],
    card: [
      { text: "CARD PURCHASE FUEL STATION GERMASOGEIA", code: "449", rate: 19, range: [45, 95], perMonth: 4 },
      { text: "CARD PURCHASE HARBOUR CAFE LIMASSOL", code: "420", rate: 9, range: [18, 75], perMonth: 2 },
      { text: "CARD PURCHASE OFFICE MEGASTORE", code: "453", rate: 19, range: [25, 140], perMonth: 1 },
    ],
    payroll: { salaries: 9840, social: 2463 }, bankFee: 18.5,
    opening: { bank: 46250, capital: 5000, fixed: [["730", 21500], ["740", 9800]], loan: 18000 },
    filed: [{ periodTo: "2025-09-30", filedOn: "2025-11-06" }, { periodTo: "2025-12-31", filedOn: "2026-02-04" }, { periodTo: "2026-03-31", filedOn: "2026-05-07" }, { periodTo: "2026-06-30", filedOn: "2026-08-06" }],
  },
  {
    slug: "troodos-gold", scale: 1.7, name: "Troodos Gold Olive Oil Ltd", greek: "ΤΡΟΟΔΟΣ ΓΚΟΛΝΤ ΕΛΑΙΟΛΑΔΟ ΛΤΔ", industry: "Olive oil producer",
    he: "HE 388104", vat: "CY10388104O", tic: "12388104D", registered: true, quarterEnd: 1, lock: "2026-07-31",
    address: "3 Makariou III Street, 2800 Kakopetria", contact: "Eleni Kyprianou", email: "eleni@troodosgold.example",
    bank: { name: "Hellenic Bank current account", details: "IBAN CY78 0050 0145 0001 4501 3330 1201\nBIC HEBACY2N" }, prefix: "TG-",
    accounts: [
      { code: "200", name: "Olive oil sales", type: "revenue", role: "sales" },
      { code: "205", name: "Olive oil soap and cosmetics", type: "revenue" },
      { code: "210", name: "Tastings and mill tours", type: "revenue" },
      { code: "310", name: "Olives and pressing", type: "direct_costs" },
      { code: "315", name: "Bottles, labels and packaging", type: "direct_costs" },
    ],
    customers: [
      { name: "Nicosia Fine Foods Ltd", vat: "CY10144782P", perMonth: 1.8, payDays: [20, 45], terms: 30, lines: [{ code: "200", rate: 5, range: [900, 2600], text: ["Extra virgin olive oil 750ml × 120", "Extra virgin olive oil 5L tins × 40"] }] },
      { name: "Paphos Gourmet Deli Ltd", vat: "CY10288453A", perMonth: 1.2, payDays: [15, 40], terms: 30, lines: [{ code: "200", rate: 5, range: [400, 1300], text: ["Early harvest olive oil 500ml × 60"] }, { code: "205", rate: 19, range: [150, 480], text: ["Olive oil soap gift boxes"] }] },
      { name: "Coral Sands Hotel Ltd", vat: "CY10501127A", perMonth: 1, payDays: [30, 60], terms: 45, lines: [{ code: "200", rate: 5, range: [700, 1900], text: ["Olive oil for restaurant, monthly supply"] }, { code: "210", rate: 19, range: [300, 900], text: ["Guest tastings at the mill"] }] },
    ],
    suppliers: [
      { name: "Marathasa Olive Pressing Ltd", greek: "ΕΛΑΙΟΤΡΙΒΕΙΟ ΜΑΡΑΘΑΣΑΣ ΛΤΔ", vat: "CY10120339W", code: "310", rate: 5, range: [600, 2400], perMonth: 1.1, text: "MARATHASA OLIVE PRESSING", number: (seq, month) => `ΤΔΑ ${month.slice(2, 4)}${String(100 + seq)}`, payDays: [15, 35] },
      { name: "Mediterranean Glass Bottles Ltd", vat: "CY10233611W", code: "315", rate: 19, range: [450, 1600], perMonth: 0.9, text: "MEDITERRANEAN GLASS BOTTLES", number: seqNumber("MGB"), payDays: [20, 40] },
      ...UTILITIES(),
      { name: "Kypros General Insurance Ltd", vat: "CY10090451D", code: "433", rate: 0, range: [145, 145], perMonth: 1, text: "KYPROS GENERAL INSURANCE", number: (seq, month) => `POL-55120-${month.replace("-", "")}`, payDays: [5, 12] },
    ],
    card: [
      { text: "CARD PURCHASE FUEL STATION KAKOPETRIA", code: "449", rate: 19, range: [40, 80], perMonth: 2 },
      { text: "CARD PURCHASE BUILDERS MERCHANT EVRYCHOU", code: "473", rate: 19, range: [30, 260], perMonth: 1 },
      { text: "ONLINE SHOP PAYOUT WEB SALES", code: "200", rate: 5, range: [180, 640], perMonth: 2, kind: "receive" },
    ],
    payroll: { salaries: 4120, social: 1031 }, bankFee: 12,
    opening: { bank: 18400, capital: 2000, fixed: [["740", 38500]], loan: 25000 },
    filed: [{ periodTo: "2025-07-31", filedOn: "2025-09-05" }, { periodTo: "2025-10-31", filedOn: "2025-12-08" }, { periodTo: "2026-01-31", filedOn: "2026-03-06" }, { periodTo: "2026-04-30", filedOn: "2026-06-04" }, { periodTo: "2026-07-31", filedOn: "2026-09-08" }],
  },
  {
    slug: "kalamies-dental", scale: 1.55, name: "Kalamies Dental Clinic Ltd", greek: "ΟΔΟΝΤΙΑΤΡΙΚΗ ΚΛΙΝΙΚΗ ΚΑΛΑΜΙΕΣ ΛΤΔ", industry: "Dental clinic (exempt supplies)",
    he: "HE 401266", vat: null, tic: "12401266Q", registered: false, quarterEnd: 3, lock: "2025-12-31",
    address: "22 Grigori Afxentiou Avenue, 6023 Larnaca", contact: "Dr Sofia Hadjioannou", email: "office@kalamiesdental.example",
    bank: { name: "Bank of Cyprus current account", details: "IBAN CY71 0020 0195 0000 3570 2251 4400\nBIC BCYPCY2N" }, prefix: "KDC-",
    accounts: [
      { code: "200", name: "Dental treatment fees", type: "revenue", role: "sales", description: "Exempt from VAT: medical care" },
      { code: "310", name: "Dental supplies and materials", type: "direct_costs" },
      { code: "315", name: "Dental laboratory fees", type: "direct_costs" },
    ],
    customers: [
      { name: "Medisure Health Insurance Ltd", vat: "CY10077120F", treatment: "exempt", perMonth: 1, payDays: [25, 50], terms: 30, lines: [{ code: "200", rate: 0, range: [2200, 5200], text: ["Insured patients, treatment claims for the month"] }] },
      { name: "Olympic Health Cover Ltd", vat: "CY10244501Z", treatment: "exempt", perMonth: 1, payDays: [30, 55], terms: 30, lines: [{ code: "200", rate: 0, range: [1400, 3600], text: ["Insured patients, treatment claims"] }] },
    ],
    suppliers: [
      { name: "DentalPro Supplies Ltd", greek: "ΝΤΕΝΤΑΛΠΡΟ ΠΡΟΜΗΘΕΙΕΣ ΛΤΔ", vat: "CY10190244Z", code: "310", rate: 19, range: [600, 1700], perMonth: 1.3, text: "DENTALPRO SUPPLIES", number: seqNumber("DP"), payDays: [10, 30] },
      { name: "Larnaca Dental Laboratory Ltd", vat: "CY10301877N", code: "315", rate: 19, range: [700, 2100], perMonth: 1, text: "LARNACA DENTAL LAB", number: seqNumber("LDL"), payDays: [14, 30] },
      { name: "Phinikoudes Properties Ltd", vat: "CY10411900U", code: "469", rate: 19, range: [1400, 1400], perMonth: 1, text: "PHINIKOUDES PROPERTIES RENT", number: (seq, month) => `RENT-${month.replace("-", "")}`, payDays: [1, 3] },
      ...UTILITIES(false),
    ],
    card: [
      { text: "CARD TERMINAL SETTLEMENT PATIENT PAYMENTS", code: "200", rate: 0, range: [380, 1650], perMonth: 6, kind: "receive" },
      { text: "CARD PURCHASE PHARMACY LARNACA", code: "310", rate: 19, range: [20, 120], perMonth: 2 },
    ],
    payroll: { salaries: 6900, social: 1727 }, bankFee: 14,
    opening: { bank: 22800, capital: 1000, fixed: [["740", 64000], ["720", 4200]], loan: 40000 },
  },
  {
    slug: "larnaka-roast", scale: 2.1, name: "Larnaka Roast Coffee Co Ltd", greek: "ΛΑΡΝΑΚΑ ΡΟΣΤ ΚΑΦΕΣ ΛΤΔ", industry: "Coffee roaster and coffee bar",
    he: "HE 395540", vat: "CY10395540R", tic: "12395540G", registered: true, quarterEnd: 2, lock: "2026-08-31",
    address: "41 Ermou Street, 6021 Larnaca", contact: "Marios Georgiou", email: "marios@larnakaroast.example",
    bank: { name: "Eurobank current account", details: "IBAN CY15 0180 0001 0000 0020 1774 3301\nBIC ERBKCY2N" }, prefix: "LRC-",
    accounts: [
      { code: "200", name: "Coffee bar sales", type: "revenue", role: "sales" },
      { code: "205", name: "Equipment and merchandise", type: "revenue" },
      { code: "210", name: "Barista training", type: "revenue" },
      { code: "310", name: "Green coffee", type: "direct_costs" },
      { code: "315", name: "Milk and consumables", type: "direct_costs" },
    ],
    customers: [
      { name: "Coral Sands Hotel Ltd", vat: "CY10501127A", perMonth: 1, payDays: [25, 50], terms: 30, lines: [{ code: "200", rate: 9, range: [900, 2100], text: ["Coffee service for conference events"] }, { code: "205", rate: 19, range: [200, 900], text: ["Grinder and espresso machine servicing kit"] }] },
      { name: "Finikoudes Beach Kiosk Ltd", vat: "CY10472210X", perMonth: 0.8, payDays: [10, 30], terms: 14, lines: [{ code: "205", rate: 19, range: [300, 1200], text: ["Espresso machine lease and parts"] }, { code: "210", rate: 19, range: [150, 450], text: ["Barista training, two staff"] }] },
    ],
    suppliers: [
      { name: "Highland Green Coffee Traders Ltd", vat: "CY10322908G", code: "310", rate: 5, range: [1300, 3400], perMonth: 1, text: "HIGHLAND GREEN COFFEE", number: seqNumber("HGC"), payDays: [20, 35] },
      { name: "Troodos Dairy Ltd", greek: "ΓΑΛΑΚΤΟΚΟΜΕΙΟ ΤΡΟΟΔΟΥΣ ΛΤΔ", vat: "CY10134400R", code: "315", rate: 5, range: [380, 760], perMonth: 2, text: "TROODOS DAIRY", number: seqNumber("TD"), payDays: [7, 15] },
      { name: "Ermou Street Properties Ltd", vat: "CY10288700O", code: "469", rate: 19, range: [1200, 1200], perMonth: 1, text: "ERMOU STREET PROPERTIES RENT", number: (seq, month) => `ESP-${month.replace("-", "")}`, payDays: [1, 3] },
      ...UTILITIES(),
    ],
    card: [
      { text: "CARD SETTLEMENT MERCHANT 4471 COFFEE BAR", code: "200", rate: 9, range: [310, 980], perMonth: 9, kind: "receive" },
      { text: "CARD PURCHASE CASH AND CARRY ARADIPPOU", code: "315", rate: 19, range: [40, 210], perMonth: 2 },
    ],
    payroll: { salaries: 5650, social: 1414 }, bankFee: 16,
    opening: { bank: 12900, capital: 5000, fixed: [["740", 27800]], loan: 15000 },
    filed: [{ periodTo: "2025-08-31", filedOn: "2025-10-07" }, { periodTo: "2025-11-30", filedOn: "2026-01-08" }, { periodTo: "2026-02-28", filedOn: "2026-04-07" }, { periodTo: "2026-05-31", filedOn: "2026-07-08" }, { periodTo: "2026-08-31", filedOn: "2026-10-08" }],
  },
  {
    slug: "pixelforge", scale: 1.45, name: "Pixelforge Studio Ltd", greek: "ΠΙΞΕΛΦΟΡΤΖ ΣΤΟΥΝΤΙΟ ΛΤΔ", industry: "Software studio (EU clients)",
    he: "HE 420118", vat: "CY10420118V", tic: "12420118S", registered: true, quarterEnd: 3, lock: "2026-09-30",
    address: "8 Diagorou Street, 1097 Nicosia", contact: "Nikos Savva", email: "finance@pixelforge.example",
    bank: { name: "Bank of Cyprus current account", details: "IBAN CY24 0020 0128 0000 0012 8814 9902\nBIC BCYPCY2N" }, prefix: "PF-",
    accounts: [
      { code: "200", name: "Software development, EU clients", type: "revenue", role: "sales", description: "Services to EU businesses under the reverse charge" },
      { code: "205", name: "Software development, Cyprus clients", type: "revenue" },
      { code: "210", name: "Hosting and support retainers", type: "revenue" },
      { code: "310", name: "Subcontracted developers", type: "direct_costs" },
    ],
    customers: [
      { name: "Nordlicht Software GmbH", vat: "DE298765435", country: "DE", eu: true, treatment: "reverse_charge", perMonth: 1, payDays: [20, 35], terms: 30, lines: [{ code: "200", rate: 0, range: [6800, 11800], text: ["Mobile app development, sprint", "Backend API development"] }] },
      { name: "Brabant Digital BV", vat: "NL859123455B01", country: "NL", eu: true, treatment: "reverse_charge", perMonth: 0.8, payDays: [25, 45], terms: 30, lines: [{ code: "200", rate: 0, range: [4200, 8800], text: ["E-commerce platform build", "UX research and prototyping"] }, { code: "210", rate: 0, range: [600, 1200], text: ["Hosting and support retainer"] }] },
      { name: "Atelier Lumière SAS", vat: "FR72823456785", country: "FR", eu: true, treatment: "reverse_charge", perMonth: 0.5, payDays: [30, 50], terms: 45, lines: [{ code: "200", rate: 0, range: [3600, 7400], text: ["Booking system development"] }] },
      { name: "Helios Hotels Cyprus Ltd", vat: "CY10233457N", perMonth: 0.7, payDays: [20, 40], terms: 30, lines: [{ code: "205", rate: 19, range: [2400, 5200], text: ["Guest app development"] }, { code: "210", rate: 19, range: [450, 450], text: ["Support retainer"] }] },
    ],
    suppliers: [
      { name: "Nimbus Cloud Services BV", vat: "NL822334458B01", country: "NL", code: "485", rate: 19, range: [640, 1180], perMonth: 1, text: "NIMBUS CLOUD SERVICES", number: (seq, month) => `NCS-${month.replace("-", "")}-77${seq}`, reverseCharge: true, payDays: [1, 3] },
      { name: "Workspace Nicosia Ltd", vat: "CY10388921X", code: "469", rate: 19, range: [2100, 2100], perMonth: 1, text: "WORKSPACE NICOSIA RENT", number: (seq, month) => `WN-${month.replace("-", "")}`, payDays: [1, 4] },
      { name: "Andreas Ioannou (freelance developer)", code: "310", rate: 0, range: [2200, 3600], perMonth: 1, text: "ANDREAS IOANNOU", number: (seq, month) => `AI-${month.replace("-", "")}`, payDays: [3, 8] },
      ...UTILITIES(),
    ],
    card: [
      { text: "CARD PURCHASE SOFTWARE SUBSCRIPTION DESIGNKIT", code: "485", rate: 19, range: [49, 49], perMonth: 1 },
      { text: "CARD PURCHASE TAXI NICOSIA", code: "493", rate: 9, range: [12, 38], perMonth: 2 },
    ],
    payroll: { salaries: 14800, social: 3704 }, bankFee: 22,
    opening: { bank: 61200, capital: 10000, fixed: [["720", 18600]] },
    filed: [{ periodTo: "2025-09-30", filedOn: "2025-11-05" }, { periodTo: "2025-12-31", filedOn: "2026-02-06" }, { periodTo: "2026-03-31", filedOn: "2026-05-05" }, { periodTo: "2026-06-30", filedOn: "2026-08-05" }, { periodTo: "2026-09-30", filedOn: "2026-10-14" }],
  },
  {
    slug: "mesogeios-holdings", name: "Mesogeios Holdings Ltd", greek: "ΜΕΣΟΓΕΙΟΣ ΧΟΛΝΤΙΝΓΚΣ ΛΤΔ", industry: "Holding company",
    he: "HE 301770", vat: null, tic: "12301770M", registered: false, quarterEnd: 3, lock: "2025-12-31",
    address: "1 Archbishop Makarios III Avenue, 1065 Nicosia", contact: "Petros Constantinou", email: "petros@mesogeios.example",
    bank: { name: "Bank of Cyprus current account", details: "IBAN CY59 0020 0128 0000 0099 1220 4417\nBIC BCYPCY2N" }, prefix: "MH-",
    accounts: [
      { code: "200", name: "Management fees", type: "revenue", role: "sales" },
      { code: "265", name: "Dividends received", type: "other_income" },
      { code: "650", name: "Loan to subsidiary", type: "current_asset" },
      { code: "750", name: "Investment in subsidiaries", type: "fixed_asset" },
    ],
    customers: [
      { name: "Mesogeios Hotels Ltd", vat: "CY10300456F", treatment: "exempt", perMonth: 0.34, payDays: [10, 25], terms: 30, lines: [{ code: "270", rate: 0, range: [3750, 3750], text: ["Interest on shareholder loan, quarter"] }] },
    ],
    suppliers: [
      { name: "Kition Audit Partners Ltd", vat: "CY10166001X", code: "412", rate: 19, range: [450, 450], perMonth: 0.34, text: "KITION AUDIT PARTNERS", number: seqNumber("KAP"), payDays: [10, 30] },
    ],
    card: [{ text: "DIVIDEND MESOGEIOS HOTELS LTD", code: "265", rate: 0, range: [25000, 25000], perMonth: 0.17, kind: "receive" }],
    bankFee: 9,
    opening: { bank: 84500, capital: 100000, fixed: [["750", 350000]], directors: 0 },
  },
  // Two UK clients (lib/domain/regimes). A joinery subcontractor whose sales to contractors are under the CIS domestic
  // reverse charge, and who buys in labour the same way: most of what it sells carries no VAT, so HMRC repays it.
  {
    slug: "thames-edge-joinery", country: "GB", yearEnd: 3, scale: 1.3, name: "Thames Edge Joinery Ltd", greek: "", industry: "Joinery and fit-out subcontractor (CIS)",
    he: "10873540", vat: "GB341872692", tic: "4831957206", registered: true, quarterEnd: 1, lock: "2026-07-31",
    address: "Unit 4, Kennet Side Works, Reading RG1 3DW", contact: "Tom Ashworth", email: "accounts@thamesedgejoinery.example",
    bank: { name: "Lloyds business current account", details: "Sort code 30-96-34 · Account 48201736\nIBAN GB82 LOYD 3096 3448 2017 36\nBIC LOYDGB21" }, prefix: "TEJ-",
    accounts: [
      { code: "200", name: "Joinery and fit-out (CIS reverse charge)", type: "revenue", role: "sales" },
      { code: "205", name: "Small works for property owners", type: "revenue" },
      { code: "310", name: "Timber and sheet materials", type: "direct_costs" },
      { code: "315", name: "Ironmongery and fixings", type: "direct_costs" },
      { code: "320", name: "Labour-only subcontractors (CIS)", type: "direct_costs" },
    ],
    customers: [
      { name: "Brookmere Construction Ltd", vat: "GB276193477", treatment: "reverse_charge", perMonth: 1.4, payDays: [25, 45], terms: 30, lines: [{ code: "200", rate: 20, range: [3200, 9800], text: ["Second fix joinery, Kennet Wharf block B", "Bespoke staircase, plot 14", "Fire doors and frames, level 2"] }] },
      { name: "Caversham Homes Ltd", vat: "GB385041793", treatment: "reverse_charge", perMonth: 1.1, payDays: [20, 40], terms: 30, lines: [{ code: "200", rate: 20, range: [2400, 7200], text: ["Kitchen fit-out, plots 3 to 6", "Skirting, architrave and doors, show home"] }] },
      { name: "Hartley Lettings Ltd", vat: "GB312966401", perMonth: 0.8, payDays: [10, 25], terms: 14, lines: [{ code: "205", rate: 20, range: [280, 1400], text: ["Replacement sash window, 12 Albert Road", "Door repairs and easing, Caversham flats"] }] },
    ],
    suppliers: [
      { name: "Kennet Timber Merchants Ltd", vat: "GB448209189", code: "310", rate: 20, range: [900, 3400], perMonth: 2, text: "KENNET TIMBER", number: seqNumber("KTM"), payDays: [20, 35] },
      { name: "Arbor Fixings Ltd", vat: "GB295883046", code: "315", rate: 20, range: [120, 640], perMonth: 1.5, text: "ARBOR FIXINGS", number: seqNumber("AF"), payDays: [10, 30] },
      { name: "Wren Site Labour Ltd", vat: "GB330771518", code: "320", rate: 20, range: [1800, 4200], perMonth: 1, text: "WREN SITE LABOUR", number: seqNumber("WSL"), reverseCharge: "construction", payDays: [7, 14] },
      { name: "Riverside Energy Ltd", vat: "GB401652829", code: "445", rate: 20, range: [160, 320], perMonth: 1, text: "RIVERSIDE ENERGY", number: (seq, month) => `RE-${month.replace("-", "")}-${3100 + seq}`, payDays: [10, 16] },
      { name: "Thameside Van Leasing Ltd", vat: "GB367124985", code: "449", rate: 20, range: [540, 540], perMonth: 1, text: "THAMESIDE VAN LEASING", number: (seq, month) => `TVL-${month.replace("-", "")}`, payDays: [1, 4] },
    ],
    card: [
      { text: "CARD PURCHASE FUEL OXFORD ROAD READING", code: "449", rate: 20, range: [55, 110], perMonth: 4 },
      { text: "CARD PURCHASE TOOLSTATION READING", code: "315", rate: 20, range: [18, 160], perMonth: 2 },
    ],
    payroll: { salaries: 6900, social: 2310, socialText: "HMRC NDDS PAYE NIC", socialCode: "478" }, bankFee: 8.5,
    opening: { bank: 38600, capital: 1000, fixed: [["730", 24800], ["740", 11200]], loan: 15000 },
    filed: [{ periodTo: "2025-07-31", filedOn: "2025-09-02" }, { periodTo: "2025-10-31", filedOn: "2025-12-03" }, { periodTo: "2026-01-31", filedOn: "2026-03-04" }, { periodTo: "2026-04-30", filedOn: "2026-06-02" }, { periodTo: "2026-07-31", filedOn: "2026-09-03" }],
  },
  // A design studio on the Flat Rate Scheme at 12%: its costs carry no VAT to reclaim, but for one computer over £2,000.
  {
    slug: "willow-wren-design", country: "GB", flatRate: 12, name: "Willow & Wren Design Ltd", greek: "", industry: "Brand and web design studio (Flat Rate Scheme)",
    he: "13147206", vat: "GB429715376", tic: "7302648195", registered: true, quarterEnd: 3, lock: "2026-06-30",
    address: "Studio 9, Paintworks, Arnos Vale, Bristol BS4 3EH", contact: "Hannah Wren", email: "hello@willowandwren.example",
    bank: { name: "Starling business account", details: "Sort code 60-83-71 · Account 21874630\nIBAN GB46 SRLG 6083 7121 8746 30\nBIC SRLGGB2L" }, prefix: "WW-",
    accounts: [
      { code: "200", name: "Brand identity projects", type: "revenue", role: "sales" },
      { code: "205", name: "Websites and retainers", type: "revenue" },
      { code: "310", name: "Print and production", type: "direct_costs" },
    ],
    customers: [
      { name: "Halcyon Coffee Roasters Ltd", vat: "GB248360791", perMonth: 0.8, payDays: [14, 30], terms: 14, lines: [{ code: "200", rate: 20, range: [1800, 4800], text: ["Brand identity, phase one", "Packaging design, seasonal range"] }] },
      { name: "Clifton Physio Clinic Ltd", perMonth: 1, payDays: [10, 25], terms: 14, lines: [{ code: "205", rate: 20, range: [450, 450], text: ["Website care plan, monthly"] }] },
      { name: "Avon Valley Cider Co Ltd", vat: "GB391724088", perMonth: 0.6, payDays: [20, 40], terms: 30, lines: [{ code: "200", rate: 20, range: [1200, 3600], text: ["Label redesign, three ciders", "Trade show stand graphics"] }] },
      { name: "Northgate Architects LLP", vat: "GB412058632", perMonth: 0.7, payDays: [15, 35], terms: 30, lines: [{ code: "205", rate: 20, range: [900, 2600], text: ["Website rebuild, project pages", "Bid document design"] }] },
    ],
    suppliers: [
      { name: "Paintworks Studios Ltd", code: "469", rate: 0, range: [1150, 1150], perMonth: 1, text: "PAINTWORKS STUDIOS RENT", number: (seq, month) => `PW-${month.replace("-", "")}`, payDays: [1, 3] },
      { name: "Inkwell Print Ltd", code: "310", rate: 0, range: [180, 960], perMonth: 1, text: "INKWELL PRINT", number: seqNumber("INK"), payDays: [12, 25] },
      { name: "Severn Signal Telecom Ltd", code: "489", rate: 0, range: [54, 54], perMonth: 1, text: "SEVERN SIGNAL TELECOM", number: (seq, month) => `SST${month.replace("-", "")}${String(seq).padStart(3, "0")}`, payDays: [5, 9] },
      { name: "Clevedon Computers Ltd", vat: "GB358601292", code: "720", rate: 20, range: [2200, 2200], perMonth: 0, months: ["2026-02"], text: "CLEVEDON COMPUTERS", number: seqNumber("CC"), payDays: [5, 10] },
    ],
    card: [
      { text: "CARD PURCHASE ADOBE SYSTEMS", code: "485", rate: 0, range: [62.4, 62.4], perMonth: 1 },
      { text: "CARD PURCHASE GWR TRAINS", code: "493", rate: 0, range: [24, 96], perMonth: 1.5 },
      { text: "CARD PURCHASE HARBOURSIDE COFFEE", code: "420", rate: 0, range: [6, 28], perMonth: 2 },
    ],
    payroll: { salaries: 3100, social: 640, socialText: "HMRC NDDS PAYE NIC", socialCode: "478" }, bankFee: 6,
    opening: { bank: 24300, capital: 100, fixed: [["720", 3800]] },
    filed: [{ periodTo: "2025-09-30", filedOn: "2025-11-04" }, { periodTo: "2025-12-31", filedOn: "2026-02-03" }, { periodTo: "2026-03-31", filedOn: "2026-05-05" }, { periodTo: "2026-06-30", filedOn: "2026-08-04" }],
  },
];

// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {
  practices: [], app_users: [], organisations: [], ledger_accounts: [], customers: [], suppliers: [], invoices: [], invoice_lines: [],
  invoice_payments: [], bills: [], bill_lines: [], bill_payments: [], bank_transactions: [], bank_transaction_lines: [], journal_entries: [], journal_lines: [],
  bank_statement_imports: [], bank_statement_lines: [], bank_line_matches: [],
};
const ORDER = ["practices", "app_users", "organisations", "ledger_accounts", "customers", "suppliers", "invoices", "invoice_lines", "bills", "bill_lines",
  "bank_transactions", "bank_transaction_lines", "journal_entries", "journal_lines", "bank_statement_imports", "bank_statement_lines", "invoice_payments", "bill_payments", "bank_line_matches"];

type Movement = { date: string; amount: number; text: string; reference: string | null; counterparty: string | null; match: Row | null };

/** Who at the practice looks after each company. */
const MANAGERS: Record<string, string> = {
  "aegean-blue-marine": "Andreas Kyriakou", "kalamies-dental": "Sofia Georgiou", "larnaka-roast": "Maria Antoniou",
  "mesogeios-holdings": "Maria Antoniou", "pixelforge": "Sofia Georgiou", "troodos-gold": "Andreas Kyriakou",
  "thames-edge-joinery": "Andreas Kyriakou", "willow-wren-design": "Sofia Georgiou",
};

export async function seedDemo(pg: PGlite, options: { companies?: number } = {}) {
  rand = mulberry32(22102026);
  for (const key of Object.keys(T)) T[key] = [];
  TEMPLATE.clear();
  const total = options.companies ?? Number(process.env.LEDGERLINE_DEMO_COMPANIES ?? 0);
  ALL_PROFILES = total > PROFILES.length ? [...PROFILES, ...variants(total)] : PROFILES;
  const practiceId = uuid();
  T.practices.push({ id: practiceId, name: "Saltlake Accounting", initials: "SA", brand_color: "#0d6e6e", tagline: "Chartered accountants, Larnaca" });
  T.app_users.push({ id: uuid(), name: "Maria Antoniou", email: "maria@saltlake.example", initials: "MA" });
  const vatFacts: { org: string; profile: Profile; quarters: Map<string, number> }[] = [];

  for (const profile of ALL_PROFILES) {
    const org = uuid();
    const accounts = new Map<string, string>();
    const bankId = uuid();
    accounts.set("090", bankId);
    T.ledger_accounts.push({ id: bankId, organisation_id: org, code: "090", name: profile.bank.name, type: "bank", bank_details: profile.bank.details });
    for (const account of [...chartFor(profile.country), ...profile.accounts]) {
      if (accounts.has(account.code)) continue;
      const id = uuid();
      accounts.set(account.code, id);
      T.ledger_accounts.push({ id, organisation_id: org, code: account.code, name: account.name, type: account.type, system_role: account.role ?? null, description: account.description ?? null,
        outside_vat: "outsideVat" in account ? Boolean(account.outsideVat) : false });
    }
    T.organisations.push({
      id: org, practice_id: practiceId, slug: profile.slug, name: profile.name, greek_name: profile.greek, industry: profile.industry, he_number: profile.he,
      vat_number: profile.vat, tic: profile.tic, vat_registered: profile.registered, vat_quarter_end_month: profile.quarterEnd, year_end_month: profile.yearEnd ?? 12,
      country: profile.country ?? "CY", currency: profile.country === "GB" ? "GBP" : "EUR", vat_flat_rate: profile.flatRate ?? null,
      default_bank_account_id: bankId, contact_name: profile.contact, contact_email: profile.email, address: profile.address,
      invoice_prefix: profile.prefix, payment_terms_days: base(profile.slug) === "larnaka-roast" ? 14 : 30,
      manager: MANAGERS[profile.slug] ?? (TEMPLATE.has(profile.slug) ? STAFF[ALL_PROFILES.indexOf(profile) % STAFF.length].name : "Maria Antoniou"),
      // On Ledgerline since its books were opened, the day its client file says.
      created_at: "2025-06-30T11:20:00.000Z",
    });
    const acc = (code: string) => { const id = accounts.get(code); if (!id) throw new Error(`${profile.slug}: no account ${code}`); return id; };
    const movements: Movement[] = [];
    const quarterVat = new Map<string, number>();
    const quarterOf = (date: string) => {
      const month = Number(date.slice(5, 7)), year = Number(date.slice(0, 4));
      let end = month; while ((end - profile.quarterEnd) % 3 !== 0) end += 1;
      const endYear = end > 12 ? year + 1 : year, endMonth = end > 12 ? end - 12 : end;
      return `${endYear}-${String(endMonth).padStart(2, "0")}`;
    };
    const addVat = (date: string, amount: number) => { if (profile.registered) quarterVat.set(quarterOf(date), r2((quarterVat.get(quarterOf(date)) ?? 0) + amount)); };
    // On the flat rate, what is paid is a percentage of turnover with its VAT, less VAT on capital purchases.
    const grossSales = new Map<string, number>(), capitalVat = new Map<string, number>();
    const addSale = (date: string, gross: number) => { if (profile.flatRate) grossSales.set(quarterOf(date), r2((grossSales.get(quarterOf(date)) ?? 0) + gross)); };

    // Opening balances, 1 July 2025.
    const opening = uuid();
    const fixed = profile.opening.fixed ?? [];
    const openingLines: [string, number, number][] = [["090", profile.opening.bank, 0], ...fixed.map(([code, amount]) => [code, amount, 0] as [string, number, number]), ["950", 0, profile.opening.capital]];
    if (profile.opening.loan) openingLines.push(["900", 0, profile.opening.loan]);
    const retained = r2(profile.opening.bank + fixed.reduce((sum, [, amount]) => sum + amount, 0) - profile.opening.capital - (profile.opening.loan ?? 0));
    openingLines.push(["960", retained >= 0 ? 0 : -retained, retained >= 0 ? retained : 0]);
    T.journal_entries.push({ id: opening, organisation_id: org, entry_date: START, source: "manual", reference: "OB-2025", narration: "Opening balances on moving the books to Ledgerline", created_at: "2025-07-03T09:00:00.000Z" });
    for (const [code, debit, credit] of openingLines) if (debit || credit) T.journal_lines.push({ id: uuid(), organisation_id: org, entry_id: opening, account_id: acc(code), debit, credit, is_tax: false });

    // Customers and their invoices.
    let invoiceSeq = 0;
    for (const spec of profile.customers) {
      const customer = uuid();
      T.customers.push({ id: customer, organisation_id: org, name: spec.name, vat_number: spec.vat ?? null, country: spec.country ?? profile.country ?? "CY", eu_business: Boolean(spec.eu), default_account_id: acc(spec.lines[0].code),
        payment_terms_days: spec.terms === (base(profile.slug) === "larnaka-roast" ? 14 : 30) ? null : spec.terms });
      for (const month of MONTHS) {
        let count = Math.floor(spec.perMonth) + (rand() < spec.perMonth % 1 ? 1 : 0);
        if (month === "2026-10") count = Math.min(count, 1);
        for (let n = 0; n < count; n++) {
          const issued = day(month, Math.floor(between(2, month === "2026-10" ? 14 : 26)));
          if (issued > LAST_LINE) continue;
          invoiceSeq += 1;
          const id = uuid(), number = `${profile.prefix}${issued.slice(0, 4)}-${String(invoiceSeq + 100).padStart(4, "0")}`;
          const treatment = spec.treatment ?? "standard";
          const lines = spec.lines.filter((_, index) => index === 0 || rand() < 0.55).map((line, position) => {
            const net = money(line.range[0] * (profile.scale ?? 1), line.range[1] * (profile.scale ?? 1), line.range[0] === line.range[1] ? 1 : 5);
            const vat = treatment === "standard" ? vatOn(net, line.rate) : 0;
            return { id: uuid(), organisation_id: org, invoice_id: id, position: position + 1, description: pick(line.text), account_id: acc(line.code), net, vat_rate: treatment === "standard" ? line.rate : 0, vat_amount: vat };
          });
          const net = r2(lines.reduce((sum, line) => sum + line.net, 0)), vat = r2(lines.reduce((sum, line) => sum + line.vat_amount, 0)), total = r2(net + vat);
          T.invoices.push({ id, organisation_id: org, customer_id: customer, number, issued_on: issued, due_on: addDays(issued, spec.terms), vat_treatment: treatment, net, vat_amount: vat, status: "issued", created_at: `${issued}T08:30:00.000Z`, sent_at: `${issued}T09:15:00.000Z` });
          T.invoice_lines.push(...lines);
          addVat(issued, vat);
          addSale(issued, total);
          // Most are paid in full; one in twenty-five is still owed, long overdue.
          if (rand() < 0.04 && month < "2026-09") continue;
          const paid = addDays(issued, Math.floor(between(spec.payDays[0], spec.payDays[1])));
          if (paid > LAST_LINE) continue;
          const reference = rand() < 0.75 ? number : null;
          const text = `TRANSFER FROM ${spec.name.toUpperCase()}${reference ? ` ${reference}` : ""}`;
          if (paid > RECONCILED_TO) {
            // October: on the statement, not yet in the books. One customer pays part.
            const part = movements.filter(item => item.date > RECONCILED_TO && item.amount > 0 && item.match === null).length === 1 && total > 500;
            movements.push({ date: paid, amount: part ? r2(Math.round(total / 2)) : total, text: part ? `TRANSFER FROM ${spec.name.toUpperCase()} PART PAYMENT ${number}` : text, reference, counterparty: spec.name, match: null });
            continue;
          }
          const payment = { id: uuid(), organisation_id: org, invoice_id: id, received_on: paid, amount: total, bank_account_id: bankId, method: "bank_transfer", reference: reference ?? number };
          T.invoice_payments.push(payment);
          movements.push({ date: paid, amount: total, text, reference, counterparty: spec.name, match: { invoice_payment_id: payment.id } });
        }
      }
    }

    // Suppliers and their bills.
    for (const spec of profile.suppliers) {
      const supplier = uuid();
      // Utilities take their money by direct debit; everyone else is paid by transfer to the IBAN they print.
      const utility = /ENERGY|TELECOM/.test(spec.text);
      T.suppliers.push({ id: supplier, organisation_id: org, name: spec.name, greek_name: spec.greek ?? null, vat_number: spec.vat ?? null, country: spec.country ?? profile.country ?? "CY",
        default_account_id: acc(spec.code), reverse_charge: Boolean(spec.reverseCharge), iban: utility ? null : fictionalIban(spec.name, spec.country ?? profile.country ?? "CY") });
      let seq = 0;
      for (const month of MONTHS) {
        const count = spec.months ? (spec.months.includes(month) ? 1 : 0) : Math.floor(spec.perMonth) + (rand() < spec.perMonth % 1 ? 1 : 0);
        for (let n = 0; n < count; n++) {
          const issued = day(month, Math.floor(between(1, month === "2026-10" ? 12 : 27)));
          if (issued > LAST_LINE) continue;
          seq += 1;
          const id = uuid(), number = spec.number(seq, month);
          const net = money(spec.range[0], spec.range[1], spec.range[0] === spec.range[1] ? 1 : 0.01);
          const lineVat = vatOn(net, spec.rate);
          const rc = Boolean(spec.reverseCharge);
          T.bills.push({ id, organisation_id: org, supplier_id: supplier, number, issued_on: issued, due_on: addDays(issued, 30), net, vat_amount: rc ? 0 : lineVat,
            reverse_charge: rc, reverse_charge_vat: rc ? lineVat : 0, reverse_charge_kind: rc ? (typeof spec.reverseCharge === "string" ? spec.reverseCharge : "services") : undefined,
            status: "awaiting_payment", created_at: `${issued}T10:15:00.000Z` });
          if (!rc && profile.flatRate && lineVat) capitalVat.set(quarterOf(issued), r2((capitalVat.get(quarterOf(issued)) ?? 0) + lineVat));
          T.bill_lines.push({ id: uuid(), organisation_id: org, bill_id: id, position: 1, description: `${spec.name.split(" (")[0]} · ${new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`, account_id: acc(spec.code), net, vat_rate: spec.rate, vat_amount: lineVat });
          if (!rc) addVat(issued, -lineVat);
          const total = rc ? net : r2(net + lineVat);
          const paid = addDays(issued, Math.floor(between(spec.payDays[0], spec.payDays[1])));
          if (paid > LAST_LINE || (month >= "2026-09" && rand() < 0.25)) continue;
          const text = `TRANSFER TO ${spec.text} ${number}`;
          if (paid > RECONCILED_TO) { movements.push({ date: paid, amount: -total, text, reference: number, counterparty: spec.name, match: null }); continue; }
          const payment = { id: uuid(), organisation_id: org, bill_id: id, paid_on: paid, amount: total, bank_account_id: bankId, method: "bank_transfer", reference: number };
          T.bill_payments.push(payment);
          movements.push({ date: paid, amount: -total, text, reference: number, counterparty: spec.name, match: { bill_payment_id: payment.id } });
        }
      }
    }

    // Money straight out of and into the bank.
    const spend = (date: string, text: string, code: string, rate: Rate, gross: number, kind: "spend" | "receive" = "spend", counterparty: string | null = null) => {
      const net = r2(gross / (1 + rate / 100)), vat = r2(gross - net);
      if (date > RECONCILED_TO) { movements.push({ date, amount: kind === "spend" ? -gross : gross, text, reference: null, counterparty, match: null }); return; }
      const id = uuid();
      T.bank_transactions.push({ id, organisation_id: org, kind, bank_account_id: bankId, txn_date: date, contact: counterparty, reference: null, amount: gross, net, vat_amount: vat, created_at: `${date}T16:00:00.000Z` });
      T.bank_transaction_lines.push({ id: uuid(), organisation_id: org, transaction_id: id, position: 1, description: text.slice(0, 300), account_id: acc(code), net, vat_rate: rate, vat_amount: vat });
      if (code !== "820") addVat(date, kind === "spend" ? -vat : vat);
      movements.push({ date, amount: kind === "spend" ? -gross : gross, text, reference: null, counterparty, match: { bank_transaction_id: id } });
    };
    for (const month of MONTHS) {
      const until = month === "2026-10" ? 20 : lastDay(month);
      for (const card of profile.card) {
        const count = Math.floor(card.perMonth) + (rand() < card.perMonth % 1 ? 1 : 0);
        const factor = card.kind === "receive" ? profile.scale ?? 1 : 1;
        for (let n = 0; n < count; n++) spend(day(month, Math.floor(between(1, until + 1))), card.text, card.code, card.rate, money(card.range[0] * factor, card.range[1] * factor, 0.01), card.kind ?? "spend");
      }
      if (profile.payroll && day(month, 28) <= LAST_LINE) {
        spend(day(month, 28), "PAYROLL TRANSFER STAFF SALARIES", "477", 0, profile.payroll.salaries);
      }
      if (profile.payroll && day(month, 14) <= LAST_LINE && month > "2025-07") spend(day(month, 14), profile.payroll.socialText ?? "SOCIAL INSURANCE SERVICES CONTRIBUTIONS", profile.payroll.socialCode ?? "478", 0, profile.payroll.social);
      if (day(month, lastDay(month)) <= LAST_LINE || month === "2026-10") spend(month === "2026-10" ? "2026-10-19" : day(month, lastDay(month)), "BANK CHARGES ACCOUNT MAINTENANCE", "404", 0, profile.bankFee);
    }

    // VAT returns filed, and paid with them (in the UK, a repayment comes back a fortnight later). On the flat rate,
    // the flat percentage of turnover is what is paid, and the rest of the VAT charged moves to the scheme's surplus.
    const authority = profile.country === "GB" ? "HMRC" : "Tax Department";
    for (const filed of profile.filed ?? []) {
      const key = filed.periodTo.slice(0, 7);
      let net = quarterVat.get(key) ?? 0;
      if (profile.flatRate) {
        const owed = r2(r2((grossSales.get(key) ?? 0) * profile.flatRate / 100) - (capitalVat.get(key) ?? 0));
        const shift = r2(net - owed);
        if (shift) {
          const journal = uuid();
          T.journal_entries.push({ id: journal, organisation_id: org, entry_date: filed.periodTo, source: "manual", reference: `FRS ${filed.periodTo}`,
            narration: `Flat Rate Scheme: VAT charged less the ${profile.flatRate}% flat rate, quarter to ${filed.periodTo}`, created_at: `${filed.filedOn}T09:30:00.000Z` });
          T.journal_lines.push({ id: uuid(), organisation_id: org, entry_id: journal, account_id: acc("820"), debit: shift > 0 ? shift : 0, credit: shift > 0 ? 0 : -shift, is_tax: false },
            { id: uuid(), organisation_id: org, entry_id: journal, account_id: acc("265"), debit: shift > 0 ? 0 : -shift, credit: shift > 0 ? shift : 0, is_tax: false });
        }
        net = owed;
        quarterVat.set(key, owed);
      }
      if (net === 0) continue;
      const id = uuid(), date = net > 0 ? filed.filedOn : addDays(filed.filedOn, 14), kind = net > 0 ? "spend" : "receive";
      T.bank_transactions.push({ id, organisation_id: org, kind, bank_account_id: bankId, txn_date: date, contact: authority, reference: `VAT ${key}`, amount: Math.abs(net), net: Math.abs(net), vat_amount: 0 });
      T.bank_transaction_lines.push({ id: uuid(), organisation_id: org, transaction_id: id, position: 1, description: `VAT return to ${filed.periodTo}`, account_id: acc("820"), net: Math.abs(net), vat_rate: 0, vat_amount: 0 });
      movements.push({ date, amount: -net, text: net > 0 ? `${authority.toUpperCase()} VAT PAYMENT` : `${authority.toUpperCase()} VAT REPAYMENT`, reference: `VAT ${key}`, counterparty: authority, match: { bank_transaction_id: id } });
    }
    vatFacts.push({ org, profile, quarters: quarterVat });

    // The bank's statements: one import a month, running balance, closing balance.
    movements.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
    let balance = profile.opening.bank;
    for (const month of MONTHS) {
      const own = movements.filter(item => item.date.startsWith(month));
      if (!own.length) continue;
      const importId = uuid();
      const october = month === "2026-10";
      let seq = 0;
      for (const item of own) {
        balance = r2(balance + item.amount);
        seq += 1;
        const lineId = uuid();
        T.bank_statement_lines.push({ id: lineId, organisation_id: org, bank_account_id: bankId, import_id: importId, txn_date: item.date, amount: item.amount, description: item.text,
          reference: item.reference, counterparty: item.counterparty, balance, external_id: `${profile.slug}-${item.date}-${String(seq).padStart(3, "0")}` });
        if (item.match) T.bank_line_matches.push({ id: uuid(), organisation_id: org, line_id: lineId, bank_account_id: bankId, ...item.match, matched_at: `${addDays(item.date, 3)}T09:00:00.000Z` });
      }
      T.bank_statement_imports.push({ id: importId, organisation_id: org, bank_account_id: bankId, source: "file", file_name: `${profile.bank.name.split(" ")[0].toLowerCase()}-statement-${month}.csv`,
        added: own.length, skipped: 0, first_date: own[0].date, last_date: own[own.length - 1].date, closing_balance: balance,
        imported_at: october ? `2026-10-${21 - (ALL_PROFILES.indexOf(profile) % 3)}T${String((6 + ALL_PROFILES.indexOf(profile)) % 24).padStart(2, "0")}:${String((10 + ALL_PROFILES.indexOf(profile) * 7) % 60).padStart(2, "0")}:00.000Z` : `${addDays(day(month, lastDay(month)), 3)}T08:00:00.000Z` });
    }
  }

  await pg.transaction(async tx => {
    await tx.query("set local ledgerline.seeding = 'on'");
    for (const table of ORDER) {
      // Rows with the same columns go in together; a column a row leaves out takes its default.
      const groups = new Map<string, Row[]>();
      for (const row of T[table]) {
        const key = Object.keys(row).filter(column => row[column] !== undefined).sort().join(",");
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      for (const [key, rows] of groups) {
        for (let start = 0; start < rows.length; start += 400) {
          await tx.query(`insert into ${table} (${key}) select ${key} from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows.slice(start, start + 400))]);
        }
      }
    }
  });

  // The lines matched while seeding, marked in one go (the trigger that keeps it is quiet while seeding).
  await pg.exec("update bank_statement_lines l set matched = true where exists (select 1 from bank_line_matches m where m.line_id = l.id)");
  // History: entries carry the time their documents were recorded, not the time of the seed.
  await pg.exec(`update journal_entries set created_at = (entry_date + time '10:30') at time zone 'Asia/Nicosia' where created_at > now() - interval '1 hour'`);

  // Filed returns, lock dates and the opening of the audit trail.
  for (const { org, profile, quarters } of vatFacts) {
    for (const filed of profile.filed ?? []) {
      const key = filed.periodTo.slice(0, 7);
      const from = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 3, 1)).toISOString().slice(0, 10);
      await pg.query("insert into vat_returns (organisation_id, period_from, period_to, filed_on, net_vat) values ($1, greatest($2::date, $3::date), $4, $5, $6)",
        [org, from, START, filed.periodTo, filed.filedOn, quarters.get(key) ?? 0]);
    }
    await pg.query("update organisations set lock_date = $2 where id = $1", [org, profile.lock]);
  }
  await seedCaptures(pg, practiceId);
  await seedCrm(pg);
  await seedQuotes(pg);
  await seedItems(pg);
  await seedCredits(pg);
  await seedRepeating(pg);
  await seedDesign(pg);
  await seedSupplierCredits(pg);
  await seedPractice(pg);
  await seedYearEnds(pg);
  await seedDeadlines(pg);
  await seedVies(pg);
  await seedClientFiles(pg);
  await seedPayroll(pg);
}

// ---------------------------------------------------------------------------
// Payroll: the employees of the four companies whose payroll the practice
// runs, with what the previous payroll paid them from January to September
// 2026 brought forward. October is the first month run in Ledgerline, in the
// meeting. Their salaries add up to what the bank has paid in wages each
// month, so the profit and loss runs on as it was.
// ---------------------------------------------------------------------------

type EmployeeSpec = { name: string; job: string; start: string; salary: number; thirteenth?: boolean; deductions?: number };
const EMPLOYEES: Record<string, EmployeeSpec[]> = {
  "aegean-blue-marine": [
    { name: "Nikos Charalambous", job: "Operations manager", start: "2019-04-01", salary: 3600, deductions: 2250 },
    { name: "Andri Ioannou", job: "Port agent", start: "2021-09-01", salary: 2400 },
    { name: "Marios Hadjigeorgiou", job: "Port agent", start: "2026-03-02", salary: 2140 },
    { name: "Despina Stylianou", job: "Office administrator", start: "2017-06-01", salary: 1700 },
  ],
  "troodos-gold": [
    { name: "Giorgos Petrides", job: "Mill supervisor", start: "2015-10-01", salary: 2320 },
    { name: "Elena Pavlou", job: "Shop and tastings", start: "2023-04-01", salary: 1800, thirteenth: false },
  ],
  "kalamies-dental": [
    { name: "Christina Neophytou", job: "Dental hygienist", start: "2020-02-01", salary: 2900, deductions: 1000 },
    { name: "Katerina Savvidou", job: "Dental nurse", start: "2022-05-01", salary: 2150 },
    { name: "Panayiota Michael", job: "Receptionist", start: "2024-01-08", salary: 1850 },
  ],
  "larnaka-roast": [
    { name: "Stelios Kyriakides", job: "Head roaster", start: "2018-11-01", salary: 2450, deductions: 1000 },
    { name: "Ioanna Demetriou", job: "Barista", start: "2022-03-01", salary: 1650 },
    { name: "Alexis Panayi", job: "Barista", start: "2026-05-18", salary: 1550 },
  ],
};

async function seedPayroll(pg: PGlite) {
  const companies = (await pg.query<{ id: string; slug: string }>("select id, slug from organisations where country = 'CY'")).rows;
  const digits = (seed: string, length: number) => createHash("sha256").update(`ledgerline-demo:${seed}`).digest("hex").replace(/[a-f]/g, "").padEnd(length, "7").slice(0, length);
  for (const company of companies) {
    for (const spec of EMPLOYEES[base(company.slug)] ?? []) {
      const employee = { start_date: spec.start, leave_date: null, monthly_salary: spec.salary, thirteenth_salary: spec.thirteenth ?? true, annual_deductions: spec.deductions ?? 0, annual_exemption: 0 };
      // January to September 2026 as the previous payroll paid it.
      let ytd = NO_YEAR;
      for (let month = 1; month <= 9; month++) {
        const period = `2026-${String(month).padStart(2, "0")}-01`;
        if (spec.start > `2026-${String(month).padStart(2, "0")}-${lastDay(period.slice(0, 7))}`) continue;
        ytd = addToYear(ytd, cyMonth(employee, period, ytd));
      }
      await pg.query(`insert into employees (organisation_id, name, job_title, tic, social_insurance_no, id_document, date_of_birth, start_date, monthly_salary, thirteenth_salary, iban,
          annual_deductions, ytd_year, ytd_gross, ytd_insurable, ytd_si, ytd_gesy, ytd_tax, email)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 2026, $13, $14, $15, $16, $17, $18)`,
        [company.id, spec.name, spec.job, `${digits(`tic:${spec.name}`, 8)}${"ABCDEFGHJKLMNPQRSTUVWXYZ"[Number(digits(`tic-letter:${spec.name}`, 2)) % 24]}`, digits(`si:${spec.name}`, 7),
          digits(`id:${spec.name}`, 7), `${1965 + Number(digits(`born:${spec.name}`, 2)) % 31}-${String(1 + Number(digits(`born-month:${spec.name}`, 2)) % 12).padStart(2, "0")}-${String(1 + Number(digits(`born-day:${spec.name}`, 2)) % 28).padStart(2, "0")}`,
          spec.start, spec.salary, employee.thirteenth_salary, fictionalIban(`employee:${spec.name}`), employee.annual_deductions, ytd.gross, ytd.insurable, ytd.si, ytd.gesy, ytd.tax,
          `${spec.name.toLowerCase().split(" ")[0]}@${company.slug.replace(/-/g, "")}.example`]);
    }
  }
}

// ---------------------------------------------------------------------------
// A supplier's credit note: Larnaka Roast's green coffee supplier credits two damaged sacks on its open bill.
// ---------------------------------------------------------------------------

export async function seedSupplierCredits(pg: PGlite) {
  const today = new Date().toISOString().slice(0, 10);
  const bill = (await pg.query<{ id: string; organisation_id: string; supplier_id: string; reverse_charge: boolean }>(`
    select b.id, b.organisation_id, b.supplier_id, b.reverse_charge from bills b join suppliers s on s.id = b.supplier_id join organisations o on o.id = b.organisation_id
     where o.slug = 'larnaka-roast' and s.name = 'Highland Green Coffee Traders Ltd' and b.status in ('awaiting_payment', 'part_paid') order by b.issued_on desc limit 1`)).rows[0];
  if (!bill) return;
  const line = (await pg.query<{ account_id: string; net: number; vat_rate: number }>("select account_id, net, vat_rate from bill_lines where bill_id = $1 order by position limit 1", [bill.id])).rows[0];
  const net = Math.round(Number(line.net) * 0.12 * 100) / 100;
  const lines = [{ description: "Two sacks damaged in transit, credited", account_id: line.account_id, net, vat_rate: Number(line.vat_rate), vat_amount: Math.round(net * Number(line.vat_rate)) / 100 }];
  await pg.query("select save_supplier_credit($1, null, $2, $3, $4, $5, $6, $7::jsonb, $8)",
    [bill.organisation_id, bill.supplier_id, bill.id, "HGC-CN-2026-07", addDays(today, -4), "Damaged on delivery: photos sent to the supplier.", JSON.stringify(lines), bill.reverse_charge]);
}

// ---------------------------------------------------------------------------
// How Larnaka Roast's documents look: its logo, its colour, its terms. The others print their names.
// ---------------------------------------------------------------------------

export async function seedDesign(pg: PGlite) {
  const file = path.join(process.cwd(), "src/lib/db/seed-files/larnaka-roast-logo.png");
  if (!fs.existsSync(file)) return;
  await pg.query("update organisations set invoice_accent = '#7c4a2d', invoice_footer = $2 where slug = $1",
    ["larnaka-roast", "Coffee is roasted to order. Please tell us of any damaged or missing goods within 7 days of delivery.\nLate payments may be charged interest at the rate allowed by law."]);
  await pg.query("insert into organisation_logos (organisation_id, media_type, content) select id, 'image/png', $2 from organisations where slug = $1", ["larnaka-roast", fs.readFileSync(file)]);
}

// ---------------------------------------------------------------------------
// Repeating invoices: a lease and a management fee already due, a support retainer due next week.
// ---------------------------------------------------------------------------

export async function seedRepeating(pg: PGlite) {
  const today = new Date().toISOString().slice(0, 10);
  const plans = [
    { slug: "larnaka-roast", customer: "Finikoudes Beach Kiosk Ltd", name: "Espresso machine lease", item: "MCH-LEASE", days: 0 },
    { slug: "aegean-blue-marine", customer: "Akrotiri Yacht Charters Ltd", name: "Yacht management fee", item: "YM-MONTH", days: -3 },
    { slug: "pixelforge", customer: "Helios Hotels Cyprus Ltd", name: "Hosting and support", item: "SUPPORT", days: 9 },
  ];
  for (const plan of plans) {
    const found = (await pg.query<{ org: string; registered: boolean; customer: string; eu: boolean }>(
      "select o.id as org, o.vat_registered as registered, c.id as customer, c.eu_business as eu from organisations o join customers c on c.organisation_id = o.id and c.name = $2 where o.slug = $1", [plan.slug, plan.customer])).rows[0];
    const item = found && (await pg.query<{ id: string; name: string; unit: string | null; unit_price: number; vat_rate: number; account_id: string }>(
      "select id, name, unit, unit_price, vat_rate, account_id from items where organisation_id = $1 and code = $2", [found.org, plan.item])).rows[0];
    if (!found || !item) continue;
    const next = addDays(today, plan.days);
    const lines = [{ item_id: item.id, description: item.name, unit: item.unit, account_id: item.account_id, quantity: 1, unit_price: Number(item.unit_price), discount_pct: 0, vat_rate: Number(item.vat_rate) }];
    await pg.query(`insert into repeating_invoices (organisation_id, customer_id, name, every_months, day_of_month, next_on, issue, vat_treatment, lines)
                    values ($1, $2, $3, 1, $4, $5, true, $6, $7::jsonb)`,
      [found.org, found.customer, plan.name, Number(next.slice(8, 10)), next, !found.registered ? "exempt" : found.eu ? "reverse_charge" : "standard", JSON.stringify(lines)]);
  }
}

// ---------------------------------------------------------------------------
// Products and services, priced once: code, name, unit, price before VAT, VAT rate, income account.
// ---------------------------------------------------------------------------

const ITEMS: Record<string, [string, string, string | null, number, Rate, string][]> = {
  "larnaka-roast": [
    ["ESP-1KG", "House espresso blend, 1 kg", "kg", 18.5, 5, "205"],
    ["DEC-1KG", "Swiss water decaf, 1 kg", "kg", 22, 5, "205"],
    ["SVC-EVENT", "Coffee service, per event", "event", 450, 9, "200"],
    ["CUP", "Barista coffee at events, per cup", "each", 2.4, 9, "200"],
    ["MCH-LEASE", "Espresso machine lease, monthly", "month", 165, 19, "205"],
    ["MCH-SVC", "Grinder and machine servicing", "visit", 85, 19, "205"],
    ["TRAIN", "Barista training, half day", "person", 95, 19, "210"],
  ],
  "troodos-gold": [
    ["EVOO-750", "Extra virgin olive oil, 750 ml", "bottle", 7.8, 5, "200"],
    ["EVOO-5L", "Extra virgin olive oil, 5 L tin", "each", 38, 5, "200"],
    ["EH-500", "Early harvest olive oil, 500 ml", "bottle", 9.5, 5, "200"],
    ["SOAP-6", "Olive oil soap, box of six", "box", 14, 19, "205"],
    ["TOUR", "Mill tour and tasting", "person", 18, 19, "210"],
  ],
  "aegean-blue-marine": [
    ["PA-CALL", "Port agency, vessel call", "each", 1450, 19, "200"],
    ["YM-MONTH", "Yacht management, monthly fee", "month", 2400, 19, "205"],
    ["CREW", "Crew change coordination", "each", 320, 19, "210"],
    ["PROV-HR", "Provisioning coordination", "hour", 45, 19, "210"],
  ],
  "kalamies-dental": [
    ["CHECK", "Check-up and clean", "visit", 60, 0, "200"],
    ["FILL", "Composite filling", "each", 85, 0, "200"],
    ["XRAY", "Panoramic X-ray", "each", 45, 0, "200"],
    ["ROOT", "Root canal treatment", "each", 320, 0, "200"],
  ],
  pixelforge: [
    ["DEV-EU", "Development day, EU client", "day", 640, 0, "200"],
    ["UX-EU", "UX research and design day, EU client", "day", 560, 0, "200"],
    ["DEV-CY", "Development day, Cyprus client", "day", 600, 19, "205"],
    ["DEV-HR", "Development, per hour", "hour", 85, 19, "205"],
    ["SUPPORT", "Hosting and support, monthly", "month", 450, 19, "210"],
  ],
  "mesogeios-holdings": [
    ["MGMT-Q", "Management fee, quarter", null, 3750, 0, "200"],
    ["DIRECTOR", "Director services, monthly", "month", 800, 0, "200"],
  ],
};

export async function seedItems(pg: PGlite) {
  for (const [slug, items] of Object.entries(ITEMS)) {
    for (const [code, name, unit, price, rate, account] of items) {
      await pg.query(`insert into items (organisation_id, code, name, unit, unit_price, vat_rate, account_id)
                      select o.id, $2, $3, $4, $5, $6, a.id from organisations o join ledger_accounts a on a.organisation_id = o.id and a.code = $7 where o.slug = $1`,
        [slug, code, name, unit, price, rate, account]);
    }
  }
}

// ---------------------------------------------------------------------------
// Two credit notes: a discount taken off an invoice still owed, and a credit kept for a customer who had already paid.
// ---------------------------------------------------------------------------

export async function seedCredits(pg: PGlite) {
  const today = new Date().toISOString().slice(0, 10);
  const cases = [
    { slug: "larnaka-roast", status: "in ('issued', 'part_paid')", share: 0.1, reason: "Discount after sale", text: "Discount agreed on", days: -2 },
    { slug: "pixelforge", status: "= 'paid'", share: 0.1, reason: "Service not delivered", text: "Days not delivered:", days: -5 },
  ];
  for (const item of cases) {
    const org = (await pg.query<{ id: string; invoice_prefix: string }>("select id, invoice_prefix from organisations where slug = $1", [item.slug])).rows[0];
    if (!org) continue;
    const invoice = (await pg.query<{ id: string; customer_id: string; vat_treatment: string }>(
      `select id, customer_id, vat_treatment from invoices where organisation_id = $1 and status ${item.status} order by issued_on desc, number desc limit 1`, [org.id])).rows[0];
    if (!invoice) continue;
    const line = (await pg.query<{ description: string; account_id: string; net: number; vat_rate: number }>("select description, account_id, net, vat_rate from invoice_lines where invoice_id = $1 order by position limit 1", [invoice.id])).rows[0];
    const net = Math.round(Number(line.net) * item.share * 100) / 100;
    const rate = invoice.vat_treatment === "standard" ? Number(line.vat_rate) : 0;
    const lines = [{ description: `${item.text} ${line.description.charAt(0).toLowerCase()}${line.description.slice(1)}`, account_id: line.account_id, net, vat_rate: rate }];
    await pg.query("select save_credit_note($1, null, $2, $3, $4, $5, $6, $7, null, $8::jsonb, 'issued')",
      [org.id, invoice.customer_id, invoice.id, `${org.invoice_prefix}CN-${today.slice(0, 4)}-0001`, addDays(today, item.days), invoice.vat_treatment, item.reason, JSON.stringify(lines)]);
  }
}

// ---------------------------------------------------------------------------
// Documents already captured, waiting for someone to review them.
// ---------------------------------------------------------------------------

type SeedCapture = { file: string; media: string; org: string; supplier: string; extraction: Record<string, unknown> };

async function seedCaptures(pg: PGlite, practiceId: string) {
  const dir = path.join(process.cwd(), "src/lib/db/seed-files");
  const manifest = path.join(dir, "captures.json");
  if (!fs.existsSync(manifest)) return;
  const captures = JSON.parse(fs.readFileSync(manifest, "utf8")) as SeedCapture[];
  for (const capture of captures) {
    const file = path.join(dir, capture.file);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file);
    const org = (await pg.query<{ id: string }>("select id from organisations where slug = $1", [capture.org])).rows[0]?.id ?? null;
    const fileId = uuid();
    await pg.query("insert into capture_files (id, practice_id, file_name, media_type, size_bytes, sha256, content, status, uploaded_at, read_at) values ($1, $2, $3, $4, $5, $6, $7, 'read', $8, $8)",
      [fileId, practiceId, capture.file, capture.media, content.length, createHash("sha256").update(content).digest("hex"), content, "2026-10-21T06:55:00.000Z"]);
    await pg.query("insert into capture_items (file_id, position, organisation_id, extraction, routing, status, created_at) values ($1, 1, $2, $3::jsonb, $4::jsonb, 'review', $5)",
      [fileId, org, JSON.stringify(capture.extraction), JSON.stringify({ method: "vat_number", confidence: "high" }), "2026-10-21T06:56:00.000Z"]);
  }
}

// ---------------------------------------------------------------------------
// The CRM inside each company: enquiries, its clients' people, matters, tasks.
// ---------------------------------------------------------------------------

type EnquirySeed = [company: string, person: string, service: string, value: number];
/** A demo job: its stage (a position among the open stages, or "won" for done), the days from today it is due (and starts), and its fields. */
type JobSeed = { title: string; customer?: string; stage: number | "won"; value?: number; due?: number; starts?: number; fields?: Record<string, string | number> };
const CRM: Record<string, { staff: string[]; enquiries: EnquirySeed[]; jobs: JobSeed[]; sources: string[]; patients?: string[]; todos?: string[];
  dealFields?: Record<number, Record<string, string | number>>; customerFields?: Record<string, Record<string, string>> }> = {
  "aegean-blue-marine": { staff: ["Christos Panayiotou", "Anna Demetriou", "Loukas Ioannides"], sources: ["Website", "Referral", "Marina office", "Phone"], enquiries: [
    ["Thalassa Yachting Ltd", "Andreas Kyriakou", "Charter season management, MY Selene", 18000], ["Nordsee Bulk Carriers GmbH", "Lena Hoffmann", "Port agency for bulk carrier calls at Vassiliko", 42000],
    ["Adriatic Crew Services d.o.o.", "Marko Petrović", "Crew change logistics, Larnaca airport", 9600], ["Limassol Sailing Club", "Christina Ioannou", "Winter berth coordination for the club fleet", 6500],
    ["Blue Wave Charters Ltd", "Stavros Michael", "Yacht management, two catamarans", 21000], ["Kypros Ferry Lines Ltd", "Elena Charalambous", "Husbandry services for the summer ferry", 15000],
    ["Orion Offshore Ltd", "James Whitfield", "Provisioning for a survey vessel", 8200], ["Aphrodite Cruises Ltd", "Maria Georgiou", "Shore excursion logistics", 12000],
    ["Delta Marine Survey Ltd", "Nikos Antoniou", "Agency for survey vessel rotation", 7400]],
    jobs: [
      { title: "Port call, MV Horizon Star", customer: "Blue Horizon Shipping Ltd", stage: 1, value: 6800, due: 3, fields: { vessel: "MV Horizon Star", port: "Limassol", eta: 3 } },
      { title: "Tanker call at Vassiliko, MT Meridian Grace", customer: "Meridian Ship Management Ltd", stage: 2, value: 9400, due: 1, fields: { vessel: "MT Meridian Grace", port: "Vassiliko", eta: -1 } },
      { title: "Yacht management, MY Akrotiri Star", customer: "Akrotiri Yacht Charters Ltd", stage: 2, value: 12000, due: 60, fields: { vessel: "MY Akrotiri Star", port: "Limassol" } },
      { title: "Crew change, MV Kourion Spirit", customer: "Kourion Bay Tours Ltd", stage: 3, value: 3200, due: -2, fields: { vessel: "MV Kourion Spirit", port: "Larnaca", eta: -9 } },
      { title: "Port call, MV Horizon Dawn", customer: "Blue Horizon Shipping Ltd", stage: "won", value: 5600, due: -6, fields: { vessel: "MV Horizon Dawn", port: "Limassol", eta: -14 } },
    ], dealFields: { 0: { vessel: "MY Selene" }, 1: { vessel: "MV Nordsee Trader" } } },
  "troodos-gold": { staff: ["Eleni Kyprianou", "Michalis Georgiades", "Rena Phylactou"], sources: ["Website", "Trade fair", "Referral", "Shop visit"], enquiries: [
    ["Mesogeios Hotels Ltd", "Petros Hadjigeorgiou", "Olive oil for three hotel restaurants", 14000], ["Feinkost Berger GmbH", "Katrin Berger", "Early harvest oil for Munich delicatessens", 26000],
    ["Larnaca Gourmet Market", "Sofia Neophytou", "Shelf listing, 500ml and 750ml", 5200], ["Nicosia Cooking School", "Alexis Pavlou", "Tasting sessions for students", 2400],
    ["Paphos Wedding Co", "Irene Savva", "Olive oil wedding favours, 400 bottles", 3800], ["Kyrenia Street Taverna", "Giorgos Loizou", "Monthly 5L tin supply", 4100],
    ["Agrotourism Cyprus", "Helen Markides", "Mill tours for agrotourism guests", 3000], ["Delikatessen Nord AB", "Erik Sandberg", "Distributor enquiry, Sweden", 31000],
    ["Troodos Hiking Tours", "Panos Christou", "Mill visit add-on for hiking groups", 1800]],
    jobs: [
      { title: "Hotel supply, October: 120 tins of 5 litres", customer: "Coral Sands Hotel Ltd", stage: 1, value: 4800, due: 4, fields: { delivery_address: "Coral Sands Hotel, kitchen entrance, Ayia Napa" } },
      { title: "Christmas gift boxes, 300 sets", customer: "Nicosia Fine Foods Ltd", stage: 2, value: 7500, due: 12 },
      { title: "Shelf restock, 500ml and 750ml", customer: "Paphos Gourmet Deli Ltd", stage: 3, value: 2100, due: 0, fields: { tracking: "Courier ref. 7731-2290" } },
      { title: "Early harvest, first pressing: 60 cases", customer: "Nicosia Fine Foods Ltd", stage: 1, value: 3900, due: 9 },
      { title: "September restock", customer: "Paphos Gourmet Deli Ltd", stage: "won", value: 1850, due: -18 },
    ], customerFields: { "Nicosia Fine Foods Ltd": { price_list: "Distributor" }, "Paphos Gourmet Deli Ltd": { price_list: "Trade" }, "Coral Sands Hotel Ltd": { price_list: "Trade" } } },
  "kalamies-dental": { staff: ["Dr Sofia Hadjioannou", "Dr Marios Evagorou", "Niki Solomou"], sources: ["Website", "Phone", "Referral", "Walk-in"], enquiries: [
    ["", "Katerina Pavlidou", "Implant consultation, upper molar", 2400], ["", "Michael Stylianou", "Clear aligner treatment plan", 3900],
    ["Larnaca Primary School No. 4", "School office", "Dental check-up day for pupils", 1500], ["", "Andrea Constantinou", "Whitening and hygiene package", 450],
    ["Medisure Health Insurance Ltd", "Claims team", "Direct-billing agreement renewal", 18000], ["", "Yiannis Kyprianou", "Crown and bridge work", 1800],
    ["Harbour Staff Benefit Fund", "Fund secretary", "Staff dental scheme", 6000], ["", "Eleni Michaelidou", "Children's orthodontic assessment", 900],
    ["", "George Hadjimichael", "Root canal follow-up", 650]],
    patients: ["Sotiris Charalambous", "Elena Vasiliou", "Kyriacos Demetriades"], jobs: [
      { title: "Implants, upper left: two-stage plan", customer: "Sotiris Charalambous", stage: 2, value: 2400, due: 30, fields: { paid_by: "Medisure" } },
      { title: "Clear aligners, 12 months", customer: "Elena Vasiliou", stage: 3, value: 3900, due: 300, fields: { paid_by: "Self-paying" } },
      { title: "Crown and bridge, lower right", customer: "Kyriacos Demetriades", stage: 1, value: 1800, due: 21, fields: { paid_by: "Olympic Health Cover" } },
      { title: "Whitening and hygiene package", customer: "Elena Vasiliou", stage: 1, value: 450, due: 14, fields: { paid_by: "Self-paying" } },
      { title: "Root canal and crown", customer: "Sotiris Charalambous", stage: "won", value: 950, due: -20, fields: { paid_by: "Medisure" } },
    ] },
  "larnaka-roast": { staff: ["Marios Georgiou", "Chloe Antoniades", "Stelios Papas"], sources: ["Website", "Instagram", "Café counter", "Referral"], enquiries: [
    ["Coral Sands Hotel Ltd", "Petros Hadjigeorgiou", "Coffee service for the conference season", 9800], ["Finikoudes Beach Kiosk Ltd", "Savvas Ioannou", "Espresso machine lease renewal", 3600],
    ["Seaview Café Ltd", "Despina Kyriacou", "House blend supply, 20kg a month", 7200], ["CoWork Nicosia Ltd", "Rania Haddad", "Office coffee subscription, three floors", 5400],
    ["Ayia Napa Beach Bars Ltd", "Kostas Efthymiou", "Barista training for summer staff", 2800], ["Larnaca Book Café", "Marina Petrou", "Retail bags of single origin", 1900],
    ["Mesogeios Hotels Ltd", "Natalia Ioannidou", "Breakfast coffee programme", 16000], ["Kition Wedding Venues", "Lucia Romano", "Coffee cart for weddings", 4500],
    ["Paralimni Bakery Ltd", "Andreas Theodorou", "Wholesale beans, weekly", 6100]],
    jobs: [
      { title: "Conference coffee bar, week 44", customer: "Coral Sands Hotel Ltd", stage: 1, value: 2600, due: 5, fields: { handover: "Delivery", delivery_address: "Coral Sands Hotel, conference wing" } },
      { title: "House blend, 20 kg", customer: "Finikoudes Beach Kiosk Ltd", stage: 2, value: 640, due: 1, fields: { handover: "Delivery", delivery_address: "Finikoudes promenade kiosk" } },
      { title: "Machine service and a spare grinder", customer: "Finikoudes Beach Kiosk Ltd", stage: 3, value: 380, due: 0, fields: { handover: "Collection" } },
      { title: "Single-origin launch: three coffees, 50 bags each", stage: 2, value: 0, due: 8, fields: { handover: "Collection" } },
      { title: "Breakfast blend, 15 kg", customer: "Coral Sands Hotel Ltd", stage: "won", value: 480, due: -5, fields: { handover: "Delivery" } },
    ] },
  "pixelforge": { staff: ["Nikos Savva", "Ioanna Kleanthous", "Marcus Lee"], sources: ["Website", "Referral", "Clutch", "LinkedIn"], enquiries: [
    ["Nordlicht Software GmbH", "Jonas Weber", "Phase 2: offline mode for the mobile app", 48000], ["Brabant Digital BV", "Sanne de Vries", "Checkout redesign", 26000],
    ["Atelier Lumière SAS", "Camille Laurent", "Booking system for a second venue", 18000], ["Helios Hotels Cyprus Ltd", "Nicolas Pierides", "Loyalty programme in the guest app", 22000],
    ["Medisure Health Insurance Ltd", "Product team", "Claims app prototype", 35000], ["Kypros Ferry Lines Ltd", "Elena Charalambous", "Ticketing website rebuild", 40000],
    ["Fjord Analytics AS", "Ingrid Nilsen", "Data dashboard, two-week discovery", 12000], ["Olive Grove Estates Ltd", "Christos Pallis", "Online shop", 9000],
    ["Brightline Learning Ltd", "Oliver Grant", "Learning platform MVP", 55000]],
    jobs: [
      { title: "Nordlicht app, sprints 14 to 16", customer: "Nordlicht Software GmbH", stage: 2, value: 36000, due: 34, starts: -8, fields: { fee_basis: "Time and materials" } },
      { title: "Brabant support retainer", customer: "Brabant Digital BV", stage: 2, value: 2400, due: 5, starts: -26, fields: { fee_basis: "Retainer" } },
      { title: "Helios guest app 2.0", customer: "Helios Hotels Cyprus Ltd", stage: 1, value: 22000, due: 75, starts: 12, fields: { fee_basis: "Fixed price" } },
      { title: "Atelier booking system go-live", customer: "Atelier Lumière SAS", stage: 3, value: 18000, due: 6, starts: -40, fields: { fee_basis: "Fixed price" } },
      { title: "Nordlicht design system", customer: "Nordlicht Software GmbH", stage: "won", value: 9500, due: -12, starts: -60, fields: { fee_basis: "Fixed price" } },
    ] },
  "mesogeios-holdings": { staff: ["Petros Constantinou", "Andri Kallis"], sources: ["Board", "Bank", "Introducer"], enquiries: [
    ["Kourion Boutique Hotel Ltd", "Board of directors", "Acquisition of a 40% stake", 1200000], ["Larnaca Logistics Park Ltd", "Chief financial officer", "Shareholder loan, €400,000", 400000],
    ["Mesogeios Hotels Ltd", "Finance director", "Dividend for the 2025 year", 50000], ["Troodos Retreats Ltd", "Founder", "Seed investment", 150000],
    ["Levant Private Bank", "Relationship manager", "Refinancing of the group facility", 2000000], ["Akamas Eco Lodges Ltd", "Managing director", "Joint venture proposal", 600000]],
    jobs: [], todos: ["Annual general meeting 2026: notice to shareholders", "Group restructuring review with the lawyers", "Loan to Mesogeios Hotels: interest schedule", "2025 audit: answer Kition Audit Partners' questions"],
    dealFields: { 0: { kind: "Acquisition", stake: 40 }, 1: { kind: "Loan" }, 2: { kind: "Investment" }, 3: { kind: "Investment", stake: 15 }, 4: { kind: "Refinancing" }, 5: { kind: "Investment", stake: 50 } } },
  "thames-edge-joinery": { staff: ["Tom Ashworth", "Priya Shah"], sources: ["Phone", "Referral", "Website", "Repeat customer"], enquiries: [
    ["Brookmere Construction Ltd", "Gareth Lewis", "Oak staircase and balustrade, Woodley plot 12", 14500], ["", "Helen Marsh", "Fitted wardrobes, three bedrooms", 6200],
    ["Caversham Homes Ltd", "Sam Okafor", "Second fix joinery, six houses", 38000], ["Hartley Lettings Ltd", "Joanna Pike", "Sash window repairs across four flats", 7800],
    ["", "David Chen", "Garden room, timber frame", 21000], ["Brookmere Construction Ltd", "Gareth Lewis", "Doors and skirting, Earley site", 16400],
    ["", "Rachel Moore", "Kitchen worktops and shelving", 3900], ["Caversham Homes Ltd", "Sam Okafor", "Show home finishing", 9200], ["Hartley Lettings Ltd", "Joanna Pike", "Fire doors to HMO standard", 11800]],
    jobs: [
      { title: "Oak staircase, Woodley plot 12", customer: "Brookmere Construction Ltd", stage: 2, value: 14500, due: 9, starts: -6, fields: { site_address: "Plot 12, Bader Way, Woodley RG5 4AX", access: "Site gate code from the site manager" } },
      { title: "Second fix, Caversham Heights phase 2", customer: "Caversham Homes Ltd", stage: 1, value: 38000, due: 40, starts: 7, fields: { site_address: "Caversham Heights, Peppard Road, Reading RG4 8TZ" } },
      { title: "Sash windows, 14 Eldon Square", customer: "Hartley Lettings Ltd", stage: 3, value: 7800, due: 2, starts: -15, fields: { site_address: "14 Eldon Square, Reading RG1 4DP", access: "Keys from the letting office" } },
      { title: "Doors and skirting, Earley site", customer: "Brookmere Construction Ltd", stage: "won", value: 16400, due: -10, starts: -45, fields: { site_address: "Earley Gate, Whiteknights Road, Reading RG6 6BU" } },
    ] },
  "willow-wren-design": { staff: ["Hannah Wren", "Ollie Grant"], sources: ["Website", "Referral", "Instagram", "Existing client"], enquiries: [
    ["Halcyon Coffee Roasters Ltd", "Amir Patel", "Packaging for the winter blends", 4800], ["Avon Valley Cider Co Ltd", "Lucy Ford", "Labels for a new perry range", 3600],
    ["Clifton Physio Clinic Ltd", "Dr Ben Ellis", "Website refresh and booking page", 7200], ["Northgate Architects LLP", "Fiona Black", "Annual report design", 5400],
    ["", "Megan Price", "Wedding stationery", 1200], ["Harbourside Market CIC", "Kate Lyons", "Market signage and maps", 2900],
    ["Halcyon Coffee Roasters Ltd", "Amir Patel", "Café menu boards", 1500], ["Avon Valley Cider Co Ltd", "Lucy Ford", "Trade show stand", 6800], ["Northgate Architects LLP", "Fiona Black", "Brand guidelines", 8400]],
    jobs: [
      { title: "Winter blend packaging", customer: "Halcyon Coffee Roasters Ltd", stage: 2, value: 4800, due: 12, starts: -10, fields: { fee_basis: "Fixed price" } },
      { title: "Website refresh", customer: "Clifton Physio Clinic Ltd", stage: 1, value: 7200, due: 45, starts: 5, fields: { fee_basis: "Fixed price" } },
      { title: "Monthly design support", customer: "Northgate Architects LLP", stage: 2, value: 1200, due: 4, starts: -27, fields: { fee_basis: "Retainer" } },
      { title: "Cider label refresh", customer: "Avon Valley Cider Co Ltd", stage: "won", value: 3100, due: -8, starts: -40, fields: { fee_basis: "Fixed price" } },
    ] },
};
/** What each demo job is, in a line. */
const JOB_SUMMARIES: Record<string, string> = {
  "Conference coffee bar, week 44": "Coffee bar and barista cover for the hotel's conference week, billed with the month.",
  "Machine service and a spare grinder": "The espresso machine's six-month service at the kiosk, and a spare grinder for the summer.",
  "Single-origin launch: three coffees, 50 bags each": "Three single-origin coffees for retail, sold at the kiosk and the café counter.",
  "Nordlicht app, sprints 14 to 16": "Three two-week sprints on the Nordlicht mobile app: offline mode and push notifications.",
  "Brabant support retainer": "Support and small changes on the Brabant checkout, up to 20 hours a month.",
  "Helios guest app 2.0": "The second version of the hotel guest app: loyalty points and room-service ordering.",
  "Atelier booking system go-live": "Launch of the booking system for Atelier's second venue, with two weeks of close support.",
  "Port call, MV Horizon Star": "Husbandry and clearance for a general cargo call: pilot, berth, provisions and a crew change.",
  "Oak staircase, Woodley plot 12": "Oak staircase with glass balustrade, made in the workshop and fitted over three days.",
};
const PEOPLE = ["Andreas Christodoulou", "Maria Iacovou", "Kyriakos Neocleous", "Anastasia Petridou", "Constantinos Louca", "Despo Charalambidou", "Thomas Kleopa", "Ioanna Papadopoulou", "Simon Hart", "Julia Becker", "Pieter Jansen", "Claire Dubois"];
const ROLES = ["Director", "Finance manager", "Operations manager", "Accounts payable", "Purchasing"];
/** Where each demo enquiry is: a position among the company's open stages, or won. */
const STAGES: (number | "won")[] = [1, 1, 1, 2, 2, 2, 3, 3, "won"];
const DUE = [-3, -1, 0, 0, 1, 3, 6, 10, 14];

/** How each demo company works: its business type, and what it changed from the type's starting point. */
const WORKSPACES: Record<string, { type: string; changes?: WorkspaceChanges }> = {
  "aegean-blue-marine": { type: "marine" },
  "troodos-gold": { type: "wholesale" },
  "kalamies-dental": { type: "health", changes: { labels: { customer: ["Patient or insurer", "Patients and insurers"] },
    fields: [{ entity: "job", key: "paid_by", label: "Paid by", kind: "choice", options: ["Self-paying", "Medisure", "Olympic Health Cover"], onCard: true }] } },
  "larnaka-roast": { type: "retail", changes: { stages: { job: [{ name: "Received" }, { name: "Roasting" }, { name: "Ready" }, { name: "Delivered", outcome: "won" }, { name: "Cancelled", outcome: "lost" }] } } },
  "pixelforge": { type: "agency" },
  "mesogeios-holdings": { type: "holding" },
  "thames-edge-joinery": { type: "trades" },
  "willow-wren-design": { type: "agency", changes: { labels: { deal: ["Enquiry", "Enquiries"] } } },
};
type StageRow = { id: string; board: string; name: string; position: number; outcome: string };
/** A company's stage: a position among its open stages on the board, or the one that closes it well. */
const stageAt = (stages: StageRow[], board: "deal" | "job", at: number | "won") => {
  if (at === "won") return stages.find(stage => stage.board === board && stage.outcome === "won")!;
  const open = stages.filter(stage => stage.board === board && stage.outcome === "open");
  return open[Math.min(at, open.length) - 1];
};
/** What to call someone in a to-do: a person by their first name, a board or an office by what it is. */
const callName = (person: string) => /^(Dr )?[A-Z][a-zà-ÿ]+ [A-Z]/.test(person) ? person.replace(/^Dr /, "").split(" ")[0] : `the ${person.toLowerCase()}`;
const workspaceQueries = (pg: PGlite) => ({
  query: (text: string, params?: unknown[]) => pg.query(text, params),
  rows: async <T,>(text: string, params?: unknown[]) => (await pg.query<T>(text, params)).rows,
});

export async function seedCrm(pg: PGlite) {
  const today = new Date().toISOString().slice(0, 10);
  const orgs = (await pg.query<{ id: string; slug: string; country: string; business_type: string }>("select id, slug, country, business_type from organisations")).rows;
  const { query, rows: rowsOf } = workspaceQueries(pg);
  for (const org of orgs) {
    const setup = WORKSPACES[base(org.slug)] ?? { type: "general" };
    await setUpWorkspace(query, rowsOf, org.id, setup.type, org.country, setup.changes);
  }
  const rows: Record<string, Row[]> = { crm_enquiries: [], crm_contacts: [], crm_jobs: [], crm_tasks: [], crm_activities: [] };
  for (const org of orgs) {
    const spec = CRM[base(org.slug)];
    if (!spec) continue;
    const stages = (await pg.query<StageRow>("select id, board, name, position, outcome from crm_stages where organisation_id = $1 order by position", [org.id])).rows;
    const type = businessType(WORKSPACES[base(org.slug)]?.type);
    // A clinic's private patients are customers in their own name.
    for (const [index, name] of (spec.patients ?? []).entries())
      await pg.query("insert into customers (organisation_id, name, email, phone, default_account_id) select $1, $2, $3, $4, id from ledger_accounts where organisation_id = $1 and system_role = 'sales'",
        [org.id, name, `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`, `+357 99 ${String(624110 + index * 3313).slice(0, 6)}`]);
    for (const [name, extra] of Object.entries(spec.customerFields ?? {})) await pg.query("update customers set extra = $3 where organisation_id = $1 and name = $2", [org.id, name, JSON.stringify(extra)]);
    const customers = (await pg.query<{ id: string; name: string }>("select id, name from customers where organisation_id = $1 order by name", [org.id])).rows;
    const overdue = (await pg.query<{ customer_id: string; number: string; client_name: string }>("select customer_id, number, client_name from v_invoice_directory where organisation_id = $1 and days_overdue > 0 order by days_overdue desc limit 2", [org.id])).rows;
    const prefix = org.slug.split("-").map(part => part[0]).join("").toUpperCase();
    const at = (offset: number, hour = 10) => new Date(Date.parse(`${addDays(today, offset)}T${String(hour).padStart(2, "0")}:15:00Z`)).toISOString();
    const enquiryIds: { id: string; name: string; company: string; won: boolean }[] = [];
    spec.enquiries.forEach(([company, person, service, value], index) => {
      const id = uuid(), place = STAGES[index] ?? 2, stage = stageAt(stages, "deal", place);
      const won = place === "won";
      const due = won ? null : addDays(today, DUE[index] ?? 7);
      // A person, by their first name; a board or an office, by what it is.
      const who = callName(person);
      const next = won ? null : [`Call ${who} back`, `Send the proposal for ${service.toLowerCase()}`, `Chase ${company || person} for a decision`, `Book a meeting with ${who}`][index % 4];
      const source = spec.sources[index % spec.sources.length], owner = spec.staff[index % spec.staff.length];
      rows.crm_enquiries.push({ id, organisation_id: org.id, reference: `${prefix}-${2026}-${String(40 + index).padStart(4, "0")}`, full_name: person, company: company || null,
        email: `${person.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.test`, phone: `+357 9${String(9100000 + index * 7331).slice(0, 7)}`,
        source, channel: source === "Website" ? "form" : "manual", service, stage_id: stage.id, value, owner, priority: index === 1 ? "urgent" : index === 4 ? "high" : "normal",
        next_action: next, next_action_due: due, expected_on: won ? null : addDays(today, 14 + index * 6), extra: spec.dealFields?.[index] ?? {},
        summary: `${service}. ${company ? `${company} ` : ""}${won ? "Agreed: set up as a customer." : "Requirement being clarified."}`,
        stage_changed_at: at(-(index + 2)), created_at: at(-(index * 4 + 6), 9) });
      rows.crm_activities.push({ id: uuid(), organisation_id: org.id, enquiry_id: id, kind: "email", body: `Enquiry received via ${source.toLowerCase()}: ${service.toLowerCase()}.`, actor: owner, occurred_at: at(-(index * 4 + 6), 9) });
      if (place !== 1) rows.crm_activities.push({ id: uuid(), organisation_id: org.id, enquiry_id: id, kind: "call", body: `Spoke to ${who}: wants ${service.toLowerCase()}${value ? `, budget around ${org.country === "GB" ? "£" : "€"}${value.toLocaleString("en-GB")}` : ""}.`, actor: owner, occurred_at: at(-(index * 2 + 3), 11) });
      if (place === 3) rows.crm_activities.push({ id: uuid(), organisation_id: org.id, enquiry_id: id, kind: "stage", body: `Moved to ${stage.name}.`, actor: owner, occurred_at: at(-(index + 2), 15) });
      if (won) rows.crm_activities.push({ id: uuid(), organisation_id: org.id, enquiry_id: id, kind: "won", body: "Won: terms agreed and set up as a customer.", actor: spec.staff[0], occurred_at: at(-3, 16) });
      enquiryIds.push({ id, name: person, company, won });
    });
    customers.forEach((customer, index) => {
      if ((spec.patients ?? []).includes(customer.name)) return;
      const count = 1 + (index % 2);
      for (let n = 0; n < count; n++) {
        const name = PEOPLE[(index * 3 + n * 5 + orgs.indexOf(org)) % PEOPLE.length];
        rows.crm_contacts.push({ id: uuid(), organisation_id: org.id, customer_id: customer.id, name, role: ROLES[(index + n) % ROLES.length],
          email: `${name.toLowerCase().split(" ")[0]}@${customer.name.toLowerCase().replace(/ (ltd|limited|gmbh|bv|sas|ab|llp|cic|co ltd)$/, "").replace(/[^a-z]+/g, "")}.example`, phone: `+357 2${String(2200000 + index * 913 + n * 37).slice(0, 7)}` });
      }
    });
    const jobIds: string[] = [];
    spec.jobs.forEach((job, index) => {
      const id = uuid(), stage = stageAt(stages, "job", job.stage), done = job.stage === "won";
      const customer = job.customer ? customers.find(row => row.name === job.customer) : undefined;
      if (job.customer && !customer) throw new Error(`${org.slug}: no customer ${job.customer}`);
      // A date field given as days from today.
      const extra = Object.fromEntries(Object.entries(job.fields ?? {}).map(([key, value]) => [key, key === "eta" && typeof value === "number" ? addDays(today, value) : value]));
      jobIds.push(id);
      rows.crm_jobs.push({ id, organisation_id: org.id, reference: String(101 + index), title: job.title, customer_id: customer?.id ?? null, owner: spec.staff[index % spec.staff.length],
        stage_id: stage.id, priority: index === 0 ? "high" : "normal", value: job.value || null, starts_on: job.starts === undefined ? null : addDays(today, job.starts),
        due_on: job.due === undefined ? null : addDays(today, job.due), closed_on: done ? addDays(today, job.due ?? -3) : null,
        next_action: done ? null : ["Confirm the dates with the customer", "Send an update", "Check everything is ready", "Agree what is left"][index % 4], next_action_due: done ? null : addDays(today, [0, 2, 1, 5][index % 4]),
        summary: JOB_SUMMARIES[job.title] ?? (customer ? `For ${customer.name}.` : null), extra, opened_on: addDays(today, -(18 + index * 9)), stage_changed_at: at(-(index + 1)), created_at: at(-(18 + index * 9), 9) });
      rows.crm_activities.push({ id: uuid(), organisation_id: org.id, job_id: id, kind: "note", body: customer ? `Opened for ${customer.name}.` : "Opened.", actor: spec.staff[index % spec.staff.length], occurred_at: at(-(18 + index * 9), 10) });
      if (done) rows.crm_activities.push({ id: uuid(), organisation_id: org.id, job_id: id, kind: "stage", body: `Moved to ${stage.name}.`, actor: spec.staff[0], occurred_at: at(job.due ?? -3, 16) });
    });
    const open = enquiryIds.filter(item => !item.won);
    const doneJob = spec.jobs.findIndex(job => job.stage === "won");
    const tasks: [string, number, string, Partial<Row>][] = [
      [`Call ${open[0] ? callName(open[0].name) : "the prospect"} back`, -2, "high", { enquiry_id: open[0]?.id }],
      [`Send the revised quote to ${open[6]?.company || open[6]?.name || "the customer"}`, -1, "urgent", { enquiry_id: open[6]?.id }],
      ...(jobIds[0] ? [[type.firstTask, 0, "normal", { job_id: jobIds[0] }] as [string, number, string, Partial<Row>]] : []),
      [`Chase ${open[2]?.company || open[2]?.name || "the customer"} for a decision`, 0, "normal", { enquiry_id: open[2]?.id }],
      ...(overdue[0] ? [[`Chase invoice ${overdue[0].number} with ${overdue[0].client_name}`, 1, "high", { customer_id: overdue[0].customer_id }] as [string, number, string, Partial<Row>]] : []),
      ...(doneJob >= 0 ? [[`Raise the invoice: ${spec.jobs[doneJob].title}`, 1, "high", { job_id: jobIds[doneJob] }] as [string, number, string, Partial<Row>]] : []),
      [`Prepare a quote: ${open[3]?.company || open[3]?.name || "new enquiry"}`, 2, "normal", { enquiry_id: open[3]?.id }],
      ...(jobIds[1] ? [[`Send ${spec.jobs[1].customer ?? "the customer"} an update`, 4, "normal", { job_id: jobIds[1] }] as [string, number, string, Partial<Row>]] : []),
      [`Book a meeting with ${open[4] ? callName(open[4].name) : "the prospect"}`, 6, "normal", { enquiry_id: open[4]?.id }],
      ...(overdue[1] ? [[`Agree a payment plan with ${overdue[1].client_name}`, 8, "normal", { customer_id: overdue[1].customer_id }] as [string, number, string, Partial<Row>]] : []),
      ...(spec.todos ?? []).map((title, index) => [title, [-2, 0, 4, 13][index % 4], "normal", {}] as [string, number, string, Partial<Row>]),
    ];
    tasks.forEach(([title, offset, priority, link], index) => rows.crm_tasks.push({ id: uuid(), organisation_id: org.id, title, due_on: addDays(today, offset), priority, owner: spec.staff[index % spec.staff.length],
      enquiry_id: link.enquiry_id ?? null, job_id: link.job_id ?? null, customer_id: link.customer_id ?? null, created_at: at(-(5 + index), 9) }));
  }
  for (const table of ["crm_enquiries", "crm_contacts", "crm_jobs", "crm_tasks", "crm_activities"]) {
    const groups = new Map<string, Row[]>();
    for (const row of rows[table]) {
      const key = Object.keys(row).filter(column => row[column] !== undefined).sort().join(",");
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const [key, list] of groups) await pg.query(`insert into ${table} (${key}) select ${key} from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(list)]);
  }
  // Every company's website form starts switched on, with a key of its own.
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (const org of orgs) {
    const token = `ll_form_${Array.from({ length: 24 }, () => letters[randomInt(letters.length)]).join("")}`;
    await pg.query("insert into enquiry_form_keys (organisation_id, token) values ($1, $2)", [org.id, token]);
  }
}

// ---------------------------------------------------------------------------
// Open quotes: one still a draft, one with the customer.
// ---------------------------------------------------------------------------

export async function seedQuotes(pg: PGlite) {
  const today = new Date().toISOString().slice(0, 10);
  const orgs = (await pg.query<{ id: string; slug: string; invoice_prefix: string; vat_registered: boolean }>("select id, slug, invoice_prefix, vat_registered from organisations order by slug")).rows;
  for (const org of orgs) {
    const spec = CRM[base(org.slug)];
    const profile = profileOf(org.slug);
    // Quotes to the customers the company trades with, not a clinic's patients.
    const customers = (await pg.query<{ id: string; name: string; eu_business: boolean; default_account_id: string }>("select id, name, eu_business, default_account_id from customers where organisation_id = $1 order by name", [org.id])).rows
      .filter(customer => !profile || profile.customers.some(item => item.name === customer.name));
    if (!spec || !profile || !customers.length) continue;
    const codes = new Map((await pg.query<{ id: string; code: string }>("select id, code from ledger_accounts where organisation_id = $1", [org.id])).rows.map(row => [row.code, row.id]));
    for (let index = 0; index < 2; index++) {
      // Two customers where there are two: a quote each, priced from what each is usually sold.
      const customer = customers[index % customers.length];
      const sold = profile.customers.find(item => item.name === customer.name)?.lines ?? [];
      const treatment = !org.vat_registered ? "exempt" : customer.eu_business ? "reverse_charge" : "standard";
      const lines = (sold.length ? sold : [{ code: "", rate: 19 as Rate, range: [900, 2400] as [number, number], text: [spec.jobs[index]?.title ?? "Services"] }]).map(item => {
        const rate = treatment === "standard" ? item.rate : 0;
        const net = Math.round((index === 0 ? item.range[1] : (item.range[0] + item.range[1]) / 2) * (profile.scale ?? 1) / 10) * 10;
        return { description: item.text[0], account_id: codes.get(item.code) ?? customer.default_account_id, net, vat_rate: rate, vat_amount: Math.round(net * rate) / 100 };
      });
      const issued = addDays(today, index === 0 ? -1 : -6);
      const quote = (await pg.query<{ id: string }>("select save_quote($1, null, $2, $3, $4, $5, $6, $7, $8::jsonb) as id",
        [org.id, customer.id, `${org.invoice_prefix}Q-${String(index + 1).padStart(3, "0")}`, issued, addDays(issued, 30), treatment, null, JSON.stringify(lines)])).rows[0];
      if (index === 1) await pg.query("update quotes set status = 'sent' where id = $1", [quote.id]);
    }
  }
}

// ---------------------------------------------------------------------------
// Deadlines already dealt with: provisional tax paid and VIES statements sent,
// except one instalment that slipped, which the deadline list catches.
// ---------------------------------------------------------------------------

async function seedDeadlines(pg: PGlite) {
  const today = new Date().toISOString().slice(0, 10);
  const orgs = (await pg.query<{ id: string; slug: string; manager: string; country: string }>("select id, slug, manager, country from organisations")).rows;
  const managerOf = new Map(orgs.map(org => [org.id, org.manager]));
  const marks: Row[] = [];
  // Cyprus's provisional tax; the UK's own deadlines are below.
  for (const org of orgs.filter(item => item.country === "CY")) for (const due of ["2025-07-31", "2025-12-31", "2026-07-31"]) {
    if (due >= today || (base(org.slug) === "kalamies-dental" && due === "2026-07-31")) continue;
    marks.push({ organisation_id: org.id, kind: "provisional_tax", period_end: due, done_on: addDays(due, -3), done_by: org.manager });
  }
  const months = (await pg.query<{ organisation_id: string; month_end: string }>(`
    select i.organisation_id, (date_trunc('month', i.issued_on) + interval '1 month - 1 day')::date::text as month_end
      from invoices i join customers c on c.id = i.customer_id
     where i.vat_treatment = 'reverse_charge' and c.eu_business and i.status in ('issued', 'part_paid', 'paid') group by 1, 2`)).rows;
  for (const row of months) {
    const [year, month] = row.month_end.split("-").map(Number);
    const due = month === 12 ? `${year + 1}-01-15` : `${year}-${String(month + 1).padStart(2, "0")}-15`;
    if (due < today) marks.push({ organisation_id: row.organisation_id, kind: "vies", period_end: row.month_end, done_on: addDays(due, -2), done_by: managerOf.get(row.organisation_id) ?? "Maria Antoniou" });
  }
  // The balance of 2025's tax, paid by 1 August 2026; every annual return and month's payroll returns already due, done.
  const companies = (await pg.query<{ id: string; slug: string; manager: string; incorporated_on: string | null; is_practice: boolean; country: string; year_end_month: number; vat_registered: boolean;
    vat_quarter_end_month: number }>("select id, slug, manager, incorporated_on::text, is_practice, country, year_end_month, vat_registered, vat_quarter_end_month from organisations")).rows;
  // A UK client's: every filing with Companies House and HMRC already due, done (VAT returns are filed returns, above).
  for (const org of companies.filter(item => item.country === "GB")) {
    for (const item of ukObligations({ registered: org.vat_registered, booksFrom: START, until: today, yearEndMonth: org.year_end_month, incorporatedOn: org.incorporated_on, entity: "company",
      vat: { period: "quarterly", quarterEndMonth: org.vat_quarter_end_month, yearEndMonth: null, annualPayments: null } })) {
      if (item.kind !== "vat_return" && item.kind !== "accounts_filing" && item.due < today) marks.push({ organisation_id: org.id, kind: item.kind, period_end: item.periodEnd, done_on: addDays(item.due, -5), done_by: org.manager });
    }
  }
  for (const org of companies.filter(item => item.country === "CY")) {
    if (!org.is_practice && "2026-08-01" < today) marks.push({ organisation_id: org.id, kind: "tax_payment", period_end: "2025-12-31", done_on: "2026-07-28", done_by: org.manager });
    if (org.incorporated_on) for (const date of annualReturnDates(org.incorporated_on, START, today))
      if (addDays(date, 28) < today) marks.push({ organisation_id: org.id, kind: "annual_return", period_end: date, done_on: addDays(date, 9), done_by: org.manager });
    if (!(CLIENT_SERVICES[base(org.slug)] ?? []).includes("payroll")) continue;
    for (const month of MONTHS) {
      const end = `${month}-${String(lastDay(month)).padStart(2, "0")}`;
      const next = MONTHS[MONTHS.indexOf(month) + 1] ?? "2026-11";
      const due = `${next}-${String(lastDay(next)).padStart(2, "0")}`;
      if (due < today) marks.push({ organisation_id: org.id, kind: "payroll", period_end: end, done_on: addDays(due, -6), done_by: org.manager });
    }
    // The employer's return for 2025 is extended to 30 November 2026: one is in, three to go.
    if (base(org.slug) === "aegean-blue-marine") marks.push({ organisation_id: org.id, kind: "employer_return", period_end: "2025-12-31", done_on: "2026-10-14", done_by: org.manager });
  }
  if (marks.length) await pg.query("insert into deadline_marks (organisation_id, kind, period_end, done_on, done_by) select organisation_id, kind, period_end, done_on, done_by from jsonb_populate_recordset(null::deadline_marks, $1::jsonb)", [JSON.stringify(marks)]);
}

// ---------------------------------------------------------------------------
// Company law: when each company was incorporated, who audits it, and 2025's
// year end in each state there is. Aegean Blue and Mesogeios are filed;
// Troodos Gold is signed, audited by the practice itself (the independence
// question); Larnaka Roast is with the auditor and past its AGM date (last
// year's figures over the review limit, so audited); Kalamies Dental is
// within the limits both years and chose a review; Pixelforge hasn't started.
// The year before the books began holds only the AGM it was laid at.
// ---------------------------------------------------------------------------

const COMPANY_LAW: Record<string, { incorporated: string; auditor?: string; practiceAudits?: boolean; group?: boolean }> = {
  "aegean-blue-marine": { incorporated: "2014-03-11", auditor: "Kition Audit Partners Ltd" },
  "troodos-gold": { incorporated: "2011-01-15", auditor: "Saltlake Accounting Ltd", practiceAudits: true },
  "kalamies-dental": { incorporated: "2016-05-03", auditor: "Kition Audit Partners Ltd" },
  "larnaka-roast": { incorporated: "2019-08-20", auditor: "Kition Audit Partners Ltd" },
  "pixelforge": { incorporated: "2020-11-02", auditor: "Kition Audit Partners Ltd" },
  "mesogeios-holdings": { incorporated: "2008-06-30", auditor: "Kition Audit Partners Ltd", group: true },
  "saltlake-accounting": { incorporated: "2019-03-14", auditor: "Kition Audit Partners Ltd" },
  // Small UK companies, exempt from audit.
  "thames-edge-joinery": { incorporated: "2017-06-12" },
  "willow-wren-design": { incorporated: "2021-02-03" },
};
const YEAR_ENDS: Record<string, Row[]> = {
  // Small UK companies, exempt from audit: Willow & Wren's 2025 accounts are at Companies House; Thames Edge's, to 31 March 2026, are approved.
  "willow-wren-design": [
    { period_end: "2025-12-31", assurance: "exempt", average_employees: 3, turnover_before_books: 27400, prior_turnover: 51800, prior_total_assets: 21300, approved_on: "2026-08-28", filed_on: "2026-09-10" },
  ],
  "thames-edge-joinery": [
    { period_end: "2026-03-31", assurance: "exempt", average_employees: 4, turnover_before_books: 47200, prior_turnover: 176400, prior_total_assets: 118200, approved_on: "2026-10-15" },
  ],
  "aegean-blue-marine": [
    { period_end: "2024-12-31", agm_on: "2025-05-22" },
    { period_end: "2025-12-31", average_employees: 7, turnover_before_books: 161400, prior_turnover: 298700, prior_total_assets: 141200,
      sent_to_auditor_on: "2026-02-27", approved_on: "2026-04-14", report_signed_on: "2026-04-16", opinion: "unmodified", agm_on: "2026-05-21", filed_on: "2026-06-04" },
  ],
  "troodos-gold": [
    { period_end: "2024-12-31", agm_on: "2025-09-30" },
    { period_end: "2025-12-31", average_employees: 9, turnover_before_books: 48900, prior_turnover: 96800, prior_total_assets: 58300,
      sent_to_auditor_on: "2026-05-12", approved_on: "2026-07-08", report_signed_on: "2026-07-10", opinion: "unmodified" },
  ],
  "kalamies-dental": [
    { period_end: "2024-12-31", agm_on: "2025-09-18" },
    { period_end: "2025-12-31", assurance: "review", average_employees: 4, turnover_before_books: 94500, prior_turnover: 184300, prior_total_assets: 98400, sent_to_auditor_on: "2026-09-28" },
  ],
  "larnaka-roast": [
    { period_end: "2024-12-31", agm_on: "2025-06-30" },
    { period_end: "2025-12-31", average_employees: 6, turnover_before_books: 101200, prior_turnover: 212400, prior_total_assets: 61700, sent_to_auditor_on: "2026-09-15",
      notes: "2024 turnover was over the review limit, so 2025 is audited. Kition have asked for the coffee stock count sheets." },
  ],
  "mesogeios-holdings": [
    { period_end: "2024-12-31", agm_on: "2025-04-24" },
    { period_end: "2025-12-31", average_employees: 0, turnover_before_books: 3750, prior_turnover: 7500, prior_total_assets: 431900,
      sent_to_auditor_on: "2026-02-10", approved_on: "2026-03-24", report_signed_on: "2026-03-26", opinion: "unmodified", agm_on: "2026-04-29", filed_on: "2026-05-12" },
  ],
};

async function seedYearEnds(pg: PGlite) {
  for (const [slug, law] of [...Object.entries(COMPANY_LAW), ...[...TEMPLATE].filter(([, template]) => COMPANY_LAW[template])
    .map(([slug, template], index) => [slug, { ...COMPANY_LAW[template], incorporated: addDays(COMPANY_LAW[template].incorporated, -37 * (index + 1)) }] as const)])
    await pg.query("update organisations set incorporated_on = $2, auditor_name = $3, auditor_is_practice = $4, consolidated_group = $5 where slug = $1",
      [slug, law.incorporated, law.auditor ?? null, law.practiceAudits ?? false, law.group ?? false]);
  const rows = Object.entries(YEAR_ENDS).flatMap(([slug, years]) => years.map(year => ({ slug, assurance: "audit", updated_by: MANAGERS[slug] ?? "Maria Antoniou", ...year })));
  await pg.query(`insert into year_ends (organisation_id, period_end, assurance, average_employees, turnover_before_books, prior_turnover, prior_total_assets,
      sent_to_auditor_on, approved_on, report_signed_on, opinion, agm_on, filed_on, notes, updated_by)
    select o.id, r.period_end, r.assurance, r.average_employees, r.turnover_before_books, r.prior_turnover, r.prior_total_assets,
           r.sent_to_auditor_on, r.approved_on, r.report_signed_on, r.opinion, r.agm_on, r.filed_on, r.notes, r.updated_by
      from jsonb_to_recordset($1::jsonb) as r (slug text, period_end date, assurance text, average_employees numeric, turnover_before_books numeric, prior_turnover numeric, prior_total_assets numeric,
           sent_to_auditor_on date, approved_on date, report_signed_on date, opinion text, agm_on date, filed_on date, notes text, updated_by text)
      join organisations o on o.slug = r.slug`, [JSON.stringify(rows)]);
}

// ---------------------------------------------------------------------------
// The practice's own books and work: its people, Saltlake Accounting Ltd as a
// company of its own (its clients its customers, its fees its sales), July to
// September's fee invoices, and the hours each person has put into each client.
// ---------------------------------------------------------------------------

const STAFF = [
  { name: "Maria Antoniou", role: "Partner", weekly_hours: 35 },
  { name: "Andreas Kyriakou", role: "Senior accountant", weekly_hours: 37.5 },
  { name: "Sofia Georgiou", role: "Accountant", weekly_hours: 35 },
];
/** Each client's monthly fee, rate for extra work, what the firm charges it for the app, and the hours a month its books take. */
const FEES: Record<string, { fee: number; rate: number; app: number; hours: number }> = {
  "aegean-blue-marine": { fee: 450, rate: 60, app: 25, hours: 9.5 }, "kalamies-dental": { fee: 250, rate: 60, app: 0, hours: 7.8 },
  "larnaka-roast": { fee: 300, rate: 60, app: 25, hours: 5.1 }, "mesogeios-holdings": { fee: 600, rate: 90, app: 0, hours: 6.5 },
  "pixelforge": { fee: 380, rate: 60, app: 25, hours: 4.2 }, "troodos-gold": { fee: 280, rate: 60, app: 25, hours: 4.4 },
  "thames-edge-joinery": { fee: 320, rate: 60, app: 25, hours: 5.2 }, "willow-wren-design": { fee: 180, rate: 60, app: 25, hours: 3.1 },
};
const WORK = ["Bookkeeping", "Bank reconciliation", "VAT return", "Payroll", "Call with the owner", "Supplier invoices", "Management accounts"];

// ---------------------------------------------------------------------------
// VIES. The companies are invented, so the real register has never heard of
// them: the demo register answers for them instead. Each Cyprus company is in
// it under its own name, as Cyprus discloses names but not addresses. Of
// Pixelforge's EU customers, Nordlicht was checked last week (Germany
// discloses nothing), Brabant in June, so is due a fresh check before the next
// zero-rated invoice, and Atelier Lumière never. Nimbus, its Dutch hosting
// supplier, is registered under its parent's name: the check shows that.
// ---------------------------------------------------------------------------

const VIES_EU = [
  { number: "DE298765435", name: null, address: null },
  { number: "NL859123455B01", name: "BRABANT DIGITAL B.V.", address: "MARKT 00014, 5611EB EINDHOVEN" },
  { number: "FR72823456785", name: "SAS ATELIER LUMIERE", address: "12 RUE DES TANNEURS, 69002 LYON" },
  { number: "NL822334458B01", name: "STRATOCUMULUS HOSTING B.V.", address: "ZUIDPLEIN 00200, 1077XV AMSTERDAM" },
];

async function seedVies(pg: PGlite) {
  for (const entry of VIES_EU)
    await pg.query("insert into vies_demo_register (country, number, valid, name, address) values ($1, $2, true, $3, $4)", [entry.number.slice(0, 2), entry.number.slice(2), entry.name, entry.address]);
  await pg.query(`insert into vies_demo_register (country, number, valid, name)
    select distinct on (left(vat, 2), substr(vat, 3)) left(vat, 2), substr(vat, 3), true, upper(name)
      from (select vat_number as vat, name from organisations union all select vat_number, name from customers union all select vat_number, name from suppliers) known
     where vat ~ '^CY[0-9]{8}[A-Z]$'
    on conflict do nothing`);
  const pixelforge = (await pg.query<{ id: string }>("select id from organisations where slug = 'pixelforge'")).rows[0].id;
  const today = new Date();
  const ago = (days: number, time: string) => `${addDays(today.toISOString().slice(0, 10), -days)}T${time}.000Z`;
  for (const check of [
    { number: "DE298765435", name: null, address: null, at: ago(9, "08:41:12"), by: "Andreas Kyriakou" },
    { number: "NL859123455B01", name: VIES_EU[1].name, address: VIES_EU[1].address, at: ago(142, "11:05:47"), by: "Sofia Georgiou" },
  ])
    await pg.query("insert into vat_checks (organisation_id, country, number, valid, name, address, source, checked_by, checked_at) values ($1, $2, $3, true, $4, $5, 'demo', $6, $7)",
      [pixelforge, check.number.slice(0, 2), check.number.slice(2), check.name, check.address, check.by, check.at]);
}

async function seedPractice(pg: PGlite) {
  const today = new Date().toISOString().slice(0, 10);
  const practiceId = (await pg.query<{ id: string }>("select id from practices limit 1")).rows[0].id;
  // Each of the firm's people has a sign-in, and sees every company the firm keeps.
  for (const person of STAFF) {
    const email = `${person.name.split(" ")[0].toLowerCase()}@saltlake.example`;
    await pg.query("insert into app_users (name, email, initials) values ($1, $2, $3) on conflict (email) do nothing", [person.name, email, person.name.split(" ").map(part => part[0]).join("")]);
    await pg.query(`insert into practice_staff (practice_id, name, role, weekly_hours, mlco, user_id) select $1, $2, $3, $4, $5, id from app_users where email = $6`,
      [practiceId, person.name, person.role, person.weekly_hours, person.name === "Maria Antoniou", email]);
  }
  // A client's own owner, who uses Pixelforge's books and sees nothing else: not the other clients, not the firm's file on Pixelforge.
  const owner = (await pg.query<{ id: string }>("insert into app_users (name, email, initials) values ('Nikos Savva', 'nikos@pixelforge.example', 'NS') returning id")).rows[0].id;
  await pg.query("insert into company_members (organisation_id, user_id, role) select id, $1, 'owner' from organisations where slug = 'pixelforge'", [owner]);
  // On the laptop, each seeded person's sign-in is a stand-in with their own id. On Supabase the sign-ins are made there
  // (npm run supabase:demo-users) and attach by email, so they are left for it.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) await pg.query("update app_users set auth_id = id where auth_id is null");
  const clients = (await pg.query<{ id: string; slug: string; name: string; vat_number: string | null; vat_registered: boolean; contact_email: string | null; address: string | null; manager: string; country: string }>(
    "select id, slug, name, vat_number, vat_registered, contact_email, address, manager, country from organisations order by name")).rows;

  // Saltlake Accounting Ltd: the firm's own books, from July 2026.
  const org = randomUUID(), bank = randomUUID(), fees = randomUUID(), payroll = randomUUID();
  await pg.query(`insert into organisations (id, practice_id, slug, name, greek_name, industry, he_number, vat_number, tic, vat_registered, vat_quarter_end_month, year_end_month,
      contact_name, contact_email, address, invoice_prefix, payment_terms_days, invoice_accent, invoice_footer, manager, is_practice)
    values ($1, $2, 'saltlake-accounting', 'Saltlake Accounting Ltd', 'ΣΑΛΤΛΕΪΚ ΛΟΓΙΣΤΙΚΗ ΛΤΔ', 'Chartered accountants: the firm''s own books', 'HE 402881', 'CY10402881S', '12402881S', true, 3, 12,
      'Maria Antoniou', 'maria@saltlake.example', '18 Grigori Afxentiou Avenue, 6023 Larnaca', 'SAL-', 14, '#0d6e6e', 'Fees are due within 14 days. Thank you for your business.', 'Maria Antoniou', true)`, [org, practiceId]);
  const accounts: Row[] = [
    { id: bank, organisation_id: org, code: "090", name: "Bank of Cyprus current account", type: "bank", bank_details: "IBAN CY63 0020 0195 0000 3570 0128 4419\nBIC BCYPCY2N" },
    { id: fees, organisation_id: org, code: "200", name: "Accounting and tax fees", type: "revenue", system_role: "sales" },
    { id: payroll, organisation_id: org, code: "205", name: "Payroll and company secretarial", type: "revenue" },
    ...BASE.map(account => ({ id: randomUUID(), organisation_id: org, code: account.code, name: account.name, type: account.type, system_role: account.role ?? null, description: account.description ?? null })),
  ];
  await pg.query(`insert into ledger_accounts (id, organisation_id, code, name, type, system_role, description, bank_details)
    select id, organisation_id, code, name, type, system_role, description, bank_details from jsonb_populate_recordset(null::ledger_accounts, $1::jsonb)`, [JSON.stringify(accounts)]);
  await pg.query("update organisations set default_bank_account_id = $2 where id = $1", [org, bank]);

  // Each client company is a customer of the firm, with its fee.
  const customerOf = new Map<string, string>();
  for (const client of clients) {
    const plan = FEES[base(client.slug)];
    if (!plan) continue;
    const customer = (await pg.query<{ id: string }>(`insert into customers (organisation_id, name, email, vat_number, country, address, default_account_id)
      values ($1, $2, $3, $4, $7, $5, $6) returning id`, [org, client.name, client.contact_email, client.vat_registered ? client.vat_number : null, client.address, fees, client.country])).rows[0].id;
    customerOf.set(client.id, customer);
    await pg.query("insert into client_fees (organisation_id, customer_id, monthly_fee, hourly_rate, app_fee) values ($1, $2, $3, $4, $5)", [client.id, customer, plan.fee, plan.rate, plan.app]);
  }

  // July to September's fees, invoiced on the first of each month. July and August are paid; two of September's are not.
  let number = 0;
  const month = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  for (const period of ["2026-07-01", "2026-08-01", "2026-09-01"]) {
    if (period > today) continue;
    for (const client of clients) {
      const plan = FEES[base(client.slug)], customer = customerOf.get(client.id);
      if (!plan || !customer) continue;
      number += 1;
      // A UK client's fees are outside the scope of Cyprus VAT: a business customer accounts for VAT where it is.
      const rate = client.country === "CY" ? 19 : 0;
      const lines = [{ description: `Accounting services, ${month(period)}`, account_id: fees, net: plan.fee, vat_rate: rate, vat_amount: Math.round(plan.fee * rate) / 100 }];
      if (plan.app) lines.push({ description: `Online books and invoicing, ${month(period)}`, account_id: fees, net: plan.app, vat_rate: rate, vat_amount: Math.round(plan.app * rate) / 100 });
      const invoice = (await pg.query<{ id: string }>("select save_invoice($1, null, $2, $3, $4, $5, $8::vat_treatment, null, $6::jsonb, 'issued', $7) as id",
        [org, customer, `SAL-2026-${String(number).padStart(4, "0")}`, period, addDays(period, 14), JSON.stringify(lines), `Fees ${month(period)}`, rate ? "standard" : "outside_scope"])).rows[0].id;
      await pg.query("update invoices set sent_at = $2, sent_to = $3 where id = $1", [invoice, `${period}T08:30:00Z`, client.contact_email]);
      await pg.query("insert into fee_invoices (client_organisation_id, period, invoice_id) values ($1, $2, $3)", [client.id, period, invoice]);
      const unpaid = period === "2026-09-01" && ["aegean-blue-marine", "kalamies-dental"].includes(client.slug);
      const paidOn = addDays(period, 6 + (number % 7));
      if (!unpaid && paidOn <= today) await pg.query(`insert into invoice_payments (organisation_id, invoice_id, received_on, amount, bank_account_id, method, reference)
        select organisation_id, id, $2, total, $3, 'bank_transfer', number from invoices where id = $1`, [invoice, paidOn, bank]);
    }
  }

  // Hours: each client's books take about the same time each month, mostly by the person who looks after them.
  const entries: Row[] = [];
  const staffNames = STAFF.map(person => person.name);
  const workingDays = (from: string, to: string) => {
    const days: string[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) { const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); if (weekday !== 0 && weekday !== 6) days.push(day); }
    return days;
  };
  const add = (orgId: string, person: string, day: string, minutes: number, work: string, extra = false) => {
    const start = new Date(Date.parse(`${day}T06:00:00Z`) + Math.floor(rand() * 7) * 30 * 60_000);
    entries.push({ organisation_id: orgId, person, work, started_at: start.toISOString(), ended_at: new Date(start.getTime() + minutes * 60_000).toISOString(), minutes, extra });
  };
  const monthStart = `${today.slice(0, 7)}-01`;
  for (const period of ["2026-08-01", "2026-09-01", monthStart]) {
    const end = period === monthStart ? today : addDays(addDays(period, 32).slice(0, 8) + "01", -1);
    const days = workingDays(period, end);
    if (!days.length) continue;
    for (const client of clients) {
      const plan = FEES[base(client.slug)];
      if (!plan) continue;
      let left = Math.round(plan.hours * 60);
      while (left > 0) {
        const minutes = Math.min(left, [30, 45, 60, 75, 90][Math.floor(rand() * 5)]);
        const person = rand() < 0.8 ? client.manager : staffNames[Math.floor(rand() * staffNames.length)];
        add(client.id, person, days[Math.floor(rand() * days.length)], minutes, WORK[Math.floor(rand() * WORK.length)]);
        left -= minutes;
      }
    }
  }
  // Extra work this month, billed on top of the fee.
  const extraFor = (slug: string) => clients.find(client => client.slug === slug);
  const thisMonth = workingDays(monthStart, today);
  if (thisMonth.length) {
    const mesogeios = extraFor("mesogeios-holdings"), pixelforge = extraFor("pixelforge");
    if (mesogeios) add(mesogeios.id, "Maria Antoniou", thisMonth[Math.floor(thisMonth.length / 2)], 180, "Refinancing pack for the bank", true);
    if (pixelforge) add(pixelforge.id, "Sofia Georgiou", thisMonth[thisMonth.length - 1], 90, "Advice: registering for VAT in Germany", true);
  }
  // This week: the firm's own work fills each person's week, and Sofia's runs over.
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const week = workingDays(monday, today);
  const target: Record<string, number> = { "Maria Antoniou": 14, "Andreas Kyriakou": 24.5, "Sofia Georgiou": 37 };
  for (const person of staffNames) {
    const logged = entries.filter(entry => entry.person === person && String(entry.started_at).slice(0, 10) >= monday).reduce((sum, entry) => sum + Number(entry.minutes), 0);
    let left = Math.round(target[person] * 60) - logged;
    if (left <= 0 || !week.length) continue;
    // A day's own work is one or two entries, as people log it, not a stack of identical blocks.
    const internal = ["Practice admin", "Team meeting", "Training: VAT changes", "New client proposals", "Quality review", "Planning the week"];
    const perDay = Math.ceil(left / week.length / 15) * 15;
    week.forEach((day, index) => {
      const minutes = Math.min(left, perDay);
      const parts = minutes > 240 ? [Math.round(minutes / 2 / 15) * 15, minutes - Math.round(minutes / 2 / 15) * 15] : [minutes];
      parts.forEach((part, which) => {
        if (part <= 0) return;
        add(org, person, day, part, internal[(index * 2 + which + staffNames.indexOf(person)) % internal.length]);
        left -= part;
      });
    });
  }
  await pg.query(`insert into time_entries (organisation_id, person, work, started_at, ended_at, minutes, extra)
    select organisation_id, person, work, started_at, ended_at, minutes, extra from jsonb_populate_recordset(null::time_entries, $1::jsonb)`, [JSON.stringify(entries)]);
}

// ---------------------------------------------------------------------------
// Client files. The EU sanctions list as a snapshot (scripts/make-sanctions-snapshot.mts),
// so screening works with no network. Every client's due diligence: the
// letter signed when the books began, the people behind it, their documents,
// screened clear on the snapshot and rated. Mesogeios' review is a week
// overdue and Kalamies' is due in three weeks. And Kypros Ferry Lines, won
// from the firm's own website form five days ago, half way through being
// taken on: the letter still to send, one document still to come, nobody
// screened yet. Its 40% owner shares his name with two listed persons, born
// in other years: the screening shows how a namesake is ruled out.
// ---------------------------------------------------------------------------

type SeedPerson = { name: string; roles: Role[]; ownership: number | null; born: string; nationality: string; residence: string; id: ["passport" | "id_card", string, string]; pep?: Person["pep"] };
const CLIENT_PEOPLE: Record<string, SeedPerson[]> = {
  "thames-edge-joinery": [
    { name: "Tom Ashworth", roles: ["director", "shareholder"], ownership: 60, born: "1979-03-21", nationality: "GB", residence: "GB", id: ["passport", "548120937", "2031-08-14"] },
    { name: "Priya Ashworth", roles: ["shareholder"], ownership: 40, born: "1982-10-05", nationality: "GB", residence: "GB", id: ["passport", "551873026", "2030-04-02"] },
  ],
  "willow-wren-design": [
    { name: "Hannah Wren", roles: ["director", "shareholder"], ownership: 50, born: "1988-07-12", nationality: "GB", residence: "GB", id: ["passport", "563409182", "2033-01-25"] },
    { name: "Joel Willow", roles: ["director", "shareholder"], ownership: 50, born: "1986-12-30", nationality: "GB", residence: "GB", id: ["passport", "560271944", "2032-06-09"] },
  ],
  "aegean-blue-marine": [
    { name: "Christos Panayiotou", roles: ["director", "shareholder"], ownership: 70, born: "1968-11-02", nationality: "CY", residence: "CY", id: ["id_card", "0811204", "2031-05-17"] },
    { name: "Ioanna Panayiotou", roles: ["secretary", "shareholder"], ownership: 30, born: "1972-04-19", nationality: "CY", residence: "CY", id: ["id_card", "0927731", "2029-09-03"] },
  ],
  "troodos-gold": [{ name: "Eleni Kyprianou", roles: ["director", "shareholder"], ownership: 50, born: "1979-06-08", nationality: "CY", residence: "CY", id: ["id_card", "1044582", "2030-02-11"] },
    { name: "Giorgos Kyprianou", roles: ["shareholder"], ownership: 50, born: "1976-01-23", nationality: "CY", residence: "CY", id: ["id_card", "0993217", "2028-12-01"] }],
  "kalamies-dental": [{ name: "Sofia Hadjioannou", roles: ["director", "shareholder"], ownership: 100, born: "1981-09-14", nationality: "CY", residence: "CY", id: ["passport", "K00812734", "2032-03-30"] }],
  "larnaka-roast": [{ name: "Marios Georgiou", roles: ["director", "shareholder"], ownership: 70, born: "1985-02-27", nationality: "CY", residence: "CY", id: ["id_card", "1187340", "2031-08-22"] },
    { name: "Katerina Georgiou", roles: ["shareholder"], ownership: 30, born: "1987-07-05", nationality: "GR", residence: "CY", id: ["id_card", "AK 412873", "2033-01-14"] }],
  "pixelforge": [{ name: "Nikos Savva", roles: ["director", "shareholder"], ownership: 70, born: "1990-03-11", nationality: "CY", residence: "CY", id: ["passport", "K01294551", "2033-06-09"] },
    { name: "Daniel Weber", roles: ["director", "shareholder"], ownership: 30, born: "1988-12-01", nationality: "DE", residence: "CY", id: ["passport", "C4L9X2T7M", "2030-10-28"] }],
  "mesogeios-holdings": [{ name: "Petros Constantinou", roles: ["director", "shareholder"], ownership: 100, born: "1959-05-30", nationality: "CY", residence: "CY", id: ["passport", "K00371920", "2029-04-04"] },
    { name: "Elena Constantinou", roles: ["director"], ownership: null, born: "1962-10-12", nationality: "CY", residence: "CY", id: ["id_card", "0688415", "2030-07-19"] }],
};
const CLIENT_SERVICES: Record<string, Service[]> = {
  "aegean-blue-marine": ["bookkeeping", "vat", "payroll", "tax_return", "annual_accounts"], "troodos-gold": ["bookkeeping", "vat", "payroll", "tax_return"],
  "kalamies-dental": ["bookkeeping", "payroll", "tax_return", "annual_accounts"], "larnaka-roast": ["bookkeeping", "vat", "payroll", "tax_return"],
  "pixelforge": ["bookkeeping", "vat", "tax_return", "annual_accounts"], "mesogeios-holdings": ["bookkeeping", "vat", "tax_return", "annual_accounts", "secretarial"],
  "thames-edge-joinery": ["bookkeeping", "vat", "tax_return", "annual_accounts"], "willow-wren-design": ["bookkeeping", "vat", "tax_return", "annual_accounts"],
};
/** Days from today to each client's next AML review. */
const REVIEW_IN: Record<string, number> = { "aegean-blue-marine": 412, "troodos-gold": 655, "kalamies-dental": 19, "larnaka-roast": 287, "pixelforge": 530, "mesogeios-holdings": -7,
  "thames-edge-joinery": 318, "willow-wren-design": 590 };

/** A one-page PDF marked as demo data, standing in for a scanned document. Latin text only. */
function demoPdf(lines: string[]) {
  const text = lines.map((line, index) => `BT /F1 ${index === 0 ? 15 : 10.5} Tf 56 ${770 - index * 24} Td (${line.replace(/[()\\]/g, char => `\\${char}`)}) Tj ET`).join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function seedSanctionsSnapshot(pg: PGlite) {
  const file = path.join(process.cwd(), "src", "lib", "db", "seed-files", "eu-sanctions.json.gz");
  const snapshot = JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8")) as { generatedOn: string; entries: SanctionsEntry[] };
  const list = randomUUID();
  await pg.query("insert into sanctions_lists (id, source, generated_on, fetched_at, entries) values ($1, 'eu', $2, $3, $4)", [list, snapshot.generatedOn, `${snapshot.generatedOn}T15:10:14Z`, snapshot.entries.length]);
  for (let start = 0; start < snapshot.entries.length; start += 1000) await pg.query(SANCTIONS_INSERT, [list, JSON.stringify(snapshot.entries.slice(start, start + 1000))]);
  return snapshot.generatedOn;
}

async function seedClientFiles(pg: PGlite) {
  // The files' history is the demo's starting point, not something done in it: it stays off the audit trail.
  await pg.query("select set_config('ledgerline.seeding', 'on', false)");
  try { await writeClientFiles(pg); } finally { await pg.query("select set_config('ledgerline.seeding', '', false)"); }
}

async function writeClientFiles(pg: PGlite) {
  const today = new Date().toISOString().slice(0, 10);
  const listDate = await seedSanctionsSnapshot(pg);
  const practice = (await pg.query<{ id: string; org: string; name: string; address: string | null }>("select p.id, o.id as org, o.name, o.address from practices p join organisations o on o.practice_id = p.id and o.is_practice limit 1")).rows[0];
  const clients = (await pg.query<{ id: string; slug: string; name: string; he_number: string | null; industry: string; vat_number: string | null; vat_registered: boolean; vat_quarter_end_month: number;
    contact_name: string | null; contact_email: string | null; address: string | null; manager: string | null; monthly_fee: number; hourly_rate: number; app_fee: number }>(`
    select o.id, o.slug, o.name, o.he_number, o.industry, o.vat_number, o.vat_registered, o.vat_quarter_end_month, o.contact_name, o.contact_email, o.address, o.manager,
           f.monthly_fee, f.hourly_rate, f.app_fee from organisations o join client_fees f on f.organisation_id = o.id where not o.is_practice order by o.name`)).rows;
  const at = (date: string, time = "10:00:00") => `${date}T${time}.000Z`;

  for (const client of clients) {
    const people = CLIENT_PEOPLE[base(client.slug)] ?? [];
    const services = CLIENT_SERVICES[base(client.slug)] ?? ["bookkeeping", "vat", "tax_return"];
    const contact = (client.contact_name ?? people[0]?.name ?? "").replace(/^Dr\s+/, "");
    const fileId = randomUUID(), signedOn = "2025-06-20";
    const letter = engagementLetter({ date: "2025-06-16", practice: { name: practice.name, address: practice.address, partner: "Maria Antoniou" },
      file: { company_name: client.name, registered_address: client.address, contact_name: contact, services, monthly_fee: Number(client.monthly_fee), hourly_rate: Number(client.hourly_rate), app_fee: Number(client.app_fee), books_from: "2025-07-01" } });
    const hash = createHash("sha256").update(letterText(letter)).digest("hex");
    const token = `ll_cf_${createHash("sha256").update(`client-link:${client.slug}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
    await pg.query(`insert into client_files (id, practice_id, organisation_id, status, company_name, he_number, registered_address, business, contact_name, contact_email, services, monthly_fee, hourly_rate, app_fee,
        vat_registered, vat_number, vat_quarter_end_month, year_end_month, books_from, manager, face_to_face, client_token, letter_sent_at, letter_text, letter_hash,
        signed_at, signed_name, signed_position, signed_ip, signed_agent, signed_hash, opened_at, opened_by, created_by, created_at)
      values ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 12, '2025-07-01', $17, true, $18, $19, $20, $21, $22, $23, 'Director', $24, $25, $21, $26, 'Maria Antoniou', 'Maria Antoniou', $27)`,
      [fileId, practice.id, client.id, client.name, client.he_number, client.address, client.industry, contact, client.contact_email, services, client.monthly_fee, client.hourly_rate, client.app_fee,
       client.vat_registered, client.vat_number, client.vat_quarter_end_month, client.manager, token, at("2025-06-16", "09:12:00"), JSON.stringify(letter), hash,
       at(signedOn, "15:42:17"), people[0]?.name ?? contact, `203.0.113.${20 + clients.indexOf(client) * 7}`, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)", at("2025-06-30", "11:20:00"), at("2025-06-12", "08:40:00")]);
    await pg.query("update client_files set country = o.country from organisations o where o.id = $1 and client_files.id = $2", [client.id, fileId]);
    const ids: string[] = [];
    for (const person of people) {
      const id = randomUUID();
      ids.push(id);
      const roles = person.ownership && person.ownership > 25 ? [...person.roles, "beneficial_owner" as const] : person.roles;
      await pg.query(`insert into client_people (id, file_id, name, roles, ownership, date_of_birth, nationality, residence, id_kind, id_number, id_expires, pep, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [id, fileId, person.name, roles, person.ownership, person.born, person.nationality, person.residence, ...person.id, person.pep ?? "no", at("2025-06-12", "09:00:00")]);
    }
    const stored = (await pg.query<Person>("select id, name, roles, ownership, date_of_birth, nationality, residence, id_kind, id_number, id_expires, pep, pep_detail from client_people where file_id = $1 order by created_at, name", [fileId])).rows;
    for (const request of documentRequests(stored, "2025-07-01")) {
      const content = demoPdf([`Demo document: ${request.label.replace(/[^\x20-\x7e]/g, "'")}`, client.name, "Fictional demo data for Ledgerline. Not a real document."]);
      await pg.query(`insert into client_documents (file_id, person_id, kind, label, requested_at, file_name, media_type, content, size_bytes, received_at, received_from)
        values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, $9, 'client')`, [fileId, request.personId, request.kind, request.label, at("2025-06-16", "09:12:00"),
        `${request.label.replace(/[^A-Za-z0-9 ]+/g, " ").trim().slice(0, 60)}.pdf`, content, content.length, at("2025-06-18", "18:05:00")]);
    }
    // Screened when the list of the snapshot came out, and clear: the company and each person.
    const screenedAt = at(addDays(today, -2), "08:30:00");
    await pg.query("insert into sanctions_screenings (file_id, person_id, name, list_date, result, screened_by, screened_at) values ($1, null, $2, $3, 'clear', 'Maria Antoniou', $4)", [fileId, client.name, listDate, screenedAt]);
    for (const person of stored) await pg.query("insert into sanctions_screenings (file_id, person_id, name, list_date, result, screened_by, screened_at) values ($1, $2, $3, $4, 'clear', 'Maria Antoniou', $5)", [fileId, person.id, person.name, listDate, screenedAt]);
    // The latest approved assessment, dated so its next review falls where REVIEW_IN says.
    const factors = suggestFactors({ business: client.industry, services, face_to_face: true, introduced_by: null }, stored);
    const result = assessRisk(factors, stored);
    const review = addDays(today, REVIEW_IN[base(client.slug)] ?? 400);
    const years = { low: 3, normal: 2, high: 1 }[result.level];
    const approvedOn = `${Number(review.slice(0, 4)) - years}${review.slice(4)}`;
    if (nextReview(approvedOn, result.level) !== review) throw new Error(`${client.slug}: review date does not line up`);
    await pg.query(`insert into risk_assessments (file_id, factors, client_score, service_score, geography_score, channel_score, scored_level, forced_reason, level, assessed_by, assessed_at, approved_by, approved_as, approved_at, next_review_on)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Maria Antoniou', $10, 'Maria Antoniou', 'mlco', $11, $12)`,
      [fileId, JSON.stringify(factors), result.scores.client, result.scores.service, result.scores.geography, result.scores.channel, result.scored, result.forced, result.level,
       at(approvedOn, "09:30:00"), at(approvedOn, "16:10:00"), review]);
  }

  // The firm's own pipeline: who has asked Saltlake Accounting to keep their books.
  const enquiries = [
    { company: "Kypros Ferry Lines Ltd", person: "Andreas Michaelides", service: "Bookkeeping, VAT, payroll and company tax", stage: "won", value: 7800, days: 9, changed: 5, channel: "form" },
    { company: "Limassol Car Rentals Ltd", person: "Stelios Andreou", service: "VAT registration and monthly books", stage: "new", value: 4200, days: 1, changed: 1, channel: "form" },
    { company: "Paphos Yoga House", person: "Christina Ioannou", service: "Bookkeeping for a new studio", stage: "proposal", value: 2400, days: 12, changed: 4, channel: "manual" },
    { company: "Olive and Thyme Catering Ltd", person: "Despina Charalambous", service: "Payroll for 14 staff and the annual accounts", stage: "contacted", value: 5400, days: 6, changed: 3, channel: "manual" },
  ];
  const enquiryIds: Record<string, string> = {};
  // The firm works as a professional practice: its clients, enquiries and engagements.
  const { query, rows: rowsOf } = workspaceQueries(pg);
  await setUpWorkspace(query, rowsOf, practice.org, "professional", "CY", { labels: { job: ["Engagement", "Engagements"] } });
  const practiceStages = (await pg.query<StageRow>("select id, board, name, position, outcome from crm_stages where organisation_id = $1 order by position", [practice.org])).rows;
  const PLACES: Record<string, number | "won"> = { new: 1, contacted: 2, proposal: 3, won: "won" };
  for (const [index, enquiry] of enquiries.entries()) {
    const id = randomUUID();
    enquiryIds[enquiry.company] = id;
    const won = enquiry.stage === "won";
    await pg.query(`insert into crm_enquiries (id, organisation_id, reference, full_name, company, email, phone, source, channel, service, stage_id, value, owner, next_action, next_action_due, summary, stage_changed_at, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [id, practice.org, `SA-2026-${String(61 + index).padStart(4, "0")}`, enquiry.person, enquiry.company, `${enquiry.person.split(" ")[0].toLowerCase()}@${enquiry.company.toLowerCase().replace(/ (ltd|house)$/, "").replace(/[^a-z]+/g, "")}.example`,
       `+357 99 ${String(512330 + index * 4417).slice(0, 6)}`, enquiry.channel === "form" ? "Website" : "Referral", enquiry.channel, enquiry.service, stageAt(practiceStages, "deal", PLACES[enquiry.stage]).id, enquiry.value,
       index % 2 ? "Andreas Kyriakou" : "Maria Antoniou", won ? null : ["Call Stelios back", "Send the proposal", "Chase Despina for a decision"][index - 1] ?? null, won ? null : addDays(today, index),
       `${enquiry.service}. ${won ? "Agreed: taking them on." : "Requirement being clarified."}`, at(addDays(today, -enquiry.changed), "15:20:00"), at(addDays(today, -enquiry.days), "09:05:00")]);
    await pg.query("insert into crm_activities (organisation_id, enquiry_id, kind, body, actor, occurred_at) values ($1, $2, 'email', $3, 'system', $4)",
      [practice.org, id, `Enquiry received${enquiry.channel === "form" ? " from the website form" : ""}: ${enquiry.service.toLowerCase()}.`, at(addDays(today, -enquiry.days), "09:05:00")]);
    if (won) await pg.query("insert into crm_activities (organisation_id, enquiry_id, kind, body, actor, occurred_at) values ($1, $2, 'won', 'Won: terms agreed at a meeting in the office. Taking them on.', 'Maria Antoniou', $3)",
      [practice.org, id, at(addDays(today, -enquiry.changed), "15:20:00")]);
  }

  // Kypros Ferry Lines: taken on five days ago, half way through.
  const kypros = randomUUID();
  await pg.query(`insert into client_files (id, practice_id, enquiry_id, status, company_name, he_number, incorporated_on, registered_address, business, contact_name, contact_email, contact_phone,
      services, monthly_fee, hourly_rate, app_fee, vat_registered, vat_number, vat_quarter_end_month, year_end_month, books_from, manager, face_to_face, introduced_by, created_by, created_at)
    values ($1, $2, $3, 'onboarding', 'Kypros Ferry Lines Ltd', 'HE 431776', '2019-05-14', '27 Spyrou Kyprianou Avenue, 3070 Limassol', 'Passenger and vehicle ferry services',
      'Andreas Michaelides', 'andreas@kyprosferrylines.example', '+357 99 512330', $4, 650, 55, 25, true, 'CY10431776Q', 2, 12, $5, 'Andreas Kyriakou', true, 'Lysandrou & Co, advocates', 'Maria Antoniou', $6)`,
    [kypros, practice.id, enquiryIds["Kypros Ferry Lines Ltd"], ["bookkeeping", "vat", "payroll", "tax_return"], `${today.slice(0, 7)}-01`, at(addDays(today, -5), "15:40:00")]);
  for (const person of [
    { name: "Andreas Michaelides", roles: ["director", "shareholder", "beneficial_owner"], ownership: 60, born: "1971-03-14", nationality: "CY", residence: "CY", id: ["passport", "K00431299", "2030-08-01"] },
    { name: "Alexander Petrov", roles: ["director", "shareholder", "beneficial_owner"], ownership: 40, born: "1984-09-02", nationality: "RU", residence: "CY", id: ["passport", "76 4417302", "2031-02-11"] },
  ]) await pg.query(`insert into client_people (file_id, name, roles, ownership, date_of_birth, nationality, residence, id_kind, id_number, id_expires, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [kypros, person.name, person.roles, person.ownership, person.born, person.nationality, person.residence, ...person.id, at(addDays(today, -5), person.name.startsWith("Andreas") ? "15:45:00" : "15:47:00")]);
  const kyprosPeople = (await pg.query<{ id: string; name: string; roles: Role[] }>("select id, name, roles from client_people where file_id = $1 order by created_at", [kypros])).rows;
  for (const request of documentRequests(kyprosPeople, `${today.slice(0, 7)}-01`)) {
    // Everything the meeting brought, but Alexander Petrov's proof of address and the bank statements.
    const missing = request.kind === "bank_statements" || request.kind === "prior_accounts" || (request.kind === "address" && request.label.startsWith("Alexander"));
    const content = missing ? null : demoPdf([`Demo document: ${request.label.replace(/[^\x20-\x7e]/g, "'")}`, "Kypros Ferry Lines Ltd", "Fictional demo data for Ledgerline. Not a real document."]);
    await pg.query(`insert into client_documents (file_id, person_id, kind, label, requested_at, file_name, media_type, content, size_bytes, received_at, received_from) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [kypros, request.personId, request.kind, request.label, at(addDays(today, -5), "15:50:00"), content ? `${request.label.replace(/[^A-Za-z0-9 ]+/g, " ").trim().slice(0, 60)}.pdf` : null,
       content ? "application/pdf" : null, content, content?.length ?? null, content ? at(addDays(today, -5), "16:05:00") : null, content ? "Maria Antoniou" : null]);
  }
}
