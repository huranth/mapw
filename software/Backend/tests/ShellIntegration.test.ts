// Pure tests for the PowerShell rc's Windows console-default-color pin — the
// pane-side lever that flips codex's GetConsoleScreenBufferInfoEx bg-probe to
// LIGHT so codex renders its light palette inside our ConPTY panes. (See the
// header of Frontend/electron/codexThemeSeeder.ts for the full lever split +
// the probe rationale.) The rc is built by `buildShellRc`, a pure function
// (no fs/os), so we assert on its returned string directly — mirroring how
// PtyService.test.ts reads the temp rc the service writes but scoped to the
// pure builder here for finer-grained coverage of the pin placement + guards.

import { describe, expect, it } from "vitest";
import { buildShellRc } from "../src/pty/shellIntegration.js";

describe("buildShellRc — PowerShell Windows console-color pin (codex lever)", () => {
  const rc = buildShellRc("powershell", null);

  it("pins the console DEFAULT bg to 'White' (light -> codex reads light)", () => {
    expect(rc).toContain("[Console]::BackgroundColor = 'White'");
  });

  it("pins the console DEFAULT fg to 'Black' (dark ink on paper)", () => {
    expect(rc).toContain("[Console]::ForegroundColor = 'Black'");
  });

  it("guards the pin to Windows via RuntimeInformation::IsOSPlatform", () => {
    // The only platform with a Console API; the guard matters because on Unix
    // setting [Console]::BackgroundColor emits ANSI bg codes that WOULD paint
    // rendered cells directly (vs ConPTY's SGR-reset diffing on Windows).
    expect(rc).toContain("IsOSPlatform");
    expect(rc).toContain("OSPlatform]::Windows");
  });

  it("wraps the guard + set in try/catch (redirected console degrades quietly)", () => {
    expect(rc).toMatch(/try\s*\{/);
    expect(rc).toMatch(/catch\s*\{\s*\}/);
  });

  it("places the pin AFTER the profile source and BEFORE the prompt override", () => {
    // The pin must run after the user's $PROFILE is dot-sourced so a profile
    // that sets its own console colors is overridden — and before `function
    // prompt` so the first prompt paint already reflects the pinned colors.
    const pinIdx = rc.indexOf("[Console]::BackgroundColor");
    const promptIdx = rc.indexOf("function prompt");
    expect(pinIdx).toBeGreaterThan(-1);
    expect(promptIdx).toBeGreaterThan(-1);
    expect(pinIdx).toBeLessThan(promptIdx);
  });

  it("keeps the OSC 133/7 markers + prompt override intact around the pin", () => {
    expect(rc).toContain("133;A");
    expect(rc).toContain("133;D");
    expect(rc).toContain("]7;file://");
    expect(rc).toContain("function prompt");
    // PowerShell does NOT ship the 133;C (outputStart) marker — unchanged.
    expect(rc).not.toContain("133;C");
  });

  it("pwsh (PS7) shares the same pin via the same powerShellRc builder", () => {
    expect(buildShellRc("pwsh", null)).toContain(
      "[Console]::BackgroundColor = 'White'",
    );
  });
});

describe("buildShellRc — non-pwsh shells do NOT carry the Console:: pin", () => {
  // The Console-API lever is Windows + pwsh only. bash/zsh run in ConPTY too
  // on Windows, but their rc is a POSIX shell rc — `[Console]::BackgroundColor`
  // is PowerShell-only syntax. Unix codex probes via OSC 11 instead (the
  // deferred cross-platform lever); forcing a bg via ANSI on those shells
  // would paint rendered cells directly, so we ship no pin for them here.
  it("bash rc has no Console:: pin", () => {
    expect(buildShellRc("bash", null)).not.toContain("[Console]::BackgroundColor");
  });

  it("zsh rc has no Console:: pin", () => {
    expect(buildShellRc("zsh", null)).not.toContain("[Console]::BackgroundColor");
  });

  it("sh rc has no Console:: pin", () => {
    expect(buildShellRc("sh", null)).not.toContain("[Console]::BackgroundColor");
  });

  it("cmd rc is empty (no integration shipped at all)", () => {
    expect(buildShellRc("cmd", null)).toBe("");
  });
});
