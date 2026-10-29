import type { Metadata } from "next";

import Link from "@/components/navigation/navigation-link";
import { getPractice, requirePracticeMember } from "@/lib/org";
import { resetDemoData } from "@/lib/actions/practice";
import { PageBody } from "@/components/common/primitives";
import { BrandForm } from "@/components/settings/brand-form";
import { RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Practice settings" };

/** Journey 5: white label. The practice's name, initials and colour run through every screen. */
export default async function PracticeSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePracticeMember();
  const practice = await getPractice();
  // Resetting is for rehearsals: it appears only at /settings?demo=1.
  const showReset = (await searchParams).demo === "1";
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Practice settings" />
    <RecordSection title="People" hint="Who at the practice signs in, and inviting someone" action={<Link href="/settings/people" className={recordOutlineButton}>Manage people</Link>}>
      <p className="text-ink-muted px-4 py-3 text-[13px] sm:px-5">Everyone at the practice who signs in sees every client. A partner invites them; each makes their own account from the link.</p>
    </RecordSection>
    <RecordSection title="Your brand"><div className="p-4 sm:p-5"><BrandForm practice={practice} /></div></RecordSection>
    {showReset ? <RecordSection title="Demo data" hint="For rehearsing: back to the state the demo starts in">
      <form action={resetDemoData} className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <button className="border-critical-line text-critical hover:bg-critical-soft h-8 rounded-md border px-3 text-[13px] font-medium">Reset demo data</button>
        <p className="text-ink-muted text-[12.5px]">Rebuilds the six companies from the seed: every posting, match, capture and brand change since is discarded.</p>
      </form>
    </RecordSection> : null}
  </PageBody>;
}
