import { fileForToken } from "@/lib/clients/client-link";
import { letterPdfResponse } from "@/lib/documents/letter-pdf";

export const dynamic = "force-dynamic";

/** The client's copy of the signed letter. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await fileForToken(token);
  if (!found || !found.file.signed_at) return new Response("There is no signed letter for this link yet.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return letterPdfResponse(found.file.id, true);
}
