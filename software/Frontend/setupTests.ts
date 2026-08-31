import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import type { Bridge } from "@/bridge/types";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type PtySpawnOptions,
  type PtySpawnResponse,
} from "@bridgespace/backend/renderer";

// ---------------------------------------------------------------------------
// xterm + addons — global jsdom mock.
// The renderer instantiates a real xterm `Terminal` for every pane. Under
// jsdom there is no canvas / GL context, so we mock the public surface each
// pane actually calls (parser.registerOscHandler, onData, registerMarker,
// loadAddon, open, dispose, options.*) and have addons expose cheap stubs.
// `__last()` hands tests the most recently created mock so they can assert on
// `term.write` / `term.writeln` invocations without reaching into xterm.
// ---------------------------------------------------------------------------

const xtermMock = vi.hoisted(() => {
  function makeMockTerminal() {
    const dataListeners = new Set<(data: string) => void>();
    const oscHandlers = new Map<number, (data: string) => boolean | void>();
    return {
      cols: 80,
      rows: 24,
      element: null as HTMLElement | null,
      textarea: null as HTMLTextAreaElement | null,
      buffer: {
        active: {
          baseY: 0,
          length: 24,
          getLine: () => ({
            isWrapped: false,
            translateToString: () => "",
          }),
        },
      },
      options: {} as Record<string, unknown>,
      parser: {
        // NOTE: xterm@6's `registerOscHandler(ident: number, …)` keys by number.
        registerOscHandler: vi.fn(
          (code: number, h: (data: string) => boolean | void) => {
            oscHandlers.set(code, h);
            return { dispose: () => oscHandlers.delete(code) };
          },
        ),
      },
      onData: vi.fn((cb: (data: string) => void) => ({
        dispose: () => dataListeners.delete(cb),
      })),
      write: vi.fn(),
      writeln: vi.fn(),
      open: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
      registerMarker: vi.fn(() => ({ dispose: vi.fn(), line: 0 })),
      loadAddon: vi.fn(),
      // xterm@6's IUnicodeHandling exposes `activeVersion: string` (NOT
      // `activeVariant`); the Unicode11Addon registers version "11".
      unicode: { activeVersion: "11", versions: ["6", "11"] },
    };
  }
  const instances: ReturnType<typeof makeMockTerminal>[] = [];
  return { makeMockTerminal, instances };
});

vi.mock("@xterm/xterm", () => ({
  // A function expression whose body RETURNS an object ⇒ ES `new` semantics
  // uses that object as the constructed instance. No `this` annotations
  // (which would trip `Object is of type 'unknown'` under strict mode).
  Terminal: vi.fn(function (options?: Record<string, unknown>) {
    const t = xtermMock.makeMockTerminal();
    Object.assign(t.options, options ?? {});
    xtermMock.instances.push(t);
    return t;
  }),
  __last: () => xtermMock.instances[xtermMock.instances.length - 1],
  __reset: () => {
    xtermMock.instances.length = 0;
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function () {
    return {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
      dispose: vi.fn(),
    };
  }),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn(function () {
    return {
      onContextLoss: vi.fn((cb: () => void) => {
        // hold the cb so a test could trigger it if needed; we never do.
        void cb;
        return () => undefined;
      }),
      dispose: vi.fn(),
    };
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(function () {
    return { dispose: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: vi.fn(function () {
    return { dispose: vi.fn() };
  }),
}));

// ---------------------------------------------------------------------------
// Bridge factory.
// Starting from a FULL Bridge (rather than `{ base, ...partial }`) so a
// `Partial<Bridge>` override doesn't downgrade required props to `| undefined`
// — that downgrade is what broke the pre-resume typecheck. Tests override only
// the slice they assert on; everything else stays a no-op / echo default.
// ---------------------------------------------------------------------------
export function makeTestBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    getSettings:
      overrides.getSettings ??
      (async () => ({ settings: { ...DEFAULT_SETTINGS } })),
    updateSettings:
      overrides.updateSettings ??
      (async (partial: Partial<Settings>) => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      })),
    openDirectoryDialog:
      overrides.openDirectoryDialog ??
      // Default: canceled — a test that doesn't opt-in is asserting only on
      // the 4 boot seeds, not on the New Terminal flow. Tests that want the
      // picker to "pick" a folder override this with a non-canceled result.
      (async () => ({ canceled: true, filePaths: [] })),
    detectCliTools:
      overrides.detectCliTools ??
      // Default: empty curated list — a test that doesn't opt-in is asserting
      // on the raw-pane boot path, not on the chip strip's CLI list. Tests
      // that exercise the chip strip override this with a non-empty result.
      (async () => ({ tools: [] })),
    whoami: overrides.whoami ?? (async () => "tester"),
    checkForUpdates: overrides.checkForUpdates ?? (async () => undefined),
    onUpdateStatus:
      overrides.onUpdateStatus ??
      (() => {
        return () => undefined;
      }),
    ptySpawn:
      overrides.ptySpawn ??
      (async (opts: PtySpawnOptions): Promise<PtySpawnResponse> => ({
        paneId: opts.paneId,
        shell: "pwsh",
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwdOverride ?? "/home/test",
      })),
    ptyWrite: overrides.ptyWrite ?? (async () => undefined),
    ptyResize: overrides.ptyResize ?? (async () => undefined),
    ptyKill: overrides.ptyKill ?? (async () => undefined),
    onPtyData: overrides.onPtyData ?? (() => () => undefined),
    onPtyExit: overrides.onPtyExit ?? (() => () => undefined),
  };
}

// Install a default in-memory bridge so renderer tests that don't care about
// wiring don't need to mock anything; individual tests can overwrite
// window.bridge with `makeTestBridge({ ...overrides })`.
const w = window as unknown as { bridge?: Bridge };
if (!w.bridge) w.bridge = makeTestBridge();

// jsdom ships no ResizeObserver; TerminalPane's fit-on-resize path relies on
// it. A no-op stub is enough — TerminalPane triggers an immediate `fit()` in
// the spawn `then` callback, so panes still receive an initial geometry.
class ResizeObserverStub {
  observe(): void {
    // no-op
  }
  unobserve(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}
(window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
