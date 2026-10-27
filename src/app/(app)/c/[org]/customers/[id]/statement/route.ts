import { statementResponse } from "@/lib/documents/pdf-response";

/** The customer's statement of account as a PDF: `?from=…&to=…`, or the last three months. `?download=1` saves it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return statementResponse(request, (await params).id);
}
