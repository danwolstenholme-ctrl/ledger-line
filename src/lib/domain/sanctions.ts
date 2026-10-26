/**
 * Screening a name against the EU's consolidated list of persons, groups and
 * entities subject to financial sanctions. Names are compared as words, in
 * any order, ignoring accents and case, with a typing difference forgiven
 * ("Sergei" and "Sergey", "Mohamed" and "Mohammed"); a listed name with a
 * middle name or patronymic still matches one without. A date of birth on
 * both sides says whether a match is the same person or a namesake. Nothing
 * here decides: a possible match goes to a person, who closes it. Client-safe.
 */

export type SanctionsEntry = {
  id: string; kind: "person" | "enterprise"; names: string[]; birthDates: string[]; countries: string[];
  programme: string | null; reference: string | null; designatedOn: string | null; url: string | null;
};

/** The EU's programme codes, as its list names them, in words. */
export const PROGRAMMES: Record<string, string> = {
  UKR: "Russia’s actions against Ukraine", RUSDA: "Russia: destabilising activities", BLR: "Belarus", IRN: "Iran", SYR: "Syria", PRK: "North Korea",
  TAQA: "ISIL (Da’esh) and Al-Qaida", TERR: "Terrorism", AFG: "Afghanistan (Taliban)", MMR: "Myanmar", HR: "Human rights violations", CYB: "Cyber-attacks",
  CHEM: "Chemical weapons", LBY: "Libya", IRQ: "Iraq", COD: "Democratic Republic of the Congo", SOM: "Somalia", CAF: "Central African Republic", SSD: "South Sudan",
  SDN: "Sudan", YEM: "Yemen", MLI: "Mali", VEN: "Venezuela", NIC: "Nicaragua", HTI: "Haiti", GIN: "Guinea", GTM: "Guatemala", MDA: "Moldova", TUN: "Tunisia",
  BIH: "Bosnia and Herzegovina", NER: "Niger", LBN: "Lebanon", TUR: "Türkiye: drilling in the Eastern Mediterranean", ZWE: "Zimbabwe", EUAQ: "ISIL (Da’esh) and Al-Qaida (EU)",
};

// ---------------------------------------------------------------------------
// Reading the EU file: semicolon-separated, one row per name, address, birth date, identity document and citizenship.
// ---------------------------------------------------------------------------

export function parseDelimited(text: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { field += '"'; index++; } else quoted = false; }
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field); field = "";
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** The EU file as one entry per sanctioned person or entity. Names without a Latin letter are left out: names are screened as written on passports. */
export function readEuSanctionsCsv(text: string): { generatedOn: string | null; entries: SanctionsEntry[] } {
  const rows = parseDelimited(text);
  const head = rows[0] ?? [];
  const at = (name: string) => head.indexOf(name);
  const col = {
    generated: at("fileGenerationDate"), id: at("Entity_LogicalId"), reference: at("Entity_EU_ReferenceNumber"), designated: at("Entity_DesignationDate"),
    kind: at("Entity_SubjectType_ClassificationCode"), programme: at("Entity_Regulation_Programme"), url: at("Entity_Regulation_PublicationUrl"),
    name: at("NameAlias_WholeName"), birth: at("BirthDate_BirthDate"), birthYear: at("BirthDate_Year"),
    citizenship: at("Citizenship_CountryIso2Code"), address: at("Address_CountryIso2Code"), birthCountry: at("BirthDate_CountryIso2Code"),
  };
  if (col.id < 0 || col.name < 0 || col.kind < 0) throw new Error("This is not the EU consolidated sanctions list: its columns are not there.");
  const entries = new Map<string, SanctionsEntry & { nameSet: Set<string>; birthSet: Set<string>; countrySet: Set<string> }>();
  let generatedOn: string | null = null;
  for (const row of rows.slice(1)) {
    const id = row[col.id];
    if (!id) continue;
    if (!generatedOn && row[col.generated]) generatedOn = toIsoDate(row[col.generated]);
    let entry = entries.get(id);
    if (!entry) {
      entry = { id, kind: row[col.kind] === "person" ? "person" : "enterprise", names: [], birthDates: [], countries: [], programme: row[col.programme] || null,
        reference: row[col.reference] || null, designatedOn: row[col.designated] || null, url: row[col.url] || null,
        nameSet: new Set(), birthSet: new Set(), countrySet: new Set() };
      entries.set(id, entry);
    }
    const name = row[col.name]?.trim();
    if (name && /[A-Za-z]/.test(name)) entry.nameSet.add(name);
    const birth = row[col.birth]?.trim() || row[col.birthYear]?.trim();
    if (birth && /^\d{4}(-\d{2}-\d{2})?$/.test(birth)) entry.birthSet.add(birth);
    for (const code of [row[col.citizenship], row[col.address], row[col.birthCountry]]) if (code && /^[A-Z]{2}$/.test(code) && code !== "00") entry.countrySet.add(code);
  }
  return {
    generatedOn,
    entries: [...entries.values()].filter(entry => entry.nameSet.size).map(({ nameSet, birthSet, countrySet, ...entry }) => ({
      ...entry, names: [...nameSet], birthDates: [...birthSet].sort(), countries: [...countrySet].sort(),
    })),
  };
}

/** How a batch of entries is written: $1 the list, $2 the entries as JSON. Shared with the seed. */
export const SANCTIONS_INSERT = `insert into sanctions_entries (list_id, entity_id, kind, names, birth_dates, countries, programme, reference, designated_on, url)
  select $1, x.id, x.kind, x.names, x."birthDates", x.countries, x.programme, x.reference, nullif(x."designatedOn", '')::date, x.url
    from jsonb_to_recordset($2::jsonb) as x(id text, kind text, names text[], "birthDates" text[], countries text[], programme text, reference text, "designatedOn" text, url text)`;

const toIsoDate = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const LEGAL_FORMS = new Set(["ltd", "limited", "llc", "llp", "plc", "inc", "corp", "corporation", "co", "company", "the", "of", "and", "sa", "sarl", "sas", "srl", "spa", "gmbh", "ag", "bv", "nv",
  "ooo", "oao", "zao", "pao", "ao", "jsc", "pjsc", "ojsc", "cjsc", "fze", "fzco", "llc", "tov", "pt", "sdn", "bhd", "lda", "as", "ab", "oy", "kft", "doo", "sro", "λτδ"]);

/** A name as words: no accents, no case, no punctuation; for a company, no legal form. */
export function nameWords(name: string, kind: "person" | "enterprise" = "person") {
  const words = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9Ͱ-ϿЀ-ӿ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return kind === "enterprise" ? words.filter(word => !LEGAL_FORMS.has(word)) : words;
}

/** Damerau–Levenshtein distance, stopping early once it passes `limit`. */
function distance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}

/** Two words are the same word if equal, or a slip apart: one character in a word of 4 or more, two in a word of 8 or more. */
function sameWord(a: string, b: string): "exact" | "close" | null {
  if (a === b) return "exact";
  const shorter = Math.min(a.length, b.length);
  const limit = shorter >= 8 ? 2 : shorter >= 4 ? 1 : 0;
  return limit && a[0] === b[0] && distance(a, b, limit) <= limit ? "close" : null;
}

/** Each word of the shorter name matched to a different word of the longer: how many exactly. Null if any is unmatched. */
function wordsMatch(screened: string[], listed: string[]): { exact: number; close: number } | null {
  const [short, long] = screened.length <= listed.length ? [screened, listed] : [listed, screened];
  if (short.length < 2 && !(short.length === 1 && long.length === 1)) return null;
  const used = new Set<number>();
  let exact = 0, close = 0;
  for (const word of short) {
    let found: { index: number; how: "exact" | "close" } | null = null;
    for (let index = 0; index < long.length; index++) {
      if (used.has(index)) continue;
      const how = sameWord(word, long[index]);
      if (how === "exact") { found = { index, how }; break; }
      if (how === "close" && !found) found = { index, how };
    }
    if (!found) return null;
    used.add(found.index);
    if (found.how === "exact") exact++; else close++;
  }
  return { exact, close };
}

export type BirthComparison = "same_date" | "same_year" | "different" | "unknown";
export type SanctionsMatch = {
  entityId: string; kind: "person" | "enterprise"; listedName: string; otherNames: string[]; birthDates: string[]; countries: string[];
  programme: string | null; programmeLabel: string | null; reference: string | null; designatedOn: string | null; url: string | null;
  how: "exact" | "close"; words: string; birth: BirthComparison; score: number;
};

export type PreparedEntry = SanctionsEntry & { words: string[][] };
export const prepareEntries = (entries: SanctionsEntry[]): PreparedEntry[] => entries.map(entry => ({ ...entry, words: entry.names.map(name => nameWords(name, entry.kind)) }));

function compareBirth(dateOfBirth: string | null | undefined, listed: string[]): BirthComparison {
  if (!dateOfBirth || !listed.length) return "unknown";
  if (listed.some(date => date === dateOfBirth)) return "same_date";
  if (listed.some(date => date.slice(0, 4) === dateOfBirth.slice(0, 4))) return "same_year";
  return "different";
}

/**
 * Every listed person or entity whose name matches, best first. A person is
 * compared with listed persons, a company with listed entities. A namesake
 * born in another year is still shown, marked as such: a person decides.
 */
export function screenName(entries: PreparedEntry[], input: { name: string; kind: "person" | "enterprise"; dateOfBirth?: string | null }, limit = 8): SanctionsMatch[] {
  const words = nameWords(input.name, input.kind);
  if (!words.length) return [];
  const matches: SanctionsMatch[] = [];
  for (const entry of entries) {
    if (entry.kind !== input.kind) continue;
    let found: { index: number; exact: number; close: number; size: number } | null = null;
    for (let index = 0; index < entry.words.length; index++) {
      const listed = entry.words[index];
      const match = wordsMatch(words, listed);
      if (!match) continue;
      const size = Math.max(words.length, listed.length);
      if (!found || match.exact * 2 + match.close - size > found.exact * 2 + found.close - found.size) found = { index, ...match, size };
    }
    if (!found) continue;
    const birth = input.kind === "person" ? compareBirth(input.dateOfBirth, entry.birthDates) : "unknown";
    const score = Math.round(100 * (found.exact + found.close * 0.8) / found.size) - (birth === "different" ? 40 : 0) + (birth === "same_date" ? 20 : birth === "same_year" ? 10 : 0);
    matches.push({
      entityId: entry.id, kind: entry.kind, listedName: entry.names[found.index], otherNames: entry.names.filter((_, index) => index !== found.index).slice(0, 6),
      birthDates: entry.birthDates, countries: entry.countries, programme: entry.programme, programmeLabel: entry.programme ? PROGRAMMES[entry.programme] ?? entry.programme : null,
      reference: entry.reference, designatedOn: entry.designatedOn, url: entry.url, how: found.close ? "close" : "exact",
      words: `${found.exact + found.close} of ${found.size} words`, birth, score,
    });
  }
  return matches.sort((a, b) => b.score - a.score || a.listedName.localeCompare(b.listedName)).slice(0, limit);
}
