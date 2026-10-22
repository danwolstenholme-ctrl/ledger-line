"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2, ChevronUp, CornerDownLeft, Eye } from "lucide-react";

import { askTheBooks, explainTheBooks } from "@/lib/actions/books-ai";
import { BOOKS_QUESTION_MAX, idleOverview, idleQuestion, type OverviewTone } from "@/lib/domain/accounts-insights";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SubmitButton } from "@/components/common/form-fields";

const TONES: Record<OverviewTone, { label: string; icon: typeof CheckCircle2; className: string }> = {
  good: { label: "Going well", icon: CheckCircle2, className: "text-positive" },
  watch: { label: "Keep an eye on", icon: Eye, className: "text-caution" },
  concern: { label: "Needs attention", icon: AlertTriangle, className: "text-critical" },
};

/**
 * The books' AI, in one row: ask a question, or have Claude explain the
 * figures. Answers open beneath the row and fold away again; nothing is
 * stored. Claude sees totals only — never a client's or supplier's name.
 */
export function AiOverview({ unavailable }: { unavailable: string | null }) {
  const [overviewState, explain, explaining] = useActionState(async () => explainTheBooks(), idleOverview);
  const [answer, ask, asking] = useActionState(askTheBooks, idleQuestion);
  const reason = unavailable ?? (!overviewState.available ? overviewState.error : !answer.available ? answer.error : null);
  // The latest of the two answers is the one shown; folding it keeps it until the next press.
  const [shown, setShown] = useState<"overview" | "answer" | null>(null);
  const [seen, setSeen] = useState({ overviewState, answer });
  if (overviewState !== seen.overviewState || answer !== seen.answer) {
    setSeen({ overviewState, answer });
    setShown(overviewState !== seen.overviewState ? "overview" : "answer");
  }
  const overview = explaining ? null : overviewState.overview;

  return <section aria-label="AI overview" className="ll-panel overflow-hidden">
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="text-ink flex shrink-0 items-center gap-1.5 text-[13px] font-semibold"><Brain aria-hidden className="text-brand size-4" />AI</span>
      <form action={ask} className="flex min-w-0 flex-1 basis-64 items-center gap-2">
        <label htmlFor="books-question" className="sr-only">Ask the books</label>
        <input id="books-question" name="question" maxLength={BOOKS_QUESTION_MAX} required disabled={Boolean(reason) || asking} autoComplete="off"
          placeholder={reason ? "AI is off" : "Ask the books — what did we spend on rent this year against last?"}
          className="border-hairline-strong bg-surface placeholder:text-ink-faint focus-visible:ring-ring/40 h-8 min-w-0 flex-1 rounded-md border px-2.5 text-[13px] outline-none focus-visible:ring-[3px] disabled:opacity-60 touch:h-11 touch:text-[16px]" />
        <SubmitButton variant="outline" size="sm" pendingLabel="Looking…" disabled={Boolean(reason)}><CornerDownLeft className="size-3.5" />Ask</SubmitButton>
      </form>
      <form action={explain}>
        <SubmitButton size="sm" pendingLabel="Reading…" disabled={Boolean(reason)}><Brain className="size-3.5" />{overviewState.overview ? "Explain again" : "Explain the figures"}</SubmitButton>
      </form>
    </div>
    {reason ? <p className="border-hairline text-ink-faint border-t px-3 py-1.5 text-[11.5px]">{reason}</p> : null}

    {explaining || asking ? <div aria-live="polite" className="border-hairline flex items-center gap-3 border-t px-4 py-3">
      <ThinkingBars />
      <p className="ll-ai-sheen text-[12.5px] font-medium">{explaining ? "Claude is reading the books" : "Claude is looking through the books"}</p>
    </div> : null}

    {!explaining && !asking && shown === "overview" && overviewState.error && overviewState.available ? <p role="alert" className="border-hairline text-critical border-t px-4 py-2.5 text-[12.5px]">{overviewState.error}</p> : null}
    {!explaining && !asking && shown === "answer" && answer.error && answer.available ? <p role="alert" className="border-hairline text-critical border-t px-4 py-2.5 text-[12.5px]">{answer.error}</p> : null}

    {!asking && shown === "answer" && answer.answer ? <div aria-live="polite" className="ll-ai-enter border-hairline border-t px-4 py-3">
      <Fold onClose={() => setShown(null)}>{answer.question}</Fold>
      <div className="text-ink mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap">{answer.answer}</div>
      {answer.looked.length ? <p className="text-ink-faint mt-1.5 text-[11.5px]">Looked at: {answer.looked.join(" · ")}</p> : null}
    </div> : null}

    {!explaining && shown === "overview" && overview ? <div aria-live="polite" className="ll-ai-enter border-hairline border-t">
      <div className="px-4 pt-3"><Fold onClose={() => setShown(null)}>{overviewState.at ? `Read at ${formatTime(overviewState.at)} from the figures below. It can be wrong: the statements are the record.` : null}</Fold></div>
      <p className="text-ink px-4 pt-1.5 pb-3 text-[14.5px] leading-snug font-medium">{overview.headline}</p>
      <div className="divide-hairline border-hairline grid border-t lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:divide-x">
        <ul className="divide-hairline divide-y">
          {overview.points.map(point => {
            const tone = TONES[point.tone];
            return <li key={point.title} className="flex gap-3 px-4 py-2.5">
              <tone.icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone.className)} />
              <span className="min-w-0">
                <span className="block text-[13px]"><span className="text-ink font-semibold">{point.title}</span><span className={cn("ml-2 text-[11px] font-semibold tracking-[0.06em] uppercase", tone.className)}>{tone.label}</span></span>
                <span className="text-ink-muted mt-0.5 block text-[12.5px] leading-relaxed">{point.detail}</span>
              </span>
            </li>;
          })}
        </ul>
        <div className="border-hairline space-y-3 border-t px-4 py-3 lg:border-t-0">
          {overview.actions.length ? <div>
            <p className="ll-eyebrow">Next steps</p>
            <ol className="text-ink mt-1.5 list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed">{overview.actions.map(item => <li key={item}>{item}</li>)}</ol>
          </div> : null}
          {overview.questions.length ? <div>
            <p className="ll-eyebrow">To ask the accountant</p>
            <ul className="text-ink mt-1.5 list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed">{overview.questions.map(item => <li key={item}>{item}</li>)}</ul>
          </div> : null}
        </div>
      </div>
    </div> : null}
  </section>;
}

/** The line above an answer: what it answers, and the way to fold it away. */
function Fold({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Escape folds the answer as well, from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="flex items-start gap-3">
    <p className="text-ink-muted min-w-0 flex-1 text-[12px]">{children}</p>
    <button type="button" onClick={onClose} className="text-ink-muted hover:text-ink inline-flex shrink-0 items-center gap-1 text-[12px] touch:min-h-10"><ChevronUp className="size-3.5" />Hide</button>
  </div>;
}

/** Five bars rising and falling in turn, like figures being read: the sign that Claude is working. */
function ThinkingBars({ className }: { className?: string }) {
  return <span aria-hidden className={cn("ll-ai-bars flex h-4 items-end gap-[2px]", className)}>
    {["bg-brand-200", "bg-brand-400", "bg-brand-600", "bg-brand", "bg-brand-deep"].map(swatch => <span key={swatch} className={cn("h-full w-[3px] rounded-[1px]", swatch)} />)}
  </span>;
}
