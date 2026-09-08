import type { Terminal } from "@xterm/xterm";
const terminals = new Map<string, Terminal>();
export function registerTerminal(paneId: string, term: Terminal): void { terminals.set(paneId, term); }
export function unregisterTerminal(paneId: string): void { terminals.delete(paneId); }
export function paneBufferToText(paneId: string): string | null {
  const term = terminals.get(paneId);
  if (!term) return null;
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) { const line = buf.getLine(i); if (line) lines.push(line.translateToString(true)); }
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end -= 1;
  const text = lines.slice(0, end).join("\n");
  return text.length ? text : null;
}