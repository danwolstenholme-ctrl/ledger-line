import { statementResponse } from "@/lib/documents/pdf-response";

/** The customer's statement as a CSV: `?view=activity|open&range=…` (lib/domain/statements). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return statementResponse(request, "customer", (await params).id, "csv");
}
