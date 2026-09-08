export type ShellKind = "bash" | "zsh" | "pwsh" | "powershell" | "cmd" | "sh";

export interface DetectShellInput { readonly preference: string | null; readonly shellEnv: string | undefined; readonly platform: NodeJS.Platform; }

export function detectShell(input: DetectShellInput): ShellKind {
  const pref = input.preference?.trim();
  if (pref) { const k = matchShellByName(basename(pref)); if (k) return k; }
  if (input.platform !== "win32" && input.shellEnv?.trim()) {
    const k = matchShellByName(basename(input.shellEnv.trim()));
    if (k) return k;
  }
  return input.platform === "win32" ? "powershell" : "bash";
}

export function resolveBinary(shell: ShellKind, preference: string | null, platform: NodeJS.Platform): string {
  const pref = preference?.trim();
  if (pref && isSafeShellPath(pref, shell)) return pref;
  if (platform === "win32") {
    const windir = process.env["WINDIR"] ?? "C:\\Windows";
    const system32 = `${windir}\\System32`;
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    switch (shell) {
      case "cmd": return `${system32}\\cmd.exe`;
      case "powershell": return `${system32}\\WindowsPowerShell\\v1.0\\powershell.exe`;
      case "pwsh": return `${programFiles}\\PowerShell\\7\\pwsh.exe`;
      case "bash": return "bash.exe";
      case "zsh": return "zsh.exe";
      case "sh": return "sh.exe";
    }
  }
  return shell;
}

export function detectProfilePath(shell: ShellKind, homeDir: string, platform: NodeJS.Platform): string | null {
  if (!homeDir) return null;
  switch (shell) {
    case "bash": return joinPosix(homeDir, ".bashrc");
    case "zsh": return joinPosix(homeDir, ".zshrc");
    case "sh": return joinPosix(homeDir, ".profile");
    case "pwsh": return platform === "win32" ? joinWin(homeDir, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1") : joinPosix(homeDir, ".config", "powershell", "Microsoft.PowerShell_profile.ps1");
    case "powershell": return joinWin(homeDir, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1");
    case "cmd": return null;
  }
}

export function buildShellRc(shell: ShellKind, profilePath: string | null): string {
  switch (shell) {
    case "bash": return bashRc(profilePath);
    case "zsh": return zshRc(profilePath);
    case "sh": return shRc(profilePath);
    case "pwsh":
    case "powershell": return powerShellRc(profilePath);
    case "cmd": return "";
  }
}

export function spawnArgsFor(shell: ShellKind, rcPath?: string): string[] {
  switch (shell) {
    case "bash": return rcPath ? ["--rcfile", rcPath, "-i"] : ["-i"];
    case "zsh":
    case "sh": return ["-i"];
    case "pwsh":
    case "powershell": return rcPath ? ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", rcPath] : ["-NoLogo", "-NoExit"];
    case "cmd": return [];
  }
}

export interface SpawnEnvInput { readonly shell: ShellKind; readonly baseEnv: NodeJS.ProcessEnv; readonly zdotDir: string | null; }

export function spawnEnv(input: SpawnEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.baseEnv, TERM: "xterm-256color", COLORTERM: "truecolor" };
  if (input.shell === "zsh" && input.zdotDir) env["ZDOTDIR"] = input.zdotDir;
  return env;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function matchShellByName(name: string): ShellKind | null {
  switch (name.toLowerCase()) {
    case "bash": case "bash.exe": return "bash";
    case "zsh": case "zsh.exe": return "zsh";
    case "pwsh": case "pwsh.exe": return "pwsh";
    case "powershell": case "powershell.exe": return "powershell";
    case "cmd": case "cmd.exe": return "cmd";
    case "sh": case "sh.exe": return "sh";
    default: return null;
  }
}

function isSafeShellPath(pref: string, shell: ShellKind): boolean {
  const base = basename(pref);
  if (matchShellByName(base) !== shell) return false;
  if (!/[\/\\]/.test(pref)) return true; // bare name like "bash"
  const lower = pref.toLowerCase().replace(/\\/g, "/");
  const safePrefixes = ["/usr/local/bin/", "/usr/bin/", "/bin/", "/opt/homebrew/bin/", "/opt/homebrew/sbin/", "/usr/local/sbin/"];
  const winSafe = ["c:/windows/system32/", "c:/program files/", "c:/program files (x86)/"];
  return safePrefixes.some((p) => lower.startsWith(p)) || winSafe.some((p) => lower.startsWith(p));
}

function joinPosix(...parts: string[]): string { return parts.join("/").replace(/\/+/g, "/"); }
function joinWin(...parts: string[]): string { return parts.join("\\").replace(/\\+/g, "\\"); }
function escBash(s: string): string { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`"); }
function escPwsh(s: string): string { return s.replace(/'/g, "''"); }

function bashRc(profilePath: string | null): string {
  const src = profilePath ? `if [ -r "${escBash(profilePath)}" ]; then source "${escBash(profilePath)}"; fi` : "";
  return [
    "# mapw: OSC 133/7",
    ...(src ? [src] : []),
    "",
    "__mapw_in_command=0",
    "__mapw_debug(){ local rc=$?; if [ \"$__mapw_in_command\" = \"0\" ]; then __mapw_in_command=1; printf '\\033]133;C\\007'; fi; return $rc; }",
    "trap '__mapw_debug' DEBUG",
    "",
    "__mapw_urlenc(){ printf '%s' \"$1\" | sed -e 's/%/%25/g' -e 's/ /%20/g' -e 's/#/%23/g' -e 's/?/%3F/g' -e 's/;/%3B/g' -e 's/&/%26/g'; }",
    "__mapw_precmd(){ local ec=$?; if [ \"$__mapw_in_command\" = \"1\" ]; then printf \"\\033]133;D;%s\\007\" \"$ec\"; __mapw_in_command=0; fi; local h; h=\"$(uname -n 2>/dev/null || hostname 2>/dev/null || echo localhost)\"; printf \"\\033]7;file://%s%s\\007\" \"$h\" \"$(__mapw_urlenc \"$PWD\")\"; printf \"\\033]133;A\\007\"; }",
    "if [ -z \"$PROMPT_COMMAND\" ]; then PROMPT_COMMAND='__mapw_precmd'; else PROMPT_COMMAND=\"__mapw_precmd; $PROMPT_COMMAND\"; fi",
    "",
  ].join("\n");
}

function zshRc(profilePath: string | null): string {
  const src = profilePath ? `if [ -r "${escBash(profilePath)}" ]; then source "${escBash(profilePath)}"; fi` : "";
  return [
    "# mapw: OSC 133/7",
    ...(src ? [src] : []),
    "",
    "__mapw_preexec(){ printf '\\033]133;C\\007'; }",
    "__mapw_urlenc(){ printf '%s' \"$1\" | sed -e 's/%/%25/g' -e 's/ /%20/g' -e 's/#/%23/g' -e 's/?/%3F/g' -e 's/;/%3B/g' -e 's/&/%26/g'; }",
    "__mapw_precmd(){ local ec=$?; local h; h=\"$(uname -n 2>/dev/null || hostname 2>/dev/null || echo localhost)\"; printf \"\\033]133;D;%s\\007\" \"$ec\"; printf \"\\033]7;file://%s%s\\007\" \"$h\" \"$(__mapw_urlenc \"$PWD\")\"; printf \"\\033]133;A\\007\"; }",
    "preexec_functions=(__mapw_preexec $preexec_functions)",
    "precmd_functions=(__mapw_precmd $precmd_functions)",
    "",
  ].join("\n");
}

function shRc(profilePath: string | null): string {
  if (!profilePath) return "";
  const p = escBash(profilePath);
  return `if [ -r "${p}" ]; then . "${p}"; fi\n`;
}

function powerShellRc(profilePath: string | null): string {
  const lines: string[] = ["# mapw: OSC 133/7"];
  if (profilePath) lines.push(`if (Test-Path -LiteralPath '${escPwsh(profilePath)}') { . '${escPwsh(profilePath)}' }`);
  lines.push(
    "",
    "try { if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) { [Console]::BackgroundColor = 'White'; [Console]::ForegroundColor = 'Black' } } catch {}",
    "",
    "$global:__mapwUserPrompt=(Get-Item Function:prompt).ScriptBlock",
    "function prompt {",
    "  $ec=if($null -ne $global:LASTEXITCODE){$global:LASTEXITCODE}else{0}",
    "  $h=[System.Net.Dns]::GetHostName()",
    "  $loc=(Get-Location).Path -replace '\\\\','/'; if($loc -match '^[A-Za-z]:'){ $loc=\"/$loc\" }",
    "  $locEsc=[Uri]::EscapeDataString($loc).Replace('%2F','/').Replace('%3A',':')",
    "  [Console]::Write([char]27+\"]133;D;$ec\"+[char]7)",
    "  [Console]::Write([char]27+\"]7;file://${h}${locEsc}\" + [char]7)",
    "  [Console]::Write([char]27+\"]133;A\"+[char]7)",
    "  & $global:__mapwUserPrompt",
    "}",
    "",
  );
  return lines.join("\n");
}