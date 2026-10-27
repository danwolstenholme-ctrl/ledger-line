import type { Metadata } from "next";

import { removeCompanyMember, revokeInvitation } from "@/lib/actions/people";
import { getCompanyPeople } from "@/lib/data/people";
import { formatDate } from "@/lib/format";
import { getCurrentUser, getMembership, getPractice, requireOrg } from "@/lib/org";
import { PageBody } from "@/components/common/primitives";
import { InlineSubmit } from "@/components/common/form-fields";
import { RecordBadge, RecordEmpty, RecordHeader, RecordSection } from "@/components/records/record-layout";
import { InviteForm } from "@/components/people/forms";

export const metadata: Metadata = { title: "People" };

const ROLES = [{ value: "owner", label: "Owner" }, { value: "staff", label: "Team" }, { value: "viewer", label: "Can look" }, { value: "auditor", label: "Auditor: reads the books, changes nothing" }];
const ROLE_LABEL: Record<string, string> = { owner: "Owner", staff: "Team", viewer: "Can look", auditor: "Auditor" };

/** Who at the company uses its books. They see this company only: not the practice’s other clients, nor the practice’s own file on them. */
export default async function CompanyPeoplePage() {
  const [org, user, membership, practice] = await Promise.all([requireOrg(), getCurrentUser(), getMembership(), getPractice()]);
  const { members, invitations } = await getCompanyPeople(org.id);
  const owner = membership.companies.some(company => company.slug === org.slug && company.role === "owner");
  const manage = membership.practice || owner;
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader back={{ href: `/c/${org.slug}/settings`, label: "Company settings" }} title="People"
      description={`Who at ${org.name} uses these books. They see ${org.name} only, and none of ${practice.name}’s other clients.`} />
    <RecordSection title={`At ${org.name}`}>
      {members.length ? <ul className="divide-hairline divide-y">{members.map(member => <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
        <span className="min-w-0"><span className="text-ink font-medium">{member.name}</span><span className="text-ink-faint"> · {ROLE_LABEL[member.role] ?? member.role}</span>
          <span className="text-ink-faint block text-[12px]">{member.email} · since {formatDate(member.created_at.slice(0, 10))}{member.has_sign_in ? "" : " · no account yet"}</span></span>
        {manage && member.user_id !== user.id ? <form action={removeCompanyMember}><input type="hidden" name="organisation_id" value={org.id} /><input type="hidden" name="user_id" value={member.user_id} />
          <InlineSubmit destructive title={`Stop ${member.name} using these books`}>Remove</InlineSubmit></form> : null}
      </li>)}</ul> : <RecordEmpty title="Nobody at the company signs in yet">Invite the owner: they see their own books, invoices and documents, and nothing else.</RecordEmpty>}
    </RecordSection>
    {invitations.length ? <RecordSection title="Invited, not joined yet">
      <ul className="divide-hairline divide-y">{invitations.map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
        <span><span className="text-ink font-medium">{invitation.name}</span><span className="text-ink-faint"> · {ROLE_LABEL[invitation.role] ?? invitation.role} · {invitation.email}</span></span>
        <span className="flex items-center gap-2">{invitation.expired ? <RecordBadge tone="caution">Expired</RecordBadge> : <RecordBadge>Until {formatDate(invitation.expires_at.slice(0, 10))}</RecordBadge>}
          {manage ? <form action={revokeInvitation}><input type="hidden" name="id" value={invitation.id} /><InlineSubmit destructive title="Withdraw the invitation">Withdraw</InlineSubmit></form> : null}</span>
      </li>)}</ul>
    </RecordSection> : null}
    {manage ? <RecordSection title={`Invite someone from ${org.name}`} hint="They make their account from the link">
      <div className="p-4"><InviteForm organisationId={org.id} roles={ROLES} from={`${user.name}\n${membership.practice ? practice.name : org.name}`}
        defaults={membership.practice && !members.some(member => member.role === "owner") && !invitations.some(invitation => invitation.role === "owner" && !invitation.expired)
          ? { name: org.contact_name, email: org.contact_email } : undefined} /></div>
    </RecordSection> : null}
  </PageBody>;
}
