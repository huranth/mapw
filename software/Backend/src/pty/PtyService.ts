import { spawn as ptySpawn, type IPty } from "node-pty";
import { promises as fs } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildShellRc, detectProfilePath, detectShell, resolveBinary, spawnArgsFor, spawnEnv, type ShellKind } from "./shellIntegration.js";
import type { PtyEvent, PtySpawnOptions, PtySpawnResponse } from "./types.js";

export type PtyDataListener = (event: Extract<PtyEvent, { type: "data" }>) => void;
export type PtyExitListener = (event: Extract<PtyEvent, { type: "exit" }>) => void;
export interface PtyServiceOptions { readonly tmpBase?: string; }

interface Session { readonly pty: IPty; readonly paneId: string; readonly shell: ShellKind; readonly cwd: string; cols: number; rows: number; readonly rcPath: string | null; readonly zdotDir: string | null; readonly gen: number; }

export class PtyService {
  private readonly sessions = new Map<string, Session>();
  private readonly generations = new Map<string, number>();
  private readonly dataListeners = new Set<PtyDataListener>();
  private readonly exitListeners = new Set<PtyExitListener>();
  private readonly tmpBase: string;
  constructor(opts: PtyServiceOptions = {}) { this.tmpBase = opts.tmpBase ?? tmpdir(); }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResponse> {
    if (!opts.paneId || typeof opts.paneId !== "string" || opts.paneId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(opts.paneId)) throw new Error("PtyService.spawn: invalid paneId");
    if (this.sessions.has(opts.paneId)) throw new Error(`PtyService.spawn: pane already running: ${opts.paneId}`);
    if (!Number.isInteger(opts.cols) || !Number.isInteger(opts.rows) || opts.cols <= 0 || opts.rows <= 0 || opts.cols > 1000 || opts.rows > 1000) throw new Error("PtyService.spawn: cols and rows must be positive integers");

    const SAFE_ENV_KEYS = new Set(["TERM","COLORTERM","PATH","PATHEXT","WINDIR","ProgramFiles","ProgramFiles(x86)","USERPROFILE","HOME","HOMEDRIVE","HOMEPATH","LANG","LC_ALL","LC_CTYPE","SHELL","USER","LOGNAME","TMP","TEMP","TMPDIR","COMSPEC","SYSTEMROOT","NUMBER_OF_PROCESSORS","OS"]);
    const BLOCKED_ENV_OVERRIDE = new Set(["PATH","PATHEXT","WINDIR","SYSTEMROOT","COMSPEC","ProgramFiles","ProgramFiles(x86)","USERPROFILE","HOME","TMP","TEMP","TMPDIR","WINDIR"]);
    const baseEnv: NodeJS.ProcessEnv = {};
    for (const k of SAFE_ENV_KEYS) if (process.env[k] != null) baseEnv[k] = process.env[k]!;
    if (opts.env) for (const [k, v] of Object.entries(opts.env)) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !BLOCKED_ENV_OVERRIDE.has(k) && !/^SUPABASE_|^OPENAI_|^DEVICE_HEARTBEAT/.test(k) && typeof v === "string" && v.length < 4096) baseEnv[k] = v;

    const shell = detectShell({ preference: opts.shellOverride ?? null, shellEnv: baseEnv["SHELL"], platform: process.platform });
    const home = homedir() || "/";
    const cwdRaw = opts.cwdOverride?.trim();
    const cwd = cwdRaw && isAbsolute(cwdRaw) ? cwdRaw : home;
    const rcContents = buildShellRc(shell, detectProfilePath(shell, home, process.platform));

    let rcPath: string | null = null; let zdotDir: string | null = null; let args: string[];
    const id = randomUUID();
    try {
      if (rcContents !== "") {
        if (shell === "zsh") {
          zdotDir = join(this.tmpBase, `mapw-zsh-${id}`);
          await fs.mkdir(zdotDir, { recursive: true });
          rcPath = join(zdotDir, ".zshrc");
          await fs.writeFile(rcPath, rcContents, "utf8");
          args = spawnArgsFor(shell);
        } else {
          const ext = shell === "pwsh" || shell === "powershell" ? ".ps1" : "";
          rcPath = join(this.tmpBase, `mapw-${shell}-${id}${ext}`);
          await fs.writeFile(rcPath, rcContents, "utf8");
          args = spawnArgsFor(shell, rcPath);
        }
      } else args = spawnArgsFor(shell);

      const env = spawnEnv({ shell, baseEnv, zdotDir });
      const filteredEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) if (typeof v === "string") filteredEnv[k] = v;
      const binary = resolveBinary(shell, opts.shellOverride ?? null, process.platform);
      const pty = ptySpawn(binary, args, { cols: opts.cols, rows: opts.rows, cwd, env: filteredEnv, name: "xterm-256color" });

      if (this.sessions.has(opts.paneId)) { try { pty.kill(); } catch {} await this.cleanupFiles({ rcPath, zdotDir }); throw new Error(`PtyService.spawn: pane already running: ${opts.paneId}`); }

      const gen = (this.generations.get(opts.paneId) ?? 0) + 1;
      this.generations.set(opts.paneId, gen);
      const session: Session = { pty, paneId: opts.paneId, shell, cwd, cols: opts.cols, rows: opts.rows, rcPath, zdotDir, gen };
      this.sessions.set(opts.paneId, session);

      pty.onData((data) => {
        if (this.generations.get(opts.paneId) !== gen) return;
        const evt: Extract<PtyEvent, { type: "data" }> = { paneId: opts.paneId, type: "data", data };
        for (const l of this.dataListeners) l(evt);
      });
      pty.onExit(({ exitCode }) => {
        const liveGen = this.generations.get(opts.paneId);
        if (liveGen !== gen) { void this.cleanupFiles(session); return; }
        const evt: Extract<PtyEvent, { type: "exit" }> = { paneId: opts.paneId, type: "exit", exitCode };
        for (const l of this.exitListeners) l(evt);
        this.sessions.delete(opts.paneId);
        this.generations.delete(opts.paneId);
        void this.cleanupFiles(session);
      });
      return { paneId: opts.paneId, shell, cols: opts.cols, rows: opts.rows, cwd };
    } catch (e) {
      await this.cleanupFiles({ rcPath, zdotDir });
      throw e;
    }
  }

  async write(paneId: string, data: string): Promise<void> {
    if (typeof data !== "string" || data.length > 1_000_000) throw new Error("pty write data too large");
    this.requireSession(paneId).pty.write(data);
  }

  async resize(paneId: string, cols: number, rows: number): Promise<void> {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0 || cols > 1000 || rows > 1000) throw new Error("PtyService.resize: cols and rows must be positive integers");
    const s = this.requireSession(paneId);
    s.pty.resize(cols, rows); s.cols = cols; s.rows = rows;
  }

  async kill(paneId: string): Promise<void> {
    const s = this.sessions.get(paneId);
    if (!s) return;
    this.generations.set(paneId, (this.generations.get(paneId) ?? 0) + 1);
    try { s.pty.kill(); } catch {}
    this.sessions.delete(paneId);
    void this.cleanupFiles(s);
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    for (const s of [...this.sessions.values()]) { try { s.pty.kill(); } catch {} void this.cleanupFiles(s); }
    this.sessions.clear(); this.generations.clear(); this.dataListeners.clear(); this.exitListeners.clear();
  }

  onData(l: PtyDataListener): () => void { this.dataListeners.add(l); return () => this.dataListeners.delete(l); }
  onExit(l: PtyExitListener): () => void { this.exitListeners.add(l); return () => this.exitListeners.delete(l); }
  size(): number { return this.sessions.size; }
  has(paneId: string): boolean { return this.sessions.has(paneId); }
  snapshot(paneId: string): { shell: ShellKind; cols: number; rows: number; cwd: string } | null {
    const s = this.sessions.get(paneId);
    return s ? { shell: s.shell, cols: s.cols, rows: s.rows, cwd: s.cwd } : null;
  }
  private requireSession(paneId: string): Session {
    const s = this.sessions.get(paneId);
    if (!s) throw new Error(`PtyService: no session for pane "${paneId}"`);
    return s;
  }
  private async cleanupFiles(f: Pick<Session, "rcPath" | "zdotDir">): Promise<void> {
    if (f.zdotDir) await fs.rm(f.zdotDir, { recursive: true, force: true }).catch(() => {});
    else if (f.rcPath) await fs.rm(f.rcPath, { force: true }).catch(() => {});
  }
}
