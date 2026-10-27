import type { Metadata } from "next";

import { signInAs } from "@/lib/actions/auth";
import { AUTH_MODE, HOSTED_DEMO, safeNext } from "@/lib/auth/config";
import { asService, sql } from "@/lib/db";
import { PasswordLinkForm, PasswordSignInForm } from "@/components/people/forms";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

type Person = { email: string; name: string; initials: string; at: string };

/** Sign in. Live: email and password. The laptop demo: choose who to be, and see Ledgerline as they do. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const next = safeNext(query.next);
  if (AUTH_MODE === "supabase") {
    return <div className="ll-panel space-y-5 p-6">
      <div><h1 className="text-ink text-[18px] font-semibold">Sign in</h1><p className="text-ink-muted mt-1 text-[13px]">With the email address your practice invited.</p></div>
      <PasswordSignInForm next={next} email={query.email} />
      <details className="border-hairline border-t pt-3 text-[13px]"><summary className="text-brand cursor-pointer">Forgotten your password?</summary><div className="pt-3"><PasswordLinkForm /></div></details>
    </div>;
  }
  // The demo's people, as the practice and its clients: no passwords, nothing real behind them.
  const people = await asService("the demo's sign-in list", () => sql<Person>(`
    select u.email, u.name, u.initials, coalesce(s.role || ', ' || p.name, case m.role when 'owner' then 'Owner' else 'Team' end || ', ' || regexp_replace(o.name, ' (Ltd|Limited)$', ''), 'No access yet') as at
      from app_users u left join practice_staff s on s.user_id = u.id left join practices p on p.id = s.practice_id
      left join company_members m on m.user_id = u.id left join organisations o on o.id = m.organisation_id
     where u.auth_id is not null order by (s.id is null), (s.role = 'Partner') desc, u.name`));
  const firm = people.filter(person => !/^(Owner|Team), /.test(person.at)), clients = people.filter(person => /^(Owner|Team), /.test(person.at));
  const list = (title: string, entries: Person[]) => entries.length ? <section className="space-y-1.5">
    <h2 className="text-ink-faint text-[11.5px] font-semibold tracking-[0.06em] uppercase">{title}</h2>
    <ul className="space-y-1.5">{entries.map(person => <li key={person.email}><form action={signInAs}>
      <input type="hidden" name="email" value={person.email} /><input type="hidden" name="next" value={next} />
      <button type="submit" className="border-hairline hover:border-brand-200 hover:bg-brand-50 bg-surface flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left">
        <span className="bg-brand grid size-8 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold text-white">{person.initials}</span>
        <span className="min-w-0"><span className="text-ink block text-[13.5px] font-medium">Sign in as {person.name}</span><span className="text-ink-faint block truncate text-[12px]">{person.at}</span></span>
      </button>
    </form></li>)}</ul>
  </section> : null;
  return <div className="ll-panel space-y-5 p-6">
    <div><h1 className="text-ink text-[18px] font-semibold">Sign in</h1>
      <p className="text-ink-muted mt-1 text-[13px]">This is the demo: choose who to be. Each sees only what they may: the firm sees every client; a client’s owner, their own company.</p></div>
    {HOSTED_DEMO ? <p role="note" className="border-caution-line bg-caution-soft text-caution rounded-md border px-3 py-2 text-[12.5px] leading-relaxed">
      A public demo: Saltlake Accounting and its clients are made up, anyone with this address can open it, and it starts again from time to time. Please don’t put anything real in it.
    </p> : null}
    {query.problem ? <p role="alert" className="text-critical text-[13px]">That person isn’t in the demo any more.</p> : null}
    {list("Saltlake Accounting", firm)}
    {list("Clients’ own people", clients)}
  </div>;
}
