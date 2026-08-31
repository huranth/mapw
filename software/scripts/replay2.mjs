import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/xterm");
const cols = Number(process.argv[2]);
const raw = readFileSync("scripts/__effort_capture.bin", "utf8");
// find the selector paint: the LAST "Effort" title paint preceded by ▔s
const marker = "Effort";
let start = raw.lastIndexOf("▔▔▔");
if (start < 0) start = raw.lastIndexOf(marker);
// back up to a clean escape boundary
while (start > 0 && raw[start - 1] !== "m" && raw[start-1] !== "l") start--;
const end = raw.indexOf("⎿  ", start);
const bytes = raw.slice(start, end > start ? end : undefined);
const term = new Terminal({ cols, rows: 24, convertEol: false });
await new Promise((r) => term.write(bytes, r));
for (let y = 0; y < 24; y++) {
  const l = term.buffer.active.getLine(y);
  const t = l ? l.translateToString(true) : "";
  if (t.trim()) console.log(`${y + 1}: "${t}"`);
}
