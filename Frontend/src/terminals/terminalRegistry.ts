// Per-pane terminal-instance registry. xterm's `Terminal` is a heavy,
// non-serialisable object — too expensive to sit inside the reactive
// Zustand store (which is meant for the small bits the chrome + sbar
// re-render on). Instead, `TerminalPane` registers the instance here
// when it opens + unregisters on teardown; the pane chrome's `Copy`
// button looks the instance up by paneId to lift the visible buffer
// text onto the clipboard for downstream paste + triage.
//
// A `Map` is fine — entries live exactly as long as the pane mounts,
// no listeners, no subscription.

import type { Terminal } from "@xterm/xterm";

const terminals = new Map<string, Terminal>();

export function registerTerminal(paneId: string, term: Terminal): void {
  terminals.set(paneId, term);
}

export function unregisterTerminal(paneId: string): void {
  terminals.delete(paneId);
}

export function getTerminal(paneId: string): Terminal | undefined {
  return terminals.get(paneId);
}

/** Lift the pane's entire current-buffer text as a single `\n`-joined
 *  string. `translateToString(true)` trims trailing whitespace per line —
 *  xterm fills bg-styled empty trailing cells with spaces, which would
 *  balloon the copied text + fire spurious horizontal scrollbars on paste.
 *  The active buffer points at either the primary scrollback (PowerShell
 *  idle) or the alt-screen buffer (a full-screen TUI), so the user copies
 *  whatever they're currently staring at. */
export function paneBufferToText(paneId: string): string | null {
  const term = terminals.get(paneId);
  if (!term) return null;
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    lines.push(line.translateToString(true));
  }
  // Drop trailing fully-empty lines — alt-screen buffers pad the bottom
  // with blank rows up to the viewport height; keeping them just adds
  // a wall of empty lines below the meaningful text on paste.
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end -= 1;
  return lines.slice(0, end).join("\n");
}
