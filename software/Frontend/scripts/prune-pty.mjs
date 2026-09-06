#!/usr/bin/env node
// Prune node-pty prebuilds to win32-x64 only (Windows x64) — drops ~3.8 MB
// and ~16 files (darwin, arm64, win10 legacy). Keeps quality, just removes
// platforms we'll never run on Windows installer.
import { rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const keep = new Set(["win32-x64"]);
const roots = [
  "release/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/prebuilds",
  "release/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/build",
];

for (const root of roots) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !keep.has(e.name)) {
        const full = join(root, e.name);
        // extra guard: only delete known prebuild dirs
        if (/^(darwin|win32-arm64|win10-)/.test(e.name) || e.name.startsWith("darwin")) {
          await rm(full, { recursive: true, force: true });
          console.log(`[prune-pty] removed ${full}`);
        }
      }
    }
  } catch {}
}

// Also prune conpty win32-arm64 leftovers inside lib
try {
  const conpty = "release/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/prebuilds";
  const subs = await readdir(conpty, { withFileTypes: true });
  for (const s of subs) {
    if (s.isDirectory() && s.name === "win32-arm64") {
      await rm(join(conpty, s.name), { recursive: true, force: true });
      console.log(`[prune-pty] removed ${join(conpty, s.name)}`);
    }
  }
} catch {}
