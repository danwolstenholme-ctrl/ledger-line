"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AUTH_MODE, DEMO_COOKIE } from "@/lib/auth/config";
import { DEMO_COOKIE_OPTIONS, demoCookieFor } from "@/lib/auth/demo-cookie";
import { passwordProblem } from "@/lib/auth/password";
import { supabaseAdmin, supabaseServer } from "@/lib/auth/supabase";
import { asDbError, asService, one, sql } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import type { InviteState } from "@/lib/actions/state";
import { findInvitation, grantInvitation, newInvitationToken, tokenHash } from "@/lib/invitations";
import { siteOrigin } from "@/lib/site";
import { getCurrentUser, getMembership, getPractice } from "@/lib/org";

/**
 * The people who use Ledgerline: inviting them, withdrawing an invitation,
 * taking someone's access away, and joining from an invitation's link.
 * Who may do what: a partner invites the practice's people; anyone at the
 * practice, or the company's owner, invites a client company's own.
 */

const PRACTICE_ROLES = ["Partner", "Manager", "Accountant", "Assistant"] as const;
const COMPANY_ROLES = ["owner", "staff", "viewer", "auditor"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function invitePerson(_previous: InviteState, form: FormData): Promise<InviteState> {
  const p = new FormParser(form);
  const organisation = p.uuid("organisation_id");
  const name = p.text("name", { required: true, max: 200, label: "Name" });
  const email = p.email("email", { required: true })?.toLowerCase() ?? null;
  const role = organisation ? p.enum("role", COMPANY_ROLES, { required: true, label: "Role" }) : p.enum("role", PRACTICE_ROLES, { required: true, label: "Role" });
  const mlco = !organisation && p.boolean("mlco");
  if (p.failed || !name || !email || !role) return p.fail();
  const [user, membership, practice] = await Promise.all([getCurrentUser(), getMembership(), getPractice()]);
  let company: { id: string; name: string; practice_id: string } | null = null;
  if (organisation) {
    company = await one("select id, name, practice_id from organisations where id = $1", [organisation]);
    if (!company) return { ok: false, error: "That company isn't one you can invite people to." };
    const owner = membership.companies.some(entry => entry.role === "owner") && (await one("select 1 from company_members where organisation_id = $1 and user_id = $2 and role = 'owner'", [organisation, user.id]));
    if (!membership.practice && !owner) return { ok: false, error: "Only the practice, or the company's owner, can invite people to its books." };
  } else if (membership.role !== "Partner") return { ok: false, error: "Only a partner can invite people to the practice." };
  const already = organisation
    ? await one("select 1 from company_members m join app_users u on u.id = m.user_id where m.organisation_id = $1 and u.email = $2", [organisation, email])
    : await one("select 1 from practice_staff s join app_users u on u.id = s.user_id where s.practice_id = $1 and u.email = $2", [practice.id, email]);
  if (already) return { ok: false, error: `${email} already has access${company ? ` to ${company.name}` : " to the practice"}.`, fieldErrors: { email: "Already has access." } };
  const token = newInvitationToken();
  try {
    await sql(`insert into invitations (practice_id, organisation_id, email, name, role, mlco, token_hash, invited_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [company?.practice_id ?? practice.id, organisation, email, name, role, mlco, tokenHash(token), user.id]);
  } catch (error) {
    const failure = asDbError(error);
    if (failure.code === "23505") return { ok: false, error: `${email} has an invitation waiting. Withdraw it to send a new link.`, fieldErrors: { email: "Already invited." } };
    return { ok: false, error: describeDbError(failure, "The invitation could not be made.") };
  }
  revalidatePath("/", "layout");
  return { ok: true, error: null, link: `${await siteOrigin()}/join/${token}`, email, name, scope: company?.name ?? practice.name };
}

export async function revokeInvitation(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  await sql("update invitations set revoked_at = now() where id = $1 and accepted_at is null and revoked_at is null", [id]);
  revalidatePath("/", "layout");
}

/** Take a client company's member off its books. The practice's own people are managed by a partner, below. */
export async function removeCompanyMember(form: FormData) {
  const organisation = String(form.get("organisation_id") ?? ""), userId = String(form.get("user_id") ?? "");
  if (!UUID.test(organisation) || !UUID.test(userId)) return;
  const user = await getCurrentUser();
  if (user.id === userId) return;
  await sql("delete from company_members where organisation_id = $1 and user_id = $2", [organisation, userId]);
  revalidatePath("/", "layout");
}

/** A partner takes someone's sign-in away from the practice. They stay on the staff list, for their time and their name on records. */
export async function removePracticeAccess(form: FormData) {
  const staffId = String(form.get("staff_id") ?? "");
  if (!UUID.test(staffId)) return;
  const [user, membership] = await Promise.all([getCurrentUser(), getMembership()]);
  if (membership.role !== "Partner") return;
  await sql("update practice_staff set user_id = null where id = $1 and user_id is distinct from $2", [staffId, user.id]);
  revalidatePath("/", "layout");
}

/**
 * Joining from an invitation's link. Someone signed in as the invited address
 * just joins. Anyone else makes their account here (live: a password; in the
 * demo: just their name), which signs them in, and then joins. The link
 * itself is the proof that the address is theirs.
 */
export async function acceptInvitation(_previous: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get("token") ?? "");
  const invitation = await findInvitation(token);
  if (!invitation || invitation.state !== "open") return { ok: false, error: "This invitation can't be used: it has been used, withdrawn, or has expired. Ask for a new one." };
  const current = await one<{ id: string; email: string }>("select id, email from app_users where id = app_user_id()");
  let userId: string;
  if (current && current.email === invitation.email) userId = current.id;
  else {
    const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 200) || invitation.name;
    if (name.length < 2) return { ok: false, error: "Write your name.", fieldErrors: { name: "Your name, as colleagues know it." } };
    if (AUTH_MODE === "supabase") {
      if (invitation.has_account) return { ok: false, error: "You already have a Ledgerline account: sign in with it, then open this link again." };
      const password = String(form.get("password") ?? "");
      const problem = passwordProblem(password);
      if (problem) return { ok: false, error: problem, fieldErrors: { password: problem } };
      if (current) await (await supabaseServer()).auth.signOut();
      // The address is proven by the link that reached it, so the account is made confirmed.
      const made = await supabaseAdmin().auth.admin.createUser({ email: invitation.email, password, email_confirm: true, user_metadata: { name } });
      if (made.error) return { ok: false, error: made.error.message.includes("already") ? "You already have a Ledgerline account: sign in with it, then open this link again." : "The account could not be made. Try again." };
      const signed = await (await supabaseServer()).auth.signInWithPassword({ email: invitation.email, password });
      if (signed.error) return { ok: false, error: "Your account is made, but signing in failed. Sign in from the sign-in page." };
      const person = await asService("finding the account just made", () => one<{ id: string }>("select id from app_users where auth_id = $1", [made.data.user.id]));
      if (!person) return { ok: false, error: "Your account is made, but Ledgerline could not find it. Ask whoever invited you." };
      userId = person.id;
    } else {
      // The demo: the person is made, or found, and signed in as.
      const person = await asService("the demo making an invited person", () => one<{ id: string; auth_id: string }>(`
        insert into app_users (name, email, initials, auth_id) values ($1, $2, $3, gen_random_uuid())
        on conflict (email) do update set auth_id = coalesce(app_users.auth_id, excluded.auth_id) returning id, auth_id`,
        [name, invitation.email, name.split(" ").map(part => part[0]).join("").slice(0, 3).toUpperCase()]));
      if (!person) return { ok: false, error: "The account could not be made." };
      (await cookies()).set(DEMO_COOKIE, demoCookieFor(person.auth_id), DEMO_COOKIE_OPTIONS);
      userId = person.id;
    }
  }
  try { await grantInvitation(invitation, userId); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Joining failed. Try again." }; }
  revalidatePath("/", "layout");
  redirect(invitation.company_slug ? `/c/${invitation.company_slug}?joined=1` : "/?joined=1");
}
