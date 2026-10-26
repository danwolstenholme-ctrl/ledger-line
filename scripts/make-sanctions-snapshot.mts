/**
 * The EU consolidated sanctions list, as a snapshot the demo seeds from, so
 * screening works with no network. The product fetches the live list itself
 * (Client files → Update the list); this keeps the seed current.
 *
 *   npx tsx scripts/make-sanctions-snapshot.mts [path/to/list.csv]
 *
 * With no path it downloads the list from the EU's Financial Sanctions Files.
 */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { readEuSanctionsCsv } from "../src/lib/domain/sanctions";

const SOURCE = "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";
const OUT = path.join(import.meta.dirname, "..", "src", "lib", "db", "seed-files", "eu-sanctions.json.gz");

const file = process.argv[2];
const text = file ? fs.readFileSync(file, "utf8") : await (await fetch(SOURCE, { signal: AbortSignal.timeout(600_000) })).text();
const { generatedOn, entries } = readEuSanctionsCsv(text);
if (!generatedOn || entries.length < 1000) throw new Error(`The list looks incomplete: ${entries.length} entries, generated ${generatedOn}.`);
const json = JSON.stringify({ source: "eu", generatedOn, entries });
fs.writeFileSync(OUT, gzipSync(json, { level: 9 }));
console.log(`${entries.length} entries, list of ${generatedOn}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB at ${path.relative(process.cwd(), OUT)}`);
