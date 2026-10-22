import { getPaymentRun } from "@/lib/data/purchases";
import { ibanIn } from "@/lib/domain/iban";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { sepaCreditTransfer } from "@/lib/documents/sepa";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** The payment run as a SEPA credit transfer file (pain.001.001.03), to upload to the company's online banking. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return text("That payment run does not exist.", 404);
  const data = await getPaymentRun(id);
  if (!data) return text("That payment run does not exist.", 404);
  const { org, run, payments } = data;
  const iban = ibanIn(run.bank_details);
  if (!iban) return text(`${run.bank_name} has no valid IBAN in its details. Add it to the bank account first.`, 409);
  const bic = /BIC[:\s]*([A-Z0-9]{8,11})/i.exec(run.bank_details ?? "")?.[1] ?? null;
  let xml: string;
  try {
    xml = sepaCreditTransfer({
      messageId: `LL${run.paid_on.replace(/-/g, "")}${run.id.replace(/-/g, "").slice(0, 12)}`, createdAt: new Date().toISOString(), executionDate: run.paid_on,
      debtor: { name: org.name, iban, bic },
      payments: payments.filter(payment => payment.iban).map(payment => ({
        endToEndId: payment.number ?? payment.id.slice(0, 8), amount: Number(payment.amount), name: payment.supplier_name, iban: payment.iban!, bic: payment.bic,
        remittance: `${payment.number ? `Invoice ${payment.number}` : "Payment"}${run.reference ? ` ${run.reference}` : ""}`,
      })),
    });
  } catch (error) { return text(error instanceof Error ? error.message : "The file could not be made.", 409); }
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="SEPA payments ${run.paid_on}.xml"`, "cache-control": "private, no-store" } });
}
