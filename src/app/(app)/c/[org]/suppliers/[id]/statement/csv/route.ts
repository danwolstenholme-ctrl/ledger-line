import { statementResponse } from "@/lib/documents/pdf-response";

/** The supplier's statement as a CSV: `?view=activity|open&range=…` (lib/domain/statements). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return statementResponse(request, "supplier", (await params).id, "csv");
}
