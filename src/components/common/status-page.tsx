import type { ReactNode } from "react";

import { PageBody } from "@/components/common/primitives";

/** A page that is not the page asked for: not found, or something went wrong. One calm panel, a plain reason, and the way on. */
export function StatusPage({ icon, eyebrow, title, children, actions }: { icon: ReactNode; eyebrow: string; title: string; children: ReactNode; actions: ReactNode }) {
  return <PageBody width="3xl" className="pt-4 sm:pt-10">
    <section className="ll-panel px-6 py-7 sm:px-8 sm:py-9">
      <span aria-hidden className="bg-brand-50 text-brand grid size-10 place-items-center rounded-full">{icon}</span>
      <p className="ll-eyebrow mt-5">{eyebrow}</p>
      <h1 className="text-ink mt-1 text-[18px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
      <div className="text-ink-muted mt-2 max-w-[62ch] space-y-1.5 text-[13px] leading-relaxed">{children}</div>
      <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>
    </section>
  </PageBody>;
}
