"use server";

import { revalidatePath } from "next/cache";

import { asDbError, asService, one, sql, transaction } from "@/lib/db";
import { describeDbError, type ActionState } from "@/lib/actions/form";
import { TOKEN, newLinkToken, type LinkKind } from "@/lib/data/document-links";
import { firmToday } from "@/lib/domain/invoices";
import { getCurrentUser, requireOrg } from "@/lib/org";

/**
 * Sharing an invoice or a quote with its customer as a link (schema:
 * document_links): made, stopped, and a quote accepted from it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHAREABLE = { invoice: ["issued", "part_paid", "paid"], quote: ["draft", "sent", "accepted"] } as const;

export interface ShareState extends ActionState { token?: string }

/** The document's link for its customer: the one already made, or a new one. Drafts and voided invoices are not shared. */
export async function shareDocument(kind: LinkKind, id: string): Promise<ShareState> {
  const org = await requireOrg();
  if (!UUID.test(id) || (kind !== "invoice" && kind !== "quote")) return { ok: false, error: "That document is no longer available." };
  const column = kind === "invoice" ? "invoice_id" : "quote_id";
  const document = await one<{ status: string }>(`select status from ${kind === "invoice" ? "invoices" : "quotes"} where id = $1 and organisation_id = $2`, [id, org.id]);
  if (!document) return { ok: false, error: "That document is no longer available." };
  if (!(SHAREABLE[kind] as readonly string[]).includes(document.status)) return { ok: false, error: kind === "invoice" ? "Issue the invoice first: a draft or a voided one is not sent." : "A declined quote is not sent." };
  const open = await one<{ token: string }>(`select token from document_links where ${column} = $1 and revoked_at is null`, [id]);
  if (open) return { ok: true, error: null, token: open.token };
  const user = await getCurrentUser();
  try {
    const made = await one<{ token: string }>(`insert into document_links (organisation_id, ${column}, token, created_by) values ($1, $2, $3, $4) returning token`, [org.id, id, newLinkToken(), user.id]);
    revalidatePath("/", "layout");
    return { ok: true, error: null, token: made!.token };
  } catch (error) {
    const failure = asDbError(error);
    // Made a moment ago by someone else: theirs is the link.
    if (failure.code === "23505") {
      const theirs = await one<{ token: string }>(`select token from document_links where ${column} = $1 and revoked_at is null`, [id]);
      if (theirs) return { ok: true, error: null, token: theirs.token };
    }
    return { ok: false, error: describeDbError(failure, "The link could not be made.") };
  }
}

/** The link stops working at once. Sharing again makes a new one. */
export async function stopSharing(form: FormData) {
  const org = await requireOrg();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  await sql("update document_links set revoked_at = now() where id = $1 and organisation_id = $2 and revoked_at is null", [id, org.id]);
  revalidatePath("/", "layout");
}

/** An invoice's link sent by WhatsApp, Viber or a text message: it counts as sent, on the customer's timeline as such. */
export async function markLinkSent(invoiceId: string, by: "WhatsApp" | "Viber" | "a text message"): Promise<void> {
  const org = await requireOrg();
  if (!UUID.test(invoiceId) || !["WhatsApp", "Viber", "a text message"].includes(by)) return;
  const user = await getCurrentUser();
  const invoice = await one<{ customer_id: string; number: string }>(
    "update invoices set sent_at = now(), sent_to = $3 where id = $1 and organisation_id = $2 and status in ('issued', 'part_paid', 'paid') returning customer_id, number", [invoiceId, org.id, `by ${by}`]);
  if (invoice) await sql("insert into crm_activities (organisation_id, customer_id, kind, body, actor) values ($1, $2, 'note', $3, $4)",
    [org.id, invoice.customer_id, `Invoice ${invoice.number} sent by ${by}, as a link.`, user.name]);
  revalidatePath("/", "layout");
}

/**
 * The customer accepts a quote from its link, in their own name. Nothing is
 * posted: whoever shared it gets a to-do to raise the invoice, which they do
 * in Ledgerline as before. Done with Ledgerline's own rights, because the
 * customer is nobody's user; the link is their proof.
 */
export async function acceptSharedQuote(_previous: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get("token") ?? "");
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  // Answered in the language the customer is reading.
  const greek = form.get("lang") === "el";
  const say = (en: string, el: string) => greek ? el : en;
  if (!TOKEN.test(token)) return { ok: false, error: say("This link can’t be used.", "Ο σύνδεσμος δεν ισχύει.") };
  if (name.length < 2) return { ok: false, error: say("Write your name, as the person accepting it.", "Γράψτε το όνομά σας, ως το πρόσωπο που την αποδέχεται."), fieldErrors: { name: say("Your name", "Το όνομά σας") } };
  try {
    const done = await asService("a customer accepting a shared quote", () => transaction(async run => {
      const [link] = await run<{ id: string; organisation_id: string; quote_id: string | null; revoked_at: string | null; accepted_at: string | null; created_by_name: string | null }>(
        `select l.id, l.organisation_id, l.quote_id, l.revoked_at, l.accepted_at, u.name as created_by_name from document_links l left join app_users u on u.id = l.created_by where l.token = $1 for update of l`, [token]);
      if (!link || link.revoked_at || !link.quote_id) return "gone";
      if (link.accepted_at) return "already";
      const [quote] = await run<{ number: string; status: string; customer_id: string; customer: string; manager: string | null }>(
        `select q.number, q.status, q.customer_id, c.name as customer, o.manager from quotes q join customers c on c.id = q.customer_id join organisations o on o.id = q.organisation_id where q.id = $1`, [link.quote_id]);
      if (!quote || quote.status === "declined") return "gone";
      // On the audit trail as the customer who accepted it.
      await run("select set_config('ledgerline.actor', $1, true)", [`${name} (customer)`]);
      await run("update document_links set accepted_at = now(), accepted_name = $2 where id = $1", [link.id, name]);
      await run(`insert into crm_tasks (organisation_id, title, due_on, priority, owner, customer_id) values ($1, $2, $3, 'high', $4, $5)`,
        [link.organisation_id, `Raise the invoice: ${quote.customer} accepted quote ${quote.number} online (${name})`, firmToday(), link.created_by_name ?? quote.manager ?? "Owner", quote.customer_id]);
      return "accepted";
    }));
    if (done === "gone") return { ok: false, error: say("This quote can’t be accepted from this link any more. Ask whoever sent it.", "Η προσφορά δεν μπορεί πια να γίνει αποδεκτή από αυτόν τον σύνδεσμο. Ρωτήστε όποιον σας την έστειλε.") };
    // Nothing to refresh: the company's pages are drawn fresh each time, and the customer keeps their thank-you.
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeDbError(asDbError(error), say("It could not be accepted. Try again.", "Η αποδοχή δεν έγινε. Δοκιμάστε ξανά.")) };
  }
}
