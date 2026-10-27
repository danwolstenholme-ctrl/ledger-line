import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { removePracticeAccess, revokeInvitation } from "@/lib/actions/people";
import { getPracticePeople } from "@/lib/data/people";
import { formatDate } from "@/lib/format";
import { getCurrentUser, getPractice, requirePracticeMember } from "@/lib/org";
import { PageBody } from "@/components/common/primitives";
import { InlineSubmit } from "@/components/common/form-fields";
import { RecordBadge, RecordEmpty, RecordHeader, RecordSection } from "@/components/records/record-layout";
import { InviteForm } from "@/components/people/forms";

export const metadata: Metadata = { title: "People" };

const ROLES = [{ value: "Accountant", label: "Accountant" }, { value: "Manager", label: "Manager" }, { value: "Assistant", label: "Assistant" }, { value: "Partner", label: "Partner" }];

/** The practice's people: who signs in, in what role, and who is invited. A partner invites; everyone sees every client. */
export default async function PracticePeoplePage() {
  const membership = await requirePracticeMember();
  const [practice, user] = await Promise.all([getPractice(), getCurrentUser()]);
  const { staff, invitations } = await getPracticePeople(practice.id);
  const partner = membership.role === "Partner";
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader back={{ href: "/settings", label: "Practice settings" }} title="People"
      description={`Everyone at ${practice.name} who signs in to Ledgerline sees every client the practice keeps. Clients’ own people are invited from each company, and see only their own.`} />

    <RecordSection title={`At ${practice.name}`} hint={`${staff.filter(person => person.has_sign_in).length} sign in`}>
      <ul className="divide-hairline divide-y">{staff.map(person => <li key={person.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
        <span className="min-w-0"><span className="text-ink font-medium">{person.name}</span><span className="text-ink-faint"> · {person.role ?? "No role set"}{person.mlco ? " · compliance officer" : ""}</span>
          <span className="text-ink-faint block text-[12px]">{person.email ?? "Doesn’t sign in"}</span></span>
        <span className="flex items-center gap-2">
          {person.user_id && person.has_sign_in ? <RecordBadge tone="positive">Signs in</RecordBadge> : person.user_id ? <RecordBadge tone="caution">No account yet</RecordBadge> : <RecordBadge>No sign-in</RecordBadge>}
          {partner && person.user_id && person.user_id !== user.id ? <form action={removePracticeAccess}><input type="hidden" name="staff_id" value={person.id} /><InlineSubmit destructive title={`Stop ${person.name} signing in`}>Remove access</InlineSubmit></form> : null}
        </span>
      </li>)}</ul>
    </RecordSection>

    {invitations.length ? <RecordSection title="Invited, not joined yet">
      <ul className="divide-hairline divide-y">{invitations.map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
        <span className="min-w-0"><span className="text-ink font-medium">{invitation.name}</span><span className="text-ink-faint"> · {invitation.role}{invitation.mlco ? " · compliance officer" : ""}</span>
          <span className="text-ink-faint block text-[12px]">{invitation.email} · invited by {invitation.invited_by_name ?? "someone"} on {formatDate(invitation.created_at.slice(0, 10))}</span></span>
        <span className="flex items-center gap-2">{invitation.expired ? <RecordBadge tone="caution">Expired</RecordBadge> : <RecordBadge>Until {formatDate(invitation.expires_at.slice(0, 10))}</RecordBadge>}
          <form action={revokeInvitation}><input type="hidden" name="id" value={invitation.id} /><InlineSubmit destructive title="Withdraw the invitation">Withdraw</InlineSubmit></form></span>
      </li>)}</ul>
    </RecordSection> : null}

    <RecordSection title="Invite someone to the practice" hint={partner ? "They make their account from the link" : "Partners invite people"}>
      <div className="p-4">{partner ? <InviteForm roles={ROLES} mlco from={`${user.name}\n${practice.name}`} /> : <RecordEmpty title="Ask a partner">Only a partner can invite someone to the practice.</RecordEmpty>}</div>
    </RecordSection>
    <p className="text-ink-faint text-[12px]">Clients’ own people: <Link href="/" className="text-brand hover:underline">open a company</Link>, then Company settings → People.</p>
  </PageBody>;
}
