import { remittanceResponse } from "@/lib/documents/pdf-response";

/** The remittance advice for one payment against a bill, as a PDF. `?download=1` saves it. */
export async function GET(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  return remittanceResponse(request, { paymentId: (await params).paymentId });
}
