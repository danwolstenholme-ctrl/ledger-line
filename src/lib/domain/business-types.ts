/**
 * How a company works: the kind of business it is, and what that sets up.
 * Client-safe.
 *
 * Every company has the same building blocks: its customers, a pipeline of
 * enquiries, the work it does for its customers (a job), tasks and a
 * calendar, all tied to its books. A business type is a starting point for
 * them: what the company calls each, the stages its enquiries and its work
 * go through, the extra details it keeps, and which parts it uses. The
 * accountant picks it when adding the client; the company changes any of it
 * afterwards.
 */

export const BOARDS = ["deal", "job"] as const;
export type Board = (typeof BOARDS)[number];
/** Where a stage leaves the record: still open, or closed one way or the other (won or done; lost or cancelled). */
export type Outcome = "open" | "won" | "lost";
export type StageSpec = { name: string; outcome?: Outcome; probability?: number };

export const FIELD_ENTITIES = ["customer", "deal", "job"] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];
export const FIELD_KINDS = ["text", "number", "money", "date", "choice", "yes_no", "link"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const FIELD_KIND_LABELS: Record<FieldKind, string> = { text: "Text", number: "Number", money: "Amount", date: "Date", choice: "Choice", yes_no: "Yes or no", link: "Web link" };
export type FieldSpec = { entity: FieldEntity; key: string; label: string; kind: FieldKind; options?: string[]; onCard?: boolean };

/** The parts a company can use beyond its books. Customers, invoices and the books themselves are always there. */
export const MODULES = ["pipeline", "quotes", "jobs", "tasks", "products", "payroll"] as const;
export type Module = (typeof MODULES)[number];

export type Labels = { customer: [one: string, many: string]; deal: [one: string, many: string]; job: [one: string, many: string] };

export type BusinessType = {
  key: string; label: string; examples: string;
  labels: Labels; modules: Module[];
  deal: StageSpec[]; job: StageSpec[]; fields: FieldSpec[];
  /** The first to-do on a new job, and where its enquiries usually come from. */
  firstTask: string; sources: string[];
  /** Said once, where it matters. */
  note?: string;
};

const ALL: Module[] = ["pipeline", "quotes", "jobs", "tasks", "products", "payroll"];
const won = (name: string): StageSpec => ({ name, outcome: "won", probability: 100 });
const lost = (name: string): StageSpec => ({ name, outcome: "lost", probability: 0 });

export const BUSINESS_TYPES: BusinessType[] = [
  {
    key: "trades", label: "Trades and construction", examples: "Builders, joiners, electricians, plumbers, installers",
    labels: { customer: ["Customer", "Customers"], deal: ["Enquiry", "Enquiries"], job: ["Job", "Jobs"] }, modules: ALL,
    deal: [{ name: "New", probability: 10 }, { name: "Site visit booked", probability: 30 }, { name: "Quote sent", probability: 60 }, won("Won"), lost("Lost")],
    job: [{ name: "Booked" }, { name: "In progress" }, { name: "Snagging" }, won("Completed"), lost("Cancelled")],
    fields: [
      { entity: "job", key: "site_address", label: "Site address", kind: "text", onCard: true },
      { entity: "job", key: "access", label: "Access and parking", kind: "text" },
      { entity: "deal", key: "site_address", label: "Site address", kind: "text" },
    ],
    firstTask: "Book the start date with the customer", sources: ["Phone", "Referral", "Website", "Facebook", "Repeat customer"],
  },
  {
    key: "professional", label: "Professional services", examples: "Consultants, lawyers, engineers, architects, accountants",
    labels: { customer: ["Client", "Clients"], deal: ["Enquiry", "Enquiries"], job: ["Project", "Projects"] }, modules: ALL,
    deal: [{ name: "New", probability: 10 }, { name: "First meeting", probability: 30 }, { name: "Proposal sent", probability: 60 }, won("Won"), lost("Lost")],
    job: [{ name: "Active" }, { name: "Waiting on the client" }, { name: "On hold" }, won("Completed"), lost("Cancelled")],
    fields: [{ entity: "job", key: "fee_basis", label: "Fee basis", kind: "choice", options: ["Fixed fee", "Hourly", "Monthly retainer"], onCard: true }],
    firstTask: "Send the engagement letter", sources: ["Referral", "Website", "LinkedIn", "Existing client", "Event"],
  },
  {
    key: "agency", label: "Agency, software or creative studio", examples: "Developers, designers, marketing, photo and video",
    labels: { customer: ["Client", "Clients"], deal: ["Deal", "Deals"], job: ["Project", "Projects"] }, modules: ALL,
    deal: [{ name: "Discovery", probability: 20 }, { name: "Proposal", probability: 50 }, { name: "Negotiation", probability: 75 }, won("Won"), lost("Lost")],
    job: [{ name: "Planned" }, { name: "In progress" }, { name: "In review" }, won("Delivered"), lost("Cancelled")],
    fields: [
      { entity: "job", key: "fee_basis", label: "Fee basis", kind: "choice", options: ["Fixed price", "Time and materials", "Retainer"], onCard: true },
      { entity: "job", key: "brief", label: "Brief or repository", kind: "link" },
    ],
    firstTask: "Hold the kick-off meeting", sources: ["Website", "Referral", "LinkedIn", "Clutch", "Existing client"],
  },
  {
    key: "retail", label: "Shop, café or restaurant", examples: "Shops, cafés, bars, restaurants, bakeries",
    labels: { customer: ["Customer", "Customers"], deal: ["Enquiry", "Enquiries"], job: ["Order", "Orders"] }, modules: ALL,
    deal: [{ name: "New", probability: 10 }, { name: "Quote sent", probability: 50 }, { name: "Confirmed", probability: 80 }, won("Won"), lost("Lost")],
    job: [{ name: "Received" }, { name: "Preparing" }, { name: "Ready" }, won("Delivered"), lost("Cancelled")],
    fields: [
      { entity: "job", key: "handover", label: "Collection or delivery", kind: "choice", options: ["Collection", "Delivery"], onCard: true },
      { entity: "job", key: "delivery_address", label: "Delivery address", kind: "text" },
    ],
    firstTask: "Confirm the date and time with the customer", sources: ["Walk-in", "Instagram", "Phone", "Website", "Referral"],
  },
  {
    key: "wholesale", label: "Producer, wholesale or distribution", examples: "Food and drink producers, importers, distributors",
    labels: { customer: ["Customer", "Customers"], deal: ["Lead", "Leads"], job: ["Order", "Orders"] }, modules: ALL,
    deal: [{ name: "New", probability: 10 }, { name: "Samples sent", probability: 35 }, { name: "Price agreed", probability: 70 }, won("Won"), lost("Lost")],
    job: [{ name: "Received" }, { name: "Packed" }, { name: "Dispatched" }, won("Delivered"), lost("Cancelled")],
    fields: [
      { entity: "job", key: "delivery_address", label: "Delivery address", kind: "text" },
      { entity: "job", key: "tracking", label: "Courier and tracking", kind: "text", onCard: true },
      { entity: "customer", key: "price_list", label: "Price list", kind: "choice", options: ["Retail", "Trade", "Distributor"] },
    ],
    firstTask: "Confirm the delivery date", sources: ["Trade fair", "Website", "Referral", "Sales visit", "Distributor"],
  },
  {
    key: "marine", label: "Shipping and marine services", examples: "Port agents, yacht management, crewing, ship chandlers",
    labels: { customer: ["Client", "Clients"], deal: ["Enquiry", "Enquiries"], job: ["Job", "Jobs"] }, modules: ALL,
    deal: [{ name: "New", probability: 10 }, { name: "Quoted", probability: 40 }, { name: "Nominated", probability: 80 }, won("Won"), lost("Lost")],
    job: [{ name: "Planned" }, { name: "In port" }, { name: "Final account" }, won("Closed"), lost("Cancelled")],
    fields: [
      { entity: "job", key: "vessel", label: "Vessel", kind: "text", onCard: true },
      { entity: "job", key: "imo", label: "IMO number", kind: "text" },
      { entity: "job", key: "port", label: "Port", kind: "choice", options: ["Limassol", "Larnaca", "Vassiliko", "Paphos", "Latsi"], onCard: true },
      { entity: "job", key: "eta", label: "ETA", kind: "date" },
      { entity: "deal", key: "vessel", label: "Vessel", kind: "text" },
    ],
    firstTask: "Send the proforma disbursement account", sources: ["Website", "Referral", "Owner or manager", "Charterer", "Phone"],
  },
  {
    key: "property", label: "Property and rentals", examples: "Estate agents, property managers, holiday lets",
    labels: { customer: ["Client", "Clients"], deal: ["Enquiry", "Enquiries"], job: ["Booking", "Bookings"] }, modules: ["pipeline", "quotes", "jobs", "tasks", "payroll"],
    deal: [{ name: "New", probability: 10 }, { name: "Viewing booked", probability: 35 }, { name: "Offer made", probability: 70 }, won("Won"), lost("Lost")],
    job: [{ name: "Confirmed" }, { name: "Checked in" }, won("Checked out"), lost("Cancelled")],
    fields: [
      { entity: "job", key: "property", label: "Property", kind: "text", onCard: true },
      { entity: "job", key: "guests", label: "Guests", kind: "number" },
      { entity: "deal", key: "property", label: "Property", kind: "text" },
    ],
    firstTask: "Send the booking confirmation", sources: ["Website", "Booking platform", "Referral", "Phone", "Walk-in"],
  },
  {
    key: "health", label: "Clinic or health practice", examples: "Dentists, doctors, physiotherapists, vets, clinics",
    labels: { customer: ["Patient", "Patients"], deal: ["Enquiry", "Enquiries"], job: ["Treatment plan", "Treatment plans"] }, modules: ALL,
    deal: [{ name: "New", probability: 10 }, { name: "Consultation booked", probability: 40 }, { name: "Plan sent", probability: 70 }, won("Won"), lost("Lost")],
    job: [{ name: "Proposed" }, { name: "Accepted" }, { name: "In treatment" }, won("Completed"), lost("Declined")],
    fields: [{ entity: "job", key: "paid_by", label: "Paid by", kind: "choice", options: ["Self-paying", "Insurer"], onCard: true }],
    firstTask: "Book the first appointment", sources: ["Phone", "Website", "Referral", "Walk-in", "Insurer"],
    note: "Keep clinical notes in your clinical records system. Ledgerline holds the plan, the appointments and the billing.",
  },
  {
    key: "holding", label: "Holding or investment company", examples: "Holds shares, property or loans, with little trading",
    labels: { customer: ["Customer", "Customers"], deal: ["Opportunity", "Opportunities"], job: ["Project", "Projects"] }, modules: ["pipeline", "tasks"],
    deal: [{ name: "Proposal", probability: 20 }, { name: "Due diligence", probability: 50 }, { name: "Board approval", probability: 80 }, won("Completed"), lost("Declined")],
    job: [{ name: "Active" }, won("Done"), lost("Cancelled")],
    fields: [
      { entity: "deal", key: "kind", label: "Type", kind: "choice", options: ["Acquisition", "Investment", "Loan", "Disposal", "Refinancing"], onCard: true },
      { entity: "deal", key: "stake", label: "Stake (%)", kind: "number" },
    ],
    firstTask: "Record the board's decision in the minutes", sources: ["Board", "Bank", "Introducer", "Shareholder"],
  },
  {
    key: "general", label: "Any other business", examples: "When none of the others fits",
    labels: { customer: ["Customer", "Customers"], deal: ["Enquiry", "Enquiries"], job: ["Job", "Jobs"] }, modules: ALL,
    deal: [{ name: "New", probability: 10 }, { name: "Contacted", probability: 25 }, { name: "Quote sent", probability: 60 }, won("Won"), lost("Lost")],
    job: [{ name: "To do" }, { name: "In progress" }, won("Done"), lost("Cancelled")],
    fields: [],
    firstTask: "Agree the start date", sources: ["Website", "Referral", "Phone", "Email", "Walk-in"],
  },
];
export const BUSINESS_TYPE_KEYS = BUSINESS_TYPES.map(type => type.key);
export const businessType = (key: string | null | undefined) => BUSINESS_TYPES.find(type => type.key === key) ?? BUSINESS_TYPES[BUSINESS_TYPES.length - 1];

/** A likely kind of business from what the company says it does, as the accountant's starting point. */
const SUGGESTIONS: [RegExp, string][] = [
  [/\b(ship|shipping|vessel|yacht|marine|port agen|ferry|crew|chandl|maritime)/i, "marine"],
  [/\b(dental|dentist|clinic|medical|physio|doctor|veterin|health centre|optic)/i, "health"],
  [/\b(holding|investment|investor)/i, "holding"],
  [/\b(build|construct|joiner|carpent|electric|plumb|install|renovat|roofing|kitchen fitt)/i, "trades"],
  [/\b(software|developer|app\b|design studio|agency|marketing|media|video|photograph|creative|digital|web)/i, "agency"],
  [/\b(wholesale|distribut|import|export|producer|manufactur|olive oil|winery|brewery|roaster)/i, "wholesale"],
  [/\b(shop|store|café|cafe|restaurant|\bbar\b|bakery|retail|tavern|kiosk)/i, "retail"],
  [/\b(propert|real estate|estate agent|rental|letting|holiday home|villa)/i, "property"],
  [/\b(law|legal|advocate|consult|architect|engineer|accountan|audit|tax adviser|surveyor)/i, "professional"],
];
export const suggestBusinessType = (business: string | null | undefined) => SUGGESTIONS.find(([pattern]) => pattern.test(business ?? ""))?.[1] ?? "general";

/** How a stage reads on its board: a deal is won or lost, a job done or cancelled. */
export const outcomeLabel = (board: Board, outcome: Outcome) => outcome === "open" ? "Open" : board === "deal" ? (outcome === "won" ? "Won" : "Lost") : outcome === "won" ? "Done" : "Cancelled";

/** A field's value as typed in a form, checked against its kind: the value to keep, or what is wrong with it. */
export function readFieldValue(kind: FieldKind, raw: string, options: string[] = []): { value: string | number | boolean | null } | { error: string } {
  const text = raw.trim();
  if (kind === "yes_no") return { value: text === "on" || text === "true" || text === "yes" };
  if (!text) return { value: null };
  if (text.length > 500) return { error: "is too long: 500 characters at most" };
  switch (kind) {
    case "number": case "money": {
      const value = Number(text.replace(/[,\s]/g, ""));
      if (!Number.isFinite(value)) return { error: "must be a number" };
      return { value: kind === "money" ? Math.round(value * 100) / 100 : value };
    }
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T12:00:00Z`)) ? { value: text } : { error: "is not a date" };
    case "choice": return options.includes(text) ? { value: text } : { error: "is not one of the choices" };
    case "link": return /^https?:\/\/[^\s]+$/i.test(text) ? { value: text } : { error: "must be a web address starting https://" };
    default: return { value: text };
  }
}

/** A field's key from its label: lower case, words joined by underscores. */
export const fieldKey = (label: string) => label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40) || "field";

/** A company's stages, fields and names as they are stored: what every CRM screen reads. */
export type Stage = { id: string; board: Board; name: string; position: number; outcome: Outcome; probability: number | null };
export type Field = { id: string; entity: FieldEntity; key: string; label: string; kind: FieldKind; options: string[]; position: number; on_card: boolean };
export type Workspace = { typeKey: string; labels: Labels; modules: Module[]; stages: Record<Board, Stage[]>; fields: Field[] };

export const DEFAULT_WORKSPACE: Workspace = { typeKey: "general", labels: businessType("general").labels, modules: businessType("general").modules, stages: { deal: [], job: [] }, fields: [] };
export const uses = (workspace: Pick<Workspace, "modules">, module: Module) => workspace.modules.includes(module);
/** The stages a record can be in while it is still open, in order; and the one that closes it each way. */
export const openStages = (workspace: Workspace, board: Board) => workspace.stages[board].filter(stage => stage.outcome === "open");
export const closingStage = (workspace: Workspace, board: Board, outcome: "won" | "lost") => workspace.stages[board].find(stage => stage.outcome === outcome) ?? null;
export const fieldsFor = (workspace: Workspace, entity: FieldEntity) => workspace.fields.filter(field => field.entity === entity);

/** A field's value as it reads on a page. */
export function showFieldValue(field: Pick<Field, "kind">, value: unknown, formatMoney: (amount: number) => string, formatDay: (date: string) => string): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (field.kind) {
    case "yes_no": return value ? "Yes" : "No";
    case "money": return formatMoney(Number(value));
    case "number": return Number(value).toLocaleString("en-GB");
    case "date": return formatDay(String(value));
    default: return String(value);
  }
}
