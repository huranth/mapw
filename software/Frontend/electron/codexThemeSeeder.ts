// Best-effort, idempotent seed of the OpenAI codex CLI's `[tui] theme` knob into
// the user's `config.toml`, so codex boots with the `catppuccin-latte` light
// syntax theme — matching the paper-light chrome — EVEN when codex is launched
// standalone (outside our panes), where the per-pane Console-API light-bg pin in
// `Backend/src/pty/shellIntegration.ts` (`powerShellRc`) can't reach it.
//
// Two levers cooperate to make codex render light:
//   (A) pane-side  — `powerShellRc` pins the Windows console's DEFAULT screen
//                    colors to dark-ink-on-paper so codex's
//                    `GetConsoleScreenBufferInfoEx` bg-probe (the `#[cfg(windows)]`
//                    path in `codex-rs/tui/src/terminal_probe.rs`) reads a LIGHT
//                    bg → light chrome + light auto syntax. This only runs
//                    inside our ConPTY panes.
//   (B) config-side (this file) — `[tui] theme = "catppuccin-latte"` forces the
//                    light syntax theme regardless of any probe, so a STANDALONE
//                    codex (plain Windows Terminal, a CI shell, …) still renders
//                    light syntax. The chrome of a standalone codex follows
//                    whatever console background that host gives it; we can't
//                    control that from here, hence the pane-side lever for in-app.
// Together: codex in our panes is wholly light (chrome + syntax); codex
// standalone is at least light-syntax.
//
// This mirrors the opencode precedent (`opencodeThemeSeeder.ts`): opencode on
// Windows needs its `kv.json` `theme_mode_lock = "light"` (a config lever,
// because its termenv hardcodes ANSIColor(0)=black and ignores the real console
// bg); codex instead READS the live console bg, so its Windows lever is the
// pane-side console-color pin (A) — there is no codex config "lock" for the
// chrome, only `[tui] theme` for syntax. Different CLIs, honestly different
// mechanisms; this file is the (B) lever, the (A) lever lives in shellIntegration.
//
// codex resolves its config home via `$CODEX_HOME` (must be an EXISTING dir, per
// `codex-rs/utils/home-dir/src/lib.rs: find_codex_home`) else `~/.codex`. We
// honor the same resolution so we write the exact file codex will read.
//
// Defensive: wrapped in try/catch, never throws, never blocks app boot. Atomic:
// tmp-file + rename — no half-written file under any crash mode. Idempotent: the
// pure merge returns `null` when the file already carries the target theme, and
// we skip the write (so re-running the app never churns the user's config).

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import {
  CODEX_TARGET_THEME,
  mergeTuiThemeIntoToml,
} from "./codexThemeMerge.js";

interface CodexHomeResolution {
  readonly home: string;
  /** true when $CODEX_HOME was honored (vs falling back to ~/.codex). */
  readonly fromEnv: boolean;
}

/** Match codex's own home resolution: $CODEX_HOME (non-empty) is used verbatim
 *  regardless of whether it exists (codex treats a non-existent CODEX_HOME as a
 *  hard boot error — but if the user set it, they own that); otherwise ~/.codex. */
function resolveCodexHome(): CodexHomeResolution {
  const env = process.env["CODEX_HOME"];
  if (env && env.trim() !== "") return { home: env, fromEnv: true };
  return { home: join(homedir(), ".codex"), fromEnv: false };
}

export async function seedCodexTheme(): Promise<void> {
  try {
    const { home } = resolveCodexHome();
    const configPath = join(home, "config.toml");

    let raw = "";
    let exists = true;
    try {
      raw = await readFile(configPath, "utf8");
    } catch {
      exists = false;
    }

    const next = mergeTuiThemeIntoToml(exists ? raw : "", CODEX_TARGET_THEME);
    if (next === null) return; // already seeded — leave the file byte-identical.

    // The home dir exists for any machine codex has run on; create it lazily so
    // a fresh install still seeds on the very first boot of our app (before
    // codex itself has had a chance to create the dir). mkdir is best-effort —
    // a failure is caught and warned on below; we never throw.
    try {
      await mkdir(home, { recursive: true });
    } catch {
      // recursive throws if the path is an existing file (not a dir); the
      // writeFile/rename below will fail next and we'll catch + warn.
    }

    // Atomic write: tmp + rename. The tmp lives in the same dir as the target
    // (same volume) so `rename` is atomic on every platform.
    const tmp = `${configPath}.codex-theme-seed.tmp`;
    await writeFile(tmp, next, "utf8");
    await rename(tmp, configPath);
    console.log(
      `[codexThemeSeeder] seeded [tui] theme = "${CODEX_TARGET_THEME}" ${
        exists ? "into (merged, comments preserved)" : "into (created new)"
      } ${configPath}`,
    );
  } catch (err) {
    console.warn(
      "[codexThemeSeeder] best-effort seed failed (path absent, write protected, or config locked); skipping. codex will use its built-in default theme.",
      err,
    );
  }
}
