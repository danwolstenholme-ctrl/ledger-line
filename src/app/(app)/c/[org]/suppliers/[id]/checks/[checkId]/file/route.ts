import { getStatementCheckFile } from "@/lib/data/statement-checks";
import { UUID_PATTERN } from "@/lib/domain/invoices";

/** The supplier's own statement, as it was kept with a check of it. */
export async function GET(_request: Request, { params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = await params;
  const file = UUID_PATTERN.test(checkId) ? await getStatementCheckFile(checkId) : null;
  if (!file) return new Response("No statement was kept with that check.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const name = (file.file_name ?? "Their statement").replace(/[^A-Za-z0-9 ._-]+/g, "-");
  return new Response(new Uint8Array(file.file_content), { headers: { "content-type": file.file_type, "content-disposition": `inline; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
