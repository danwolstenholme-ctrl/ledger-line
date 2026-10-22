"use client";

import { Printer } from "lucide-react";

import { recordOutlineButton } from "@/components/records/record-layout";

/** Print the report, or save it as a PDF from the print dialog. The page's print styles leave out the navigation. */
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={recordOutlineButton}><Printer className="size-3.5" />Print</button>;
}
