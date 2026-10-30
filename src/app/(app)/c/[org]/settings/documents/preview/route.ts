import { pdfFile } from "@/lib/documents/pdf-response";
import { previewPdf } from "@/lib/documents/preview";
import { DEFAULT_STYLE, STYLED_DOCUMENTS, decodeStyle, type StyledDocument } from "@/lib/documents/style";
import { requireOrg } from "@/lib/org";

/** A document drawn in a style the editor has not saved yet: `?kind=invoice&style=…` (lib/documents/style's encodeStyle). */
export async function GET(request: Request) {
  const org = await requireOrg();
  const params = new URL(request.url).searchParams;
  const kind = (STYLED_DOCUMENTS.some(document => document.key === params.get("kind")) ? params.get("kind") : "invoice") as StyledDocument;
  try { return pdfFile(request, await previewPdf(org, kind, decodeStyle(params.get("style")) ?? DEFAULT_STYLE), "Preview.pdf"); }
  catch (error) {
    console.error("[style preview] pdf failed", error instanceof Error ? error.name : "unknown");
    return new Response("The preview could not be drawn. Try again.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
}
