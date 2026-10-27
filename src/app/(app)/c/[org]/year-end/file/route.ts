import { requireOrg } from "@/lib/org";
import { searchParams } from "@/lib/data/csv";
import { auditFile } from "@/lib/documents/audit-file";

/** One financial year's audit file, as a ZIP: for the auditor, or the reviewer, to start from. */
export async function GET(request: Request) {
  await requireOrg();
  const { period } = searchParams(request);
  const file = await auditFile(typeof period === "string" ? period : "");
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return new Response(new Uint8Array(file.archive), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(`${file.name}.zip`)}`,
      "cache-control": "no-store",
    },
  });
}
