import { getPayslipDocuments } from "@/lib/data/payroll";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { renderPayslips } from "@/lib/documents/payslip-pdf";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** The month's payslips, a page each: inline to read and print, or `?download=1` to save. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return text("That payroll run does not exist.", 404);
  const data = await getPayslipDocuments(id);
  if (!data) return text("That payroll run does not exist.", 404);
  if (!data.slips.length) return text("Nobody is paid in this run.", 409);
  let bytes: Buffer;
  try { bytes = await renderPayslips(data); }
  catch (error) {
    // The name only: payslips hold people's pay.
    console.error("[payslips] pdf failed", error instanceof Error ? error.name : "unknown");
    return text("The payslips could not be made. Try again.", 500);
  }
  const disposition = new URL(request.url).searchParams.get("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `${disposition}; filename="Payslips ${data.run.period.slice(0, 7)}${data.run.status === "draft" ? " (draft)" : ""}.pdf"`, "cache-control": "private, no-store" } });
}
