// OSC sequence parser for shell-integration markers (semantic prompts).
// Handles OSC 133 (A/B/C/D prompt boundaries) and OSC 7 (cwd).
//
// This is a pure-logic reference implementation, decoupled from xterm.js so it
// can be unit-tested. In the live terminal (M1) we additionally register the
// same handlers via xterm.js `parser.registerOscHandler` so the renderer can
// cut command blocks from the same markers alongside the visible buffer.

const ESC = "\x1b";
const OSC_START = "\x1b]";
const BEL = "\x07";
const ST = "\x1b\\"; // String Terminator (ESC backslash)

export type OscEvent =
  | { type: "promptStart" }
  | { type: "commandStart" }
  | { type: "outputStart" }
  | { type: "commandEnd"; exitCode: number | null }
  | { type: "cwd"; path: string; hostname: string };

export class OscParser {
  private buffer = "";

  push(chunk: string): OscEvent[] {
    this.buffer += chunk;
    const events: OscEvent[] = [];

    let i = 0;
    while (i < this.buffer.length) {
      const start = this.buffer.indexOf(OSC_START, i);
      if (start === -1) {
        // No complete OSC opener. Retain a lone trailing ESC so a sequence
        // split across chunks can complete on the next push().
        const tail = this.buffer.endsWith(ESC) ? ESC : "";
        this.buffer = tail;
        return events;
      }

      const oscStart = start + OSC_START.length;
      const belIdx = this.buffer.indexOf(BEL, oscStart);
      const stIdx = this.buffer.indexOf(ST, oscStart);

      let endIdx = -1;
      let termLen = 0;
      if (belIdx !== -1 && (stIdx === -1 || belIdx < stIdx)) {
        endIdx = belIdx;
        termLen = BEL.length;
      } else if (stIdx !== -1) {
        endIdx = stIdx;
        termLen = ST.length;
      } else {
        // Incomplete sequence — keep everything from `start` for the next push().
        this.buffer = this.buffer.slice(start);
        return events;
      }

      const payload = this.buffer.slice(oscStart, endIdx);
      const event = parseOscPayload(payload);
      if (event) events.push(event);
      i = endIdx + termLen;
    }

    this.buffer = "";
    return events;
  }

  reset(): void {
    this.buffer = "";
  }
}

export function parseOscPayload(payload: string): OscEvent | null {
  const sep = payload.indexOf(";");
  const code = sep === -1 ? payload : payload.slice(0, sep);
  const body = sep === -1 ? "" : payload.slice(sep + 1);

  switch (code) {
    case "133":
      return parse133(body);
    case "7":
      return parse7(body);
    default:
      return null;
  }
}

function parse133(body: string): OscEvent | null {
  if (body === "") return null;
  const mark = body[0];
  switch (mark) {
    case "A":
      return { type: "promptStart" };
    case "B":
      return { type: "commandStart" };
    case "C":
      return { type: "outputStart" };
    case "D": {
      const remainder = body.slice(1).replace(/^;/, "");
      if (remainder === "") return { type: "commandEnd", exitCode: null };
      const n = Number(remainder);
      return Number.isFinite(n) ? { type: "commandEnd", exitCode: n } : null;
    }
    default:
      return null;
  }
}

function parse7(body: string): OscEvent | null {
  let url: URL;
  try {
    url = new URL(body);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  return {
    type: "cwd",
    hostname: url.hostname,
    path: decodeURIComponent(url.pathname),
  };
}
