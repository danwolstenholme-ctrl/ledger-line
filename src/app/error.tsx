"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { StatusPage } from "@/components/common/status-page";
import { recordButton, recordOutlineButton } from "@/components/records/record-layout";

/** Something failed while the page was being made. The books are safe: nothing half-saves, because every change runs in one transaction. */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <>
    <title>Something went wrong</title>
    <StatusPage icon={<TriangleAlert className="size-5" />} eyebrow="Something went wrong" title="This page could not be shown"
      actions={<>
        <button type="button" onClick={() => retry()} className={recordButton}><RotateCw className="size-3.5" />Try again</button>
        <Link href="/" className={recordOutlineButton}>Practice dashboard</Link>
      </>}>
      <p>Nothing was lost: a change is either saved in full or not at all. Try again, and if it keeps happening, note the time{error.digest ? ` and reference ${error.digest}` : ""}.</p>
    </StatusPage>
  </>;
}
