import { getClientFile } from "@/lib/data/clients";
import { letterPdfResponse } from "@/lib/documents/letter-pdf";

export const dynamic = "force-dynamic";

/** The engagement letter: as sent and signed, or, before it is sent, as it would be. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const data = await getClientFile((await params).id);
  if (!data) return new Response("That client file does not exist.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return letterPdfResponse(data.file.id, true, data.letter.sent ? undefined : data.letter.draft);
}
