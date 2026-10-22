import { revalidatePath } from "next/cache";

import { readCaptureFile } from "@/lib/capture";
import { UUID_PATTERN } from "@/lib/domain/invoices";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Claude reads one file: every invoice in it becomes an item to review. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return Response.json({ ok: false, error: "Unknown file." }, { status: 404 });
  const result = await readCaptureFile(id);
  revalidatePath("/", "layout");
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
