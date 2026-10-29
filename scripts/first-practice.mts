/**
 * A practice on a live Ledgerline, and an invitation for a partner: what
 * Wolsten Studios does by hand until the admin console exists (README, Going
 * live). A new practice gets its own books in Cyprus's terms, which its fees
 * are invoiced from and its audit trail is kept in. The partner is invited as
 * its compliance officer (MLCO), and makes their account from the link, valid
 * 14 days. The link is printed once: send it to the partner, and to nobody
 * else, since whoever opens it joins as the partner. A practice already there
 * is only given the invitation; one named without a partner is only opened.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/first-practice.mts \
 *     --practice "Name Ltd" [--tagline "Chartered accountants, Nicosia"] [--partner "Full Name" --email partner@example.com] [--site https://…]
 */
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";

import { freeSlug, openCompany } from "../src/lib/clients/open-company";

const { values } = parseArgs({ options: { practice: { type: "string" }, tagline: { type: "string" }, partner: { type: "string" }, email: { type: "string" }, site: { type: "string" } } });
const practice = values.practice?.trim(), tagline = values.tagline?.trim() || null, partner = values.partner?.trim(), email = values.email?.trim().toLowerCase();
const site = (values.site ?? process.env.LEDGERLINE_SITE_URL ?? "https://ledger-line-vert.vercel.app").replace(/\/$/, "");
if (!practice) throw new Error('Give --practice "Name Ltd", and --partner "Full Name" --email partner@example.com to invite its partner.');
if (Boolean(partner) !== Boolean(email)) throw new Error("A partner needs both --partner and --email.");
if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${email} is not an email address.`);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL to the live database (its session pooler, port 5432).");

// sslmode as Postgres means it ("require": encrypted), as the app connects (src/lib/db).
const client = new pg.Client({ connectionString: /[?&]sslmode=/.test(url) && !/[?&]uselibpqcompat=/.test(url) ? `${url}&uselibpqcompat=true` : url });
await client.connect();
const run = async <R = Record<string, unknown>,>(text: string, params: unknown[] = []) => (await client.query(text, params)).rows as R[];

// The same token and fingerprint as an invitation made in Ledgerline (src/lib/invitations.ts).
const token = randomBytes(24).toString("base64url");
const initials = practice.replace(/\b(Ltd|Limited|LLC|PLC)\b\.?/gi, "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "LL";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Nicosia" }).format(new Date());

try {
  await run("begin");
  await run("select set_config('ledgerline.actor', 'Wolsten Studios', true)");
  const [existing] = await run<{ id: string }>("select id from practices where lower(name) = lower($1)", [practice]);
  if (existing && !partner) throw new Error(`There is already a practice called ${practice}: name a partner to invite.`);
  let practiceId = existing?.id;
  if (!practiceId) {
    [{ id: practiceId }] = await run<{ id: string }>("insert into practices (name, initials, tagline) values ($1, $2, $3) returning id", [practice, initials, tagline]);
    // Its own books, opened as any company's are, then marked as the practice's own.
    const slug = await freeSlug(run, practice);
    const books = await openCompany(run, {
      practiceId, name: practice, business: "Accountancy practice: its own books", businessType: "professional", country: "CY", heNumber: null, vatNumber: null, vatRegistered: false,
      quarterEndMonth: 3, yearEndMonth: 12, contactName: partner ?? null, contactEmail: email ?? null, address: null, manager: partner ?? null, booksFrom: `${today.slice(0, 7)}-01`, incorporatedOn: null,
      fee: { monthly: 0, hourly: 0, app: 0 },
    }, slug);
    await run("update organisations set is_practice = true where id = $1", [books]);
    console.log(`${practice} is on Ledgerline (${initials}), with its own books at ${site}/c/${slug}.`);
  }
  if (partner && email) {
    await run("insert into invitations (practice_id, email, name, role, mlco, token_hash) values ($1, $2, $3, 'Partner', true, $4)",
      [practiceId, email, partner, createHash("sha256").update(token).digest("hex")]);
  }
  await run("commit");
  if (partner && email) {
    console.log(`${partner} (${email}) is invited to ${practice} as a partner and the compliance officer, until ${new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)}.`);
    console.log(`Their link, to send to them only:\n${site}/join/${token}`);
  }
} catch (error) {
  await run("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
