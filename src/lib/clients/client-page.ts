import "server-only";

import { letterDate, type Letter } from "@/lib/domain/onboarding";

/**
 * The page a new client opens from the practice's email: no account, no
 * password. The engagement letter to read and sign, then the documents the
 * practice asked for, each uploaded on its own. Plain HTML forms, so it works
 * on any phone with no script, in the practice's colour.
 */

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export type ClientPageInput = {
  token: string;
  practice: { name: string; initials: string; colour: string };
  company: string; contact: string | null;
  letter: Letter | null;
  signed: { name: string; position: string | null; at: string } | null;
  documents: { id: string; label: string; received_at: string | null; file_name: string | null; forBooks: boolean }[];
  notice?: { tone: "ok" | "problem"; text: string } | null;
  closed?: string | null;
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Nicosia" });

export function letterHtml(letter: Letter) {
  return `<article class="letter">
    <p class="meta">${escape(letterDate(letter.date))}</p>
    <p class="meta">${escape(letter.to.company)}${letter.to.attention ? `<br>For the attention of ${escape(letter.to.attention)}` : ""}${letter.to.address ? `<br>${escape(letter.to.address)}` : ""}</p>
    <h2>${escape(letter.title)}</h2>
    ${letter.sections.map(section => `${section.heading ? `<h3>${escape(section.heading)}</h3>` : ""}${section.paragraphs.map(text => `<p>${escape(text)}</p>`).join("")}${section.bullets?.length ? `<ul>${section.bullets.map(text => `<li>${escape(text)}</li>`).join("")}</ul>` : ""}`).join("\n")}
    <p class="sign-off">Yours sincerely,<br>${escape(letter.signOff)}</p>
  </article>`;
}

export function clientPage(input: ClientPageInput) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.practice.colour) ? input.practice.colour : "#0d6e6e";
  const firm = escape(input.practice.name), company = escape(input.company);
  const base = `/o/${escape(input.token)}`;
  const outstanding = input.documents.filter(document => !document.received_at);
  let body: string;
  if (input.closed) {
    body = `<h1>This link is closed</h1><p class="lead">${escape(input.closed)}</p>`;
  } else {
    const letter = !input.letter ? `<section><h2 class="step"><span>1</span>Your engagement letter</h2><p class="muted">${firm} is preparing your engagement letter. It will appear here.</p></section>`
      : input.signed ? `<section><h2 class="step done"><span>✓</span>Your engagement letter</h2>
          <p>Signed by ${escape(input.signed.name)}${input.signed.position ? `, ${escape(input.signed.position)}` : ""}, on ${escape(when(input.signed.at))}.</p>
          <p><a class="button ghost" href="${base}/letter.pdf">Download the signed letter (PDF)</a></p>
          <details><summary>Read the letter again</summary>${letterHtml(input.letter)}</details></section>`
      : `<section><h2 class="step"><span>1</span>Read and sign your engagement letter</h2>
          <p class="muted">It sets out what ${firm} will do for ${company}, what is needed from you, and the fees.</p>
          <div class="scroll" tabindex="0" aria-label="The engagement letter">${letterHtml(input.letter)}</div>
          <form method="post" action="${base}/sign" class="sign">
            <div class="pair">
              <div><label for="name">Your full name</label><input id="name" name="name" required maxlength="200" autocomplete="name" value="${escape(input.contact ?? "")}"></div>
              <div><label for="position">Your position</label><input id="position" name="position" required maxlength="100" value="Director"></div>
            </div>
            <label class="check"><input type="checkbox" name="agree" value="1" required> I am authorised to sign for ${company}, and I agree to this letter on its behalf.</label>
            <button type="submit">Sign the letter</button>
            <p class="small">Signing here is an electronic signature. ${firm} keeps the time, the letter’s fingerprint and the address it was signed from.</p>
          </form></section>`;
    const documents = input.documents.length ? `<section><h2 class="step${outstanding.length ? "" : " done"}"><span>${outstanding.length ? "2" : "✓"}</span>Send your documents</h2>
        <p class="muted">${outstanding.length ? `${outstanding.length} still to send. A PDF, or a clear photo of each page, up to 10 MB.` : "Everything asked for has arrived. Thank you."}</p>
        <ul class="docs">${input.documents.map(document => `<li class="${document.received_at ? "got" : ""}">
          <div><b>${escape(document.label)}</b>${document.forBooks ? `<small>For your books</small>` : ""}${document.received_at ? `<small>Received ${escape(when(document.received_at))}${document.file_name ? `: ${escape(document.file_name)}` : ""}</small>` : ""}</div>
          ${document.received_at ? `<span class="ok">Received</span>` : `<form method="post" action="${base}/upload" enctype="multipart/form-data">
            <input type="hidden" name="document" value="${escape(document.id)}">
            <label class="file"><input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required aria-label="${escape(document.label)}"></label>
            <button type="submit" class="small-button">Upload</button></form>`}
        </li>`).join("")}</ul></section>` : "";
    body = `<h1>Welcome to ${firm}</h1>
      <p class="lead">${input.contact ? `${escape(input.contact.split(" ")[0])}, this` : "This"} is where you sign ${company}’s engagement letter and send the documents ${firm} needs. No account or password: keep this link to yourself.</p>
      ${input.notice ? `<p class="notice ${input.notice.tone}" role="${input.notice.tone === "ok" ? "status" : "alert"}">${escape(input.notice.text)}</p>` : ""}
      ${letter}${documents}`;
  }
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${company} · ${firm}</title>
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><link rel="icon" href="data:,">
<style>
  :root { --accent: ${accent}; --ink: #1b2422; --muted: #5d6b67; --rule: #d9e0dd; --paper: #f5f7f6; color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: clamp(16px, 4vw, 48px) 16px; }
  main { width: 100%; max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid var(--rule); border-radius: 12px; padding: clamp(20px, 5vw, 40px); box-shadow: 0 18px 40px -24px rgb(0 0 0 / .25); }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; }
  .chip { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 4px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; }
  .firm { font-size: 15px; }
  h1 { font-size: 26px; line-height: 1.15; margin: 0 0 8px; letter-spacing: -0.01em; }
  .lead { color: var(--muted); margin: 0 0 8px; }
  .muted { color: var(--muted); margin: 4px 0 14px; }
  section { margin-top: 30px; padding-top: 22px; border-top: 1px solid var(--rule); }
  .step { display: flex; align-items: center; gap: 10px; font-size: 18px; margin: 0; }
  .step span { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 14%, #fff); color: var(--accent); font-size: 13px; font-weight: 700; flex: none; }
  .step.done span { background: var(--accent); color: #fff; }
  .scroll { max-height: 420px; overflow: auto; border: 1px solid var(--rule); border-radius: 8px; padding: 18px 20px; background: #fcfdfc; }
  .letter { font-size: 14.5px; }
  .letter h2 { font-size: 16px; margin: 14px 0 8px; }
  .letter h3 { font-size: 14.5px; margin: 16px 0 4px; }
  .letter p { margin: 0 0 8px; } .letter ul { margin: 0 0 8px; padding-left: 20px; } .letter li { margin-bottom: 4px; }
  .letter .meta { color: var(--muted); font-size: 13.5px; } .sign-off { margin-top: 16px !important; }
  details { margin-top: 10px; } summary { cursor: pointer; color: var(--accent); font-size: 14px; }
  form.sign { display: grid; gap: 6px; margin-top: 16px; }
  label { font-size: 13.5px; font-weight: 500; }
  input[type=text], input:not([type]), input[name=name], input[name=position] { width: 100%; font: inherit; color: inherit; border: 1px solid #c5cfcb; border-radius: 8px; padding: 10px 12px; background: #fff; margin-top: 4px; }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  @media (max-width: 520px) { .pair { grid-template-columns: 1fr; gap: 10px; } }
  .check { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; margin-top: 12px; } .check input { margin-top: 4px; width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  button, .button { display: inline-block; margin-top: 14px; justify-self: start; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 999px; padding: 11px 26px; cursor: pointer; text-decoration: none; }
  .button.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); margin-top: 4px; }
  button:hover { filter: brightness(.92); }
  .small { font-size: 12.5px; color: var(--muted); margin: 6px 0 0; }
  .docs { list-style: none; padding: 0; margin: 0; border: 1px solid var(--rule); border-radius: 8px; }
  .docs li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--rule); }
  .docs li:first-child { border-top: 0; }
  .docs li div { min-width: 0; flex: 1 1 260px; } .docs b { font-weight: 500; font-size: 14.5px; display: block; } .docs small { display: block; color: var(--muted); font-size: 12.5px; }
  .docs form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } .docs input[type=file] { font-size: 13px; max-width: 220px; }
  .small-button { margin: 0; padding: 7px 16px; font-size: 13.5px; }
  .ok { color: var(--accent); font-weight: 600; font-size: 13.5px; }
  .notice { border-radius: 8px; padding: 10px 14px; font-size: 14px; margin: 14px 0 0; }
  .notice.ok { background: color-mix(in srgb, var(--accent) 10%, #fff); color: var(--ink); border: 1px solid color-mix(in srgb, var(--accent) 35%, #fff); }
  .notice.problem { background: #fdf0ee; color: #8c2f22; border: 1px solid #f1c7bf; }
  a { color: var(--accent); }
  footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--rule); font-size: 12px; color: var(--muted); }
</style></head><body><main>
<header><span class="chip">${escape(input.practice.initials)}</span><b class="firm">${firm}</b></header>
${body}
<footer>A private link from ${firm} for ${company}. Powered by Ledgerline.</footer>
</main></body></html>`;
}
