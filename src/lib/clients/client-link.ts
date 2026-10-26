import "server-only";

import { one, sql } from "@/lib/db";
import { FOR_THE_BOOKS, sortDocuments, type DocumentKind, type Letter } from "@/lib/domain/onboarding";

/** A client's private link: the file it opens, if the token is one Ledgerline issued. */
export async function fileForToken(token: string) {
  if (!/^ll_cf_[A-Za-z0-9]{24}$/.test(token)) return null;
  const file = await one<{
    id: string; status: string; company_name: string; contact_name: string | null; letter_text: string | null; letter_hash: string | null; letter_sent_at: string | null;
    signed_at: string | null; signed_name: string | null; signed_position: string | null; signed_ip: string | null; signed_hash: string | null; practice_id: string;
  }>("select id, status, company_name, contact_name, letter_text, letter_hash, letter_sent_at, signed_at, signed_name, signed_position, signed_ip, signed_hash, practice_id from client_files where client_token = $1", [token]);
  if (!file) return null;
  const [practice, documents, people] = await Promise.all([
    one<{ name: string; initials: string; brand_color: string }>("select name, initials, brand_color from practices where id = $1", [file.practice_id]),
    sql<{ id: string; kind: DocumentKind; person_id: string | null; label: string; requested_at: string; received_at: string | null; file_name: string | null }>(
      "select id, kind, person_id, label, requested_at, received_at, file_name from client_documents where file_id = $1", [file.id]),
    sql<{ id: string }>("select id from client_people where file_id = $1 order by created_at", [file.id]),
  ]);
  // What is still to send comes first; what has arrived follows, in the same order.
  const ordered = sortDocuments(documents, people.map(person => person.id)).sort((a, b) => Number(Boolean(a.received_at)) - Number(Boolean(b.received_at)));
  const letter: Letter | null = file.letter_text && file.letter_sent_at ? JSON.parse(file.letter_text) : null;
  return {
    file, letter, practice: { name: practice?.name ?? "Your accountants", initials: practice?.initials ?? "", colour: practice?.brand_color ?? "#0d6e6e" },
    documents: ordered.map(document => ({ ...document, forBooks: FOR_THE_BOOKS.includes(document.kind) })),
  };
}

export const htmlResponse = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
export const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } });
