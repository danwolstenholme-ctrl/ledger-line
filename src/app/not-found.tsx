import { Compass } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { currentOrg } from "@/lib/org";
import { StatusPage } from "@/components/common/status-page";
import { recordButton, recordOutlineButton } from "@/components/records/record-layout";

/** Any address with nothing behind it, and any record that is not there: inside the company it was asked for, when there is one. */
export default async function NotFound() {
  const org = await currentOrg();
  return <>
    <title>Not found</title>
    <StatusPage icon={<Compass className="size-5" />} eyebrow="Page not found" title="There is nothing at this address"
      actions={<>
        {org ? <Link href={`/c/${org.slug}`} className={recordButton}>Back to {org.name}</Link> : null}
        <Link href="/" className={org ? recordOutlineButton : recordButton}>Practice dashboard</Link>
      </>}>
      <p>The record may have been removed, or the link may be mistyped. Nothing in the books has changed.</p>
    </StatusPage>
  </>;
}
