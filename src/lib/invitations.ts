import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { asService, one, transaction } from "@/lib/db";

/**
 * Invitations: a link that lets one person join the practice, or a client
 * company, in one role. The token is in the link only; the database keeps its
 * fingerprint, so neither a leaked backup nor the practice's own staff can
 * use one that was not sent to them. Looked up and granted with the owner's
 * rights, because the person opening the link is not yet anybody's.
 */

export const newInvitationToken = () => randomBytes(24).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{32}$/;

export type InvitationView = {
  id: string; practice_id: string; organisation_id: string | null; email: string; name: string; role: string; mlco: boolean;
  expires_at: string; accepted_at: string | null; revoked_at: string | null;
  practice_name: string; company_name: string | null; company_slug: string | null; invited_by_name: string | null;
  /** Someone with this email already uses Ledgerline (and has signed in before). */
  has_account: boolean;
  state: "open" | "expired" | "accepted" | "revoked";
};

export async function findInvitation(token: string): Promise<InvitationView | null> {
  if (!TOKEN.test(token)) return null;
  const row = await asService("opening an invitation link", () => one<Omit<InvitationView, "state">>(`
    select i.id, i.practice_id, i.organisation_id, i.email, i.name, i.role, i.mlco, i.expires_at, i.accepted_at, i.revoked_at,
           p.name as practice_name, o.name as company_name, o.slug as company_slug, inviter.name as invited_by_name,
           exists (select 1 from app_users u where u.email = i.email and u.auth_id is not null) as has_account
      from invitations i join practices p on p.id = i.practice_id left join organisations o on o.id = i.organisation_id left join app_users inviter on inviter.id = i.invited_by
     where i.token_hash = $1`, [tokenHash(token)]));
  if (!row) return null;
  const state = row.accepted_at ? "accepted" : row.revoked_at ? "revoked" : Date.parse(row.expires_at) < Date.now() ? "expired" : "open";
  return { ...row, state };
}

/** Make the person a member, as the invitation says, and close it. */
export async function grantInvitation(invitation: InvitationView, userId: string) {
  return asService("accepting an invitation", () =>
    transaction(async run => {
      const open = (await run<{ id: string }>("select id from invitations where id = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update", [invitation.id]))[0];
      if (!open) throw new Error("This invitation has already been used, withdrawn, or has expired.");
      if (invitation.organisation_id) {
        await run(`insert into company_members (organisation_id, user_id, role) values ($1, $2, $3)
          on conflict (organisation_id, user_id) do update set role = excluded.role`, [invitation.organisation_id, userId, invitation.role]);
      } else {
        // Someone already on the staff list without a sign-in (by name) is linked; anyone else is added.
        const linked = await run(`update practice_staff set user_id = $2, role = $3, mlco = $4 where practice_id = $1 and user_id is null and lower(name) = lower($5) returning id`,
          [invitation.practice_id, userId, invitation.role, invitation.mlco, invitation.name]);
        if (!linked.length) await run(`insert into practice_staff (practice_id, name, role, mlco, user_id) values ($1, $2, $3, $4, $5)
          on conflict (practice_id, user_id) do update set role = excluded.role, mlco = excluded.mlco`, [invitation.practice_id, invitation.name, invitation.role, invitation.mlco, userId]);
      }
      // On the trail as the person joining.
      await run("select set_config('ledgerline.actor', (select name from app_users where id = $1), true)", [userId]);
      await run("update invitations set accepted_at = now(), accepted_by = $2 where id = $1", [invitation.id, userId]);
    }));
}
