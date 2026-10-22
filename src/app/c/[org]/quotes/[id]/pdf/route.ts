import { pdfResponse } from "@/lib/documents/pdf-response";

/** The quote as a PDF, to open, print or send. `?download=1` saves it instead. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return pdfResponse(request, "quote", (await params).id);
}
