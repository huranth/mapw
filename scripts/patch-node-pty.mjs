#!/usr/bin/env node
// Re-applies the bridgespace-clone M1 patch to node-pty's ConPTY worker so it
// survives `npm install`. The worker calls `GetConsoleProcessList(shellPid)`,
// which under Electron's GUI-subsystem main process throws `AttachConsole
// failed` because no console is attached. node-pty's parent already has a
// 5-second-timeout fallback that resolves to `[shellPid]`; the throw here only
// pollutes stderr and (in earlier node-pty versions) crashed the forked worker.
// We wrap the call so on failure we return the same `[shellPid]` answer.
//
// Idempotent: if the file is already patched (or missing — e.g. non-win32
// installs where node-pty takes a different code path) this is a no-op.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "node_modules", "node-pty", "lib", "conpty_console_list_agent.js");

let src;
try {
  src = await readFile(target, "utf8");
} catch {
  // node-pty not installed (or non-win32 layout) — nothing to patch.
  process.exit(0);
}

const PAT = /var consoleProcessList = getConsoleProcessList\(shellPid\);/;
if (!PAT.test(src)) {
  // Already patched (try/catch wrapper present) or unexpected file shape — bail.
  process.exit(0);
}

const patched = src.replace(
  PAT,
  [
    "var consoleProcessList;",
    "try {",
    "  consoleProcessList = getConsoleProcessList(shellPid);",
    "} catch (e) {",
    "  // Patched by bridgespace-clone: see scripts/patch-node-pty.mjs.",
    "  // AttachConsole throws under Electron's GUI-subsystem main; return the",
    "  // same [shellPid] fallback node-pty's parent already resolves to via",
    "  // its 5-second timeout.",
    "  consoleProcessList = [shellPid];",
    "}",
  ].join("\n"),
);

await writeFile(target, patched, "utf8");
console.log("[patch-node-pty] applied try/catch fallback to", target);
