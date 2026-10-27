import "server-only";

import { Font } from "@react-pdf/renderer";

import { ROBOTO_MEDIUM, ROBOTO_REGULAR } from "./fonts";

/**
 * Every PDF Ledgerline makes is set in Roboto, Latin and Greek. react-pdf
 * loads a font once and shares it between documents, and a font that has set
 * one document's Greek garbles the next one's: letters drop out of its
 * embedded subset ("NVOICE", "12 ct 2026"). So each document is made with
 * Roboto registered afresh (react-pdf's own standard fonts are left alone),
 * one document at a time, so that no two share a font while being set.
 */
// A company name is never broken across lines with a hyphen.
Font.registerHyphenationCallback(word => [word]);

let queue: Promise<unknown> = Promise.resolve();

export function makePdf<T>(work: () => Promise<T>): Promise<T> {
  const turn = queue.then(() => {
    delete Font.getRegisteredFonts().Roboto;
    Font.register({ family: "Roboto", fonts: [{ src: ROBOTO_REGULAR, fontWeight: 400 }, { src: ROBOTO_MEDIUM, fontWeight: 500 }] });
    return work();
  });
  queue = turn.catch(() => undefined);
  return turn;
}
