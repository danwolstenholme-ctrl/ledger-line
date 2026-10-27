/**
 * The shape a form action hands back to the component that submitted it.
 * Deliberately unguarded: client components need the type and the idle value.
 */
export type DuplicateMatch = { href: string; name: string; detail: string; reason?: string };

export interface ActionState {
  ok: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
  notice?: string;
  duplicates?: { fingerprint: string; matches: DuplicateMatch[] };
}

export const idleState: ActionState = { ok: false, error: null };

/** What a VIES check hands back to the form that asked for it. */
export type VatCheckResult = {
  number: string; countryName: string; valid: boolean | null; name: string | null; address: string | null; consultation: string | null;
  checkedAt: string; source: "vies" | "demo"; match: "match" | "differs" | "unknown"; error: string | null; requester: string;
  /** Said when VIES checked the number but would not take the asking company's own VAT number, so issued no consultation number. */
  note?: string | null;
};
export interface VatCheckState { ok: boolean; error: string | null; result?: VatCheckResult }
export const idleVatCheck: VatCheckState = { ok: false, error: null };

/** What inviting someone hands back: the link, shown once, to copy or email. */
export interface InviteState extends ActionState { link?: string; email?: string; name?: string; scope?: string }
export const idleInvite: InviteState = { ok: false, error: null };

/** What making a calendar link hands back: the link, shown once. */
export interface FeedState extends ActionState { link?: string }
export const idleFeed: FeedState = { ok: false, error: null };
