"use client";

import { useActionState, useId, useState } from "react";
import { Mail, UserPlus } from "lucide-react";

import { sendPasswordLink, setNewPassword, signInWithPassword } from "@/lib/actions/auth";
import { acceptInvitation, invitePerson } from "@/lib/actions/people";
import { idleInvite, idleState } from "@/lib/actions/state";
import { firstName } from "@/lib/format";
import { Checkbox, Field, FormError, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import { CopyBlock } from "@/components/crm/forms";
import { recordButton } from "@/components/records/record-layout";

/** Ask someone to join: the practice, or one client company. The link is shown once, to copy or to send from your own email. */
export function InviteForm({ organisationId, roles, mlco = false, from, defaults }: {
  organisationId?: string; roles: { value: string; label: string }[]; mlco?: boolean; from: string;
  /** Who to invite when the page already knows: a company's contact, before its owner has joined. */
  defaults?: { name: string | null; email: string | null };
}) {
  const [state, action] = useActionState(invitePerson, idleInvite);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const body = state.link ? `Dear ${firstName(state.name)},\n\nYou're invited to ${state.scope} on Ledgerline. Open this link to make your account and join (it works for 14 days, and only for ${state.email}):\n\n${state.link}\n\n${from}` : "";
  return <div className="space-y-3">
    <form action={action} className="space-y-3" noValidate>
      {organisationId ? <input type="hidden" name="organisation_id" value={organisationId} /> : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_10rem]">
        <Field label="Name" htmlFor={`${uid}-name`} required error={errors.name}><TextInput id={`${uid}-name`} name="name" maxLength={200} autoComplete="off" defaultValue={defaults?.name ?? undefined} /></Field>
        <Field label="Email" htmlFor={`${uid}-email`} required error={errors.email}><TextInput id={`${uid}-email`} name="email" type="email" autoComplete="off" defaultValue={defaults?.email ?? undefined} /></Field>
        <Field label="Role" htmlFor={`${uid}-role`} error={errors.role}><NativeSelect id={`${uid}-role`} name="role" defaultValue={roles[0]?.value}>{roles.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</NativeSelect></Field>
      </div>
      {mlco ? <Checkbox name="mlco" label="Money laundering compliance officer: approves low and normal risk clients" /> : null}
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Inviting…"><UserPlus className="size-3.5" />Invite</SubmitButton>
    </form>
    {state.ok && state.link ? <div role="status" className="border-positive-line bg-positive-soft space-y-2 rounded-md border p-3">
      <p className="text-positive text-[13px] font-medium">{state.name} is invited. Send them this link: it is shown only now.</p>
      <CopyBlock label={`For ${state.email}, valid for 14 days`} text={state.link} />
      <a href={`mailto:${encodeURIComponent(state.email ?? "")}?subject=${encodeURIComponent(`You're invited to ${state.scope} on Ledgerline`)}&body=${encodeURIComponent(body)}`} className={recordButton}><Mail className="size-3.5" />Open in email</a>
    </div> : null}
  </div>;
}

/** Joining from an invitation: make the account (with a password, live), or join as who you are already signed in as. */
export function JoinForm({ token, name, password, label }: { token: string; name: string | null; password: boolean; label: string }) {
  const [state, action] = useActionState(acceptInvitation, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  // Kept across a failed try: the form resets after each, and only the password should need typing again.
  const [typedName, setTypedName] = useState(name ?? "");
  return <form action={action} className="space-y-3" noValidate>
    <input type="hidden" name="token" value={token} />
    {name !== null ? <Field label="Your name" htmlFor={`${uid}-name`} error={errors.name}><TextInput id={`${uid}-name`} name="name" value={typedName} onChange={event => setTypedName(event.target.value)} maxLength={200} autoComplete="name" /></Field> : null}
    {password ? <Field label="Choose a password" htmlFor={`${uid}-password`} hint="at least 10 characters" error={errors.password}><TextInput id={`${uid}-password`} name="password" type="password" autoComplete="new-password" /></Field> : null}
    <FormError message={state.error} />
    <SubmitButton pendingLabel="Joining…" className="w-full">{label}</SubmitButton>
  </form>;
}

export function PasswordSignInForm({ next, email }: { next: string; email?: string }) {
  const [state, action] = useActionState(signInWithPassword, idleState);
  // Kept across a failed try: the form resets after each, and only the password should need typing again.
  const [typedEmail, setTypedEmail] = useState(email ?? "");
  return <form action={action} className="space-y-3" noValidate>
    <input type="hidden" name="next" value={next} />
    <Field label="Email" htmlFor="sign-in-email"><TextInput id="sign-in-email" name="email" type="email" value={typedEmail} onChange={event => setTypedEmail(event.target.value)} autoComplete="email" /></Field>
    <Field label="Password" htmlFor="sign-in-password"><TextInput id="sign-in-password" name="password" type="password" autoComplete="current-password" /></Field>
    <FormError message={state.error} />
    <SubmitButton pendingLabel="Signing in…" className="w-full">Sign in</SubmitButton>
  </form>;
}

export function PasswordLinkForm() {
  const [state, action] = useActionState(sendPasswordLink, idleState);
  return <form action={action} className="space-y-2" noValidate>
    <Field label="Your email" htmlFor="reset-email"><TextInput id="reset-email" name="email" type="email" autoComplete="email" /></Field>
    <FormError message={state.error} />
    {state.ok ? <p role="status" className="text-positive text-[12.5px]">{state.notice}</p> : null}
    <SubmitButton size="sm" variant="outline" pendingLabel="Sending…">Email me a link</SubmitButton>
  </form>;
}

export function NewPasswordForm() {
  const [state, action] = useActionState(setNewPassword, idleState);
  return <form action={action} className="space-y-3" noValidate>
    <Field label="New password" htmlFor="new-password" hint="at least 10 characters" error={state.fieldErrors?.password}><TextInput id="new-password" name="password" type="password" autoComplete="new-password" /></Field>
    <FormError message={state.error} />
    <SubmitButton pendingLabel="Saving…" className="w-full">Set the password</SubmitButton>
  </form>;
}
