// Best-effort seed of opencode's TUI preference at three locations so every
// opencode launched on this machine — inside our panes OR standalone globally
// — boots with the built-in `paper` theme RENDERED IN ITS LIGHT VARIANT,
// matching the paper-light chrome around it, AND with its hairline border
// tokens repainted to #FFFFFF so Bubble Tea's `lipgloss.BoxBorder` `--` chars
// (which opencode emits AROUND the /model picker + BETWEEN chat sections, in
// the paper-light `--bs-border` = `#EAEAEA` color) blend INVISIBLE against
// the pure-white pane bg, eliminating the "light-gray horizontal lines
// outside the picker" artifact the user reported.
//
// Three files, three levers:
//
//   (1) `~/.config/opencode/tui.json`                ← `theme = "paper-bare"`
//   (2) `~/.local/state/opencode/kv.json`            ← `{"theme_mode_lock":"light"}`
//   (3) `~/.config/opencode/themes/paper-bare.json` ← the bare-forked theme JSON
//
// Lever (3) — the missing piece. opencode ships built-in themes (opencode,
//   paper, ...) BUT also scans `themes/*.json` from each config dir at boot
//   (binary offset 0x5d69f58: `await Er.scan("themes/*.json",{cwd:d,...})` ->
//   registers each file's basename-without-ext as a custom theme name). We ship
//   a fork of the Paper theme (`paper-bare.json`) — same 38 defs + same 50
//   theme keys verbatim EXCEPT the two hairline tokens whose LIGHT variant
//   evaluated to #EAEAEA (= our accentless `--bs-border`):
//     `theme.border.light`:         "lightGray200" (#EAEAEA) -> "#FFFFFF"
//     `theme.borderSubtle.light`:   "#EAEAEA"            -> "#FFFFFF"
//   so the `--` chars opencode's Bubble Tea pickers + section dividers draw
//   in the paper-LIGHT `border` token resolve to #FFFFFF (= the pane's
//   bg-elevated color) — invisible against the pane background. The `dark`
//   variants are preserved unmodified so a `theme.mode.lock = dark` roll-back
//   still renders cleanly. The paper-bare.json content lives in the repo at
//   sibling `themes/paper-bare.json` and is imported here via `?raw`-free
//   JSON import (tsconfig has `resolveJsonModule: true` +
//   `moduleResolution: "Bundler"` so Rollup bundles the literal string at
//   build time — no runtime fs traversal of our repo's source path needed).
//
// Lever (1): the SDK's `Config.theme?: string` ("Theme name to use for the
//   interface"; @opencode-ai/sdk/dist/gen/types.gen.d.ts:1024). opencode
//   1.18.x auto-migrates this from opencode.jsonc into a dedicated tui.json
//   on first launch (it writes .opencode.jsonc.tui-migration.bak + a fresh
//   tui.json + strips `theme` out of opencode.jsonc). Writing tui.json
//   directly is the idempotent + migration-free path. We point it at
//   "paper-bare" — the theme registered by lever (3).
//
// Lever (2): the TUI's KV store (`TuiKV`) — its backing file is at
//   `stateDir/kv.json` (stateDir defaults to `~/.local/state/opencode`,
//   confirmed at opencode.exe offset 0x5d69bcc:
//   `let r=Hd.join(a.state,"kv.json"), d=\`tui-kv:${r}\``, then later at
//   0x5d6a0fb the Theme module reads it: `let w=e(t.get("theme_mode_lock")),
//   s=w??e(r.themeMode)??a.mode; f.mode=s,f.lock=w`. Lock value "light"
//   (or "dark") overrides BOTH the auto-detected termenv bg detection AND
//   the OSC 11 query path, unconditionally forcing that variant. On Windows,
//   termenv's `backgroundColor()` returns hardcoded ANSIColor(0) (black) —
//   so without the lock, opencode picks dark even when the user's pane
//   bg is white. The lock is the clean way around that.
//
// Lock overrides detection per opencode source. main.ts also sets
//   COLORFGBG='0;15' (env fallback for non-Windows detection) and
//   TerminalPane.tsx registers OSC 10/11 autofeed responders (TUI fallback).
//   Both are belt-and-suspenders for hosts where the TuiKV file is
//   unavailable; the lock is the primary mechanism on Windows.
//
// Idempotent: writes only when each file's value differs from the target.
// Defensive: wrapped in try/catch, never throws, never blocks app boot.
// Atomic: tmp-file + rename — never leaves a half-written file under any
// crash mode. Reversible: the user can either rebind+use the `theme.mode.lock`
// keybind in the TUI OR edit any of the three files by hand — opencode reads
// them fresh at next TUI boot.

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, rename, access } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import paperBareThemeContent from "./themes/paper-bare.json";

const TARGET_THEME = "paper-bare";
const TARGET_MODE_LOCK = "light";
const TUI_SCHEMA = "https://opencode.ai/tui.json";
const PAPER_BARE_THEME_FILENAME = "paper-bare.json";

interface TuiConfig {
  $schema?: string;
  theme?: string;
  [k: string]: unknown;
}

/** Valid variant strings opencode accepts for `theme_mode_lock` (binary:
 *  `e=f=>f==="dark"||f==="light"?f:undefined`).
 *  Other values are silently rejected by opencode (lock skipped) — so we
 *  only need to write one of these two literals. */
const VALID_MODE_LOCKS = new Set<string>(["light", "dark"]);

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function seedTuiJson(tuiPath: string): Promise<boolean> {
  const exists = await fileExists(tuiPath);
  let parsed: TuiConfig = {};

  if (exists) {
    const raw = await readFile(tuiPath, "utf8");
    try {
      parsed = JSON.parse(raw) as TuiConfig;
    } catch {
      // tui.json may contain comments or trailing commas that strict
      // JSON.parse rejects. We don't add a JSONC parser dep just for this —
      // bail with a warning rather than risk mangling the file.
      console.warn(
        `[opencodeThemeSeeder] ${tuiPath} is not strict JSON (likely comments or trailing commas); skipping to avoid mangling it.`,
      );
      return false;
    }
    if (parsed.theme === TARGET_THEME) return false; // already seeded
    parsed.theme = TARGET_THEME;
  } else {
    parsed = {
      $schema: TUI_SCHEMA,
      theme: TARGET_THEME,
    };
  }

  // Preserve any existing sibling keys (opencode might write keybinds here in
  // the future). 2-space indent matches the format opencode emits.
  const next = `${JSON.stringify(parsed, null, 2)}\n`;

  // Atomic write: tmp + rename — no half-written file under any crash mode.
  const tmp = `${tuiPath}.opencode-theme-seed.tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, tuiPath);
  console.log(
    `[opencodeThemeSeeder] seeded \`theme = ${TARGET_THEME}\` ${
      exists ? "into (rewrote existing)" : "into (created new)"
    } ${tuiPath}`,
  );
  return true;
}

async function seedKvLockLight(kvPath: string): Promise<boolean> {
  // kv.json: opencode persists TuiKV's state here. Schema is a flat JSON
  // object map `{ key: value, ... }` — we MUST NOT clobber keys other TUI
  // modules persist (e.g. scroll position, model sort order, etc.). Merge:
  // read → parse → set just `theme_mode_lock` → write back.
  let parsed: Record<string, unknown> = {};
  const exists = await fileExists(kvPath);

  if (exists) {
    const raw = await readFile(kvPath, "utf8");
    try {
      const maybe = JSON.parse(raw);
      if (maybe && typeof maybe === "object" && !Array.isArray(maybe)) {
        parsed = maybe as Record<string, unknown>;
      } else {
        console.warn(
          `[opencodeThemeSeeder] ${kvPath} is not a JSON object (got ${
            maybe === null ? "null" : Array.isArray(maybe) ? "array" : typeof maybe
          }); skipping to avoid mangling it.`,
        );
        return false;
      }
    } catch {
      console.warn(
        `[opencodeThemeSeeder] ${kvPath} is not strict JSON; skipping to avoid mangling it.`,
      );
      return false;
    }
    if (parsed.theme_mode_lock === TARGET_MODE_LOCK) return false; // already seeded
  }

  // The "configure it entirely" directive means we DO overwrite a divergent
  // valid lock (e.g. `theme_mode_lock="dark"` → `"light"`). We only refuse
  // writes that would mangle an out-of-spec value opencode can't interpret
  // — those are impossible to satisfy the directive via KV anyway (opencode
  // silently ignores them as `e(weirdValue)=undefined`).
  const current = parsed.theme_mode_lock;
  if (
    typeof current === "string" &&
    VALID_MODE_LOCKS.has(current) &&
    current !== TARGET_MODE_LOCK
  ) {
    console.warn(
      `[opencodeThemeSeeder] ${kvPath} has theme_mode_lock="${current}"; overwriting to "${TARGET_MODE_LOCK}" per configure-entirely directive.`,
    );
  }
  parsed.theme_mode_lock = TARGET_MODE_LOCK;

  const next = `${JSON.stringify(parsed, null, 2)}\n`;

  // Atomic write: tmp + rename. The state dir itself always exists for any
  // opencode install — but we mkdir defensively in case a fresh machine
  // boots our app before opencode is installed/launched once (the dir is
  // created lazily by opencode only after first KV write).
  const tmp = `${kvPath}.opencode-theme-seed.tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, kvPath);
  console.log(
    `[opencodeThemeSeeder] seeded \`theme_mode_lock = ${TARGET_MODE_LOCK}\` ${
      exists ? "into (rewrote existing)" : "into (created new)"
    } ${kvPath}`,
  );
  return true;
}

async function seedPaperBareThemeFile(barePath: string): Promise<boolean> {
  // Idempotently write paper-bare.json — the paper fork where the LIGHT
  // variant of theme.border (originally "lightGray200" = #EAEAEA) and
  // theme.borderSubtle (originally literal "#EAEAEA") are repainted to
  // #FFFFFF (= the pane bg-elevated color). With the paper-bare theme
  // selected, opencode's Bubble Tea pickers + section dividers paint their
  // `--` box-drawing chars in transparent-on-white #FFFFFF — invisible
  // against the pane surface — so the user no longer sees light-gray
  // horizontal lines around the /model picker.
  //
  // The JSON content lives in repo at `themes/paper-bare.json` and is
  // imported above; `resolveJsonModule: true` + `moduleResolution: "Bundler"`
  // mean Rollup bundles the literal into our main bundle at build time and
  // exposes it here as a parsed JS object — no runtime fs read of the source
  // repo path is required, so the bundled app stays portable across installs.
  //
  // Idempotent via single-line JSON.stringify deep-equality: if the on-disk
  // file's parsed object matches our target object, skip the write.
  const targetSerialized = JSON.stringify(paperBareThemeContent);
  if (await fileExists(barePath)) {
    const raw = await readFile(barePath, "utf8");
    try {
      const existingParsed = JSON.parse(raw);
      if (JSON.stringify(existingParsed) === targetSerialized) return false;
    } catch {
      // Disk had malformed JSON — fall through to the canonical re-seed.
    }
  }

  // 2-space indent + trailing newline matches the canonical JSON layout we
  // generate; consumed unchanged by opencode's `JSON.parse(await Md(..))`.
  const next = `${JSON.stringify(paperBareThemeContent, null, 2)}\n`;
  const tmp = `${barePath}.opencode-theme-seed.tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, barePath);
  console.log(
    `[opencodeThemeSeeder] seeded \`paper-bare\` theme JSON into ${barePath}`,
  );
  return true;
}

export async function seedOpencodeTheme(): Promise<void> {
  try {
    const configHome =
      process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");

    // (3) themes/paper-bare.json — fork of paper where border +
    // borderSubtle on the LIGHT variant are repainted #FFFFFF. Mounted
    // BEFORE tui.json flips its theme name to "paper-bare" since opencode
    // scans themes/*.json at boot + resolves the registry by basename.
    const themesDir = join(configHome, "opencode", "themes");
    try {
      await mkdir(themesDir, { recursive: true });
    } catch {
      // recursive-mode mkdir throws if the path is a file (vs dir); the
      // write below is best-effort and its failure is warned-on by the
      // outer catch.
    }
    const barePath = join(themesDir, PAPER_BARE_THEME_FILENAME);
    await seedPaperBareThemeFile(barePath);

    // (1) tui.json — theme name "paper-bare" (matches the JSON registered
    // just above).
    const tuiPath = join(configHome, "opencode", "tui.json");
    await seedTuiJson(tuiPath);

    // kv.json — theme variant lock (forces light, overrides Windows termenv
    // detection which is hardcoded to ANSIColor(0) = black = "dark").
    const stateHome =
      process.env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
    const stateDir = join(stateHome, "opencode");
    const kvPath = join(stateDir, "kv.json");
    try {
      // Defensive mkdir — the dir exists for any machine that's ever run
      // opencode; we create it lazily here so a fresh install still seeds
      // the lock on the very first boot of our app (before opencode itself
      // has had a chance to lazily create the dir).
      await mkdir(stateDir, { recursive: true });
    } catch {
      // recursive mode throws if the path is a file (not a dir) — for our
      // purposes that error is recoverable; seedKvLockLight will fail next
      // and we'll catch + warn below.
    }
    await seedKvLockLight(kvPath);
  } catch (err) {
    console.warn(
      "[opencodeThemeSeeder] best-effort seed failed (path absent, write protected, or JSONC parse); skipping. opencode will fall back to its built-in default theme/variant.",
      err,
    );
  }
}
