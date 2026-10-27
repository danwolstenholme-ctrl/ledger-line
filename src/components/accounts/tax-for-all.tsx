"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recordOutlineButton } from "@/components/records/record-layout";

/** Where Cyprus's VAT returns are filed and paid: the Tax Department's Tax For All, signed in to with CY Login. */
export const TAX_FOR_ALL = "https://taxforall.mof.gov.cy";

/** An amount as a tax form takes it: digits and a decimal point, no thousands separator. */
const asTyped = (amount: number) => amount.toFixed(2);

function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }); };
  return [copied, copy] as const;
}

/** A box's amount to type into Tax For All, a tap away. */
export function CopyBox({ box, amount }: { box: string; amount: number }) {
  const [copied, copy] = useCopied();
  return <button type="button" onClick={() => copy(asTyped(amount))} aria-label={`Copy box ${box}`} title={`Copy ${asTyped(amount)}`}
    className={cn("grid size-7 shrink-0 place-items-center rounded-md print:hidden", copied ? "text-positive" : "text-ink-faint hover:bg-muted hover:text-brand")}>
    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
  </button>;
}

/**
 * Filing it on Tax For All, step by step: there is no way to send a return to
 * the Tax Department but its own portal, so Ledgerline gives each figure as it
 * is to be typed, and records the filing when it is done.
 */
export function TaxForAllSteps({ company, vatNumber, period, boxes, net, due }: {
  company: string; vatNumber: string; period: string; boxes: { box: string; label: string; amount: number }[]; net: number; due: string;
}) {
  const [allCopied, copyAll] = useCopied();
  const [vatCopied, copyVat] = useCopied();
  const sheet = [`VAT return ${period} · ${company} · ${vatNumber}`, ...boxes.map(box => `Box ${box.box}  ${asTyped(box.amount)}  ${box.label}`)].join("\n");
  const steps = [
    <>Sign in to Tax For All with CY Login. <a href={TAX_FOR_ALL} target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-1 font-medium hover:underline">Open Tax For All<ExternalLink className="size-3" /></a></>,
    <>Open the VAT return for {period}, for {company} <span className="inline-flex items-center gap-1 font-mono text-[12.5px]">{vatNumber}
      <button type="button" onClick={() => copyVat(vatNumber)} aria-label="Copy the VAT number" className="text-ink-faint hover:text-brand">{vatCopied ? <Check className="size-3" /> : <Copy className="size-3" />}</button></span>.</>,
    <>Type in each box. The copy button beside each amount gives it as Tax For All takes it (for example {asTyped(boxes.find(box => box.amount)?.amount ?? 0)}).</>,
    <>Submit it, and note the reference Tax For All gives.</>,
    net > 0 ? <>Pay <span className="font-medium">{formatAmount(net)}</span> in Tax For All by <span className="font-medium">{formatDate(due)}</span>.</>
      : net < 0 ? <>Nothing to pay: <span className="font-medium">{formatAmount(-net)}</span> is due back from the Tax Department.</> : <>Nothing to pay.</>,
    <>Mark it as filed here, with the reference: the period locks, so nothing in it can change.</>,
  ];
  return <div className="space-y-3 px-4 py-3.5">
    <ol className="space-y-2">{steps.map((step, index) => <li key={index} className="text-ink flex gap-3 text-[13.5px] leading-relaxed">
      <span aria-hidden className="bg-brand-50 text-brand mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold">{index + 1}</span><span className="min-w-0">{step}</span>
    </li>)}</ol>
    <button type="button" onClick={() => copyAll(sheet)} className={recordOutlineButton}>{allCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{allCopied ? "Copied" : "Copy every box"}</button>
  </div>;
}
