export const SYNC_OPEN = "\x1b[?2026h";
export const SYNC_CLOSE = "\x1b[?2026l";
export const ALT_SCREEN_ENTER = "\x1b[?1049h";
export const ALT_SCREEN_LEAVE = "\x1b[?1049l";
export const DECTCEM_SHOW = "\x1b[?25h";
export const DECTCEM_HIDE = "\x1b[?25l";
export const DECSDM_ON = "\x1b[?12h";
export const DECSDM_OFF = "\x1b[?12l";

export function stripCursorVisibilityModes(chunk: string): string { return chunk.replace(/\x1b\[\?(?:12|25)[hl]/g, ""); }

const CUP_RE = /\x1b\[(\d+);(\d+)H/g;
function scanCups(slice: string, batcher: SyncBatcher, kind: "outside" | "inside"): void {
  const re = new RegExp(CUP_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const row = parseInt(m[1]!, 10), col = parseInt(m[2]!, 10);
    if (row > 0 && col > 0) {
      if (kind === "outside") { batcher.lastOutsideCup = { row, col }; batcher.outsideCupFresh = true; }
      else { batcher.lastBodyCup = { row, col }; batcher.bodyCupFresh = true; }
    }
  }
}

export type TuiEnterMode = "alt" | "sync" | null;
export interface TuiCursorState { tuiRunning: boolean; tuiMode?: TuiEnterMode | null; }
export interface TuiCursorInput { enterMode: TuiEnterMode; altExit: boolean; oscExit: boolean; }
export interface TuiCursorActions { markEntered: boolean; markExited: boolean; restoreBlink: boolean; suppressBlink: boolean; }

export function detectTuiEnter(chunk: string): TuiEnterMode { return chunk.includes(ALT_SCREEN_ENTER) ? "alt" : chunk.includes(SYNC_OPEN) ? "sync" : null; }
export function detectTuiAltExit(chunk: string): boolean { return chunk.includes(ALT_SCREEN_LEAVE); }

export function applyTuiCursorStep(prev: TuiCursorState, input: TuiCursorInput): { next: TuiCursorState; actions: TuiCursorActions } {
  const wasRunning = prev.tuiRunning;
  let tuiRunning = prev.tuiRunning;
  let tuiMode: TuiEnterMode = prev.tuiMode ?? null;
  let markEntered = false;
  if (!tuiRunning && input.enterMode !== null) { tuiRunning = true; tuiMode = input.enterMode; markEntered = true; }
  let markExited = false;
  if (wasRunning && (input.altExit || input.oscExit)) { tuiRunning = false; tuiMode = null; markExited = true; }
  return { next: { tuiRunning, tuiMode }, actions: { markEntered, markExited, restoreBlink: markExited, suppressBlink: markEntered } };
}

export type SyncFlushReason = "close" | "depth" | "length" | "timeout";
export interface SyncBatcher { depth: number; pending: string; lastOutsideCup: { row: number; col: number } | null; lastBodyCup: { row: number; col: number } | null; outsideCupFresh: boolean; bodyCupFresh: boolean; }
export const SYNC_FLUSH_TIMEOUT_MS = 1000;
export const SYNC_FLUSH_MAX_LENGTH = 1 << 20;
export interface SyncBatchResult { emits: string[]; hasOpenFrame: boolean; forceFlushed: SyncFlushReason | null; outsideCupFresh: boolean; chunkHadCup: boolean; }

export function batchSyncFrames(batcher: SyncBatcher, chunk: string): SyncBatchResult {
  const emits: string[] = []; let forceFlushed: SyncFlushReason | null = null;
  batcher.outsideCupFresh = false; batcher.bodyCupFresh = false;
  if (batcher.depth > 0 && batcher.pending.length + chunk.length > SYNC_FLUSH_MAX_LENGTH) {
    forceFlushed = "length";
    const combined = batcher.pending + chunk;
    batcher.depth = 0; batcher.pending = "";
    emits.push(combined);
    scanCups(chunk, batcher, "inside");
    return { emits, hasOpenFrame: false, forceFlushed, outsideCupFresh: batcher.outsideCupFresh, chunkHadCup: batcher.outsideCupFresh || batcher.bodyCupFresh };
  }
  let rest = chunk;
  while (rest.length > 0) {
    if (batcher.depth === 0) {
      const openIdx = rest.indexOf(SYNC_OPEN);
      if (openIdx === -1) { scanCups(rest, batcher, "outside"); emits.push(rest); break; }
      if (openIdx > 0) { const prefix = rest.slice(0, openIdx); scanCups(prefix, batcher, "outside"); emits.push(prefix); }
      batcher.pending += SYNC_OPEN; rest = rest.slice(openIdx + SYNC_OPEN.length); batcher.depth = 1; continue;
    }
    const closeIdx = rest.indexOf(SYNC_CLOSE), nestedIdx = rest.indexOf(SYNC_OPEN);
    if (closeIdx === -1 && nestedIdx === -1) { scanCups(rest, batcher, "inside"); batcher.pending += rest; break; }
    const takeNested = nestedIdx !== -1 && (closeIdx === -1 || nestedIdx < closeIdx);
    if (takeNested) {
      const body = rest.slice(0, nestedIdx);
      scanCups(body, batcher, "inside");
      batcher.pending += body + SYNC_OPEN; rest = rest.slice(nestedIdx + SYNC_OPEN.length); batcher.depth += 1; continue;
    }
    const closeBody = rest.slice(0, closeIdx);
    scanCups(closeBody, batcher, "inside");
    batcher.pending += closeBody + SYNC_CLOSE; rest = rest.slice(closeIdx + SYNC_CLOSE.length);
    if (batcher.depth > 0) batcher.depth -= 1;
    if (batcher.depth === 0) { emits.push(batcher.pending); batcher.pending = ""; }
  }
  return { emits, hasOpenFrame: batcher.depth > 0, forceFlushed, outsideCupFresh: batcher.outsideCupFresh, chunkHadCup: batcher.outsideCupFresh || batcher.bodyCupFresh };
}

export function flushSyncBatcher(batcher: SyncBatcher): { flushed: string | null } {
  if (!batcher.depth && !batcher.pending) return { flushed: null };
  const body = batcher.pending;
  batcher.depth = 0; batcher.pending = "";
  return { flushed: body };
}

export function resolveSyncCloseAnchor(b: SyncBatcher): { row: number; col: number } | null {
  const chunkHadCup = b.outsideCupFresh || b.bodyCupFresh;
  if (b.outsideCupFresh) return b.lastOutsideCup;
  if (chunkHadCup) {
    // Typing heuristic
    if (b.lastBodyCup && (!b.lastOutsideCup || b.lastBodyCup.row === b.lastOutsideCup.row)) return b.lastBodyCup;
    return b.lastOutsideCup;
  }
  if (b.lastBodyCup) {
    // Split stream
    if (b.lastOutsideCup && b.lastBodyCup.row !== b.lastOutsideCup.row) return b.lastOutsideCup;
    return b.lastBodyCup;
  }
  return null;
}