
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { parseOscPayload } from "@bridgespace/backend/renderer";
import { useSettingsStore } from "@/stores/settings";
import { useCliToolsStore } from "@/stores/cliTools";
import { useTheme } from "@/themes";
import { useTerminalsStore } from "@/stores/terminals";
import { toXtermTheme } from "./toXtermTheme";
import { applyTuiCursorStep, batchSyncFrames, detectTuiAltExit, detectTuiEnter, flushSyncBatcher, resolveSyncCloseAnchor, stripCursorVisibilityModes, SYNC_CLOSE, SYNC_FLUSH_TIMEOUT_MS, SYNC_OPEN, type SyncBatcher, type TuiCursorState } from "./syncBatcher";
import { disposeBlockModel, handleOscEvent } from "./blockModel";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";
import { useUsageStore } from "@/stores/usage";

const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;
const MONO_FALLBACK = ', ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const RESIZE_DEBOUNCE_MS = 200;

export interface TerminalPaneProps {
  readonly paneId: string;
  
  readonly cwd?: string | null;
  
  readonly cliId?: string | null;
}

export function TerminalPane({ paneId, cwd, cliId }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fontFamily = useSettingsStore((s) => s.settings.fontFamily);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const scrollbackLines = useSettingsStore((s) => s.settings.scrollbackLines);
  const lastCwd = useSettingsStore((s) => s.settings.lastCwd);

  const { theme } = useTheme();

  const register = useTerminalsStore((s) => s.register);
  const unregister = useTerminalsStore((s) => s.unregister);
  const markSpawned = useTerminalsStore((s) => s.markSpawned);
  const markExited = useTerminalsStore((s) => s.markExited);
  const markTuiEntered = useTerminalsStore((s) => s.markTuiEntered);
  const markTuiExited = useTerminalsStore((s) => s.markTuiExited);
  const setBlockModel = useTerminalsStore((s) => s.setBlockModel);
  const setCwd = useTerminalsStore((s) => s.setCwd);
  const pane = useTerminalsStore((s) => s.panes[paneId]);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const aliveRef = useRef(false);
  const spawnedRef = useRef(false);
  const tuiCursorStateRef = useRef<TuiCursorState>({ tuiRunning: false, tuiMode: null });
  const autoLaunchedRef = useRef(false);
  const cliIdRef = useRef<string | null>(cliId ?? null);
  cliIdRef.current = cliId ?? null;
  const tuiExitRequestedRef = useRef(false);
  const syncBatcherRef = useRef<SyncBatcher>({
    depth: 0,
    pending: "",
    lastOutsideCup: null,
    lastBodyCup: null,
    outsideCupFresh: false,
    bodyCupFresh: false,
  });
  const syncFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const promptSeenRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      fontFamily: `${fontFamily}${MONO_FALLBACK}`,
      fontSize,
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: scrollbackLines,
      convertEol: false,
      macOptionIsMeta: true,
      theme: toXtermTheme(theme.tokens),
      allowProposedApi: true,
      cursorBlink: true,
    });
    terminal.open(host);
    termRef.current = terminal;
    aliveRef.current = true;
    registerTerminal(paneId, terminal);

    const fit = new FitAddon();
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";

    const onOsc133 = (data: string): boolean => {
      const event = parseOscPayload(`133;${data}`);
      if (event) {
        if (
          tuiCursorStateRef.current.tuiRunning &&
          (event.type === "commandEnd" || event.type === "promptStart")
        ) {
          tuiExitRequestedRef.current = true;
        }
        const prompt =
          event.type === "promptStart" ? terminal.registerMarker(0) : null;
        const exit =
          event.type === "commandEnd" ? terminal.registerMarker(0) : null;
      if (event.type === "promptStart") {
        promptSeenRef.current = true;
      } else if (event.type === "commandEnd" && promptSeenRef.current) {
        try { useUsageStore.getState().recordCommand(1); } catch {}
      }
      setBlockModel(paneId, (m) => handleOscEvent(m, event, { prompt, exit }));
      }
      return true;
    };
    const onOsc7 = (data: string): boolean => {
      const event = parseOscPayload(`7;${data}`);
      if (event && event.type === "cwd") {
        setCwd(paneId, event.path, event.hostname);
        setBlockModel(paneId, (m) => handleOscEvent(m, event));
      }
      return true;
    };
    terminal.parser.registerOscHandler(133, onOsc133);
    terminal.parser.registerOscHandler(7, onOsc7);

    const disposeOnData = terminal.onData((data) => {
      void window.bridge.ptyWrite(paneId, data);
    });

    const disposePtyData = window.bridge.onPtyData((evt) => {
      if (evt.paneId !== paneId) return;
      const chunkRaw = evt.data;

      const enterMode = detectTuiEnter(chunkRaw);
      const altExit = detectTuiAltExit(chunkRaw);

      const curIsSync = tuiCursorStateRef.current.tuiMode === "sync";
      const enteringSync = enterMode === "sync" && !tuiCursorStateRef.current.tuiRunning;
      const shouldStrip = curIsSync || enteringSync;
      const chunk = shouldStrip
        ? stripCursorVisibilityModes(chunkRaw)
        : chunkRaw;

      const depthBefore = syncBatcherRef.current.depth;
      const batched = batchSyncFrames(syncBatcherRef.current, chunk);

      if (batched.hasOpenFrame) {
        if (syncFlushTimerRef.current) clearTimeout(syncFlushTimerRef.current);
        syncFlushTimerRef.current = setTimeout(() => {
          syncFlushTimerRef.current = null;
          const { flushed } = flushSyncBatcher(syncBatcherRef.current);
          if (flushed) terminal.write(flushed);
        }, SYNC_FLUSH_TIMEOUT_MS);
      } else if (syncFlushTimerRef.current) {
        clearTimeout(syncFlushTimerRef.current);
        syncFlushTimerRef.current = null;
      }

      const shouldHandleSync =
        tuiCursorStateRef.current.tuiRunning || enterMode !== null;
      if (
        shouldHandleSync && (depthBefore > 0 || chunk.includes(SYNC_OPEN))
      ) {
        (terminal as unknown as { write(data: string): void }).write("\u001b[?25l");
      }

      tuiExitRequestedRef.current = false;
      for (const out of batched.emits) terminal.write(out);
      const oscExit = tuiExitRequestedRef.current;

      const { next, actions } = applyTuiCursorStep(
        tuiCursorStateRef.current,
        { enterMode, altExit, oscExit },
      );
      tuiCursorStateRef.current = next;

      if (actions.markEntered) markTuiEntered(paneId);
      if (actions.markExited) markTuiExited(paneId);
      if (shouldHandleSync && batched.emits.some((e) => e.includes(SYNC_CLOSE))) {
        const anchor = resolveSyncCloseAnchor(syncBatcherRef.current);
        const seq = anchor ? `\u001b[${anchor.row};${anchor.col}H\u001b[?25h` : "\u001b[?25h";
        (terminal as unknown as { write(data: string): void }).write(seq);
      }
      if (actions.restoreBlink) {
        (terminal as unknown as { write(data: string): void }).write("\u001b[?25h");
        terminal.options.cursorBlink = true;
      }
    });
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!aliveRef.current || !spawnedRef.current || !fitRef.current || !termRef.current) return;
        try {
          fitRef.current.fit();
        } catch {
        }
        const t = termRef.current;
        if (!t) return;
        const last = lastResizeRef.current;
        if (last && last.cols === t.cols && last.rows === t.rows) return;
        lastResizeRef.current = { cols: t.cols, rows: t.rows };
        void window.bridge.ptyResize(paneId, t.cols, t.rows).catch(() => {});
      }, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(host);

    const disposePtyExit = window.bridge.onPtyExit((evt) => {
      if (evt.paneId !== paneId) return;
      markExited(paneId, evt.exitCode);
      aliveRef.current = false;
      spawnedRef.current = false;
      if (resizeTimer) {
        clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      try {
        ro.disconnect();
      } catch {
      }
    });

    register(paneId);
    const term = terminal;

    let spawnCols = INITIAL_COLS;
    let spawnRows = INITIAL_ROWS;
    try {
      fit.fit();
      if (term.cols > 0 && term.rows > 0) {
        spawnCols = term.cols;
        spawnRows = term.rows;
      }
    } catch {
    }

    const resolvedCwd = cwd ?? lastCwd ?? null;
    void window.bridge
      .ptySpawn({
        paneId,
        cols: spawnCols,
        rows: spawnRows,
        cwdOverride: resolvedCwd,
      })
      .then((res) => {
        if (!aliveRef.current || termRef.current !== term) return;
        markSpawned(paneId, res.shell, res.cwd);
        spawnedRef.current = true;
        if (!autoLaunchedRef.current && cliIdRef.current != null) {
          autoLaunchedRef.current = true;
          const tool = useCliToolsStore
            .getState()
            .cliTools.find((c) => c.id === cliIdRef.current);
          if (tool) {
            void window.bridge.ptyWrite(paneId, `${tool.launchCommand}\r`);
          } else {
            (terminal as unknown as { writeln(data: string): void }).writeln(
              `\x1b[33m[mapw] layout CLI "${cliIdRef.current}" not installed; pane is in raw shell.\x1b[0m`,
            );
          }
        }
        try {
          fit.fit();
        } catch {
        }
        if (term.cols !== spawnCols || term.rows !== spawnRows) {
          void window.bridge.ptyResize(paneId, term.cols, term.rows).catch(() => {});
        }
        lastResizeRef.current = { cols: term.cols, rows: term.rows };
        term.focus();
      })
      .catch((err: unknown) => {
        if (aliveRef.current) {
          terminal.writeln(
            `\x1b[31m[mapw] pty spawn failed: ${(err as Error).message}\x1b[0m`,
          );
        }
        markExited(paneId, -1);
      });

    return () => {
      aliveRef.current = false;
      spawnedRef.current = false;
      if (syncFlushTimerRef.current) {
        clearTimeout(syncFlushTimerRef.current);
        syncFlushTimerRef.current = null;
      }
      syncBatcherRef.current = {
        depth: 0,
        pending: "",
        lastOutsideCup: null,
        lastBodyCup: null,
        outsideCupFresh: false,
        bodyCupFresh: false,
      };
      tuiCursorStateRef.current = { tuiRunning: false, tuiMode: null };
      tuiExitRequestedRef.current = false;
      try {
        (terminal as unknown as { write(data: string): void }).write("\x1b[?25h");
        terminal.options.cursorBlink = true;
      } catch {
      }
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      disposeOnData.dispose();
      disposePtyData();
      disposePtyExit();
      void window.bridge.ptyKill(paneId);
      setBlockModel(paneId, (m) => {
        disposeBlockModel(m);
        return m;
      });
      try {
        terminal.dispose();
      } catch {
      }
      termRef.current = null;
      fitRef.current = null;
      unregisterTerminal(paneId);
      unregister(paneId);
    };
  }, [paneId]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = toXtermTheme(theme.tokens);
  }, [theme]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontFamily = `${fontFamily}${MONO_FALLBACK}`;
    termRef.current.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
    }
    const t = termRef.current;
    if (t && aliveRef.current && spawnedRef.current) {
      const last = lastResizeRef.current;
      if (!last || last.cols !== t.cols || last.rows !== t.rows) {
        lastResizeRef.current = { cols: t.cols, rows: t.rows };
        void window.bridge.ptyResize(paneId, t.cols, t.rows).catch(() => {});
      }
    }
  }, [fontFamily, fontSize]);

  const blocks = pane?.blockModel.blocks ?? [];
  const lastClosed = [...blocks].reverse().find((b) => b.status === "closed");
  const chipState = !pane?.alive
    ? "dead"
    : lastClosed
      ? lastClosed.exitCode === 0
        ? "ok"
        : "err"
      : "ready";
  const chipText = !pane?.alive
    ? `EXIT ${pane?.exitCode ?? 0}`
    : lastClosed
      ? `→ ${lastClosed.exitCode ?? "?"}`
      : "ready";

  return (
    <div
      className="pane"
      data-testid={`pane-${paneId}`}
      data-pane-id={paneId}
      data-state={chipState}
    >
      <div className="pane__host" ref={hostRef} />
      <span className="pane__chip" data-state={chipState} aria-hidden="true">
        {chipText}
      </span>
    </div>
  );
}