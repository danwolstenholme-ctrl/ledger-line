import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { CaptureInbox } from "@/components/capture/capture-inbox";

export const metadata: Metadata = { title: "Upload receipts" };

/** One company's receipts and supplier invoices: uploaded here, they belong here unless a VAT number says otherwise. */
export default async function CompanyCapturePage() {
  return <CaptureInbox company={await requireOrg()} />;
}
