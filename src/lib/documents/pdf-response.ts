import "server-only";

import { getDocumentForPdf, getStatement } from "@/lib/data/sales";
import { UUID_PATTERN, firmToday, validRecordDate } from "@/lib/domain/invoices";
import { requireOrg } from "@/lib/org";
import { documentFileName, renderDocumentPdf, renderStatementPdf } from "./pdf";
import { documentUbl } from "./ubl";

const NAMES = { invoice: "invoice", quote: "quote", credit_note: "credit note" } as const;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

function pdf(request: Request, bytes: Buffer, fileName: string) {
  const disposition = new URL(request.url).searchParams.get("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `${disposition}; filename="${fileName}"`, "cache-control": "private, no-store" },
  });
}

/** A document's PDF as the browser receives it: inline to read, or `?download=1` to save. */
export async function pdfResponse(request: Request, kind: keyof typeof NAMES, id: string) {
  await requireOrg();
  const name = NAMES[kind];
  if (!UUID_PATTERN.test(id)) return text(`That ${name} does not exist.`, 404);
  let data: Awaited<ReturnType<typeof getDocumentForPdf>>;
  try { data = await getDocumentForPdf(kind, id); }
  catch (error) { console.error(`[${kind}] read failed`, error instanceof Error ? error.message.slice(0, 120) : "unknown"); return text(`The ${name} could not be read. Try again.`, 503); }
  if (!data) return text(`That ${name} does not exist.`, 404);
  try { return pdf(request, await renderDocumentPdf(data), documentFileName(kind, data.document.number)); }
  catch (error) {
    // The name only: the document holds the customer's name and the figures.
    console.error(`[${kind}] pdf failed`, error instanceof Error ? error.name : "unknown");
    return text("The PDF could not be made. Try again.", 500);
  }
}

/** An invoice or credit note as a UBL e-invoice, to send through Peppol or keep with the records. */
export async function ublResponse(kind: "invoice" | "credit_note", id: string) {
  await requireOrg();
  const name = NAMES[kind];
  if (!UUID_PATTERN.test(id)) return text(`That ${name} does not exist.`, 404);
  const data = await getDocumentForPdf(kind, id).catch(() => undefined);
  if (data === undefined) return text(`The ${name} could not be read. Try again.`, 503);
  if (!data) return text(`That ${name} does not exist.`, 404);
  if (data.document.status === "draft" || data.document.status === "void") return text(`A ${data.document.status} ${name} is not sent as an e-invoice.`, 409);
  const fileName = documentFileName(kind, data.document.number).replace(/\.pdf$/, ".xml");
  return new Response(documentUbl(data), { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store" } });
}

/** A customer's statement for `?from=…&to=…`, three months to today when not given. */
export async function statementResponse(request: Request, customerId: string) {
  await requireOrg();
  if (!UUID_PATTERN.test(customerId)) return text("That customer does not exist.", 404);
  const params = new URL(request.url).searchParams;
  const today = firmToday();
  const to = params.get("to") && validRecordDate(params.get("to")!) ? params.get("to")! : today;
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 3, 1);
  const from = params.get("from") && validRecordDate(params.get("from")!) && params.get("from")! <= to ? params.get("from")! : start.toISOString().slice(0, 10);
  let data: Awaited<ReturnType<typeof getStatement>>;
  try { data = await getStatement(customerId, from, to); }
  catch (error) { console.error("[statement] read failed", error instanceof Error ? error.message.slice(0, 120) : "unknown"); return text("The statement could not be read. Try again.", 503); }
  if (!data) return text("That customer does not exist.", 404);
  try { return pdf(request, await renderStatementPdf(data), documentFileName("statement", `${data.customer.name} ${to}`)); }
  catch (error) {
    console.error("[statement] pdf failed", error instanceof Error ? error.name : "unknown");
    return text("The PDF could not be made. Try again.", 500);
  }
}
