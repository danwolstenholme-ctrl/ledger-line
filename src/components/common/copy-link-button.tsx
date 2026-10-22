"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

export function CopyLinkButton({ path, label = "Copy link", iconOnly = false }: { path?: string; label?: string; iconOnly?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      const url = new URL(path ?? window.location.href, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error("Only workspace links can be copied");
      await navigator.clipboard.writeText(url.href);
      setState("copied");
    } catch { setState("failed"); }
  }
  return <span className="inline-flex flex-wrap items-center gap-2">
    <button type="button" onClick={copy} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}
      className={iconOnly ? "border-hairline-strong text-ink-muted hover:bg-muted hover:text-ink focus-visible:ring-ring/40 inline-grid size-8 place-items-center rounded-md border outline-none focus-visible:ring-[3px] touch:size-11"
        : "border-hairline-strong text-ink-muted hover:bg-muted focus-visible:ring-ring/40 inline-flex min-h-8 items-center touch:min-h-11 touch:px-3.5 touch:text-[14px] gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] outline-none focus-visible:ring-[3px]"}>
      {state === "copied" ? <Check aria-hidden className="size-3.5" /> : <Link2 aria-hidden className="size-3.5" />}{iconOnly ? null : label}
    </button>
    {state === "copied" ? <span role="status" className="text-positive text-[11.5px]">Link copied</span> : null}
    {state === "failed" ? <span role="alert" className="text-critical max-w-64 text-[11.5px]">Couldn’t copy. Copy the address from your browser instead.</span> : null}
  </span>;
}
