/** The CRM's vocabulary that every company shares: priorities, and how a stage is coloured. Client-safe. */

import type { Outcome } from "@/lib/domain/business-types";

export const PRIORITIES = ["normal", "high", "urgent"] as const;
export type CrmPriority = (typeof PRIORITIES)[number];

/** How far along its board a stage is, for its swatch: pale to full brand, won or done green, lost or cancelled red. */
export function stageSwatch(outcome: Outcome, position: number, openCount: number) {
  if (outcome === "won") return "var(--positive)";
  if (outcome === "lost") return "var(--critical)";
  return `color-mix(in oklab, var(--brand) ${Math.round(30 + (openCount > 1 ? (position - 1) / (openCount - 1) : 1) * 70)}%, white)`;
}

/** Days without a word on an open deal before its card says it has gone quiet. */
export const QUIET_DAYS = 14;
