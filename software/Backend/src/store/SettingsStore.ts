import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type Settings } from "../types.js";

export interface SettingsStoreOptions { path: string; overrides?: Partial<Settings>; }

export class SettingsStore {
  private readonly file: string;
  private readonly overrides: Partial<Settings>;
  private cache: Settings = structuredClone({ ...DEFAULT_SETTINGS } as Settings);
  private loaded = false;
  private loading: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(opts: SettingsStoreOptions) {
    this.file = opts.path;
    this.overrides = opts.overrides ?? {};
    this.cache = structuredClone({ ...DEFAULT_SETTINGS, ...this.overrides } as Settings);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = this.readFromDisk().then((s) => { this.cache = s; this.loaded = true; }).finally(() => { this.loading = null; });
    return this.loading;
  }

  getAll(): Settings { return structuredClone(this.cache); }
  get<K extends keyof Settings>(key: K): Settings[K] { return structuredClone(this.cache[key]) as Settings[K]; }

  async update(partial: Partial<Settings>): Promise<Settings> {
    await this.ensureLoaded();
    const clean = sanitizePartial(partial as unknown as Record<string, unknown>);
    this.cache = { ...this.cache, ...clean };
    await this.enqueueWrite();
    return this.getAll();
  }

  async reset(): Promise<Settings> {
    this.cache = structuredClone({ ...DEFAULT_SETTINGS, ...this.overrides } as Settings);
    await this.enqueueWrite();
    return this.getAll();
  }

  private enqueueWrite(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.writeToDisk(), () => this.writeToDisk());
    return this.writeQueue;
  }

  private async readFromDisk(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError("invalid settings");
      const clean = sanitizePartial(parsed as Record<string, unknown>);
      return { ...DEFAULT_SETTINGS, ...this.overrides, ...clean };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return structuredClone({ ...DEFAULT_SETTINGS, ...this.overrides } as Settings);
      console.error(`[settings] read failed (${code ?? "unknown"}):`, err, "— resetting to defaults");
      return structuredClone({ ...DEFAULT_SETTINGS, ...this.overrides } as Settings);
    }
  }

  private async writeToDisk(): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), "utf8");
      await fs.rename(tmp, this.file);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }
}

function sanitizePartial(obj: Record<string, unknown>): Partial<Settings> {
  const allowed = new Set([
    "theme",
    "activeWorkspaceTabId",
    "shell",
    "fontFamily",
    "fontSize",
    "scrollbackLines",
    "lastCwd",
    "workspace",
    "savedLayouts",
    "userName",
    "installId",
  ]);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (!allowed.has(k)) continue;
    out[k] = obj[k];
  }
  return out as Partial<Settings>;
}