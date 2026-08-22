// PtyService — Backend-side node-pty registry, owned by the Electron main
// process. Holds one pty per paneId, executes the shell-integration spawn
// flow (write a per-spawn temp rc → spawn the user's chosen shell with rc-load
// args → attach onData/onExit), and exposes an event surface
// (onData / onExit, disposer-returning) that the IPC layer forwards to the
// renderer through the FIRST event-channel in the codebase
// (`webContents.send("pty:data" / "pty:exit", ...)`).

import { spawn as ptySpawn, type IPty } from "node-pty";
import { promises as fs } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  buildShellRc,
  detectProfilePath,
  detectShell,
  resolveBinary,
  spawnArgsFor,
  spawnEnv,
  type ShellKind,
} from "./shellIntegration.js";
import type {
  PtyEvent,
  PtySpawnOptions,
  PtySpawnResponse,
} from "./types.js";

export type PtyDataListener = (event: Extract<PtyEvent, { type: "data" }>) => void;
export type PtyExitListener = (event: Extract<PtyEvent, { type: "exit" }>) => void;

export interface PtyServiceOptions {
  /** Override the base directory for the temp shell-integration rc files.
   *  Defaults to os.tmpdir(). */
  readonly tmpBase?: string;
}

interface Session {
  readonly pty: IPty;
  readonly paneId: string;
  readonly shell: ShellKind;
  readonly cwd: string;
  cols: number;
  rows: number;
  readonly rcPath: string | null;
  readonly zdotDir: string | null;
}

export class PtyService {
  private readonly sessions = new Map<string, Session>();
  private readonly dataListeners = new Set<PtyDataListener>();
  private readonly exitListeners = new Set<PtyExitListener>();
  private readonly tmpBase: string;
  private seq = 0;

  constructor(opts: PtyServiceOptions = {}) {
    this.tmpBase = opts.tmpBase ?? tmpdir();
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResponse> {
    // M1 dev diagnostic — remove after the live-pane spawn is verified.
    const _entry = this.sessions.has(opts.paneId);
    console.log(
      `[pty] spawn enter pane=${opts.paneId} cols=${opts.cols}x${opts.rows} existing=${_entry}`,
    );
    if (this.sessions.has(opts.paneId)) {
      throw new Error(`PtyService.spawn: pane already running: ${opts.paneId}`);
    }
    if (opts.cols <= 0 || opts.rows <= 0) {
      throw new Error("PtyService.spawn: cols and rows must be positive");
    }

    const baseEnv = { ...process.env, ...(opts.env ?? {}) };
    const shell = detectShell({
      preference: opts.shellOverride ?? null,
      shellEnv: baseEnv["SHELL"],
      platform: process.platform,
    });
    const home = homedir();
    const profilePath = detectProfilePath(shell, home, process.platform);
    const cwd = opts.cwdOverride ?? home;
    const rcContents = buildShellRc(shell, profilePath);

    let rcPath: string | null = null;
    let zdotDir: string | null = null;
    let args: string[];

    const id = `${process.pid}-${Date.now()}-${this.seq++}`;
    if (rcContents !== "") {
      if (shell === "zsh") {
        // zsh loads <ZDOTDIR>/.zshrc when launched interactive + ZDOTDIR set.
        zdotDir = join(this.tmpBase, `bs-zsh-${id}`);
        await fs.mkdir(zdotDir, { recursive: true });
        rcPath = join(zdotDir, ".zshrc");
        await fs.writeFile(rcPath, rcContents, "utf8");
        args = spawnArgsFor(shell);
      } else {
        // PowerShell's `-File` parameter REFUSES to load any script without a
        // `.ps1` extension — it prints "the file does not have a '.ps1'
        // extension" to the pane and skips our rc entirely, so the user sees
        // the error text + a bare PowerShell prompt with no OSC integration.
        // bash/zsh/sh take any filename via `--rcfile` so only the powershell
        // family needs the extension.
        const ext = shell === "pwsh" || shell === "powershell" ? ".ps1" : "";
        rcPath = join(this.tmpBase, `bs-${shell}-${id}${ext}`);
        await fs.writeFile(rcPath, rcContents, "utf8");
        args = spawnArgsFor(shell, rcPath);
      }
    } else {
      // No integration (e.g. cmd): plain interactive spawn.
      args = spawnArgsFor(shell);
    }

    const env = spawnEnv({ shell, baseEnv, zdotDir });
    const binary = resolveBinary(shell, opts.shellOverride ?? null, process.platform);
    console.log(
      `[pty] ${opts.paneId} spawn binary=${binary} args=${JSON.stringify(args)}`,
    );

    let pty;
    try {
      pty = ptySpawn(binary, args, {
        cols: opts.cols,
        rows: opts.rows,
        cwd,
        env: env as { [key: string]: string },
        name: "xterm-256color",
      });
    } catch (e) {
      console.error(`[pty] ${opts.paneId} ptySpawn threw:`, e);
      throw e;
    }

    const session: Session = {
      pty,
      paneId: opts.paneId,
      shell,
      cwd,
      cols: opts.cols,
      rows: opts.rows,
      rcPath,
      zdotDir,
    };
    this.sessions.set(opts.paneId, session);

    const paneId = opts.paneId;
    pty.onData((data) => {
      const evt: Extract<PtyEvent, { type: "data" }> = { paneId, type: "data", data };
      for (const listener of this.dataListeners) listener(evt);
    });
    pty.onExit(({ exitCode, signal }) => {
      // M1 dev diagnostic — surface every pane death's exitCode + signal so a
      // pane dying silently (ConPTY glitch, PS panic, stray ptyKill racing the
      // spawn) shows in the main log instead of just disappearing from /tmp.
      console.log(
        `[pty] ${paneId} EXIT exitCode=${exitCode} signal=${signal ?? "<none>"} rc=${
          session.rcPath ?? "<none>"
        }`,
      );
      const evt: Extract<PtyEvent, { type: "exit" }> = {
        paneId,
        type: "exit",
        exitCode,
      };
      for (const listener of this.exitListeners) listener(evt);
      this.sessions.delete(paneId);
      void this.cleanupFiles(session);
    });

    console.log(`[pty] ${opts.paneId} registered ok shell=${shell}`);
    return {
      paneId,
      shell,
      cols: opts.cols,
      rows: opts.rows,
      cwd,
    };
  }

  async write(paneId: string, data: string): Promise<void> {
    this.requireSession(paneId).pty.write(data);
  }

  async resize(paneId: string, cols: number, rows: number): Promise<void> {
    if (cols <= 0 || rows <= 0) {
      throw new Error("PtyService.resize: cols and rows must be positive");
    }
    const session = this.requireSession(paneId);
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }

  async kill(paneId: string): Promise<void> {
    // M1 dev diagnostic — track which path drives the next pane death. A
    // `[pty] <id> KILL ...` line followed by `[pty] <id> EXIT ...` means the
    // renderer's TerminalPane cleanup killed an in-flight session; an EXIT
    // with no preceding KILL means the PTY died on its own (e.g. `exit`
    // typed, profile load crashed, or a ConPTY glitch closed the handle).
    console.log(
      `[pty] ${paneId} KILL enter hasSession=${this.sessions.has(paneId)}`,
    );
    const session = this.sessions.get(paneId);
    if (!session) return;
    try {
      session.pty.kill();
    } catch {
      // node-pty throws if the process already exited; swallow on shutdown.
    }
    this.sessions.delete(paneId);
    void this.cleanupFiles(session);
  }

  disposeAll(): void {
    for (const session of [...this.sessions.values()]) {
      try {
        session.pty.kill();
      } catch {
        // Best-effort during shutdown.
      }
      void this.cleanupFiles(session);
    }
    this.sessions.clear();
    this.dataListeners.clear();
    this.exitListeners.clear();
  }

  onData(listener: PtyDataListener): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onExit(listener: PtyExitListener): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  size(): number {
    return this.sessions.size;
  }

  has(paneId: string): boolean {
    return this.sessions.has(paneId);
  }

  snapshot(paneId: string): {
    shell: ShellKind;
    cols: number;
    rows: number;
    cwd: string;
  } | null {
    const session = this.sessions.get(paneId);
    if (!session) return null;
    return {
      shell: session.shell,
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
    };
  }

  private requireSession(paneId: string): Session {
    const session = this.sessions.get(paneId);
    if (!session) {
      throw new Error(`PtyService: no session for pane "${paneId}"`);
    }
    return session;
  }

  private async cleanupFiles(session: Session): Promise<void> {
    if (session.zdotDir) {
      await fs.rm(session.zdotDir, { recursive: true, force: true }).catch(() => {});
    } else if (session.rcPath) {
      await fs.rm(session.rcPath, { force: true }).catch(() => {});
    }
  }
}
