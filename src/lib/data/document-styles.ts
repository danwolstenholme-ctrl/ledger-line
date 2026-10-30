import "server-only";

import { one, sql } from "@/lib/db";
import { DEFAULT_STYLE, readStyle, type DocumentStyle } from "@/lib/documents/style";
import { requireOrg } from "@/lib/org";
import type { DocumentStyleRow } from "@/types/database";

/**
 * What a company's documents look like (lib/documents/style): its styles,
 * the one a customer's documents take, and the logo at their head.
 */

/** The company's logo as a PDF takes it: a data URI, or nothing. */
export async function logoFor(orgId: string) {
  const logo = await one<{ media_type: string; content: Uint8Array }>("select media_type, content from organisation_logos where organisation_id = $1", [orgId]);
  return logo ? `data:${logo.media_type};base64,${Buffer.from(logo.content).toString("base64")}` : null;
}

/** The style a document takes: its customer's own, or the company's default. */
export async function styleFor(orgId: string, customerId?: string | null): Promise<DocumentStyle> {
  const row = await one<{ settings: unknown }>(`
    select s.settings from document_styles s
     where s.organisation_id = $1 and (s.is_default or s.id = (select document_style_id from customers where id = $2 and organisation_id = $1))
     order by s.is_default limit 1`, [orgId, customerId ?? null]);
  return row ? readStyle(row.settings) : DEFAULT_STYLE;
}

/** The company's colour: its default style's, for what it sends that is not a document (its enquiry form, payslips). */
export async function companyAccent(orgId: string) {
  return (await styleFor(orgId)).accent;
}

export async function getDocumentStyles() {
  const org = await requireOrg();
  const rows = await sql<DocumentStyleRow & { customers: number }>(`
    select s.*, (select count(*) from customers c where c.document_style_id = s.id)::int as customers
      from document_styles s where s.organisation_id = $1 order by s.is_default desc, lower(s.name)`, [org.id]);
  return rows.map(row => ({ ...row, style: readStyle(row.settings) }));
}

export async function getDocumentStyle(id: string) {
  const org = await requireOrg();
  const row = await one<DocumentStyleRow>("select * from document_styles where id = $1 and organisation_id = $2", [id, org.id]);
  return row ? { ...row, style: readStyle(row.settings) } : null;
}
