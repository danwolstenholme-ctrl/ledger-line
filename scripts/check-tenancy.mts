/**
 * Who sees what. Builds a fresh database from schema.sql and the demo data,
 * adds a second practice that has nothing to do with Saltlake, then asks the
 * database questions as different people, the way a signed-in Supabase
 * request asks them, and checks every answer. Row-level security is what
 * answers: the app is not involved.
 *
 *   npx tsx scripts/check-tenancy.mts
 *       on an embedded Postgres in memory
 *   DATABASE_URL=postgres://… CHECK_TENANCY_WIPE=1 npx tsx scripts/check-tenancy.mts
 *       on a real Postgres. It empties the database first, so never point it at one that matters.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

import { seedDemo } from "../src/lib/db/seed";

type Rows = Record<string, unknown>[];
type Conn = { query(text: string, params?: unknown[]): Promise<{ rows: Rows }>; exec(text: string): Promise<unknown>; transaction<T>(work: (tx: { query(text: string, params?: unknown[]): Promise<{ rows: Rows }> }) => Promise<T>): Promise<T> };

async function connect(): Promise<{ conn: Conn; close: () => Promise<void> }> {
  if (!process.env.DATABASE_URL) {
    const lite = await PGlite.create();
    return { conn: lite as unknown as Conn, close: () => lite.close() };
  }
  if (process.env.CHECK_TENANCY_WIPE !== "1") throw new Error("This empties the database at DATABASE_URL. Set CHECK_TENANCY_WIPE=1 to confirm.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const conn: Conn = {
    query: async (text, params) => ({ rows: (await client.query(text, params)).rows }),
    exec: text => client.query(text),
    async transaction(work) {
      await client.query("begin");
      try { const result = await work({ query: async (text, params) => ({ rows: (await client.query(text, params)).rows }) }); await client.query("commit"); return result; }
      catch (error) { await client.query("rollback"); throw error; }
    },
  };
  return { conn, close: () => client.end() };
}

const { conn, close } = await connect();
const started = Date.now();
await conn.exec("drop schema public cascade; create schema public;");
await conn.exec(fs.readFileSync(path.join(import.meta.dirname, "..", "src", "lib", "db", "schema.sql"), "utf8"));
await seedDemo(conn as unknown as PGlite);
console.log(`Built the demo database in ${((Date.now() - started) / 1000).toFixed(1)}s, on ${process.env.DATABASE_URL ? "Postgres" : "the embedded Postgres"}.\n`);

// A second practice, with one client: Harbourside Accountants, and Eva who works there.
const harbour = (await conn.query("insert into practices (name, initials) values ('Harbourside Accountants', 'HA') returning id")).rows[0].id as string;
const eva = (await conn.query("insert into app_users (name, email, initials) values ('Eva Lambrou', 'eva@harbourside.example', 'EL') returning id")).rows[0].id as string;
await conn.query("update app_users set auth_id = id where id = $1", [eva]);
await conn.query("insert into practice_staff (practice_id, name, role, user_id) values ($1, 'Eva Lambrou', 'Partner', $2)", [harbour, eva]);
await conn.query("insert into organisations (practice_id, slug, name, industry) values ($1, 'blue-door-bakery', 'Blue Door Bakery Ltd', 'Bakery')", [harbour]);

// A person's sign-in, as the claims carry it.
const user = async (email: string) => (await conn.query("select auth_id from app_users where email = $1", [email])).rows[0].auth_id as string;
const maria = await user("maria@saltlake.example"), nikos = await user("nikos@pixelforge.example");
const org = async (slug: string) => (await conn.query("select id from organisations where slug = $1", [slug])).rows[0].id as string;
const pixelforge = await org("pixelforge"), aegean = await org("aegean-blue-marine");

/** One question, asked as a person (or as nobody signed in): the role and claims Supabase gives a request. */
async function as(userId: string | null, text: string, params: unknown[] = []): Promise<Rows | { error: string; code: string }> {
  try {
    return await conn.transaction(async tx => {
      await tx.query("select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)", [JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "authenticated" })]);
      return (await tx.query(text, params)).rows;
    });
  } catch (error) {
    const failure = error as { message?: string; code?: string };
    return { error: failure.message ?? String(error), code: failure.code ?? "" };
  }
}
const count = async (userId: string | null, text: string, params: unknown[] = []) => {
  const rows = await as(userId, text, params);
  return Array.isArray(rows) ? Number(rows[0]?.n ?? rows.length) : `error: ${rows.error}`;
};

const checks: [string, unknown, (value: unknown) => boolean][] = [];
const expect = (what: string, value: unknown, test: (value: unknown) => boolean) => checks.push([what, value, test]);
const is = (wanted: unknown) => (value: unknown) => value === wanted;
const above = (floor: number) => (value: unknown) => typeof value === "number" && value > floor;
const refused = (value: unknown) => typeof value === "string" && /row-level security|permission denied/.test(value);

// Maria, a partner at Saltlake: every company the firm keeps, and its own books.
expect("Maria sees Saltlake's 9 companies, two of them in the UK", await count(maria, "select count(*) as n from organisations"), is(9));
expect("Maria sees every client file", await count(maria, "select count(*) as n from client_files"), is(9));
expect("Maria sees the time the firm spent", await count(maria, "select count(*) as n from time_entries"), above(0));
expect("Maria sees Pixelforge's invoices through the directory view", await count(maria, "select count(*) as n from v_invoice_directory where organisation_id = $1", [pixelforge]), above(0));

// Eva, at another practice: none of it.
expect("Eva sees only her own practice's company", await count(eva, "select count(*) as n from organisations"), is(1));
expect("Eva sees none of Saltlake's invoices", await count(eva, "select count(*) as n from invoices"), is(0));
expect("Eva sees none of them through the views either", await count(eva, "select count(*) as n from v_invoice_directory"), is(0));
expect("Eva sees no Saltlake customer, journal or bank line", await count(eva, "select (select count(*) from customers) + (select count(*) from journal_lines) + (select count(*) from bank_statement_lines) as n"), is(0));
expect("Eva sees no client file, person, document or screening", await count(eva, "select (select count(*) from client_files) + (select count(*) from client_people) + (select count(*) from client_documents) + (select count(*) from sanctions_screenings) as n"), is(0));
expect("Eva sees none of Saltlake's audit trail", await count(eva, "select count(*) as n from audit_log"), is(0));
expect("Eva sees no one at Saltlake", await count(eva, "select count(*) as n from app_users where email like '%@saltlake.example'"), is(0));
expect("Eva cannot add a customer to Pixelforge", await count(eva, "insert into customers (organisation_id, name) values ($1, 'Intruder Ltd') returning id", [pixelforge]), refused);
expect("Eva cannot rename Pixelforge", await count(eva, "update organisations set name = 'Taken' where id = $1 returning id", [pixelforge]), is(0));
expect("Eva cannot open books in Saltlake's practice", await count(eva, "insert into organisations (practice_id, slug, name, industry) select practice_id, 'sneaky', 'Sneaky Ltd', 'x' from organisations where id = $1 returning id", [pixelforge]), (value: unknown) => value === 0 || refused(value));

// Nikos, Pixelforge's owner: Pixelforge's books, and nothing the firm keeps about Pixelforge.
expect("Nikos sees only Pixelforge", await count(nikos, "select count(*) as n from organisations"), is(1));
expect("Nikos sees Pixelforge's invoices", await count(nikos, "select count(*) as n from invoices where organisation_id = $1", [pixelforge]), above(0));
expect("Nikos sees none of Aegean Blue's", await count(nikos, "select count(*) as n from invoices where organisation_id = $1", [aegean]), is(0));
expect("Nikos does not see the firm's AML file on Pixelforge", await count(nikos, "select count(*) as n from client_files"), is(0));
expect("Nikos does not see the firm's fee, time or staff", await count(nikos, "select (select count(*) from client_fees) + (select count(*) from time_entries) + (select count(*) from practice_staff) as n"), is(0));
expect("Nikos sees whose practice it is, for its name and colours", await count(nikos, "select count(*) as n from practices"), is(1));
expect("Nikos can raise Pixelforge's own records", await count(nikos, "insert into customers (organisation_id, name) values ($1, 'New Client GmbH') returning id", [pixelforge]), is(1));
// The language someone reads Ledgerline in is theirs to choose, and nobody else's.
expect("A person sets their own language (Nikos)", await count(nikos, "update app_users set locale = 'el' where id = app_user_id() returning id"), is(1));
expect("But not Sofia's at Kalamies", await count(nikos, "update app_users set locale = 'en' where email = 'sofia@kalamiesdental.example' returning id"), is(0));
expect("Nor Maria's at the practice", await count(nikos, "update app_users set locale = 'el' where email = 'maria@saltlake.example' returning id"), is(0));

// Invitations: the practice that sent them, and nobody else.
await conn.query("insert into invitations (practice_id, email, name, role, token_hash) select practice_id, 'new.person@example.test', 'New Person', 'Accountant', repeat('a', 64) from organisations where slug = 'pixelforge'");
expect("Maria sees Saltlake's invitations", await count(maria, "select count(*) as n from invitations"), is(1));
expect("Eva and Nikos see none of them", Number(await count(eva, "select count(*) as n from invitations")) + Number(await count(nikos, "select count(*) as n from invitations")), is(0));

// Pixelforge's auditor: reads Pixelforge's books and year end, changes nothing, and sees nothing of the firm's.
const auditor = (await conn.query("insert into app_users (name, email, initials) values ('Andri Kition', 'andri@kitionaudit.example', 'AK') returning id")).rows[0].id as string;
await conn.query("update app_users set auth_id = id where id = $1", [auditor]);
await conn.query("insert into company_members (organisation_id, user_id, role) values ($1, $2, 'auditor')", [pixelforge, auditor]);
await conn.query("insert into year_ends (organisation_id, period_end) values ($1, '2025-12-31')", [pixelforge]);
expect("The auditor reads Pixelforge's ledger", await count(auditor, "select count(*) as n from journal_lines"), above(0));
expect("The auditor reads Pixelforge's year end", await count(auditor, "select count(*) as n from year_ends"), is(1));
expect("The auditor cannot add a customer", await count(auditor, "insert into customers (organisation_id, name) values ($1, 'Audit Test Ltd') returning id", [pixelforge]), refused);
expect("The auditor cannot change an invoice, and is told so", await count(auditor, "update invoices set notes = 'changed' where organisation_id = $1 returning id", [pixelforge]), refused);
expect("Nor rename the company", await count(auditor, "update organisations set name = 'Taken' where id = $1 returning id", [pixelforge]), refused);
expect("Nor remove a bank line", await count(auditor, "delete from bank_statement_lines where organisation_id = $1 returning id", [pixelforge]), is(0));
expect("The auditor cannot record the year end's steps", await count(auditor, "update year_ends set filed_on = '2026-06-30' returning id"), is(0));
expect("The auditor sees no client file", await count(auditor, "select count(*) as n from client_files"), is(0));
expect("Nikos, the owner, cannot record the year end's steps either: the practice keeps them", await count(nikos, "update year_ends set filed_on = '2026-06-30' returning id"), is(0));
expect("Maria records them", await count(maria, "update year_ends set sent_to_auditor_on = '2026-03-01' where organisation_id = $1 returning id", [pixelforge]), is(1));
expect("Eva, at another practice, sees none of Saltlake's year ends", await count(eva, "select count(*) as n from year_ends"), is(0));

// Calendar links: each person's own, and only for what they can see.
const mariaId = (await conn.query("select id from app_users where email = 'maria@saltlake.example'")).rows[0].id as string;
expect("Maria makes a calendar link for every client", await count(maria, "insert into calendar_feeds (user_id, token_hash) values (app_user_id(), $1) returning id", ["a".repeat(64)]), is(1));
expect("Nikos makes one for Pixelforge", await count(nikos, "insert into calendar_feeds (user_id, organisation_id, token_hash) values (app_user_id(), $1, $2) returning id", [pixelforge, "b".repeat(64)]), is(1));
expect("But not for Aegean Blue, which he can't see", await count(nikos, "insert into calendar_feeds (user_id, organisation_id, token_hash) values (app_user_id(), $1, $2) returning id", [aegean, "c".repeat(64)]), refused);
expect("Nor in Maria's name", await count(nikos, "insert into calendar_feeds (user_id, token_hash) values ($1, $2) returning id", [mariaId, "d".repeat(64)]), refused);
expect("Nikos sees his own link, not Maria's", await count(nikos, "select count(*) as n from calendar_feeds"), is(1));
expect("Nobody signed in sees no calendar link", await count(null, "select count(*) as n from calendar_feeds"), is(0));

// A document shared with its customer as a link: made by whoever keeps the company's books, seen by whoever sees the company.
const pixelInvoice = (await conn.query("select id from invoices where organisation_id = $1 and status = 'issued' limit 1", [pixelforge])).rows[0].id as string;
const aegeanInvoice = (await conn.query("select id from invoices where organisation_id = $1 and status = 'issued' limit 1", [aegean])).rows[0].id as string;
const share = "insert into document_links (organisation_id, invoice_id, token) values ($1, $2, $3) returning id";
expect("Nikos shares a Pixelforge invoice as a link", await count(nikos, share, [pixelforge, pixelInvoice, "N".repeat(32)]), is(1));
expect("But not Aegean Blue's", await count(nikos, share, [aegean, aegeanInvoice, "M".repeat(32)]), refused);
expect("Nor an Aegean Blue invoice filed under Pixelforge", await count(nikos, share, [pixelforge, aegeanInvoice, "L".repeat(32)]), (value: unknown) => value === 0 || refused(value) || (typeof value === "string" && /foreign key/.test(value)));
expect("The auditor sees Pixelforge's link", await count(auditor, "select count(*) as n from document_links"), is(1));
expect("But cannot stop it", await count(auditor, "update document_links set revoked_at = now() returning id"), (value: unknown) => value === 0 || refused(value));
expect("Eva, at another practice, sees no link", await count(eva, "select count(*) as n from document_links"), is(0));
expect("Nobody signed in sees none either: a link is opened by Ledgerline, not read from the table", await count(null, "select count(*) as n from document_links"), is(0));

// A company's first steps, put away: each person's own, at a company they can see.
const dismissMine = "insert into user_dismissals (user_id, organisation_id, what) values (app_user_id(), $1, 'getting_started') returning user_id";
expect("Nikos puts Pixelforge's first steps away", await count(nikos, dismissMine, [pixelforge]), is(1));
expect("But not Aegean Blue's, which he can't see", await count(nikos, dismissMine, [aegean]), refused);
expect("Nor for Maria", await count(nikos, "insert into user_dismissals (user_id, organisation_id, what) values ($1, $2, 'getting_started') returning user_id", [mariaId, pixelforge]), refused);
expect("Maria doesn't see what Nikos put away", await count(maria, "select count(*) as n from user_dismissals"), is(0));

// Payroll: the people a company employs and what they are paid, for that company's books and nobody else's.
expect("Maria sees Aegean Blue's 4 employees", await count(maria, "select count(*) as n from employees where organisation_id = $1", [aegean]), is(4));
expect("Eva sees no employee of Saltlake's clients", await count(eva, "select count(*) as n from employees"), is(0));
expect("Nikos sees none of Aegean Blue's employees", await count(nikos, "select count(*) as n from employees where organisation_id = $1", [aegean]), is(0));
expect("Nikos, the owner, adds one to Pixelforge", await count(nikos, "insert into employees (organisation_id, name, start_date, monthly_salary) values ($1, 'Test Developer', '2026-10-01', 3000) returning id", [pixelforge]), is(1));
expect("Nor can he add one to Aegean Blue", await count(nikos, "insert into employees (organisation_id, name, start_date, monthly_salary) values ($1, 'Sneaky Hire', '2026-10-01', 3000) returning id", [aegean]), refused);
expect("Pixelforge's auditor reads its employees but cannot add one", [await count(auditor, "select count(*) as n from employees"),
  await count(auditor, "insert into employees (organisation_id, name, start_date, monthly_salary) values ($1, 'Audit Hire', '2026-10-01', 1000) returning id", [pixelforge])].join(" / "),
  (value: unknown) => typeof value === "string" && value.startsWith("1 / ") && refused(value.slice(4)));
const runRows = await as(maria, "insert into payroll_runs (organisation_id, period, pay_date, status, posted_at) values ($1, '2026-10-01', '2026-10-31', 'posted', now()) returning id", [aegean]);
const runId = Array.isArray(runRows) ? String(runRows[0]?.id) : "";
const someone = (await conn.query("select id from employees where organisation_id = $1 order by name limit 1", [aegean])).rows[0].id as string;
await as(maria, `insert into payslips (organisation_id, run_id, employee_id, salary, gross, insurable, si_employee, gesy_employee, paye, net, si_employer, gesy_employer, social_cohesion, redundancy, training)
  values ($1, $2, $3, 2000, 2000, 2000, 176, 53, 15.74, 1755.26, 176, 58, 40, 24, 10)`, [aegean, runId, someone]);
await as(maria, "select post_payroll_run($1)", [runId]);
expect("Maria posts Aegean Blue's October payroll: wages and contributions, balanced", await as(maria, `select sum(l.debit) as debit, sum(l.credit) as credit from journal_lines l join journal_entries e on e.id = l.entry_id
  where e.source = 'payroll' and e.source_id = $1`, [runId]).then(rows => Array.isArray(rows) ? `${Number(rows[0]?.debit)} = ${Number(rows[0]?.credit)}` : rows.error), is("2308 = 2308"));
expect("A payslip whose net isn't its gross less what is withheld is refused", await count(maria, `insert into payslips (organisation_id, run_id, employee_id, gross, insurable, si_employee, gesy_employee, paye, net, si_employer, gesy_employer, social_cohesion, redundancy, training)
  select $1, $2, id, 1000, 1000, 88, 26.5, 0, 900, 88, 29, 20, 12, 5 from employees where organisation_id = $1 and id <> $3 limit 1 returning id`, [aegean, runId, someone]), (value: unknown) => typeof value === "string" && value.includes("payslips_net"));
expect("Eva sees none of the payslips, Nikos none of Aegean Blue's", Number(await count(eva, "select count(*) as n from payslips")) + Number(await count(nikos, "select count(*) as n from payslips")), is(0));

// How a company works: read by everyone in it, set by its accountant or its owner. Its staff work the pipeline and never see salaries.
const staffer = (await conn.query("insert into app_users (name, email, initials) values ('Elena Markou', 'elena@pixelforge.example', 'EM') returning id")).rows[0].id as string;
await conn.query("update app_users set auth_id = id where id = $1", [staffer]);
await conn.query("insert into company_members (organisation_id, user_id, role) values ($1, $2, 'staff')", [pixelforge, staffer]);
expect("Maria sees Aegean Blue's stages, its pipeline's and its jobs'", await count(maria, "select count(*) as n from crm_stages where organisation_id = $1", [aegean]), is(10));
expect("Eva sees none of Saltlake's clients' stages or fields", await count(eva, "select (select count(*) from crm_stages) + (select count(*) from custom_fields) + (select count(*) from workspace_settings) as n"), is(0));
expect("Nikos, the owner, renames one of Pixelforge's stages", await count(nikos, "update crm_stages set name = 'Scoping' where organisation_id = $1 and board = 'deal' and position = 1 returning id", [pixelforge]), is(1));
expect("Pixelforge's staff add to its pipeline", await count(staffer, "insert into crm_enquiries (organisation_id, reference, full_name, owner) values ($1, 'P-2026-9001', 'Walk-in Visitor', 'Elena Markou') returning id", [pixelforge]), is(1));
expect("…which starts in its first stage", await count(staffer, "select count(*) as n from crm_enquiries e join crm_stages s on s.id = e.stage_id where e.reference = 'P-2026-9001' and s.name = 'Scoping'"), is(1));
expect("But they can't reshape how the company works", await count(staffer, "insert into crm_stages (organisation_id, board, name, position) values ($1, 'deal', 'Sneaky stage', 9) returning id", [pixelforge]), refused);
expect("Nor see what anyone is paid", await count(staffer, "select (select count(*) from employees) + (select count(*) from payslips) as n"), is(0));
expect("A stage from another company is refused", await count(maria, "update crm_enquiries set stage_id = (select id from crm_stages where organisation_id = $2 and board = 'deal' limit 1) where organisation_id = $1 returning id", [pixelforge, aegean]), (value: unknown) => typeof value === "string" && value.includes("crm_stage_board"));
expect("A lost enquiry needs its reason", await count(maria, "update crm_enquiries set stage_id = (select id from crm_stages where organisation_id = $1 and board = 'deal' and outcome = 'lost') where organisation_id = $1 and reference = 'P-2026-9001' returning id", [pixelforge]), (value: unknown) => typeof value === "string" && value.includes("crm_lost_reason"));

// Nobody signed in: nothing.
expect("Nobody signed in sees no company", await count(null, "select count(*) as n from organisations"), is(0));
expect("Nobody signed in sees no invoice", await count(null, "select count(*) as n from invoices"), is(0));

// The audit trail is written by the database alone, and checked whole.
expect("Maria cannot write to the audit trail", await count(maria, "insert into audit_log (action, entity, prev_hash, hash) values ('forged', 'x', 'a', 'b') returning seq"), refused);
expect("The audit chain checks out for Nikos too", await as(nikos, "select broken_at from audit_verify()").then(rows => Array.isArray(rows) ? rows[0]?.broken_at ?? "intact" : rows.error), is("intact"));

// Nothing left unguarded.
const unguarded = (await conn.query("select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1")).rows.map(row => row.tablename);
expect("Every table has row-level security on", unguarded.length ? unguarded.join(", ") : "all", is("all"));
const openViews = (await conn.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce(c.reloptions @> array['security_invoker=true'], false) order by 1`)).rows.map(row => row.relname);
expect("Every view reads with the asker's rights", openViews.length ? openViews.join(", ") : "all", is("all"));

let failed = 0;
for (const [what, value, test] of checks) {
  const ok = test(value);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${what}${ok ? "" : `: got ${JSON.stringify(value)}`}`);
}
console.log(`\n${checks.length - failed} of ${checks.length} checks passed.`);
await close();
process.exit(failed ? 1 : 0);
