import { one } from "@/lib/db";
import { UUID_PATTERN } from "@/lib/domain/invoices";

export const dynamic = "force-dynamic";

/** The original document, for the review screen's preview. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return new Response("Not found", { status: 404 });
  const file = await one<{ file_name: string; media_type: string; content: Uint8Array }>("select file_name, media_type, content from capture_files where id = $1", [id]);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.content), { headers: { "content-type": file.media_type, "content-disposition": `inline; filename="${encodeURIComponent(file.file_name)}"`, "cache-control": "no-store" } });
}
