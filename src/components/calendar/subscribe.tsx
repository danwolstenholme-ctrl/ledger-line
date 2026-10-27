"use client";

import { useActionState } from "react";
import { CalendarPlus } from "lucide-react";

import { makeCalendarFeed, stopCalendarFeed } from "@/lib/actions/calendar";
import { idleFeed } from "@/lib/actions/state";
import { FormError, InlineSubmit, SubmitButton } from "@/components/common/form-fields";
import { CopyBlock } from "@/components/crm/forms";

/**
 * A link to add this calendar to Google, Outlook or Apple Calendar. It is
 * shown once: making a new one stops the old, as does stopping it.
 */
export function SubscribeCalendar({ organisationId, kind, showing, live }: { organisationId: string | null; kind: string | null; showing: string; live: { id: string; made: string; used: string | null; showing: string } | null }) {
  const [state, action] = useActionState(makeCalendarFeed, idleFeed);
  const local = state.link ? /^http:\/\/(localhost|127\.)/.test(state.link) : false;
  return <div className="space-y-3">
    {live && !state.link ? <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
      <p className="text-ink-muted">You have a link showing {live.showing}, made {live.made}{live.used ? `, last read by your calendar ${live.used}` : ", not read by a calendar yet"}. Lost it, or want it to show {showing}? Make a new one: the old one stops.</p>
      <form action={stopCalendarFeed}><input type="hidden" name="id" value={live.id} /><InlineSubmit destructive title="Stop this link: calendars that use it get nothing more">Stop the link</InlineSubmit></form>
    </div> : null}
    <form action={action}>
      {organisationId ? <input type="hidden" name="organisation_id" value={organisationId} /> : null}
      {kind ? <input type="hidden" name="kind" value={kind} /> : null}
      <SubmitButton variant={live || state.link ? "outline" : "primary"} pendingLabel="Making the link…"><CalendarPlus className="size-3.5" />{live || state.link ? "Make a new link" : "Make a subscribe link"}</SubmitButton>
      <span className="text-ink-faint ml-3 text-[12px]">It will show {showing}, as the calendar above does.</span>
    </form>
    <FormError message={state.error} />
    {state.ok && state.link ? <div role="status" className="border-positive-line bg-positive-soft space-y-2 rounded-md border p-3">
      <p className="text-positive text-[12.5px] font-medium">Your calendar link: it is shown only now, so copy it before you leave.</p>
      <CopyBlock label="Subscribe address" text={state.link} />
      <p className="text-ink-muted text-[12px] leading-relaxed">
        <strong className="text-ink font-medium">Google Calendar</strong>: Other calendars, From URL. <strong className="text-ink font-medium">Outlook</strong>: Add calendar, Subscribe from web.{" "}
        <strong className="text-ink font-medium">Apple Calendar</strong>: File, New Calendar Subscription, or <a href={state.link.replace(/^https?:/, "webcal:")} className="text-brand hover:underline">open it in your calendar app</a>.
        Calendars check for changes every few hours.
      </p>
      {local ? <p className="text-caution text-[12px] leading-relaxed">This is the laptop demo: Google and Outlook read the link from their own servers, so they can’t reach it until Ledgerline is online. Apple Calendar on this Mac can.</p> : null}
    </div> : null}
  </div>;
}
