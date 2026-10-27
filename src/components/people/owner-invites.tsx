"use client";

import { startTransition, useActionState, useState } from "react";
import { Check, Copy, FileDown, Mail, UserPlus } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { inviteOwners } from "@/lib/actions/people";
import { idleOwnerInvites, type OwnerInvitesState } from "@/lib/actions/state";
import { firstName, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormError, SubmitButton } from "@/components/common/form-fields";
import { CopyBlock } from "@/components/crm/forms";
import { RecordBadge, recordButton, recordOutlineButton } from "@/components/records/record-layout";

export type OwnerLine = {
  id: string; name: string; he: string | null; contact: string | null; email: string | null; fileId: string | null;
  status: "todo" | "invited" | "expired" | "joined"; detail: string;
};

const STATUS = {
  todo: { label: "Not invited", tone: "neutral" },
  invited: { label: "Invited", tone: "neutral" },
  expired: { label: "Link expired", tone: "caution" },
  joined: { label: "On Ledgerline", tone: "positive" },
} as const;

/** "A, B and C". */
const listed = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
const csvCell = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

/**
 * Inviting client companies' owners, many at once. Ledgerline makes the links;
 * the practice sends them from its own email, one at a time or as a mail merge.
 */
export function OwnerInvites({ rows, practice, from, choose }: { rows: OwnerLine[]; practice: string; from: string; choose: boolean }) {
  const [state, action, pending] = useActionState(inviteOwners, idleOwnerInvites);
  const open = rows.filter(row => row.status !== "joined" && row.email);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(choose ? open.map(row => row.id) : []));
  const every = open.length > 0 && open.every(row => chosen.has(row.id));
  const toggle = (id: string, on: boolean) => setChosen(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  const picked = open.filter(row => chosen.has(row.id)), count = picked.length;
  const renewing = count > 0 && picked.every(row => row.status === "invited" || row.status === "expired");
  return <div className="space-y-4">
    {state.ok && state.sent ? <InvitesMade state={state} practice={practice} from={from} /> : null}
    {/* Sent by hand, not as the form's action: React resets a form after its action, and the boxes would no longer show what is chosen. */}
    <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(() => action(data)); }}>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead><tr className="border-hairline bg-surface-sunken border-b text-left">
          <th scope="col" className="w-10 px-4 py-2"><input type="checkbox" aria-label="Choose every company on this page" checked={every} disabled={!open.length}
            onChange={event => setChosen(current => { const next = new Set(current); for (const row of open) { if (event.target.checked) next.add(row.id); else next.delete(row.id); } return next; })} className="accent-brand size-3.5" /></th>
          {["Company", "Who runs it", "On Ledgerline"].map(label => <th key={label} scope="col" className="text-ink-faint px-4 py-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase">{label}</th>)}
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => {
          const can = row.status !== "joined" && Boolean(row.email);
          return <tr key={row.id} className={cn(chosen.has(row.id) && can ? "bg-brand-50/50" : undefined)}>
            <td className="px-4 py-2.5">{can ? <input type="checkbox" name="organisation_id" value={row.id} checked={chosen.has(row.id)} onChange={event => toggle(row.id, event.target.checked)}
              aria-label={`Invite ${row.contact ?? "the owner"} of ${row.name}`} className="accent-brand size-3.5" /> : null}</td>
            <td className="px-4 py-2.5"><span className="text-ink font-medium">{row.name}</span>{row.he ? <span className="text-ink-faint block text-[12px]">{row.he}</span> : null}</td>
            <td className="px-4 py-2.5"><span className="text-ink">{row.contact ?? "No contact"}</span>
              <span className="text-ink-faint block text-[12px]">{row.email ?? (row.fileId ? <Link href={`/clients/${row.fileId}`} className="text-brand hover:underline">No email: add one to the client file</Link> : "No email")}</span></td>
            <td className="px-4 py-2.5"><RecordBadge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</RecordBadge>{row.detail ? <span className="text-ink-faint block pt-0.5 text-[12px]">{row.detail}</span> : null}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <div className="border-hairline flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3">
        <SubmitButton disabled={!count || pending}><UserPlus className="size-3.5" />{pending ? "Making the links…" : !count ? "Choose who to invite"
          : renewing ? `New links for ${count} compan${count === 1 ? "y" : "ies"}` : `Invite ${count} owner${count === 1 ? "" : "s"}`}</SubmitButton>
        <p className="text-ink-faint min-w-0 flex-1 text-[12px]">Ledgerline makes a link for each person, and you send it from your own email. Someone who runs several of these companies gets one link for them all. A new link replaces one sent before.</p>
      </div>
      <div className="px-4 pb-3"><FormError message={state.error} /></div>
    </form>
  </div>;
}

/** The links just made, shown this once: each to send from your own email, or all of them as a mail merge. */
function InvitesMade({ state, practice, from }: { state: OwnerInvitesState; practice: string; from: string }) {
  const sent = state.sent ?? [], skipped = state.skipped ?? [];
  const until = state.expires ? formatDate(state.expires.slice(0, 10)) : "two weeks from today";
  const subject = `Your books on Ledgerline, from ${practice}`;
  const message = (person: { name: string; email: string; companies: string[]; link: string }) => `Dear ${firstName(person.name)},\n\n${practice} now keeps the books of ${listed(person.companies)} on Ledgerline. You can see where the business stands, raise invoices and quotes, and send us your receipts there, from your phone or your computer.\n\nOpen this link to make your account. It works until ${until}, and only for ${person.email}:\n${person.link}\n\n${from}`;
  const csv = [["First name", "Name", "Email", "Companies", "Link", "Valid until", "Subject", "Message"],
    ...sent.map(person => [firstName(person.name), person.name, person.email, listed(person.companies), person.link, until, subject, message(person)])]
    .map(line => line.map(csvCell).join(",")).join("\r\n");
  const companies = sent.reduce((sum, person) => sum + person.companies.length, 0);
  return <div role="status" className="border-positive-line bg-positive-soft space-y-3 rounded-lg border p-4">
    <div>
      <p className="text-positive text-[13.5px] font-semibold">{sent.length} {sent.length === 1 ? "person" : "people"} invited, for {companies} compan{companies === 1 ? "y" : "ies"}.</p>
      <p className="text-ink-muted text-[13px]">Send each their link from your own email: the links are shown only now, and work until {until}. For many at once, download them for a mail merge in Outlook, Word or Gmail: the file has each person’s message ready.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${csv}`)}`} download="owner invitations.csv" className={recordButton}><FileDown className="size-3.5" />Download for a mail merge</a>
    </div>
    <ul className="border-hairline divide-hairline bg-surface divide-y rounded-md border">{sent.map(person => <li key={person.email} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-[13px]">
      <span className="min-w-0 flex-1"><span className="text-ink font-medium">{person.name}</span><span className="text-ink-faint"> · {person.email}</span>
        <span className="text-ink-muted block truncate text-[12px]">{listed(person.companies)}</span></span>
      <span className="flex items-center gap-2">
        <CopyLink link={person.link} name={person.name} />
        <a href={`mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message(person))}`} className={recordOutlineButton} aria-label={`Email ${person.name} their link`}><Mail className="size-3.5" />Open in email</a>
      </span>
    </li>)}</ul>
    {sent[0] ? <details className="text-[13px]"><summary className="text-brand cursor-pointer font-medium">The message each person gets</summary>
      <div className="pt-2"><CopyBlock label={subject} text={message(sent[0])} /></div></details> : null}
    {skipped.length ? <div className="text-[13px]"><p className="text-ink font-medium">Not invited ({skipped.length})</p>
      <ul className="text-ink-muted list-disc pl-5">{skipped.map(item => <li key={item.company}>{item.company}: {item.why}</li>)}</ul></div> : null}
  </div>;
}

function CopyLink({ link, name }: { link: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { window.prompt("Copy the link", link); } }}
    className={recordOutlineButton} aria-label={`Copy ${name}’s link`}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Copied" : "Copy link"}</button>;
}
