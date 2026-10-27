import type { CompanyEntry } from "@/components/shell/companies";

/**
 * Finding a company, a page or a record by what someone types: shared by the
 * company switcher and the command palette, so both find the same things.
 */

/** Where the same section is in another company: an invoice's page becomes the invoice list, and so on. */
export function sameSection(pathname: string, slug: string) {
  const rest = pathname.replace(/^\/c\/[a-z0-9-]+/, "").split("/").filter(Boolean);
  const keep = rest[0] === "crm" || rest[0] === "reports" ? rest.slice(0, 2) : rest.slice(0, 1);
  const section = keep.filter(part => part !== "new" && !/^[0-9a-f-]{36}$/.test(part));
  return `/c/${slug}${section.length ? `/${section.join("/")}` : ""}`;
}

const RECENT_KEY = "ledgerline.recent-companies";
/** The companies this browser opened last, most recent first. Kept in the browser only: a convenience, never a record. */
export function readRecent(): string[] {
  try { const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(stored) ? stored.filter((slug): slug is string => typeof slug === "string").slice(0, 6) : []; }
  catch { return []; }
}
export function rememberCompany(slug: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([slug, ...readRecent().filter(other => other !== slug)].slice(0, 6))); } catch { /* private window: no list */ }
}

/** Search without case or accents, and numbers without their spaces: "he412907" finds HE 412907, "αιγαιο" finds ΑΙΓΑΙΟ. */
export const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const compact = (text: string) => plain(text).replace(/[^a-z0-9α-ω]/g, "");
/** How a company matches what was typed: by its name (""), by another name or number it goes by (that text), or not at all (null). */
export function matchOf(entry: CompanyEntry, query: string): string | null {
  if (plain(entry.name).includes(query)) return "";
  const short = compact(query);
  for (const alias of [entry.greek, entry.he, entry.vat]) if (alias && (plain(alias).includes(query) || (short.length > 2 && compact(alias).includes(short)))) return alias;
  return null;
}
/** Whether every word typed is somewhere in the text: "new inv" finds "New invoice". */
export const hasWords = (text: string, query: string) => query.split(/\s+/).filter(Boolean).every(word => plain(text).includes(word));
