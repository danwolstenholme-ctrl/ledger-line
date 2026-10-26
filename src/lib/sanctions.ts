import "server-only";

import { randomUUID } from "node:crypto";

import { asService, one, sql, transaction } from "@/lib/db";
import { prepareEntries, readEuSanctionsCsv, SANCTIONS_INSERT, screenName, type PreparedEntry, type SanctionsEntry, type SanctionsMatch } from "@/lib/domain/sanctions";

/**
 * The EU consolidated sanctions list, kept in the database and screened in
 * memory. The seed loads a snapshot, so screening works offline; "Update the
 * list" fetches the current one from the EU's Financial Sanctions Files (about
 * 25 MB, and the EU's server can be slow), in the background.
 */

const SOURCE = "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";

export type SanctionsList = { id: string; generated_on: string; fetched_at: string; entries: number };

let cached: { id: string; entries: PreparedEntry[] } | null = null;

export async function currentList() {
  return one<SanctionsList>("select id, to_char(generated_on, 'YYYY-MM-DD') as generated_on, fetched_at, entries from sanctions_lists order by generated_on desc, fetched_at desc limit 1");
}

async function prepared(list: SanctionsList) {
  if (cached?.id === list.id) return cached.entries;
  const rows = await sql<{ entity_id: string; kind: "person" | "enterprise"; names: string[]; birth_dates: string[]; countries: string[]; programme: string | null; reference: string | null; designated_on: string | null; url: string | null }>(
    "select entity_id, kind, names, birth_dates, countries, programme, reference, to_char(designated_on, 'YYYY-MM-DD') as designated_on, url from sanctions_entries where list_id = $1", [list.id]);
  const entries = prepareEntries(rows.map(row => ({ id: row.entity_id, kind: row.kind, names: row.names, birthDates: row.birth_dates, countries: row.countries,
    programme: row.programme, reference: row.reference, designatedOn: row.designated_on, url: row.url })));
  cached = { id: list.id, entries };
  return entries;
}

/** Keep a list: its entries in one go, replacing the list before it. The seed writes its snapshot the same way. */
export async function storeList(generatedOn: string, entries: SanctionsEntry[]) {
  return transaction(async run => {
    const id = randomUUID();
    await run("delete from sanctions_lists");
    await run("insert into sanctions_lists (id, source, generated_on, entries) values ($1, 'eu', $2, $3)", [id, generatedOn, entries.length]);
    for (let start = 0; start < entries.length; start += 1000) await run(SANCTIONS_INSERT, [id, JSON.stringify(entries.slice(start, start + 1000))]);
    cached = null;
    return id;
  });
}

let refreshing: { startedAt: string; error: string | null; done: string | null } | null = null;
export const refreshState = () => refreshing;

/** Fetch the current list from the EU and keep it, in the background. A failed fetch leaves the list as it was. */
export function startRefresh() {
  if (refreshing && !refreshing.done && !refreshing.error) return refreshing;
  refreshing = { startedAt: new Date().toISOString(), error: null, done: null };
  const state = refreshing;
  void (async () => {
    try {
      const response = await fetch(SOURCE, { signal: AbortSignal.timeout(10 * 60_000), cache: "no-store" });
      if (!response.ok) throw new Error(`The EU's server answered ${response.status}.`);
      const expected = Number(response.headers.get("content-length") ?? 0);
      const text = await response.text();
      if (expected && Buffer.byteLength(text, "utf8") + 3 < expected) throw new Error("The download was cut short. Try again.");
      const { generatedOn, entries } = readEuSanctionsCsv(text);
      if (!generatedOn || entries.length < 1000) throw new Error("The file that came back is not a complete list.");
      // The list is the same for everyone and written by Ledgerline itself, not by a person.
      await asService("refreshing the EU sanctions list", () => storeList(generatedOn, entries));
      state.done = generatedOn;
    } catch (error) {
      state.error = error instanceof Error && error.name === "TimeoutError" ? "The EU's server took too long. Try again later." : error instanceof Error ? error.message : "The list could not be fetched.";
    }
  })();
  return state;
}

export type ScreeningRow = {
  id: string; file_id: string; person_id: string | null; name: string; list_date: string; result: "clear" | "possible"; matches: SanctionsMatch[];
  resolution: "not_the_same" | "confirmed" | null; resolved_note: string | null; resolved_by: string | null; resolved_at: string | null; screened_by: string; screened_at: string;
};

/**
 * Screen one name on a client file: a person (with their date of birth), or
 * the company. If the same matches were already looked at for this person
 * and found not to be them, that decision carries over, saying so.
 */
export async function screen(fileId: string, subject: { personId: string | null; name: string; kind: "person" | "enterprise"; dateOfBirth: string | null }, actor: string) {
  const list = await currentList();
  if (!list) throw new Error("No sanctions list is loaded. Update the list first.");
  const matches = screenName(await prepared(list), { name: subject.name, kind: subject.kind, dateOfBirth: subject.dateOfBirth });
  const previous = await one<ScreeningRow>(`select * from sanctions_screenings where file_id = $1 and person_id is not distinct from $2 and resolution = 'not_the_same' and name = $3
    order by screened_at desc limit 1`, [fileId, subject.personId, subject.name]);
  const known = new Set((previous?.matches ?? []).map(match => match.entityId));
  const carried = previous && matches.length && matches.every(match => known.has(match.entityId));
  return one<{ id: string }>(`insert into sanctions_screenings (file_id, person_id, name, list_date, result, matches, resolution, resolved_note, resolved_by, resolved_at, screened_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [fileId, subject.personId, subject.name, list.generated_on, matches.length ? "possible" : "clear", JSON.stringify(matches),
     carried ? "not_the_same" : null, carried ? `The same matches as on ${previous!.list_date.slice(0, 10)}, found then not to be the same: ${previous!.resolved_note}` : null,
     carried ? previous!.resolved_by : null, carried ? new Date().toISOString() : null, actor]);
}
