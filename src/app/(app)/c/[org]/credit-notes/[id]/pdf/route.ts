import { pdfResponse } from "@/lib/documents/pdf-response";

/** The credit note as a PDF, to open, print or send. `?download=1` saves it instead. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return pdfResponse(request, "credit_note", (await params).id);
}
