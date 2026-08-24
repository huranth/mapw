import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
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
  // Cluster 4b — serialize on-disk writes via a single chained promise so two
  // concurrent `settings:update` IPCs (TerminalCanvas's 400 ms-debounced
  // skeleton write chasing a `saveCurrentLayout`'s `update({savedLayouts})`)
  // don't race their `writeFile(tmp)`/`rename(tmp,this.file)` pairs against
  // each other. The in-memory `cache = {...cache, ...partial}` IS already
  // ordered by the JS event loop (each `update()` call applies its partial to
  // the latest cache), so the cache never loses mid-flight partials — the
  // race is purely the SHARED Tmp path making interleaved bytes + a
  // rename-against-an-already-renamed-tmp ENOENT. A promise chain makes the
  // disk writes strictly FIFO, and each call uses its own UUID'd tmp name so
  // no two writes ever touch the same tmp. (Cluster 4b fix.)
  private writeQueue: Promise<void> = Promise.resolve();

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
    this.writeQueue = this.writeQueue.then(
      () => this.writeToDisk(),
      () => this.writeToDisk(),
    );
    await this.writeQueue;
    return this.getAll();
  }

  async reset(): Promise<Settings> {
    this.cache = { ...DEFAULT_SETTINGS, ...this.overrides };
    this.writeQueue = this.writeQueue.then(
      () => this.writeToDisk(),
      () => this.writeToDisk(),
    );
    await this.writeQueue;
    return this.getAll();
  }

  private async readFromDisk(): Promise<Settings> {
    // Cluster 4a — boot-hang on corrupt `settings.json`. The previous catch
    // narrowed to ENOENT only and rethrew everything else; a `JSON.parse`
    // SyntaxError has `code === undefined` and propagated through
    // (App.tsx → settings.ts → main.ts handler → ensureLoaded) with no outer
    // try/catch, leaving `loaded` stuck at `false` → Workspace's gate hangs
    // against DEFAULT_SETTINGS + missing lastCwd → the app stays in a
    // unrecoverable wedge with NO reset path. The write-tmp-then-rename
    // pattern below prevents SETTINGS-state corruption from a force-quit
    // mid-flush (settings.json is only touched by atomic `fs.rename`, never
    // by `writeFile`), but `settings.json` can still land corrupt via
    // external manual edits (rare but real, e.g. a half-finished sync). Any
    // read failure now resets to DEFAULT_SETTINGS + overrides + a log line;
    // NEVER throw.
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...this.overrides, ...parsed };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { ...DEFAULT_SETTINGS, ...this.overrides };
      }
      // Anything else — SyntaxError (malformed JSON), EACCES, EISDIR,
      // anything — reset to defaults. A persisted corrupt file is the
      // worst case we want to recover from; booting to defaults beats a
      // boot-hang with no escape.
      console.error(
        `[settings] read failed at ${this.file} (${code ?? "unknown"}):`,
        err,
        "— resetting to defaults",
      );
      return { ...DEFAULT_SETTINGS, ...this.overrides };
    }
  }

  private async writeToDisk(): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true });
    // Cluster 4b — UUID-suffixed tmp name so two in-flight writes (frontend's
    // debounced skeleton + a `saveCurrentLayout`'s `settings:update`) can't
    // collide on the same `${file}.${pid}.tmp`. The previous shared-per-pid
    // tmp path let interleaved `writeFile` bytes + a rename-against-an-
    // already-renamed-tmp ENOENT land one corrupt JSON in `settings.json`.
    // Unique tmp + the `writeQueue` promise chain above mean each call gets
    // its own tmp + a strictly-serialized dock sequence; on Win32 the rename
    // atomically replaces any existing via libuv's
    // `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`.
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), "utf8");
    await fs.rename(tmp, this.file);
  }
}
