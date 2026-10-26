import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A document the client sent, opened in the browser. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; document: string }> }) {
  const { id, document } = await params;
  const uuid = /^[0-9a-f-]{36}$/i;
  const row = uuid.test(id) && uuid.test(document)
    ? await one<{ content: Uint8Array | null; media_type: string | null; file_name: string | null }>("select content, media_type, file_name from client_documents where id = $1 and file_id = $2", [document, id]) : null;
  if (!row?.content) return new Response("That document has not been received.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(new Uint8Array(row.content), { headers: {
    "content-type": row.media_type ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="${(row.file_name ?? "document").replace(/[^A-Za-z0-9 ._-]+/g, "-")}"`,
  } });
}
