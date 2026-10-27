import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { AUTH_MODE } from "@/lib/auth/config";
import { one } from "@/lib/db";
import { findInvitation } from "@/lib/invitations";
import { formatDate } from "@/lib/format";
import { JoinForm } from "@/components/people/forms";
import { recordButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Join", robots: { index: false } };
export const dynamic = "force-dynamic";

const ROLE_WORDS: Record<string, string> = { owner: "the owner", staff: "one of the team", viewer: "someone who can look", auditor: "the company’s auditor", Partner: "a partner", Manager: "a manager", Accountant: "an accountant", Assistant: "an assistant" };

/** An invitation's link: who it is from, to what, and joining. */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await findInvitation(token);
  if (!invitation || invitation.state !== "open") {
    const why = !invitation ? "This link isn’t one Ledgerline recognises. Check you have all of it." : invitation.state === "accepted" ? "This invitation has been used. Sign in to carry on."
      : invitation.state === "revoked" ? "This invitation was withdrawn. Ask whoever sent it for a new one." : `This invitation expired on ${formatDate(invitation.expires_at.slice(0, 10))}. Ask for a new one.`;
    return <div className="ll-panel space-y-4 p-6"><h1 className="text-ink text-[18px] font-semibold">This link can’t be used</h1><p className="text-ink-muted text-[13px]">{why}</p>
      <Link href="/sign-in" className={recordButton}>Go to sign in</Link></div>;
  }
  const others = invitation.others;
  const where = invitation.company_name ? `${invitation.company_name}’s books${others.length ? ` and ${others.length} more` : ""}, kept by ${invitation.practice_name}` : invitation.practice_name;
  const current = await one<{ name: string; email: string }>("select name, email from app_users where id = app_user_id()");
  const already = current?.email === invitation.email;
  return <div className="ll-panel space-y-5 p-6">
    <div>
      <p className="text-ink-faint text-[11px] font-semibold tracking-[0.06em] uppercase">Invitation</p>
      <h1 className="text-ink mt-1 text-[18px] font-semibold leading-snug">Join {where}</h1>
      <p className="text-ink-muted mt-1.5 text-[12.5px]">{invitation.invited_by_name ?? "Someone"} invited {invitation.name} ({invitation.email}) as {ROLE_WORDS[invitation.role] ?? invitation.role}
        {invitation.company_name ? `: you will see ${others.length ? "these companies’" : `${invitation.company_name}’s`} books, and nothing else` : ""}. Valid until {formatDate(invitation.expires_at.slice(0, 10))}.</p>
      {others.length ? <ul className="border-hairline divide-hairline mt-3 divide-y rounded-md border text-[12.5px]">
        {[{ id: invitation.id, company_name: invitation.company_name ?? "", role: invitation.role }, ...others].map(item => <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-ink font-medium">{item.company_name}</span><span className="text-ink-faint text-[11.5px]">as {ROLE_WORDS[item.role] ?? item.role}</span>
        </li>)}
      </ul> : null}
    </div>
    {already ? <JoinForm token={token} name={null} password={false} label={`Join as ${current!.name}`} />
      : AUTH_MODE === "supabase" && invitation.has_account ? <div className="space-y-3 text-[12.5px]">
        <p className="text-ink">You already have a Ledgerline account for {invitation.email}.{current ? ` You are signed in as ${current.email}.` : ""} Sign in with it, then open this link again.</p>
        <Link href={`/sign-in?email=${encodeURIComponent(invitation.email)}&next=${encodeURIComponent(`/join/${token}`)}`} className={recordButton}>Sign in as {invitation.email}</Link>
      </div>
      : <div className="space-y-3">
        {current ? <p className="text-ink-muted text-[12.5px]">You are signed in as {current.name}. Joining signs you in as {invitation.name} instead.</p> : null}
        <JoinForm token={token} name={invitation.name} password={AUTH_MODE === "supabase"} label={AUTH_MODE === "supabase" ? "Make my account and join" : `Join as ${invitation.name}`} />
      </div>}
  </div>;
}
