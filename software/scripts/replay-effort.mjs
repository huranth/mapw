// Replay the captured /effort byte stream through a real xterm.js headless
// buffer (via jsdom) at various column counts to find where "xhigh" wraps
// into "xhig\nh" — i.e. at which cols Claude Code's selector row overflows.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/xterm");

const raw = readFileSync(new URL("./__effort_capture.bin", import.meta.url), "utf8");
// Keep only the tail: from the last "?25l" before the effort slider paint
// (the selector render) to end. Simplest: replay everything — final state is
// post-Esc. Instead, cut at the moment "/effort" was submitted: find the
// LAST occurrence of the slider top-border paint.
const marker = "\u001b[16;1H▔▔▔";
const start = raw.lastIndexOf(marker);
const end = raw.indexOf("⎿  ", start); // before the Cancelled cleanup
const selectorBytes = raw.slice(start, end > start ? end : undefined);

for (const cols of [80, 79, 78, 70, 60]) {
  const term = new Terminal({ cols, rows: 24, convertEol: false });
  await new Promise((resolve) => term.write(selectorBytes, resolve));
  const lines = [];
  for (let r = 15; r < 24; r++) {
    const line = term.buffer.active.getLine(r);
    if (line) lines.push(`${r + 1}: "${line.translateToString(true)}"`);
  }
  const cur = term.buffer.active;
  console.log(`=== cols=${cols} cursor=(${cur.baseY + cur.cursorY + 1},${cur.cursorX + 1}) ===`);
  console.log(lines.join("\n"));
}
