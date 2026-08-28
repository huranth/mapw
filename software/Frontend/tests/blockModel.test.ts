// blockModel — pure state machine. Feeds OSC 133 / OSC 7 events (parsed
// through the same `parseOscPayload` the renderer registers as an xterm OSC
// handler) into the model and asserts the block lifecycle: promptStart opens
// a block, commandEnd closes it with the exit code, cwd seeds/updates the
// working directory, commandStart/outputStart are observed but do not split,
// and an orphan commandEnd before any promptStart is dropped.

import { describe, expect, it } from "vitest";
import {
  parseOscPayload,
  type OscEvent,
} from "@bridgespace/backend/renderer";
import {
  createBlockModel,
  disposeBlockModel,
  handleOscEvent,
} from "@/terminals/blockModel";

function event(payload: string): OscEvent {
  const ev = parseOscPayload(payload);
  if (!ev) throw new Error(`expected an OscEvent from ${JSON.stringify(payload)}`);
  return ev;
}

describe("blockModel — OSC 133 + OSC 7 → Block lifecycle", () => {
  it("starts empty", () => {
    const m = createBlockModel();
    expect(m.blocks).toEqual([]);
    expect(m.current).toBeNull();
    expect(m.cwd).toBeNull();
    expect(m.hostname).toBeNull();
  });

  it("opens a fresh block on promptStart (133;A)", () => {
    const m = handleOscEvent(createBlockModel(), event("133;A"));
    expect(m.blocks).toHaveLength(1);
    expect(m.current).not.toBeNull();
    expect(m.current?.status).toBe("open");
    expect(m.current?.exitCode).toBeNull();
    expect(m.current?.closedAt).toBeNull();
  });

  it("closes the open block on commandEnd (133;D;<exit>) with the exit code + timestamp", () => {
    let m = createBlockModel();
    m = handleOscEvent(m, event("133;A"));
    m = handleOscEvent(m, event("133;D;0"));
    expect(m.current).toBeNull();
    expect(m.blocks[0]?.status).toBe("closed");
    expect(m.blocks[0]?.exitCode).toBe(0);
    expect(m.blocks[0]?.closedAt).not.toBeNull();
  });

  it("records non-zero exit codes for failure surfacing", () => {
    let m = createBlockModel();
    m = handleOscEvent(m, event("133;A"));
    m = handleOscEvent(m, event("133;D;127"));
    expect(m.blocks[0]?.exitCode).toBe(127);
  });

  it("parses the commandEnd exit code as null when the marker omits it (133;D alone)", () => {
    let m = createBlockModel();
    m = handleOscEvent(m, event("133;A"));
    m = handleOscEvent(m, event("133;D"));
    expect(m.blocks[0]?.exitCode).toBeNull();
    expect(m.blocks[0]?.status).toBe("closed");
  });

  it("drops an orphan commandEnd fired before any promptStart", () => {
    const m = handleOscEvent(createBlockModel(), event("133;D;0"));
    expect(m.blocks).toHaveLength(0);
    expect(m.current).toBeNull();
  });

  it("lifts cwd + hostname from OSC 7 and seeds the open block", () => {
    let m = createBlockModel();
    m = handleOscEvent(m, event("133;A"));
    m = handleOscEvent(m, event("7;file://w-laptop/Users/w/proj"));
    expect(m.cwd).toBe("/Users/w/proj");
    expect(m.hostname).toBe("w-laptop");
    expect(m.current?.cwd).toBe("/Users/w/proj");
    expect(m.current?.hostname).toBe("w-laptop");
    expect(m.blocks[0]?.cwd).toBe("/Users/w/proj");
  });

  it("records cwd lifted OUTSIDE an open block (transient no-prompt gap)", () => {
    const m = handleOscEvent(createBlockModel(), event("7;file://host/Users/x"));
    expect(m.cwd).toBe("/Users/x");
    expect(m.hostname).toBe("host");
    expect(m.blocks).toHaveLength(0);
  });

  it("seeds a new block with the last known cwd at promptStart time", () => {
    let m = createBlockModel();
    m = handleOscEvent(m, event("7;file://host/Users/seeded"));
    m = handleOscEvent(m, event("133;A"));
    expect(m.current?.cwd).toBe("/Users/seeded");
    m = handleOscEvent(m, event("133;D;0"));
    expect(m.blocks[0]?.cwd).toBe("/Users/seeded");
  });

  it("observes commandStart + outputStart (133;B/C) without splitting blocks", () => {
    let m = createBlockModel();
    m = handleOscEvent(m, event("133;A"));
    const before = m.blocks.length;
    m = handleOscEvent(m, event("133;B"));
    m = handleOscEvent(m, event("133;C"));
    expect(m.blocks.length).toBe(before);
    expect(m.current?.status).toBe("open");
  });

  it("accumulates one block per prompt cycle, newest at the tail", () => {
    let m = createBlockModel();
    m = handleOscEvent(m, event("133;A"));
    m = handleOscEvent(m, event("133;D;0"));
    m = handleOscEvent(m, event("133;A"));
    m = handleOscEvent(m, event("133;D;2"));
    expect(m.blocks).toHaveLength(2);
    expect(m.blocks[0]?.exitCode).toBe(0);
    expect(m.blocks[1]?.exitCode).toBe(2);
  });

  it("disposeBlockModel is a safe no-op on a marker-less pure model", () => {
    let m = createBlockModel();
    m = handleOscEvent(m, event("133;A"));
    m = handleOscEvent(m, event("133;D;0"));
    expect(() => disposeBlockModel(m)).not.toThrow();
  });
});
