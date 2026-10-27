import Link from "@/components/navigation/navigation-link";
import { ArrowRight, Check, Hourglass } from "lucide-react";

import { hideGettingStarted } from "@/lib/actions/home";
import type { GettingStarted } from "@/lib/data/home";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import type { OrganisationRow } from "@/types/database";
import { InlineSubmit } from "@/components/common/form-fields";
import { recordButton } from "@/components/records/record-layout";

/** `waiting`: done for now, on someone else (an owner who has the link): the next step is the one after. */
type Step = { key: string; done: boolean; waiting?: boolean; title: string; hint: string; href: string; start: string };

/**
 * A new company's first steps, in order, each ticked off by what its books
 * show. The next one is the button; the rest wait their turn. The practice
 * sees one more, first: inviting the owner. `customers`: what the company
 * calls them (a clinic's patients).
 */
export async function GettingStartedSteps({ start, org, practice, customers }: {
  start: GettingStarted; org: Pick<OrganisationRow, "id" | "slug" | "contact_name" | "default_bank_account_id">; practice: boolean; customers: string;
}) {
  const { t, formatDate } = await getI18n();
  // "Add your patients", in Greek with the word's own article; a name the company made up, plainly.
  const addThem = `${practice ? "Add the" : "Add your"} ${customers.toLowerCase()}`;
  const steps: Step[] = [
    ...(practice ? [{ key: "owner", done: start.owner, waiting: Boolean(start.invitedAt), title: t("Invite {name} to the books", { name: org.contact_name ?? t("the owner") }),
      hint: start.invitedAt ? t("A link went on {date}: not joined yet", { date: formatDate(start.invitedAt.slice(0, 10)) }) : t("They see this company only, and nothing else of the practice’s"),
      href: `/c/${org.slug}/settings/people`, start: start.invitedAt ? t("Send a new link") : t("Invite them") }] : []),
    { key: "logo", done: start.logo, title: practice ? t("Put the logo on the invoices") : t("Put your logo on your invoices"), hint: t("Uploaded once, it heads every invoice, quote and statement"), href: `/c/${org.slug}/settings`, start: t("Upload the logo") },
    { key: "customers", done: start.customers, title: t.has(addThem) ? t(addThem) : t("Add: {customers}", { customers: t(customers) }), hint: t("From a spreadsheet in one go, or one at a time"), href: `/c/${org.slug}/customers/import`, start: t("Add customers") },
    { key: "invoice", done: start.invoiced, title: practice ? t("Raise the first invoice") : t("Raise your first invoice"), hint: t("Numbered, with its PDF, ready to send"), href: "/invoices/new", start: t("Raise an invoice") },
    { key: "receipt", done: start.receipts, title: t("Upload a receipt or a bill"), hint: t("A photo or a PDF: read and drafted for you"), href: `/c/${org.slug}/capture`, start: t("Upload one") },
    { key: "bank", done: start.bank, title: practice ? t("Bring in the bank statement") : t("Bring in your bank statement"), hint: t("A CSV from the bank: each line matched in the books"),
      href: org.default_bank_account_id ? `/c/${org.slug}/bank/${org.default_bank_account_id}/import` : `/c/${org.slug}/bank`, start: t("Import a statement") },
  ];
  const done = steps.filter(step => step.done).length;
  if (done === steps.length) return null;
  const next = steps.find(step => !step.done && !step.waiting);
  return <section aria-labelledby="getting-started" className="ll-panel overflow-hidden">
    <header className="border-hairline flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
      <h2 id="getting-started" className="text-ink text-[13.5px] font-semibold">{t("Getting started")}</h2>
      <span className="flex items-center gap-2">
        <span aria-hidden className="bg-surface-sunken h-1.5 w-24 overflow-hidden rounded-full"><span className="bg-brand block h-full rounded-full" style={{ width: `${(done / steps.length) * 100}%` }} /></span>
        <span className="text-ink-muted text-[12px] tabular-nums">{t("{done} of {count} done", { done, count: steps.length })}</span>
      </span>
      <form action={hideGettingStarted} className="ml-auto"><input type="hidden" name="organisation_id" value={org.id} /><InlineSubmit title={t("Put these steps away (for you only)")}>{t("Hide")}</InlineSubmit></form>
    </header>
    <ol className="divide-hairline divide-y">{steps.map((step, index) => <li key={step.key} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5", step === next && "bg-brand-50/60")}>
      <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold tabular-nums",
        step.done ? "bg-positive-soft text-positive" : step.waiting ? "bg-caution-soft text-caution" : step === next ? "bg-brand text-white" : "bg-surface-sunken text-ink-muted")}>
        {step.done ? <Check className="size-3.5" /> : step.waiting ? <Hourglass className="size-3.5" /> : index + 1}</span>
      <span className="min-w-0 flex-1 basis-56">
        <span className={cn("block text-[13.5px]", step.done ? "text-ink-muted" : "text-ink font-medium")}>{step.done ? <span className="sr-only">{t("Done:")} </span> : null}{step.title}</span>
        {step.done ? null : <span className="text-ink-muted block text-[12.5px]">{step.hint}</span>}
      </span>
      {step === next ? <Link href={step.href} className={recordButton}>{step.start}<ArrowRight className="size-3.5" /></Link>
        : step.done ? null : <Link href={step.href} className="text-brand text-[12.5px] font-medium hover:underline">{step.start}</Link>}
    </li>)}</ol>
  </section>;
}
