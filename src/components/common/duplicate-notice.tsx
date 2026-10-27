"use client";

import { useFormStatus } from "react-dom";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import Link from "@/components/navigation/navigation-link";
import type { ActionState } from "@/lib/actions/state";
import { cn } from "@/lib/utils";

/**
 * Shown when a create action found records that look like the one being
 * saved. Nothing was written. The person opens the existing record, or saves
 * anyway; that button carries the fingerprint of what was checked, so the same
 * name and address go through and an edited one is checked again.
 */
export function DuplicateNotice({ duplicates, noun = "record" }: { duplicates: ActionState["duplicates"]; noun?: string }) {
  if (!duplicates?.matches.length) return null;
  const one = duplicates.matches.length === 1;
  return <div role="alert" className="border-caution-line bg-caution-soft rounded-md border px-4 py-3.5">
    <p className="text-caution flex items-start gap-2 text-[13.5px] font-medium"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{one ? `This looks like a ${noun} already in the books` : `This looks like ${noun}s already in the books`}</p>
    <ul className="mt-2.5 space-y-1.5 pl-6">{duplicates.matches.map(match => <li key={match.href} className="text-[13.5px]">
      <Link href={match.href} className="text-brand inline-flex items-center gap-1 font-medium touch:min-h-10">{match.name}<ArrowUpRight className="size-3.5" /></Link>
      <span className="text-ink-muted ml-1.5 text-[13px]">{match.detail}{match.reason === "email" ? " · same email address" : ""}</span>
    </li>)}</ul>
    <div className="mt-3 flex flex-wrap items-center gap-3 pl-6">
      <SaveAnyway fingerprint={duplicates.fingerprint} />
      <p className="text-ink-muted text-[13px]">Open the existing {noun} instead of creating another, or save anyway if this is someone different.</p>
    </div>
  </div>;
}

function SaveAnyway({ fingerprint }: { fingerprint: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" name="confirm_duplicates" value={fingerprint} disabled={pending} className={cn("border-hairline-strong bg-surface text-ink hover:bg-muted focus-visible:ring-ring/40 inline-flex min-h-9 items-center rounded-md border px-3.5 text-[13.5px] font-medium outline-none focus-visible:ring-[3px] disabled:opacity-60 touch:min-h-11 touch:px-4 touch:text-[15px]")}>{pending ? "Saving…" : "Save anyway"}</button>;
}
