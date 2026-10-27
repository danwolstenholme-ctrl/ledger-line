import zlib from "node:zlib";

/**
 * The text of a PDF made by react-pdf, read back as a viewer shows it: each
 * font's glyphs turned into letters through its ToUnicode map. Enough to tell
 * a whole invoice from one whose letters dropped out, which a status code and
 * a content type cannot (the React Compiler once garbled them so).
 */
export function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const objects = new Map<string, string>();
  for (const [, id, body] of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objects.set(id, body);
  const streamOf = (id: string | undefined) => {
    const body = objects.get(id ?? "") ?? "";
    const match = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
    if (!match) return "";
    const data = Buffer.from(match[1], "latin1");
    return /\/FlateDecode/.test(body) ? zlib.inflateSync(data).toString("latin1") : data.toString("latin1");
  };
  // A hex string of UTF-16 code units: the letters a glyph stands for (a ligature stands for several).
  const letters = (hex: string) => { const clean = hex.replace(/\s+/g, ""); let text = ""; for (let at = 0; at + 4 <= clean.length; at += 4) text += String.fromCharCode(parseInt(clean.slice(at, at + 4), 16)); return text; };
  const unicodeOf = (id: string | undefined) => {
    const map = new Map<number, string>(), cmap = streamOf(id);
    for (const [, from, to, list] of cmap.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
      const entries = [...list.matchAll(/<([^>]*)>/g)].map(match => letters(match[1]));
      for (let glyph = parseInt(from, 16), index = 0; glyph <= parseInt(to, 16); glyph++, index++) map.set(glyph, entries[index] ?? "");
    }
    for (const [, section] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const [, glyph, value] of section.matchAll(/<([0-9a-fA-F]+)>\s*<([^>]*)>/g)) map.set(parseInt(glyph, 16), letters(value));
    return map;
  };
  let text = "";
  for (const [, page] of raw.matchAll(/\d+ 0 obj\s*(<<\s*\/Type \/Page\b[\s\S]*?)endobj/g)) {
    const resources = objects.get(/\/Resources (\d+) 0 R/.exec(page)?.[1] ?? "") ?? page;
    const fonts = new Map<string, Map<number, string>>();
    for (const [, name, id] of resources.matchAll(/\/(F\d+) (\d+) 0 R/g)) fonts.set(name, unicodeOf(/\/ToUnicode (\d+) 0 R/.exec(objects.get(id) ?? "")?.[1]));
    let font: Map<number, string> | undefined;
    for (const [, name, shown] of streamOf(/\/Contents (\d+) 0 R/.exec(page)?.[1]).matchAll(/\/(F\d+) [\d.]+ Tf|(\[[^\]]*\]\s*TJ|<[0-9a-fA-F]*>\s*Tj)/g)) {
      if (name) { font = fonts.get(name); continue; }
      for (const [, hex] of shown.matchAll(/<([0-9a-fA-F]*)>/g)) for (let at = 0; at + 4 <= hex.length; at += 4) text += font?.get(parseInt(hex.slice(at, at + 4), 16)) ?? "�";
      text += " ";
    }
  }
  return text.replace(/\s+/g, " ");
}
