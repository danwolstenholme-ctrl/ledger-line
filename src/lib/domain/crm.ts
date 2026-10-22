/** The CRM's vocabulary: pipeline stages, priorities, matter states. Client-safe. */

export const CRM_STAGES = [
  { key: "new", label: "New", short: "New", meaning: "Enquiry received, nobody has reached out yet.", open: true },
  { key: "contact_attempted", label: "Contact attempted", short: "Attempted", meaning: "We have tried to make contact and are waiting on a reply.", open: true },
  { key: "contacted", label: "Contacted", short: "Contacted", meaning: "Two-way contact established, requirement not yet clear.", open: true },
  { key: "qualified", label: "Qualified", short: "Qualified", meaning: "The requirement is clear and worth pursuing.", open: true },
  { key: "proposal", label: "Proposal sent", short: "Proposal", meaning: "A proposal is with the prospect.", open: true },
  { key: "won", label: "Won", short: "Won", meaning: "Agreed: now a client.", open: false },
  { key: "lost", label: "Lost", short: "Lost", meaning: "Not going ahead, with the reason recorded.", open: false },
] as const;
export type CrmStage = (typeof CRM_STAGES)[number]["key"];
export const stageOf = (key: string) => CRM_STAGES.find(stage => stage.key === key) ?? CRM_STAGES[0];
/** How far along the pipeline a stage is, for the chip's swatch: pale to full brand, won green, lost red. */
export function stageSwatch(key: string) {
  const index = CRM_STAGES.findIndex(stage => stage.key === key);
  if (key === "won") return "var(--positive)";
  if (key === "lost") return "var(--critical)";
  return `color-mix(in oklab, var(--brand) ${30 + index * 17}%, white)`;
}
export const MATTER_STATUS: Record<string, string> = { active: "Active", waiting_on_client: "Waiting on client", on_hold: "On hold", completed: "Completed" };
export const PRIORITIES = ["normal", "high", "urgent"] as const;
export type CrmPriority = (typeof PRIORITIES)[number];
