import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_SETTINGS,
  type Settings,
} from "../types.js";

export interface SettingsStoreOptions {
  /** Absolute path to the JSON store file. Created on first set() if missing. */
  path: string;
  /** Merged on top of DEFAULT_SETTINGS; reserved for migration overrides. */
  overrides?: Partial<Settings>;
}

export class SettingsStore {
  private readonly file: string;
  private readonly overrides: Partial<Settings>;
  private cache: Settings;
  private loaded = false;

  constructor(opts: SettingsStoreOptions) {
    this.file = opts.path;
    this.overrides = opts.overrides ?? {};
    this.cache = { ...DEFAULT_SETTINGS, ...this.overrides };
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.cache = await this.readFromDisk();
    this.loaded = true;
  }

  getAll(): Settings {
    return { ...this.cache };
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.cache[key];
  }

  async update(partial: Partial<Settings>): Promise<Settings> {
    this.cache = { ...this.cache, ...partial };
    await this.writeToDisk();
    return this.getAll();
  }

  async reset(): Promise<Settings> {
    this.cache = { ...DEFAULT_SETTINGS, ...this.overrides };
    await this.writeToDisk();
    return this.getAll();
  }

  private async readFromDisk(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...this.overrides, ...parsed };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { ...DEFAULT_SETTINGS, ...this.overrides };
      }
      throw err;
    }
  }

  private async writeToDisk(): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), "utf8");
    await fs.rename(tmp, this.file);
  }
}
