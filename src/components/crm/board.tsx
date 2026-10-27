"use client";

import { useOptimistic, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Flag, Globe, XCircle } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { moveDeal, moveJob } from "@/lib/actions/crm";
import type { MoveState } from "@/lib/actions/state";
import type { Board, Stage } from "@/lib/domain/business-types";
import { stageSwatch } from "@/lib/domain/crm";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/components/common/regime";

/**
 * A board of the company's stages, a column each, its cards dragged from one
 * to the next. A deal dropped on Won is set up as a customer (and its first
 * job); on Lost it asks why first. The card moves at once and the server
 * catches up; if it refuses, the card goes back and says why. Opening a card
 * moves it from its own page too, which is the way on a phone or a keyboard.
 */

export type BoardCard = {
  id: string; stageId: string; href: string; title: string; subtitle: string | null; detail: string | null; value: number | null;
  badges: string[]; note: { text: string; tone: "critical" | "due" | "muted" } | null; alert: { text: string; tone: "critical" | "caution" | "new" } | null; priority: string;
};

export function KanbanBoard({ board, columns, closing, cards, hint }: { board: Board; columns: Stage[]; closing: Stage[]; cards: BoardCard[]; hint?: string }) {
  const currency = useCurrency();
  const router = useRouter();
  const [shown, place] = useOptimistic(cards, (state, change: { id: string; stageId: string }) => state.map(card => card.id === change.id ? { ...card, stageId: change.stageId } : card));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ id: string; stage: Stage } | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<MoveState | null>(null);
  const [pending, startTransition] = useTransition();
  const money = (amount: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  const openCount = columns.filter(stage => stage.outcome === "open").length;

  const send = (id: string, stage: Stage, why?: string) => startTransition(async () => {
    place({ id, stageId: stage.id });
    const done = board === "deal" ? await moveDeal(id, stage.id, why) : await moveJob(id, stage.id);
    setResult(done);
    router.refresh();
  });
  const dropOn = (stage: Stage) => (event: DragEvent) => {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain") || dragging;
    setDragging(null);
    const card = shown.find(item => item.id === id);
    if (!card || card.stageId === stage.id) return;
    if (board === "deal" && stage.outcome === "lost") { setAsking({ id: card.id, stage }); setReason(""); return; }
    send(card.id, stage);
  };
  const target = (stage: Stage) => ({
    onDragOver: (event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (over !== stage.id) setOver(stage.id); },
    onDragLeave: () => setOver(current => current === stage.id ? null : current),
    onDrop: dropOn(stage),
  });

  return <div className="space-y-3">
    <p className="sr-only">Drag a card to another stage to move it, or open it to change its stage there.</p>
    {result?.error ? <p role="alert" className="border-critical-line bg-critical-soft text-critical rounded-md border px-3 py-2 text-[13px]">{result.error}</p>
      : result?.notice ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[13px]">
        <CheckCircle2 className="size-4 shrink-0" />{result.notice}{result.href ? <Link href={result.href} className="font-medium underline">{result.hrefLabel ?? "Open it"}</Link> : null}
      </p> : result?.href ? <p role="status" className="border-hairline bg-surface-sunken text-ink rounded-md border px-3 py-2 text-[13px]"><Link href={result.href} className="text-brand font-medium hover:underline">{result.hrefLabel ?? "Open it"}</Link></p> : null}

    {asking ? <form className="ll-panel flex flex-wrap items-center gap-2 px-3 py-2.5" onSubmit={event => { event.preventDefault(); if (!reason.trim()) return; send(asking.id, asking.stage, reason); setAsking(null); }}>
      <label htmlFor="lost-reason" className="text-ink text-[13px] font-medium">Why was {shown.find(card => card.id === asking.id)?.title ?? "it"} {asking.stage.name.toLowerCase()}?</label>
      <input id="lost-reason" autoFocus value={reason} onChange={event => setReason(event.target.value)} maxLength={300} placeholder="Price, timing, went elsewhere…"
        className="border-hairline-strong bg-surface text-ink focus-visible:border-ring focus-visible:ring-ring/40 h-8 min-w-56 flex-1 rounded-md border px-2.5 text-[13px] outline-none focus-visible:ring-[3px]" />
      <button type="submit" disabled={!reason.trim()} className="bg-critical inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-white disabled:opacity-50">Mark as {asking.stage.name.toLowerCase()}</button>
      <button type="button" onClick={() => setAsking(null)} className="text-ink-muted hover:text-ink px-2 text-[13px]">Keep it open</button>
    </form> : null}

    <div className="flex gap-3 overflow-x-auto pb-2" aria-busy={pending || undefined}>
      {columns.map(stage => {
        const list = shown.filter(card => card.stageId === stage.id);
        const value = list.reduce((sum, card) => sum + (card.value ?? 0), 0);
        return <section key={stage.id} aria-label={stage.name} {...target(stage)}
          className={cn("ll-panel flex min-w-[220px] flex-1 basis-0 flex-col overflow-hidden transition-colors", over === stage.id && "border-brand bg-brand-50/40")}>
          <header className="border-hairline bg-surface-sunken border-b px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold"><span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: stageSwatch(stage.outcome, stage.position, openCount) }} /><span className="truncate">{stage.name}</span></span>
              <span className="text-ink-faint text-[12px] tabular-nums">{list.length}</span>
            </div>
            <p className="text-ink-faint mt-0.5 text-[11.5px] tabular-nums">{value ? money(value) : "—"}{board === "deal" && stage.probability !== null && stage.outcome === "open" ? ` · ${stage.probability}% likely` : ""}</p>
          </header>
          <ul className="flex-1 space-y-2 p-2">{list.map(card => <li key={card.id} draggable onDragStart={event => { event.dataTransfer.setData("text/plain", card.id); event.dataTransfer.effectAllowed = "move"; setDragging(card.id); }}
            onDragEnd={() => { setDragging(null); setOver(null); }} className={cn("cursor-grab active:cursor-grabbing", dragging === card.id && "opacity-50")}>
            <Link href={card.href} draggable={false} className="border-hairline bg-surface hover:border-brand-400 block rounded-md border px-2.5 py-2 shadow-xs transition-colors">
              <span className="flex items-start justify-between gap-2"><span className="text-ink text-[13px] leading-snug font-medium">{card.title}</span>{card.priority !== "normal" ? <Flag aria-label={card.priority === "urgent" ? "Urgent" : "High priority"} className={cn("mt-0.5 size-3 shrink-0", card.priority === "urgent" ? "text-critical" : "text-caution")} /> : null}</span>
              {card.subtitle ? <span className="text-ink-muted block truncate text-[12px]">{card.subtitle}</span> : null}
              {card.detail ? <span className="text-ink-faint mt-0.5 block truncate text-[12px]">{card.detail}</span> : null}
              {card.badges.length ? <span className="mt-1.5 flex flex-wrap gap-1">{card.badges.map(badge => <span key={badge} className="border-hairline bg-surface-sunken text-ink-muted max-w-full truncate rounded border px-1.5 py-px text-[11px] leading-[16px]">{badge}</span>)}</span> : null}
              {card.alert ? <span className={cn("mt-1 flex items-center gap-1 text-[12px] font-medium", card.alert.tone === "critical" ? "text-critical" : card.alert.tone === "new" ? "text-brand" : "text-caution")}>{card.alert.tone === "new" ? <Globe className="size-3" /> : <Clock className="size-3" />}{card.alert.text}</span> : null}
              <span className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
                <span className={cn("min-w-0 truncate", card.note?.tone === "critical" ? "text-critical font-medium" : card.note?.tone === "due" ? "text-ink font-medium" : "text-ink-faint")}>{card.note?.text ?? ""}</span>
                {card.value ? <span className="text-ink shrink-0 tabular-nums">{money(card.value)}</span> : null}
              </span>
            </Link>
          </li>)}</ul>
          {!list.length ? <p className="text-ink-faint px-3 pb-3 text-[12px]">{dragging ? "Drop here" : "Nothing here."}</p> : null}
        </section>;
      })}
    </div>

    {/* Where a card closes without a column of its own: won and lost deals, cancelled jobs. Quiet until a card is held over them. */}
    {closing.length ? <div className={cn("grid gap-3", closing.length > 1 ? "sm:grid-cols-2" : "")}>
      {closing.map(stage => <div key={stage.id} {...target(stage)} aria-label={`Drop here: ${stage.name}`}
        className={cn("flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 text-[13px] font-medium transition-all",
          dragging ? "py-5" : "py-2.5", stage.outcome === "won" ? (dragging ? "border-positive-line text-positive" : "border-hairline text-ink-faint") : dragging ? "border-critical-line text-critical" : "border-hairline text-ink-faint",
          over === stage.id && (stage.outcome === "won" ? "bg-positive-soft" : "bg-critical-soft"))}>
        {stage.outcome === "won" ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}{stage.name}
      </div>)}
    </div> : null}
    {!dragging && hint ? <p className="text-ink-faint text-[12px]">{hint}</p> : null}
  </div>;
}
