import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Hoisted mock state: vi.mock's factory is hoisted ABOVE the import below,
// so any module-scope consts it needs must come from vi.hoisted().
interface FakePty {
  binary: string;
  args: string[];
  opts: unknown;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  emitData: (data: string) => void;
  emitExit: (exitCode: number) => void;
}

const hoisted = vi.hoisted(() => ({
  fakes: [] as FakePty[],
}));

vi.mock("node-pty", () => ({
  spawn: vi.fn((binary: string, args: string[], opts: unknown) => {
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(e: { exitCode: number }) => void>();
    const fake: FakePty = {
      binary,
      args,
      opts,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (cb) => dataListeners.add(cb),
      onExit: (cb) => exitListeners.add(cb),
      emitData: (data) => {
        for (const cb of dataListeners) cb(data);
      },
      emitExit: (exitCode) => {
        for (const cb of exitListeners) cb({ exitCode });
      },
    };
    hoisted.fakes.push(fake);
    return fake;
  }),
}));

// MUST come after vi.mock (vitest hoists it, so a normal import is fine).
import { PtyService } from "../src/pty/PtyService.js";
import * as nodePty from "node-pty";

const mockSpawn = vi.mocked(nodePty.spawn);

let savedSHELL: string | undefined;

beforeEach(() => {
  hoisted.fakes.length = 0;
  mockSpawn.mockClear();
  savedSHELL = process.env["SHELL"];
});

afterEach(() => {
  if (savedSHELL === undefined) delete process.env["SHELL"];
  else process.env["SHELL"] = savedSHELL;
});

describe("PtyService.spawn / write / resize / kill / disposeAll", () => {
  it("spawns with the resolved binary and records the session", async () => {
    const svc = new PtyService();
    const res = await svc.spawn({ paneId: "p1", cols: 80, rows: 24 });
    expect(res.paneId).toBe("p1");
    expect(res.cols).toBe(80);
    expect(res.rows).toBe(24);
    expect(svc.size()).toBe(1);
    expect(svc.has("p1")).toBe(true);

    const fake = hoisted.fakes.at(-1);
    expect(fake).toBeDefined();
    expect(fake!.binary).toMatch(/bash|powershell/);
    expect(fake!.opts).toMatchObject({ cols: 80, rows: 24 });
  });

  it("forwards ptyWrite to the underlying pty.write", async () => {
    const svc = new PtyService();
    await svc.spawn({ paneId: "p1", cols: 40, rows: 10 });
    await svc.write("p1", "echo hi\n");
    expect(hoisted.fakes.at(-1)!.write).toHaveBeenCalledWith("echo hi\n");
  });

  it("forwards ptyResize to the underlying pty.resize and records the new dims", async () => {
    const svc = new PtyService();
    await svc.spawn({ paneId: "p1", cols: 40, rows: 10 });
    await svc.resize("p1", 100, 30);
    expect(hoisted.fakes.at(-1)!.resize).toHaveBeenCalledWith(100, 30);
    expect(svc.snapshot("p1")).toMatchObject({ cols: 100, rows: 30 });
  });

  it("rejects non-positive cols/rows at spawn time", async () => {
    const svc = new PtyService();
    await expect(svc.spawn({ paneId: "x", cols: 0, rows: 24 })).rejects.toThrow();
    await expect(svc.spawn({ paneId: "x", cols: 80, rows: -1 })).rejects.toThrow();
  });

  it("rejects duplicate paneId spawns", async () => {
    const svc = new PtyService();
    await svc.spawn({ paneId: "p1", cols: 80, rows: 24 });
    await expect(svc.spawn({ paneId: "p1", cols: 80, rows: 24 })).rejects.toThrow();
  });

  it("rejects write/resize on unknown paneId", async () => {
    const svc = new PtyService();
    await expect(svc.write("ghost", "x")).rejects.toThrow();
    await expect(svc.resize("ghost", 80, 24)).rejects.toThrow();
  });

  it("kill removes the session and calls pty.kill", async () => {
    const svc = new PtyService();
    await svc.spawn({ paneId: "p1", cols: 80, rows: 24 });
    await svc.kill("p1");
    expect(svc.has("p1")).toBe(false);
    expect(hoisted.fakes.at(-1)!.kill).toHaveBeenCalled();
  });

  it("kill on an unknown paneId is a no-op", async () => {
    const svc = new PtyService();
    await svc.kill("ghost");
    expect(svc.size()).toBe(0);
  });

  it("disposeAll clears the registry and calls pty.kill on each", async () => {
    const svc = new PtyService();
    await svc.spawn({ paneId: "p1", cols: 80, rows: 24 });
    await svc.spawn({ paneId: "p2", cols: 80, rows: 24 });
    svc.disposeAll();
    expect(svc.size()).toBe(0);
    expect(hoisted.fakes[0]!.kill).toHaveBeenCalled();
    expect(hoisted.fakes[1]!.kill).toHaveBeenCalled();
  });

  it("onData fires with the routed paneId, and the disposer unsubscribes", async () => {
    const svc = new PtyService();
    await svc.spawn({ paneId: "p1", cols: 80, rows: 24 });
    const events: { paneId: string; data: string; type: string }[] = [];
    const dispose = svc.onData((e) =>
      events.push({ paneId: e.paneId, data: e.data ?? "", type: e.type }),
    );
    hoisted.fakes.at(-1)!.emitData("hello");
    expect(events).toEqual([{ paneId: "p1", data: "hello", type: "data" }]);
    dispose();
    hoisted.fakes.at(-1)!.emitData("after dispose");
    expect(events).toHaveLength(1);
  });

  it("onExit fires with the routed paneId + exitCode and removes the session", async () => {
    const svc = new PtyService();
    await svc.spawn({ paneId: "p1", cols: 80, rows: 24 });
    const exits: { paneId: string; exitCode: number }[] = [];
    svc.onExit((e) => exits.push({ paneId: e.paneId, exitCode: e.exitCode ?? -1 }));
    hoisted.fakes.at(-1)!.emitExit(42);
    expect(exits).toEqual([{ paneId: "p1", exitCode: 42 }]);
    expect(svc.has("p1")).toBe(false);
  });
});

describe("PtyService shell resolution + rc filing", () => {
  it("uses shellOverride to resolve the binary path even when $SHELL disagrees", async () => {
    const svc = new PtyService();
    process.env["SHELL"] = "/bin/zsh";
    await svc.spawn({
      paneId: "p1",
      cols: 80,
      rows: 24,
      shellOverride: "/usr/local/bin/bash",
    });
    const fake = hoisted.fakes.at(-1)!;
    expect(fake.binary).toBe("/usr/local/bin/bash");
    expect(fake.args).toContain("-i");
  });

  it("writes a temp rc file with OSC 133 / OSC 7 markers for bash", async () => {
    const tmpBase = await fs.mkdtemp(join(tmpdir(), "bs-pty-test-"));
    try {
      const svc = new PtyService({ tmpBase });
      await svc.spawn({
        paneId: "p1",
        cols: 80,
        rows: 24,
        shellOverride: "/bin/bash",
      });
      const files = await fs.readdir(tmpBase);
      const rcFile = files.find((f) => f.startsWith("bs-bash-"));
      expect(rcFile, "expected a temp bash rc file").toBeDefined();
      const rc = await fs.readFile(join(tmpBase, rcFile!), "utf8");
      // bash bonus: emits the 133;C (outputStart) marker too, alongside
      // 133;A (promptStart), 133;D (commandEnd), and OSC 7 cwd.
      expect(rc).toContain("133;A");
      expect(rc).toContain("133;C");
      expect(rc).toContain("133;D");
      expect(rc).toContain("]7;file://");
      expect(rc).toContain("PROMPT_COMMAND");
      expect(rc).toContain("DEBUG");
      // The spawn args must point bash at our temp rc via --rcfile.
      const fake = hoisted.fakes.at(-1)!;
      const rcIdx = fake.args.indexOf("--rcfile");
      expect(rcIdx, "bash args should pass --rcfile <tempRc>").toBeGreaterThan(-1);
      expect(fake.args[rcIdx + 1]).toBe(join(tmpBase, rcFile!));
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true });
    }
  });

  it("writes a temp .zshrc under a fresh ZDOTDIR for zsh", async () => {
    const tmpBase = await fs.mkdtemp(join(tmpdir(), "bs-pty-test-"));
    try {
      const svc = new PtyService({ tmpBase });
      await svc.spawn({
        paneId: "p1",
        cols: 80,
        rows: 24,
        shellOverride: "/bin/zsh",
      });
      const entries = await fs.readdir(tmpBase, { withFileTypes: true });
      const zshDir = entries.find(
        (e) => e.isDirectory() && e.name.startsWith("bs-zsh-"),
      );
      expect(zshDir, "expected a temp zsh ZDOTDIR").toBeDefined();
      const rc = await fs.readFile(join(tmpBase, zshDir!.name, ".zshrc"), "utf8");
      expect(rc).toContain("133;A");
      expect(rc).toContain("133;D");
      expect(rc).toContain("133;C");
      expect(rc).toContain("]7;file://");
      expect(rc).toContain("preexec_functions");
      expect(rc).toContain("precmd_functions");
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true });
    }
  });

  it("writes a temp .ps1 with the prompt override for powershell", async () => {
    const tmpBase = await fs.mkdtemp(join(tmpdir(), "bs-pty-test-"));
    try {
      const svc = new PtyService({ tmpBase });
      const shellOverride =
        process.platform === "win32" ? "powershell.exe" : "pwsh";
      await svc.spawn({
        paneId: "p1",
        cols: 80,
        rows: 24,
        shellOverride,
      });
      const files = await fs.readdir(tmpBase);
      const rcFile = files.find(
        (f) => f.startsWith("bs-pwsh-") || f.startsWith("bs-powershell-"),
      );
      expect(rcFile, "expected a temp powershell rc file").toBeDefined();
      const rc = await fs.readFile(join(tmpBase, rcFile!), "utf8");
      expect(rc).toContain("133;A");
      expect(rc).toContain("133;D");
      expect(rc).toContain("]7;file://");
      expect(rc).toContain("function prompt");
      // PowerShell does SHIP the outputStart (133;C)? No — only A/D + OSC 7
      // because PowerShell has no portable preexec hook.
      expect(rc).not.toContain("133;C");
      // -File path must be in the args.
      const fake = hoisted.fakes.at(-1)!;
      const fileIdx = fake.args.indexOf("-File");
      expect(fileIdx, "powershell args should pass -File <tempRc>").toBeGreaterThan(-1);
      expect(fake.args[fileIdx + 1]).toBe(join(tmpBase, rcFile!));
      // Lever 2: the Windows console default-color pin (codex Console-API
      // light-bg lever — see ShellIntegration.test.ts for the focused suite).
      expect(rc).toContain("[Console]::BackgroundColor = 'White'");
      expect(rc).toContain("OSPlatform]::Windows");
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true });
    }
  });

  it("ships no integration rc (empty string) for cmd shells", async () => {
    const tmpBase = await fs.mkdtemp(join(tmpdir(), "bs-pty-test-"));
    try {
      const svc = new PtyService({ tmpBase });
      await svc.spawn({
        paneId: "p1",
        cols: 80,
        rows: 24,
        // cmd is only meaningful on Windows; the override maps to ShellKind=cmd
        // on any platform for the purposes of this test.
        shellOverride: process.platform === "win32" ? "cmd.exe" : "cmd",
      });
      const files = await fs.readdir(tmpBase);
      expect(files.find((f) => f.startsWith("bs-cmd-"))).toBeUndefined();
      const fake = hoisted.fakes.at(-1)!;
      expect(fake.args).toEqual([]);
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true });
    }
  });
});

describe("PtyService spawns a stable paneId mapping for the IPC layer", () => {
  it("onData events are tagged with the spawn's paneId, not node-pty's pid", async () => {
    const svc = new PtyService();
    await svc.spawn({ paneId: "alpha", cols: 80, rows: 24 });
    await svc.spawn({ paneId: "beta", cols: 80, rows: 24 });

    const seen: string[] = [];
    svc.onData((e) => seen.push(e.paneId));
    hoisted.fakes[0]!.emitData("from-alpha");
    hoisted.fakes[1]!.emitData("from-beta");
    expect(seen).toEqual(["alpha", "beta"]);
  });
});
