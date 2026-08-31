import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/xterm");
const raw = readFileSync("C:/Users/W/Desktop/Something crazy/software/scripts/__effort_capture.bin", "utf8");
const marker = "[16;1H▔▔▔";
const start = raw.lastIndexOf(marker);
const end = raw.indexOf("⎿  ", start);
const bytes = raw.slice(start, end > start ? end : undefined);
for (let cols = 40; cols <= 80; cols++) {
  const term = new Terminal({ cols, rows: 24, convertEol: false });
  await new Promise((r) => term.write(bytes, r));
  const rows = [];
  for (let y = 0; y < 24; y++) {
    const l = term.buffer.active.getLine(y);
    if (l) rows.push(l.translateToString(true));
  }
  const joined = rows.join("\n");
  if (/xhig\s*\n\s*h/.test(joined) || joined.includes("xhig\n")) {
    console.log(`cols=${cols} REPRODUCES xhig-h split`);
  }
  if (cols >= 44 && cols <= 48) {
    const optRow = rows.findIndex((r) => r.includes("medium"));
    console.log(`--- cols=${cols} options row ${optRow+1}: "${rows[optRow]}" next: "${rows[optRow+1]}"`);
  }
  term.dispose();
}
console.log("scan done");
