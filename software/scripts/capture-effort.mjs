// Capture the raw PTY byte stream of Claude Code's /effort selector so the
// cursor bug can be diagnosed against real output (not guesses). Spawns
// `claude` in node-pty at a fixed geometry, waits for the prompt, sends
// "/effort\r", records everything for a few seconds, then exits.
import { spawn } from "node-pty";
import { writeFileSync } from "node:fs";

const COLS = Number(process.argv[2] ?? 80);
const ROWS = 24;
const OUT = new URL("./__effort_capture.bin", import.meta.url);

const chunks = [];
const pty = spawn(process.env.COMSPEC ?? "cmd.exe", ["/c", "claude"], {
  name: "xterm-256color",
  cols: COLS,
  rows: ROWS,
  cwd: process.cwd(),
  env: process.env,
});

pty.onData((d) => chunks.push(Buffer.from(d, "utf8")));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the REPL to boot, then open the selector.
await sleep(12000);
pty.write("/effort");
await sleep(800);
pty.write("\r");
await sleep(3000);

// Log the terminal's belief about cursor state: probe with DECRQM? Not
// reliable through ConPTY; the byte stream is what matters.
pty.write("\x1b"); // Esc — close the selector
await sleep(800);
pty.kill();

const buf = Buffer.concat(chunks);
writeFileSync(OUT, buf);
console.log(`captured ${buf.length} bytes -> ${OUT.pathname}`);

// Quick analysis: which control sequences appear?
const s = buf.toString("utf8");
const counts = {
  altEnter_1049h: (s.match(/\x1b\[\?1049h/g) || []).length,
  altLeave_1049l: (s.match(/\x1b\[\?1049l/g) || []).length,
  syncOpen_2026h: (s.match(/\x1b\[\?2026h/g) || []).length,
  syncClose_2026l: (s.match(/\x1b\[\?2026l/g) || []).length,
  cursorShow_25h: (s.match(/\x1b\[\?25h/g) || []).length,
  cursorHide_25l: (s.match(/\x1b\[\?25l/g) || []).length,
  cup: (s.match(/\x1b\[\d+;\d+H/g) || []).length,
};
console.log(counts);

// Find the /effort frame: locate "ultracode" and dump the surrounding bytes
// escaped, so we can see exactly what surrounds the selector render.
const idx = s.indexOf("ultracode");
if (idx >= 0) {
  const win = s.slice(Math.max(0, idx - 2000), idx + 2000);
  console.log("--- selector window (escaped) ---");
  console.log(JSON.stringify(win));
}
