import { describe, expect, it } from "vitest";
import { OscParser, parseOscPayload } from "../src/pty/osc.js";

const BEL = "\x07";
const ST = "\x1b\\";
const osc = (body: string, term: string = BEL) => `\x1b]${body}${term}`;

describe("parseOscPayload", () => {
  it("maps 133 marks to prompt lifecycle events", () => {
    expect(parseOscPayload("133;A")).toEqual({ type: "promptStart" });
    expect(parseOscPayload("133;B")).toEqual({ type: "commandStart" });
    expect(parseOscPayload("133;C")).toEqual({ type: "outputStart" });
  });

  it("parses 133;D exit codes (numeric, zero, missing)", () => {
    expect(parseOscPayload("133;D;0")).toEqual({ type: "commandEnd", exitCode: 0 });
    expect(parseOscPayload("133;D;127")).toEqual({ type: "commandEnd", exitCode: 127 });
    expect(parseOscPayload("133;D")).toEqual({ type: "commandEnd", exitCode: null });
  });

  it("parses OSC 7 cwd uris (file://host/path, escaped)", () => {
    expect(parseOscPayload("7;file://w-laptop/Users/w/proj")).toEqual({
      type: "cwd",
      hostname: "w-laptop",
      path: "/Users/w/proj",
    });
    expect(parseOscPayload("7;file://host/Users/w/my%20dir")).toEqual({
      type: "cwd",
      hostname: "host",
      path: "/Users/w/my dir",
    });
  });

  it("ignores unknown OSC codes and malformed bodies", () => {
    expect(parseOscPayload("0;some title")).toBeNull();
    expect(parseOscPayload("133;Z")).toBeNull(); // unknown mark
    expect(parseOscPayload("7;not-a-url")).toBeNull();
    expect(parseOscPayload("7;https://example.com")).toBeNull();
  });
});

describe("OscParser", () => {
  it("emits events for a single complete sequence", () => {
    const p = new OscParser();
    const events = p.push(osc("133;A"));
    expect(events).toEqual([{ type: "promptStart" }]);
  });

  it("emits a full prompt->command->output->exit cycle in order", () => {
    const p = new OscParser();
    const events = p.push(
      osc("133;A") + osc("133;B") + osc("133;C") + osc("133;D;0")
    );
    expect(events).toEqual([
      { type: "promptStart" },
      { type: "commandStart" },
      { type: "outputStart" },
      { type: "commandEnd", exitCode: 0 },
    ]);
  });

  it("accepts the ST (ESC \) terminator in place of BEL", () => {
    const p = new OscParser();
    expect(p.push(`\x1b]133;A${ST}`)).toEqual([{ type: "promptStart" }]);
  });

  it("handles sequences split across chunk boundaries", () => {
    const p = new OscParser();
    expect(p.push("\x1b]133")).toEqual([]);
    expect(p.push(";D;0\x07")).toEqual([{ type: "commandEnd", exitCode: 0 }]);
  });

  it("handles a dangling ESC split across chunks", () => {
    const p = new OscParser();
    expect(p.push("hello \x1b")).toEqual([]);
    expect(p.push("]133;A\x07")).toEqual([{ type: "promptStart" }]);
  });

  it("ignores interleaved non-OSC text and still finds later sequences", () => {
    const p = new OscParser();
    const events = p.push("ls -la\r\n" + osc("133;D;2") + "drwxr-xr-x src");
    expect(events).toEqual([{ type: "commandEnd", exitCode: 2 }]);
  });

  it("reset() drops any buffered partial sequence", () => {
    const p = new OscParser();
    p.push("\x1b]133");
    p.reset();
    expect(p.push(";A\x07")).toEqual([]);
  });
});
