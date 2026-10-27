import { openSharedDocument } from "@/lib/data/document-links";
import { pdfFile } from "@/lib/documents/pdf-response";
import { documentFileName, renderDocumentPdf } from "@/lib/documents/pdf";

export const dynamic = "force-dynamic";

/** A shared document's PDF, for its customer: the same file the company sends. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const shared = await openSharedDocument((await params).token);
  if (!shared) return new Response("This link can’t be used.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return pdfFile(request, await renderDocumentPdf(shared.data), documentFileName(shared.kind, shared.data.document.number));
}
