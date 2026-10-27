import { ublResponse } from "@/lib/documents/pdf-response";

/** The invoice as a UBL e-invoice (EN 16931, Peppol BIS Billing 3.0). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return ublResponse("invoice", (await params).id);
}
