import { remittanceResponse } from "@/lib/documents/pdf-response";

/** The remittance advice for one supplier's payments in a payment run, as a PDF. `?download=1` saves it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; supplierId: string }> }) {
  const { id, supplierId } = await params;
  return remittanceResponse(request, { runId: id, supplierId });
}
