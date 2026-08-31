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

      console.warn(
        `[opencodeThemeSeeder] ${tuiPath} is not strict JSON (likely comments or trailing commas); skipping to avoid mangling it.`,
      );
      return false;
    }
    if (parsed.theme === TARGET_THEME) return false;
    parsed.theme = TARGET_THEME;
  } else {
    parsed = {
      $schema: TUI_SCHEMA,
      theme: TARGET_THEME,
    };
  }

  const next = `${JSON.stringify(parsed, null, 2)}\n`;

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
    if (parsed.theme_mode_lock === TARGET_MODE_LOCK) return false;
  }

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

  const targetSerialized = JSON.stringify(paperBareThemeContent);
  if (await fileExists(barePath)) {
    const raw = await readFile(barePath, "utf8");
    try {
      const existingParsed = JSON.parse(raw);
      if (JSON.stringify(existingParsed) === targetSerialized) return false;
    } catch {

    }
  }

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

    const themesDir = join(configHome, "opencode", "themes");
    try {
      await mkdir(themesDir, { recursive: true });
    } catch {

    }
    const barePath = join(themesDir, PAPER_BARE_THEME_FILENAME);
    await seedPaperBareThemeFile(barePath);

    const tuiPath = join(configHome, "opencode", "tui.json");
    await seedTuiJson(tuiPath);

    const stateHome =
      process.env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
    const stateDir = join(stateHome, "opencode");
    const kvPath = join(stateDir, "kv.json");
    try {

      await mkdir(stateDir, { recursive: true });
    } catch {

    }
    await seedKvLockLight(kvPath);
  } catch (err) {
    console.warn(
      "[opencodeThemeSeeder] best-effort seed failed (path absent, write protected, or JSONC parse); skipping. opencode will fall back to its built-in default theme/variant.",
      err,
    );
  }
}
