import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { CaptureInbox } from "@/components/capture/capture-inbox";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Upload receipts") };
}

/** One company's receipts and supplier invoices: uploaded here, they belong here unless a VAT number says otherwise. */
export default async function CompanyCapturePage() {
  return <CaptureInbox company={await requireOrg()} />;
}
