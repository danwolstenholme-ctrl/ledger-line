import "server-only";

import { getDocumentForPdf } from "@/lib/data/sales";
import { getStatement, type StatementData } from "@/lib/data/statements";
import { getRemittance, type RemittanceTarget } from "@/lib/data/remittance";
import { toCsv } from "@/lib/domain/billing";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { STATEMENT_KIND_LABELS, statementPeriod, type StatementParty } from "@/lib/domain/statements";
import { requireOrg } from "@/lib/org";
import { documentFileName, renderDocumentPdf, renderRemittancePdf, renderStatementPdf } from "./pdf";
import { documentUbl } from "./ubl";

const NAMES = { invoice: "invoice", quote: "quote", credit_note: "credit note" } as const;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** A PDF as the browser receives it: inline to read, or `?download=1` to save. */
export function pdfFile(request: Request, bytes: Buffer, fileName: string) {
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
  try { return pdfFile(request, await renderDocumentPdf(data), documentFileName(kind, data.document.number)); }
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

/** A statement of account with a customer or supplier, as a PDF or a CSV, for the period in its address (lib/domain/statements). */
export async function statementResponse(request: Request, party: StatementParty, id: string, format: "pdf" | "csv") {
  const org = await requireOrg();
  if (!UUID_PATTERN.test(id)) return text(`That ${party} does not exist.`, 404);
  const period = statementPeriod(Object.fromEntries(new URL(request.url).searchParams), firmToday(), org.year_end_month);
  let data: StatementData | null;
  try { data = await getStatement(party, id, period); }
  catch (error) { console.error("[statement] read failed", error instanceof Error ? error.message.slice(0, 120) : "unknown"); return text("The statement could not be read. Try again.", 503); }
  if (!data) return text(`That ${party} does not exist.`, 404);
  const name = `${data.account.name} ${data.view === "open" ? "open items " : ""}${data.to}`;
  if (format === "csv") return statementCsv(data, documentFileName("statement", name, "csv"));
  try { return pdfFile(request, await renderStatementPdf(data), documentFileName("statement", name)); }
  catch (error) {
    console.error("[statement] pdf failed", error instanceof Error ? error.name : "unknown");
    return text("The PDF could not be made. Try again.", 500);
  }
}

/** A statement as a spreadsheet: a row a line, the amounts as plain numbers, the opening and closing balances first and last. */
function statementCsv(data: StatementData, fileName: string) {
  const plain = (value: number) => value.toFixed(2);
  const supplier = data.party === "supplier";
  let header: string[], rows: string[][];
  if (data.view === "activity") {
    header = ["Date", "Type", "Reference", "Against", "Due", supplier ? "Billed" : "Charged", "Paid or credited", "Balance"];
    rows = [
      [data.from, "Brought forward", "", "", "", "", "", plain(data.opening)],
      ...data.lines.map(line => [line.date, STATEMENT_KIND_LABELS[line.kind], line.reference, line.against ?? "", line.due_on ?? "", line.charged ? plain(line.charged) : "", line.settled ? plain(line.settled) : "", plain(line.balance)]),
      [data.to, supplier ? "Balance we owe" : "Balance owed", "", "", "", plain(data.charged), plain(data.settled), plain(data.closing)],
    ];
  } else {
    header = ["Date", "Type", "Number", "Due", "Days overdue", "Original", "Outstanding"];
    rows = [
      ...data.open.map(item => [item.issued_on, supplier ? "Bill" : "Invoice", item.number, item.due_on ?? "", String(item.days_overdue), plain(item.total), plain(item.outstanding)]),
      ...(data.unusedCredit > 0 ? [["", "Credit not yet used", "", "", "", "", plain(-data.unusedCredit)]] : []),
      [data.to, supplier ? "Balance we owe" : "Balance owed", "", "", "", "", plain(data.closing)],
    ];
  }
  return new Response(`\ufeff${toCsv(header, rows)}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store" } });
}

/** A remittance advice for a supplier's payments in a run, or for one payment, as a PDF. */
export async function remittanceResponse(request: Request, target: RemittanceTarget) {
  await requireOrg();
  const ids = "runId" in target ? [target.runId, target.supplierId] : [target.paymentId];
  if (!ids.every(id => UUID_PATTERN.test(id))) return text("That payment does not exist.", 404);
  let data: Awaited<ReturnType<typeof getRemittance>>;
  try { data = await getRemittance(target); }
  catch (error) { console.error("[remittance] read failed", error instanceof Error ? error.message.slice(0, 120) : "unknown"); return text("The payment could not be read. Try again.", 503); }
  if (!data) return text("That payment does not exist.", 404);
  try { return pdfFile(request, await renderRemittancePdf(data), documentFileName("remittance", `${data.supplier.name} ${data.paidOn}`)); }
  catch (error) {
    console.error("[remittance] pdf failed", error instanceof Error ? error.name : "unknown");
    return text("The PDF could not be made. Try again.", 500);
  }
}
