import type { Metadata } from "next";

import { CaptureInbox } from "@/components/capture/capture-inbox";

export const metadata: Metadata = { title: "Capture" };

/** The practice's inbox: documents for any client, routed by what is printed on them. */
export default function CapturePage() {
  return <CaptureInbox />;
}
