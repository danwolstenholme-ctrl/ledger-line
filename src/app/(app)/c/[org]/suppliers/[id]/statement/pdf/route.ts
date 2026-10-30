import { statementResponse } from "@/lib/documents/pdf-response";

/** The supplier's statement as a PDF: `?view=activity|open&range=…` (lib/domain/statements); `?download=1` saves it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return statementResponse(request, "supplier", (await params).id, "pdf");
}
