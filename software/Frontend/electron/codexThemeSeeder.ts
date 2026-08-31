import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import {
  CODEX_TARGET_THEME,
  mergeTuiThemeIntoToml,
} from "./codexThemeMerge.js";

interface CodexHomeResolution {
  readonly home: string;

  readonly fromEnv: boolean;
}

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
    if (next === null) return;

    try {
      await mkdir(home, { recursive: true });
    } catch {

    }

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
