// Shell-integration rc builder. Per the M1 design decision ("source real
// profile first, then hooks"), each shell's rc:
//   (1) sources the user's REAL profile first (~/.bashrc, ~/.zshrc,
//       $PROFILE, ~/.profile) — so the user's prompt, aliases, completions,
//       prompt themes, bindings ALL survive; nothing the user customized is
//       overwritten.
//   (2) installs OSC 133 + OSC 7 hooks around the existing prompt, so the
//       bridge just stitches the semantic-prompt / cwd markers between the
//       user's prompt redraws and command runs.
//
// The bridge NEVER replaces the user's prompt. We append markers; the shell's
// own customization layer stays intact.
//
// This module is PURE: no node:fs, no node:os reads. PtyService passes the
// platform / env values explicitly so these helpers are trivially unit-test
// friendly.

export type ShellKind =
  | "bash"
  | "zsh"
  | "pwsh"
  | "powershell"
  | "cmd"
  | "sh";

export interface DetectShellInput {
  /** User preference (Settings.shell). Null shipped by default. */
  readonly preference: string | null;
  /** `$SHELL` from process.env (used as the unix fallback). */
  readonly shellEnv: string | undefined;
  readonly platform: NodeJS.Platform;
}

/** Resolve the ShellKind. preference wins; then `$SHELL` (only on non-win32 —
 *  see below); then the platform default (`powershell` on win32, bash everywhere
 *  else). Power users who want a specific Windows shell pass `preference`
 *  (the IPC layer forwards this as `shellOverride`). */
export function detectShell(input: DetectShellInput): ShellKind {
  const { preference, shellEnv, platform } = input;
  if (preference && preference.trim() !== "") {
    const k = matchShellByName(basename(preference));
    if (k) return k;
  }
  // $SHELL is honored only on non-win32. On win32 it is MOST often an env
  // leak from the dev launcher chain (Git-bash / MSYS → npm → electron-vite)
  // that reflects the launcher's own interactive shell rather than the user's
  // chosen Windows shell — so a fresh block of panes that should default to
  // PowerShell instead pick `bash.exe` from MSYS. The right pick on win32 is
  // the platform default (`powershell`); power users opt into cmd / bash /
  // pwsh explicitly via `preference`.
  if (platform !== "win32" && shellEnv) {
    const k = matchShellByName(basename(shellEnv));
    if (k) return k;
  }
  return platform === "win32" ? "powershell" : "bash";
}

/** Map a ShellKind to the actual binary path the child process spawns. If
 *  the user supplied a full path AND its basename matches the kind, pass the
 *  user's path straight through.
 *
 *  Windows bug-workaround: node-pty's ConPTY `startProcess` walks the live
 *  process's `Path` env via `path_util::get_shell_path` to resolve a bare
 *  `powershell.exe` / `cmd.exe` filename. Under a few dev-shell launch chains
 *  (MSYS bash → npm → electron-vite → Electron main) this walk returns an
 *  empty string, so conpty throws `File not found: ` (empty). We sidestep the
 *  walk entirely by handing ConPTY an ABSOLUTE Windows path: ConPTY's
 *  `PathIsRelativeW(absPath)` is false, the `else { shellpath = filename; }`
 *  branch runs, and the file-existence check passes against the literal
 *  path. The known-good v5 PowerShell install location
 *  `%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe` has been stable
 *  across every Windows version that ships Windows PowerShell 5.1.
 *
 *  This function still only reads `process.env` for `WINDIR` / `ProgramFiles`
 *  — no `node:fs` or `node:os` calls — so the module stays pure. */
export function resolveBinary(
  shell: ShellKind,
  preference: string | null,
  platform: NodeJS.Platform,
): string {
  if (preference && preference.trim() !== "") {
    if (matchShellByName(basename(preference)) === shell) return preference;
  }
  if (platform === "win32") {
    const windir = process.env["WINDIR"] ?? "C:\\Windows";
    const system32 = `${windir}\\System32`;
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    switch (shell) {
      case "cmd":
        return `${system32}\\cmd.exe`;
      case "powershell":
        return `${system32}\\WindowsPowerShell\\v1.0\\powershell.exe`;
      case "pwsh":
        // PowerShell 7's default winget install path. PtyService defaults to
        // `powershell` on win32 so this is only hit by explicit override.
        return `${programFiles}\\PowerShell\\7\\pwsh.exe`;
      case "bash":
        // Git-bash isn't at a stable install path; rely on PATH lookup here
        // (users who override to bash on Windows usually pass a full path).
        return "bash.exe";
      case "zsh":
        return "zsh.exe";
      case "sh":
        return "sh.exe";
    }
  }
  switch (shell) {
    case "bash":
      return "bash";
    case "zsh":
      return "zsh";
    case "sh":
      return "sh";
    case "pwsh":
      return "pwsh";
    case "powershell":
      return "powershell";
    case "cmd":
      return "cmd";
  }
}

/** Path to the user's existing profile/rc for this shell (best-effort). */
export function detectProfilePath(
  shell: ShellKind,
  homeDir: string,
  platform: NodeJS.Platform,
): string | null {
  if (!homeDir) return null;
  switch (shell) {
    case "bash":
      return posixJoin(homeDir, ".bashrc");
    case "zsh":
      return posixJoin(homeDir, ".zshrc");
    case "sh":
      return posixJoin(homeDir, ".profile");
    case "pwsh":
      return platform === "win32"
        ? winJoin(homeDir, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1")
        : posixJoin(homeDir, ".config", "powershell", "Microsoft.PowerShell_profile.ps1");
    case "powershell":
      return winJoin(
        homeDir,
        "Documents",
        "WindowsPowerShell",
        "Microsoft.PowerShell_profile.ps1",
      );
    case "cmd":
      return null;
  }
}

/** Returns the rc content to write to a temp file. Empty string = no
 *  integration shipped (the launched shell runs plain interactive). */
export function buildShellRc(
  shell: ShellKind,
  profilePath: string | null,
): string {
  switch (shell) {
    case "bash":
      return bashRc(profilePath);
    case "zsh":
      return zshRc(profilePath);
    case "sh":
      return shRc(profilePath);
    case "pwsh":
    case "powershell":
      return powerShellRc(profilePath);
    case "cmd":
      // cmd has no reliable prompt-hook system; no integration in M1.
      return "";
  }
}

/** Args vector for node-pty.spawn(binary, args, opts). When an rc path is
 *  written the args explicitly redirect bash's --rcfile / PowerShell's -File
 *  / zsh's ZDOTDIR (via env) to load OUR temp rc, which itself sources the
 *  user's real profile as its first step. */
export function spawnArgsFor(
  shell: ShellKind,
  rcPath?: string,
): string[] {
  switch (shell) {
    case "bash":
      // bash --rcfile <tmp> -i replaces ~/.bashrc with our temp rc (which
      // itself sources ~/.bashrc first, before installing the hooks).
      return rcPath ? ["--rcfile", rcPath, "-i"] : ["-i"];
    case "zsh":
      // zsh loads <ZDOTDIR>/.zshrc automatically when launched as non-login
      // interactive. PtyService sets ZDOTDIR=<tempDir>, so the args list is
      // just `["-i"]`.
      return ["-i"];
    case "sh":
      // POSIX sh has no --rcfile, no DEBUG trap, no PROMPT_COMMAND, and no
      // stable precmd mechanism. We ship a plain interactive shell for sh
      // in M1 — no OSC markers. Power users almost always use bash/zsh.
      return ["-i"];
    case "pwsh":
    case "powershell":
      // -File + -NoExit keeps the session interactive after sourcing the rc.
      return rcPath
        ? ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", rcPath]
        : ["-NoLogo", "-NoExit"];
    case "cmd":
      // cmd: plain interactive (no integration).
      return [];
  }
}

export interface SpawnEnvInput {
  readonly shell: ShellKind;
  readonly baseEnv: NodeJS.ProcessEnv;
  /** When set (zsh), `ZDOTDIR` env var redirects `.zshrc` loading. */
  readonly zdotDir: string | null;
}

/** Build the child process env. Inherits process.env, layers the user's
 *  overrides, then sets TERM=xterm-256color and (for zsh) ZDOTDIR. */
export function spawnEnv(input: SpawnEnvInput): NodeJS.ProcessEnv {
  const { shell, baseEnv, zdotDir } = input;
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    // Force a TERM xterm recognises; some shell defaults to "dumb" which
    // disables ANSI emission entirely, breaking the OSC markers.
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  if (shell === "zsh" && zdotDir) {
    env["ZDOTDIR"] = zdotDir;
  }
  return env;
}

// --- internals ---------------------------------------------------------------

function basename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function matchShellByName(name: string): ShellKind | null {
  const lower = name.toLowerCase();
  switch (lower) {
    case "bash":
    case "bash.exe":
      return "bash";
    case "zsh":
    case "zsh.exe":
      return "zsh";
    case "pwsh":
    case "pwsh.exe":
      return "pwsh";
    case "powershell":
    case "powershell.exe":
      return "powershell";
    case "cmd":
    case "cmd.exe":
      return "cmd";
    case "sh":
    case "sh.exe":
      return "sh";
    default:
      return null;
  }
}

function posixJoin(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

function winJoin(...parts: string[]): string {
  // Use backslashes so PowerShell's -File path resolves cleanly on Windows.
  return parts.join("\\").replace(/\\+/g, "\\");
}

// --- bash --------------------------------------------------------------------

function bashRc(profilePath: string | null): string {
  const lines: string[] = [
    "# mapw-init: OSC 133/7 markers around your prompt.",
    "# Sources the user's ~/.bashrc first; prompt, aliases, completions",
    "# survive — the bridge just stitches markers around them.",
  ];
  if (profilePath) {
    lines.push(`if [ -r "${profilePath}" ]; then source "${profilePath}"; fi`);
  }
  lines.push(
    "",
    "__bs_in_command=0",
    "__bs_debug() {",
    "  local rc=$?",
    '  if [ "$__bs_in_command" = "0" ]; then',
    "    __bs_in_command=1",
    "    printf '\\033]133;C\\007'",
    "  fi",
    "  return $rc",
    "}",
    "trap '__bs_debug' DEBUG",
    "",
    "__bs_precmd() {",
    "  local ec=$?",
    '  if [ "$__bs_in_command" = "1" ]; then',
    '    printf "\\033]133;D;%s\\007" "$ec"',
    "    __bs_in_command=0",
    "  fi",
    "  local h",
    '  h="$(uname -n 2>/dev/null || hostname 2>/dev/null || echo localhost)"',
    '  printf "\\033]7;file://%s%s\\007" "$h" "$PWD"',
    '  printf "\\033]133;A\\007"',
    "}",
    "if [ -z \"$PROMPT_COMMAND\" ]; then",
    "  PROMPT_COMMAND='__bs_precmd'",
    "else",
    "  PROMPT_COMMAND=\"__bs_precmd; $PROMPT_COMMAND\"",
    "fi",
    "",
  );
  return lines.join("\n");
}

// --- zsh ---------------------------------------------------------------------

function zshRc(profilePath: string | null): string {
  const lines: string[] = [
    "# mapw-init: OSC 133/7 markers around your prompt.",
    "# Sources the user's ~/.zshrc first; prompt, aliases, completions",
    "# survive — the bridge just stitches markers around them.",
  ];
  if (profilePath) {
    lines.push(`if [ -r "${profilePath}" ]; then source "${profilePath}"; fi`);
  }
  lines.push(
    "",
    "__bs_preexec() {",
    "  printf '\\033]133;C\\007'",
    "}",
    "__bs_precmd() {",
    "  local ec=$?",
    "  local h",
    '  h="$(uname -n 2>/dev/null || hostname 2>/dev/null || echo localhost)"',
    '  printf "\\033]133;D;%s\\007" "$ec"',
    '  printf "\\033]7;file://%s%s\\007" "$h" "$PWD"',
    '  printf "\\033]133;A\\007"',
    "}",
    "preexec_functions=(__bs_preexec $preexec_functions)",
    "precmd_functions=(__bs_precmd $precmd_functions)",
    "",
  );
  return lines.join("\n");
}

// --- sh ----------------------------------------------------------------------

function shRc(profilePath: string | null): string {
  // POSIX sh has no precmd/preexec hook system currently. We ship the
  // profile source only — no OSC markers are emitted. The pane still runs;
  // blocks don't form on the(renderer sees no 133/7 events), which is fine.
  if (profilePath) {
    return [
      "# mapw-init: source the user's ~/.profile.",
      "# (No OSC 133/7 markers shipped for POSIX sh currently.)",
      `if [ -r "${profilePath}" ]; then`,
      `  . "${profilePath}"`,
      `fi`,
      "",
    ].join("\n");
  }
  return "";
}

// --- pwsh / powershell -------------------------------------------------------

function powerShellRc(profilePath: string | null): string {
  const lines: string[] = [
    "# mapw-init: OSC 133/7 markers around your prompt.",
    "# Dot-sources the user's $PROFILE first; their prompt, aliases,",
    "# completions all survive — the bridge just stitches markers around",
    "# them by overriding the prompt function and delegating back to the",
    "# user's captured prompt after each marker emission.",
  ];
  if (profilePath) {
    lines.push(`if (Test-Path -LiteralPath "${profilePath}") { . "${profilePath}" }`);
  }
  // Pin the Windows console's DEFAULT screen colors to dark ink on paper so a
  // TUI that reads the host background via the Windows Console API (codex's
  // GetConsoleScreenBufferInfoEx path on Windows — see Frontend/electron/
  // codexThemeSeeder.ts' header for the full lever split) observes a LIGHT bg
  // and renders its light palette, matching the paper-light chrome around the
  // pane. ConPTY emits SGR-reset for default-attribute cells it diffs out, so
  // xterm's theme still owns the visuals (white sheet, near-black ink): this
  // flips ONLY what the Console-API probe reads; it does not repaint the pane.
  // Guarded to Windows (the only platform with a Console API). On Unix codex /
  // termenv probe via OSC 11 instead (a deferred cross-platform lever) — and
  // setting [Console] colors on Unix would emit ANSI bg codes that WOULD paint
  // rendered cells directly, so the Windows guard matters. The whole block is
  // wrapped in try/catch so a missing RuntimeInformation type (pre-4.7.1
  // .NET Framework) or a redirected console degrades to the dark default
  // quietly instead of erroring into the pane at boot.
  lines.push(
    "",
    "# mapw-init: console default colors -> dark ink on paper (see rc header).",
    "try {",
    "  if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(",
    "        [System.Runtime.InteropServices.OSPlatform]::Windows)) {",
    "    [Console]::BackgroundColor = 'White'",
    "    [Console]::ForegroundColor = 'Black'",
    "  }",
    "} catch {}",
  );
  lines.push(
    "",
    "# Snapshot the existing prompt body BEFORE we override it, so we can",
    "# delegate to the user's own rendering after the markers fire. We MUST",
    "# capture `.ScriptBlock` — NOT the `FunctionInfo` itself — because the",
    "# FunctionInfo returned by `Get-Item Function:prompt` is LIVE-LINKED to",
    "# the function-table entry: once we redefine `prompt` below, calling",
    "# `& $capturedFunctionInfo` re-runs the CURRENT `prompt` (our override),",
    "# causing `prompt → & __bsUserPrompt → prompt → …` INFINITE RECURSION",
    "# (the symptom: panes clear with `[2J` then emit a flood of OSC 133;A",
    "# markers in a tight loop and never render visible text — every pane",
    "# appears blank). The `.ScriptBlock` accessor returns the BODY of the",
    "# original prompt as a frozen script block; `& $scriptBlock` runs that",
    "# body in isolation, so the delegate can never recurse back to us.",
    "$global:__bsUserPrompt = (Get-Item Function:prompt).ScriptBlock",
    "",
    "function prompt {",
    "  $ec = if ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } else { 0 }",
    "  $h = [System.Net.Dns]::GetHostName()",
    '  $loc = (Get-Location).Path -replace "\\\\","/"',
    '  if ($loc -match "^[A-Za-z]:") { $loc = "/$loc" }',
    "  [Console]::Write([char]27 + \"]133;D;$ec\" + [char]7)",
    "  [Console]::Write([char]27 + \"]7;file://${h}${loc}\" + [char]7)",
    "  [Console]::Write([char]27 + \"]133;A\" + [char]7)",
    "  & $global:__bsUserPrompt",
    "}",
    "",
  );
  return lines.join("\n");
}
