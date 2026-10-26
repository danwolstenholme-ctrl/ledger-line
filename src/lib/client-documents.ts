import "server-only";

import { transaction } from "@/lib/db";

/** What a client may send: a PDF, or a photo of the document. */
const ACCEPTED = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Keep a document a client sent: from the client's link, or uploaded by someone at the practice. */
export async function keepDocument(documentId: string, fileId: string, file: File, from: string): Promise<string | null> {
  const type = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  if (!ACCEPTED.has(type)) return "Send a PDF, or a photo as JPG or PNG.";
  if (file.size > MAX_DOCUMENT_BYTES) return "That file is over 10 MB. A scan or photo at a lower size will do.";
  if (!file.size) return "That file is empty.";
  const bytes = Buffer.from(await file.arrayBuffer());
  const rows = await transaction(async run => {
    // A document from the client's link goes on the audit trail as the client's.
    if (from === "client") await run("select set_config('ledgerline.actor', coalesce((select coalesce(signed_name, contact_name) || ' (client)' from client_files where id = $1), 'client'), true)", [fileId]);
    return run<{ id: string }>(`update client_documents set file_name = $3, media_type = $4, content = $5, size_bytes = $6, received_at = now(), received_from = $7
      where id = $1 and file_id = $2 and received_at is null returning id`, [documentId, fileId, file.name.slice(0, 200), type, bytes, bytes.length, from]);
  });
  return rows.length ? null : "That request is no longer on the file.";
}

