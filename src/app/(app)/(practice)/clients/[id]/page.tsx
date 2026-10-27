import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Check, ExternalLink, FileText, ShieldAlert } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { removePerson } from "@/lib/actions/clients";
import { getClientFile } from "@/lib/data/clients";
import { personCountry } from "@/lib/domain/countries";
import { FOR_THE_BOOKS, PEP, RISK_AREA_KEYS, RISK_AREAS, RISK_LEVELS, ROLES, SERVICES, inSentence, needsIdentity, type Person } from "@/lib/domain/onboarding";
import type { BirthComparison, SanctionsMatch } from "@/lib/domain/sanctions";
import { firstName, formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { InlineSubmit } from "@/components/common/form-fields";
import { RecordBadge, RecordDisclosure, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import {
  ApproveAssessment, ClientDetailsForm, ClientLink, DeclineForm, DocumentUpload, OpenBooksButton, PersonForm, RequestDocumentForm, ResolveMatch, RiskForm, ScreenFileButton, SendLetter,
} from "@/components/clients/forms";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await getClientFile((await params).id);
  return { title: data ? data.file.company_name : "Client file" };
}

const BIRTH: Record<BirthComparison, { label: string; tone: "critical" | "caution" | "positive" | "neutral" }> = {
  same_date: { label: "Same date of birth", tone: "critical" }, same_year: { label: "Same year of birth", tone: "caution" },
  different: { label: "Born on another date", tone: "positive" }, unknown: { label: "No date of birth to compare", tone: "neutral" },
};
const LEVEL_TONE = { low: "positive", normal: "neutral", high: "critical" } as const;
const sizeOf = (bytes: number | null) => bytes === null ? "" : bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Match({ match }: { match: SanctionsMatch }) {
  const birth = BIRTH[match.birth];
  return <div className="border-hairline bg-surface rounded-md border px-3 py-2 text-[12px]">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-ink text-[12.5px] font-semibold">{match.listedName}</p>
      <div className="flex flex-wrap gap-1.5">{match.kind === "person" ? <RecordBadge tone={birth.tone}>{birth.label}</RecordBadge> : null}<RecordBadge>{match.how === "exact" ? "Same words" : "Close spelling"} · {match.words}</RecordBadge></div>
    </div>
    <dl className="text-ink-muted mt-1 grid gap-x-3 gap-y-0.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
      {match.programmeLabel ? <><dt>Sanctions</dt><dd className="text-ink">{match.programmeLabel}{match.reference ? <span className="text-ink-faint font-mono"> · {match.reference}</span> : null}</dd></> : null}
      {match.birthDates.length ? <><dt>Born</dt><dd className="text-ink tabular-nums">{match.birthDates.map(date => date.length === 4 ? date : formatDate(date)).join(", ")}</dd></> : null}
      {match.countries.length ? <><dt>Countries</dt><dd className="text-ink">{match.countries.map(personCountry).join(", ")}</dd></> : null}
      {match.otherNames.length ? <><dt>Also listed as</dt><dd>{match.otherNames.slice(0, 4).join(" · ")}</dd></> : null}
      {match.designatedOn ? <><dt>Listed</dt><dd>{formatDate(match.designatedOn)}{match.url ? <> · <a href={match.url} target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-0.5 hover:underline">the regulation<ExternalLink className="size-3" /></a></> : null}</dd></> : null}
    </dl>
  </div>;
}

/** A client file: everything needed to take a client on, or to keep them on. */
export default async function ClientFilePage({ params }: { params: Promise<{ id: string }> }) {
  const data = await getClientFile((await params).id);
  if (!data) notFound();
  const { file, people, documents, current, approved, steps, letter } = data;
  const host = (await headers()).get("host") ?? "localhost:3000";
  const link = file.client_token ? `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}/o/${file.client_token}` : null;
  const greet = firstName(file.contact_name);
  const practiceName = letter.draft.from.name;
  const emailBody = link ? `Dear ${greet || "Sir or Madam"},\n\nThank you for choosing ${practiceName}. Your engagement letter is ready to read and sign, and on the same page you can send us the documents we need to set ${file.company_name} up:\n\n${link}\n\nNo account or password is needed. Please keep the link to yourself.\n\nKind regards,\n${data.user.name}\n${practiceName}` : "";
  const nextStep = steps.find(step => !step.done);
  const closed = file.status === "declined";
  const required = documents.filter(document => !FOR_THE_BOOKS.includes(document.kind));
  const received = required.filter(document => document.received_at).length;
  const subjects = [{ id: null as string | null, name: file.company_name, kind: "Company" }, ...people.map(person => ({ id: person.id as string | null, name: person.name, kind: person.roles.map(role => ROLES[role]).join(", ") }))];
  const approver = current && !current.approved_at ? data.approverForMe(current.level) : null;
  const outstanding = documents.filter(document => !document.received_at);
  const reminderBody = link ? `Dear ${greet || "Sir or Madam"},\n\nThank you for signing the engagement letter. To finish setting ${file.company_name} up, we still need:\n\n${outstanding.map(document => `• ${document.label}`).join("\n")}\n\nYou can upload them on the same page as before, no account needed:\n\n${link}\n\nKind regards,\n${data.user.name}\n${practiceName}` : "";
  const totalShares = people.reduce((sum, person) => sum + (person.ownership ?? 0), 0);

  return <PageBody width="full" className="space-y-4">
    <RecordHeader back={{ href: "/clients", label: "Client files" }}
      eyebrow={<RecordBadge tone={closed ? "critical" : file.status === "active" ? "positive" : "caution"}>{closed ? "Declined" : file.status === "active" ? "Client" : "Taking on"}</RecordBadge>}
      title={file.company_name}
      description={[file.he_number, file.business, file.enquiry_reference ? `from enquiry ${file.enquiry_reference}` : null].filter(Boolean).join(" · ") || "A new client file"}
      action={file.slug ? <Link href={`/c/${file.slug}`} className={recordOutlineButton}>Open the books<ExternalLink className="size-3.5" /></Link> : undefined} />

    {closed ? <p role="status" className="border-critical-line bg-critical-soft text-critical rounded-lg border px-4 py-2.5 text-[12.5px]">Declined: {file.declined_reason}</p> : null}
    {file.imported_at ? <p role="note" className="border-hairline bg-surface-sunken text-ink-muted rounded-lg border px-4 py-2.5 text-[12.5px] leading-relaxed">
      Brought over with the practice’s client list on {formatDate(file.imported_at)}. Its engagement letter and due diligence were kept outside Ledgerline: record them here as each comes up for review, and the steps below fill in.
    </p> : null}
    {data.blocked ? <p role="alert" className="border-critical-line bg-critical-soft text-critical flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]"><ShieldAlert className="size-4" />{data.blocked}</p> : null}

    <nav aria-label="Steps" className="ll-panel overflow-hidden">
      <ol className="flex flex-wrap">{steps.map((step, index) => {
        const active = step === nextStep && !closed;
        return <li key={step.key} className="min-w-[7.5rem] flex-1"><a href={`#${step.key}`} title={`${step.label}: ${step.detail}`} aria-current={active ? "step" : undefined}
          className={cn("border-hairline flex items-center gap-2 border-b-2 px-3 py-2.5 text-[12.5px] hover:bg-muted/60", active ? "border-b-brand bg-brand-50" : step.done ? "border-b-brand/40" : "border-b-transparent")}>
          <span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold", step.done ? "bg-brand text-white" : active ? "border-brand text-brand border" : "border-hairline-strong text-ink-faint border")}>
            {step.done ? <Check className="size-3" strokeWidth={3} /> : index + 1}</span>
          <span className={cn("font-medium", step.done ? "text-ink" : active ? "text-brand" : "text-ink-muted")}>{step.short}</span>
        </a></li>;
      })}</ol>
      {nextStep && !closed ? <p className="border-hairline text-ink border-t px-4 py-2 text-[12.5px]"><span className="font-medium">Next: {inSentence(nextStep.todo)}.</span> <span className="text-ink-muted">{nextStep.detail}.</span>
        <a href={`#${nextStep.key}`} className="text-brand ml-1.5 font-medium hover:underline">Go to it</a></p>
        : data.ready && !file.organisation_id ? <p className="border-hairline text-positive border-t px-4 py-2 text-[12.5px] font-medium">Everything is done: open the books.</p> : null}
    </nav>

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.9fr)]">
      <div className="min-w-0 space-y-4">
        <div id="letter" className="scroll-mt-16"><RecordSection title="Engagement letter" hint={file.signed_at ? "Signed" : file.letter_sent_at ? `Sent ${formatDate(file.letter_sent_at.slice(0, 10))}` : "Not sent yet"}
          action={<a href={`/clients/${file.id}/letter.pdf`} target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-1 text-[12px] hover:underline"><FileText className="size-3.5" />{file.signed_at ? "The signed letter" : "Read the letter"}</a>}>
          <div className="space-y-3 p-4 text-[12.5px]">
            {file.signed_at ? <div className="space-y-1">
              <p className="text-positive flex items-center gap-1.5 font-medium"><Check className="size-4" />Signed by {file.signed_name}{file.signed_position ? `, ${file.signed_position}` : ""}, {formatDateTime(file.signed_at)}</p>
              <p className="text-ink-faint text-[11.5px]">From {file.signed_ip} · fingerprint <span className="font-mono">{file.signed_hash?.slice(0, 16)}…</span>, the same as when it was sent</p>
            </div> : <>
              <p className="text-ink-muted">{SERVICES_LINE(file.services)} for {formatAmount(file.monthly_fee)} a month{file.app_fee ? ` and ${formatAmount(file.app_fee)} for the online books` : ""}{file.hourly_rate ? `, extra work at ${formatAmount(file.hourly_rate)} an hour` : ""}. Written from the client details.</p>
              {letter.changed ? <p role="alert" className="text-caution">The details have changed since the letter was sent: send it again, so the client signs what was agreed.</p> : null}
              {!closed && (!file.letter_sent_at || letter.changed) ? <SendLetter fileId={file.id} sent={Boolean(file.letter_sent_at)} changed={letter.changed} /> : null}
              {file.letter_sent_at && link ? <><p className="text-ink">Sent {formatDateTime(file.letter_sent_at)}. Waiting for {file.contact_name ?? "the client"} to sign.</p>
                <ClientLink link={link} email={file.contact_email} subject={`Your engagement letter from ${practiceName}`} body={emailBody} /></> : null}
            </>}
            {file.signed_at && link && outstanding.length ? <ClientLink link={link} email={file.contact_email} label="Send a reminder" subject={`Documents still needed for ${file.company_name}`} body={reminderBody} /> : null}
          </div>
        </RecordSection></div>

        <div id="people" className="scroll-mt-16"><RecordSection title="Directors and owners" hint={people.length ? `${people.length} ${people.length === 1 ? "person" : "people"}${totalShares ? ` · ${totalShares}% of the shares recorded` : ""}` : "Who runs the company and who owns it"}>
          {people.length ? <ul className="divide-hairline divide-y">{people.map(person => <PersonRow key={person.id} person={person} fileId={file.id} locked={Boolean(file.organisation_id) || closed} screening={data.latestBySubject.get(person.id) ?? null} />)}</ul> : null}
          {!closed ? <div className="border-hairline border-t px-4 py-3"><RecordDisclosure title={people.length ? "Add a person" : "Add the first director"} open={!people.length}><div className="pt-2"><PersonForm fileId={file.id} /></div></RecordDisclosure></div> : null}
        </RecordSection></div>

        <div id="documents" className="scroll-mt-16"><RecordSection title="Documents" hint={required.length ? `${received} of ${required.length} for due diligence received · the client can send them from their link` : undefined}>
          <ul className="divide-hairline divide-y">{documents.map(document => <li key={document.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 text-[12.5px]">
            <span className="min-w-0"><span className="text-ink block">{document.label}{FOR_THE_BOOKS.includes(document.kind) ? <span className="text-ink-faint text-[11.5px]"> · for the books</span> : null}</span>
              {document.received_at ? <span className="text-ink-faint block text-[11.5px]">Received {formatDateTime(document.received_at)} from {document.received_from === "client" ? "the client’s link" : document.received_from} · {document.file_name} · {sizeOf(document.size_bytes)}</span> : null}</span>
            {document.received_at ? <a href={`/clients/${file.id}/documents/${document.id}`} target="_blank" rel="noreferrer" title={document.file_name ?? undefined} className="text-brand inline-flex items-center gap-1 text-[12px] font-medium hover:underline"><Check className="text-positive size-3.5" />View</a>
              : closed ? <span className="text-ink-faint">Not received</span> : <DocumentUpload fileId={file.id} documentId={document.id} label={document.label} />}
          </li>)}</ul>
          {!closed ? <div className="border-hairline border-t px-4 py-3"><RequestDocumentForm fileId={file.id} /></div> : null}
        </RecordSection></div>

        <div id="screening" className="scroll-mt-16"><RecordSection title="Sanctions screening" hint={data.list ? `The EU list of ${formatDate(data.list.generated_on)}, ${data.list.entries.toLocaleString("en-GB")} entries` : "No list loaded"}
          action={!closed && people.length ? <ScreenFileButton fileId={file.id} again={data.latestBySubject.size > 0} /> : undefined}>
          <ul className="divide-hairline divide-y">{subjects.map(subject => {
            const screening = data.latestBySubject.get(subject.id ?? "company") ?? null;
            return <li key={subject.id ?? "company"} className="space-y-2 px-4 py-2.5 text-[12.5px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span><span className="text-ink font-medium">{subject.name}</span><span className="text-ink-faint text-[11.5px]"> · {subject.kind}</span></span>
                {!screening ? <span className="text-ink-faint">Not screened</span>
                  : screening.result === "clear" ? <span className="text-positive">Clear · {formatDateTime(screening.screened_at)}</span>
                  : screening.resolution === "not_the_same" ? <span className="text-positive">Not the same {subject.id ? "person" : "entity"} · decided by {screening.resolved_by}</span>
                  : screening.resolution === "confirmed" ? <RecordBadge tone="critical">Confirmed match</RecordBadge>
                  : <RecordBadge tone="critical">{screening.matches.length} possible match{screening.matches.length === 1 ? "" : "es"}</RecordBadge>}
              </div>
              {screening && screening.result === "possible" ? <div className="space-y-2">
                {screening.resolution ? <p className="text-ink-muted bg-surface-sunken rounded px-2.5 py-1.5 text-[12px]">{screening.resolution === "confirmed" ? "Confirmed" : "Not the same"}: {screening.resolved_note}</p> : null}
                {!screening.resolution ? <>{screening.matches.map(match => <Match key={match.entityId} match={match} />)}{!closed ? <ResolveMatch screeningId={screening.id} /> : null}</>
                  : <RecordDisclosure title={`The ${screening.matches.length} listed name${screening.matches.length === 1 ? "" : "s"} it was compared with`}><div className="space-y-2 pt-2">{screening.matches.map(match => <Match key={match.entityId} match={match} />)}</div></RecordDisclosure>}
              </div> : null}
            </li>;
          })}</ul>
          {!people.length ? <p className="text-ink-faint border-hairline border-t px-4 py-2 text-[11.5px]">Add the directors and owners first: the company and each of them are screened.</p> : null}
        </RecordSection></div>

        <div id="risk" className="scroll-mt-16"><RecordSection title="Risk assessment" hint="ICPAC’s client risk-based approach: four areas scored 1 to 5">
          {current ? <div className="space-y-3 p-4 text-[12.5px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink"><RecordBadge tone={LEVEL_TONE[current.level]}>{RISK_LEVELS[current.level].label} risk</RecordBadge> <span className="ml-1">{RISK_LEVELS[current.level].diligence} · total {current.total} of 20</span></p>
              <p className="text-ink-faint text-[11.5px]">Assessed by {current.assessed_by}, {formatDateTime(current.assessed_at)}</p>
            </div>
            <div className="border-hairline grid grid-cols-2 overflow-hidden rounded-md border sm:grid-cols-4">{RISK_AREA_KEYS.map(area => {
              const score = current[`${area}_score` as "client_score"];
              return <div key={area} className="border-hairline border-r border-b px-3 py-2 last:border-r-0 sm:border-b-0">
                <p className="text-ink-faint text-[11px] font-semibold tracking-[0.06em] uppercase">{RISK_AREAS[area].label}</p>
                <p className={cn("text-[18px] font-semibold tabular-nums", score >= 4 ? "text-critical" : "text-ink")}>{score}</p>
                <ul className="text-ink-muted mt-0.5 space-y-0.5 text-[11.5px]">{current.factors.filter(factor => factor.area === area).map((factor, index) => <li key={index}>{factor.label} <b className="text-ink">{factor.score}</b></li>)}</ul>
              </div>;
            })}</div>
            {current.forced_reason ? <p className="text-critical">High whatever the score: {current.forced_reason}.</p> : null}
            {current.override_reason ? <p className="text-ink-muted">Rated {RISK_LEVELS[current.level].label.toLowerCase()} rather than {RISK_LEVELS[current.scored_level].label.toLowerCase()}: {current.override_reason}</p> : null}
            {current.notes ? <p className="text-ink-muted">{current.notes}</p> : null}
            {current.approved_at ? <p className="text-positive flex items-center gap-1.5"><Check className="size-4" />Approved by {current.approved_by} as {current.approved_as === "partner" ? "partner" : "compliance officer"}, {formatDate(current.approved_at.slice(0, 10))}. Next review {formatDate(current.next_review_on!)}.</p>
              : approver ? <ApproveAssessment assessmentId={current.id} label={`Approve as ${approver === "partner" ? "partner" : "compliance officer"}`} />
              : <p className="text-caution">Waiting for approval by {RISK_LEVELS[current.level].approverLabel}.</p>}
            {approved && approved.id !== current.id ? <p className="text-ink-faint text-[11.5px]">The approved rating until then: {RISK_LEVELS[approved.level].label.toLowerCase()}, {formatDate(approved.approved_at!.slice(0, 10))}.</p> : null}
            {!closed ? <RecordDisclosure title={current.approved_at ? "Review: assess again" : "Assess again"}><div className="pt-2"><RiskForm fileId={file.id} factors={data.suggested} forced={data.suggestedResult.forced} /></div></RecordDisclosure> : null}
          </div> : <div className="space-y-3 p-4">
            <p className="text-ink-muted text-[12.5px]">Ledgerline has scored each factor from the file. Change any score you disagree with; the reasons stay with the assessment.</p>
            {!closed ? <RiskForm fileId={file.id} factors={data.suggested} forced={data.suggestedResult.forced} /> : null}
          </div>}
        </RecordSection></div>

        <div id="books" className="scroll-mt-16"><RecordSection title="The books">
          <div className="space-y-3 p-4 text-[12.5px]">
            {file.organisation_id ? <p className="text-positive flex items-center gap-1.5"><Check className="size-4" />Opened {file.opened_at ? formatDateTime(file.opened_at) : ""}{file.opened_by ? ` by ${file.opened_by}` : ""}. <Link href={`/c/${file.slug}`} className="text-brand font-medium hover:underline">Go to {file.company_name}</Link></p>
              : closed ? <p className="text-ink-faint">Not opened: the client was declined.</p> : <>
              <p className="text-ink-muted">Opening the books creates {file.company_name} in Ledgerline with the standard chart of accounts{file.vat_registered ? `, VAT quarters ending ${["Jan, Apr, Jul and Oct", "Feb, May, Aug and Nov", "Mar, Jun, Sep and Dec"][file.vat_quarter_end_month - 1]}` : ", not registered for VAT"}, a year end in {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][file.year_end_month - 1]}, and books from {file.books_from ? formatDate(file.books_from) : "this month"}.
                Its deadlines start from there, its fee of {formatAmount(file.monthly_fee)} goes on the Fees page, and it becomes a customer in the firm’s own books.</p>
              {!data.ready ? <p className="text-caution">Still to do: {steps.slice(0, 6).filter(step => !step.done).map(step => inSentence(step.label)).join("; ")}.</p> : null}
              <OpenBooksButton fileId={file.id} ready={data.ready} />
            </>}
          </div>
        </RecordSection></div>

        {file.status === "onboarding" ? <RecordDisclosure title="Not taking them on?"><div className="pt-2"><DeclineForm fileId={file.id} /></div></RecordDisclosure> : null}
      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-16">
        <RecordSection title="Client details"><div className="p-4"><ClientDetailsForm file={file} staff={data.staff.map(person => person.name)} locked={Boolean(file.signed_at) || closed} /></div></RecordSection>
      </div>
    </div>
  </PageBody>;
}

const SERVICES_LINE = (services: (keyof typeof SERVICES)[]) => {
  const labels = services.map(key => inSentence(SERVICES[key].label));
  const text = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0] ?? "No services chosen";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function PersonRow({ person, fileId, locked, screening }: { person: Person; fileId: string; locked: boolean; screening: { result: string; resolution: string | null } | null }) {
  const missing = needsIdentity(person) && (!person.date_of_birth || !person.nationality || !person.residence);
  return <li className="px-4 py-2.5 text-[12.5px]">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="min-w-0"><span className="text-ink font-medium">{person.name}</span>
        <span className="text-ink-faint text-[11.5px]"> · {person.roles.map(role => ROLES[role]).join(", ")}{person.ownership ? ` · ${person.ownership}%` : ""}</span></span>
      <span className="flex flex-wrap items-center gap-1.5">
        {person.pep !== "no" ? <RecordBadge tone={person.pep === "former" ? "caution" : "critical"}>{PEP[person.pep]}</RecordBadge> : null}
        {screening ? screening.result === "clear" || screening.resolution === "not_the_same" ? <RecordBadge tone="positive">Screened</RecordBadge> : <RecordBadge tone="critical">Possible match</RecordBadge> : null}
        {missing ? <RecordBadge tone="caution">Details needed</RecordBadge> : null}
      </span>
    </div>
    <p className="text-ink-muted text-[11.5px]">{[person.date_of_birth ? `Born ${formatDate(person.date_of_birth)}` : null, person.nationality ? `${personCountry(person.nationality)} national` : null,
      person.residence ? `lives in ${personCountry(person.residence)}` : null, person.id_kind ? `${person.id_kind === "passport" ? "Passport" : "ID card"} ${person.id_number ?? ""}${person.id_expires ? `, expires ${formatDate(person.id_expires)}` : ""}` : null,
      person.pep !== "no" && person.pep_detail ? person.pep_detail : null].filter(Boolean).join(" · ")}</p>
    {!locked ? <div className="mt-1 flex items-start gap-3">
      <RecordDisclosure title="Edit"><div className="pt-2"><PersonForm fileId={fileId} person={person} /></div></RecordDisclosure>
      <form action={removePerson} className="pt-0.5"><input type="hidden" name="id" value={person.id} /><input type="hidden" name="file_id" value={fileId} /><InlineSubmit destructive title={`Remove ${person.name}`}>Remove</InlineSubmit></form>
    </div> : null}
  </li>;
}
