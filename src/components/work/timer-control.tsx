"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Square, Timer } from "lucide-react";

import { startTimer, stopTimer } from "@/lib/actions/work";
import { idleState } from "@/lib/actions/state";
import { MenuPanel } from "@/components/motion/motion";
import { SubmitButton } from "@/components/common/form-fields";

export type TimerCompany = { id: string; name: string; slug: string; practice: boolean };
export type TimerRunning = { company: string; slug: string; work: string; started_at: string };
export const WORK_SUGGESTIONS = ["Bookkeeping", "Bank reconciliation", "VAT return", "VIES statement", "Payroll", "Call with the owner", "Supplier invoices", "Management accounts", "Year-end accounts"];

// The clock ticks once a second while a timer runs; on the server, and before the page wakes, there is no clock.
const subscribe = (tick: () => void) => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); };
const nowSeconds = () => Math.floor(Date.now() / 1000);
const noClock = () => 0;

function Elapsed({ since }: { since: string }) {
  const now = useSyncExternalStore(subscribe, nowSeconds, noClock);
  if (!now) return <span className="tabular-nums">…</span>;
  const total = Math.max(0, now - Math.floor(Date.parse(since) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return <span className="tabular-nums">{h}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</span>;
}

/** The practice's clock, in the top bar of every page: start it on any client, see it run, stop it in one press. */
export function TimerControl({ running, companies, currentSlug }: { running: TimerRunning | null; companies: TimerCompany[]; currentSlug: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(startTimer, idleState);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, [open]);

  if (running) return <form action={stopTimer} className="border-hairline-strong bg-surface flex h-8 min-w-0 items-center gap-2 rounded-full border pr-1 pl-3 text-[12.5px]">
    <span aria-hidden className="bg-critical size-2 shrink-0 animate-pulse rounded-full motion-reduce:animate-none" />
    <span className="text-ink font-medium"><Elapsed since={running.started_at} /></span>
    <span className="text-ink-muted hidden max-w-[200px] truncate lg:inline">{running.company.replace(/ (Ltd|Limited)$/, "")} · {running.work}</span>
    <button type="submit" aria-label={`Stop the timer on ${running.company}`} title="Stop" className="hover:bg-muted text-ink-muted hover:text-critical grid size-6 place-items-center rounded-full"><Square className="size-3 fill-current" /></button>
  </form>;

  const current = companies.find(company => company.slug === currentSlug) ?? companies.find(company => !company.practice);
  return <div ref={ref} className="relative">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="dialog"
      className="border-hairline-strong text-ink-muted hover:bg-muted hover:text-ink flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] active:scale-[0.98]">
      <Timer className="size-3.5" /><span className="hidden sm:inline">Start timer</span>
    </button>
    <MenuPanel open={open} role="dialog" className="bg-surface border-hairline absolute top-full right-0 z-40 mt-2 w-[19rem] rounded-lg border p-3.5 shadow-lg">
      <form action={action} onSubmit={() => setOpen(false)} className="space-y-3">
        <p className="text-ink text-[13px] font-semibold">Start the clock</p>
        <label className="block space-y-1 text-[12px]"><span className="text-ink-muted">For</span>
          <select name="organisation_id" defaultValue={current?.id} required className="border-hairline-strong bg-surface text-ink h-8 w-full rounded-md border px-2 text-[12.5px]">
            {companies.map(company => <option key={company.id} value={company.id}>{company.practice ? `${company.name} (the firm’s own work)` : company.name}</option>)}
          </select></label>
        <label className="block space-y-1 text-[12px]"><span className="text-ink-muted">Working on</span>
          <input name="work" required maxLength={200} list="work-suggestions" autoFocus placeholder="VAT return" className="border-hairline-strong bg-surface text-ink h-8 w-full rounded-md border px-2.5 text-[12.5px]" />
          <datalist id="work-suggestions">{WORK_SUGGESTIONS.map(work => <option key={work} value={work} />)}</datalist></label>
        <SubmitButton size="sm" pendingLabel="Starting…"><Timer className="size-3.5" />Start</SubmitButton>
        {state.error ? <p role="alert" className="text-critical text-[12px]">{state.error}</p> : null}
      </form>
    </MenuPanel>
  </div>;
}
