import "server-only";

import { randomBytes } from "node:crypto";

import { asService, one } from "@/lib/db";
import { documentFor } from "@/lib/data/sales";
import type { OrganisationRow } from "@/types/database";

/**
 * Links that let a customer read one invoice or quote without signing in
 * (schema: document_links). The token is the link; Ledgerline looks it up
 * with its own rights, because whoever holds it is nobody's user.
 */

export type DocumentLink = {
  id: string; token: string; created_at: string; views: number; first_viewed_at: string | null; last_viewed_at: string | null;
  accepted_at: string | null; accepted_name: string | null;
};
export type LinkKind = "invoice" | "quote";

export const TOKEN = /^[A-Za-z0-9_-]{32}$/;
export const newLinkToken = () => randomBytes(24).toString("base64url");

const LINK_COLUMNS = "id, token, created_at, views, first_viewed_at, last_viewed_at, accepted_at, accepted_name";

/** The link a document's customer was sent, while it works. */
export async function getDocumentLink(kind: LinkKind, id: string) {
  return one<DocumentLink>(`select ${LINK_COLUMNS} from document_links where ${kind === "invoice" ? "invoice_id" : "quote_id"} = $1 and revoked_at is null`, [id]);
}

/** What a link opens: the document as its PDF prints it, and the link itself. Null for a link stopped or never made. */
export async function openSharedDocument(token: string) {
  if (!TOKEN.test(token)) return null;
  return asService("opening a shared document", async () => {
    const link = await one<DocumentLink & { organisation_id: string; invoice_id: string | null; quote_id: string | null; revoked_at: string | null }>(
      `select ${LINK_COLUMNS}, organisation_id, invoice_id, quote_id, revoked_at from document_links where token = $1`, [token]);
    if (!link || link.revoked_at) return null;
    const org = await one<OrganisationRow>("select * from organisations where id = $1", [link.organisation_id]);
    if (!org) return null;
    const kind: LinkKind = link.invoice_id ? "invoice" : "quote";
    const data = await documentFor(org, kind, (link.invoice_id ?? link.quote_id)!);
    return data ? { link, kind, data } : null;
  });
}

/** Opened by its customer: when first and last, and how often. */
export async function countView(linkId: string) {
  await asService("counting a shared document's opening", () =>
    one("update document_links set views = views + 1, first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now() where id = $1 returning id", [linkId]));
}
