import "server-only";

import type { OrganisationRow } from "@/types/database";

/**
 * The page a company's website form lives on, in the company's own colour and
 * name: the form itself, the thank-you once it is sent, or what went wrong.
 * Plain HTML that posts to the enquiries API, so it works with no script and
 * can be linked to or opened from any site.
 */

type Company = Pick<OrganisationRow, "name" | "slug" | "invoice_accent">;
type PageInput =
  | { state: "form"; company: Company; token: string; logo: boolean }
  | { state: "sent"; company: Company; logo?: boolean }
  | { state: "problem"; company?: Company; message: string; logo?: boolean };

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const initials = (name: string) => name.replace(/\b(Ltd|Limited|Co)\b\.?/g, "").trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();

export function enquiryPage(input: PageInput) {
  const company = input.company;
  const accent = company && /^#[0-9a-fA-F]{6}$/.test(company.invoice_accent) ? company.invoice_accent : "#0d6e6e";
  const name = company ? escape(company.name) : "Enquiries";
  const mark = company ? (input.logo ? `<img class="logo" src="/c/${company.slug}/logo" alt="${name}">` : `<span class="chip">${escape(initials(company.name))}</span><b class="firm">${name}</b>`) : "";
  let body: string;
  if (input.state === "form") {
    body = `<h1>Tell us what you need</h1>
      <p class="lead">A real person at ${name} reads every enquiry and replies within a working day.</p>
      <form method="post" action="/api/v1/enquiries">
        <input type="hidden" name="key" value="${escape(input.token)}">
        <input type="hidden" name="redirect" value="/f/${escape(input.token)}?sent=1">
        <input type="hidden" name="source" value="Website">
        <div class="trap" aria-hidden="true"><label for="trap">Leave this empty</label><input id="trap" name="_trap" tabindex="-1" autocomplete="off"></div>
        <label for="name">Your name <span>*</span></label><input id="name" name="name" required maxlength="200" autocomplete="name">
        <label for="company">Company</label><input id="company" name="company" maxlength="200" autocomplete="organization">
        <div class="pair">
          <div><label for="email">Email</label><input id="email" name="email" type="email" maxlength="320" autocomplete="email"></div>
          <div><label for="phone">Phone</label><input id="phone" name="phone" type="tel" maxlength="40" autocomplete="tel"></div>
        </div>
        <label for="service">What do you need?</label><input id="service" name="service" maxlength="300" placeholder="For example, monthly bookkeeping and VAT">
        <label for="message">Anything else</label><textarea id="message" name="message" rows="4" maxlength="2000"></textarea>
        <button type="submit">Send</button>
        <p class="small">An email address or a phone number, so we can reply.</p>
      </form>`;
  } else if (input.state === "sent") {
    body = `<div class="done"><span class="tick" aria-hidden="true"></span><h1>Thank you</h1><p class="lead">Your enquiry is with ${name}. Someone will be in touch within a working day.</p></div>`;
  } else {
    body = `<h1>That didn’t go through</h1><p class="lead">${escape(input.message)}</p><p><a href="javascript:history.back()">Go back to the form</a></p>`;
  }
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${input.state === "sent" ? "Thank you" : "Enquiry"} · ${name}</title>
<meta name="robots" content="noindex"><link rel="icon" href="data:,">
<style>
  :root { --accent: ${accent}; --ink: #1b2422; --muted: #5d6b67; --rule: #d9e0dd; --paper: #f5f7f6; color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: start center; background: var(--paper); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: clamp(16px, 6vw, 64px) 16px; }
  main { width: 100%; max-width: 540px; background: #fff; border: 1px solid var(--rule); border-radius: 12px; padding: clamp(22px, 5vw, 36px); box-shadow: 0 18px 40px -24px rgb(0 0 0 / .25); }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; }
  .logo { max-height: 44px; max-width: 200px; }
  .chip { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 4px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; }
  .firm { font-size: 15px; }
  h1 { font-size: 26px; line-height: 1.15; margin: 0 0 8px; letter-spacing: -0.01em; }
  .lead { color: var(--muted); margin: 0 0 22px; }
  form { display: grid; gap: 6px; }
  label { font-size: 13.5px; font-weight: 500; margin-top: 10px; }
  label span { color: var(--accent); }
  input, textarea { width: 100%; font: inherit; color: inherit; border: 1px solid #c5cfcb; border-radius: 8px; padding: 10px 12px; background: #fff; }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .pair > div { display: grid; gap: 6px; }
  @media (max-width: 480px) { .pair { grid-template-columns: 1fr; } }
  button { margin-top: 18px; justify-self: start; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 999px; padding: 11px 26px; cursor: pointer; }
  button:hover { filter: brightness(.92); }
  .small { font-size: 12.5px; color: var(--muted); margin: 6px 0 0; }
  .trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  .done { text-align: left; }
  .tick { display: block; width: 44px; height: 44px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 14%, #fff); margin-bottom: 16px; position: relative; }
  .tick::after { content: ""; position: absolute; left: 16px; top: 11px; width: 9px; height: 17px; border: solid var(--accent); border-width: 0 3px 3px 0; transform: rotate(45deg); }
  a { color: var(--accent); }
  footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--rule); font-size: 12px; color: var(--muted); }
</style></head><body><main>
<header>${mark}</header>
${body}
<footer>Sent straight to ${name}. Powered by Ledgerline.</footer>
</main></body></html>`;
}
