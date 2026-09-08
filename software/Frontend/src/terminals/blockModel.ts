import type { IMarker } from "@xterm/xterm";
import type { OscEvent } from "@mapw/backend/renderer";

export type BlockStatus = "open" | "closed";
export interface Block { readonly id: string; readonly promptMarker: IMarker | null; exitMarker: IMarker | null; exitCode: number | null; cwd: string | null; hostname: string | null; startedAt: number; closedAt: number | null; status: BlockStatus; }
export interface BlockModelState { blocks: Block[]; current: Block | null; cwd: string | null; hostname: string | null; }
export function createBlockModel(): BlockModelState { return { blocks: [], current: null, cwd: null, hostname: null }; }

let seq = 0;
function nextId(): string { seq += 1; return `blk-${seq.toString(36)}-${Date.now().toString(36)}`; }

export interface OscEventMarkers { readonly prompt?: IMarker | null; readonly exit?: IMarker | null; }

function closeCurrent(blocks: Block[], current: Block, patch: Partial<Block> = {}): Block[] {
  const closed: Block = { ...current, exitMarker: null, exitCode: null, closedAt: Date.now(), status: "closed", ...patch };
  return blocks.map((b) => (b.id === current.id ? closed : b));
}

export function handleOscEvent(state: BlockModelState, event: OscEvent, markers: OscEventMarkers = {}): BlockModelState {
  switch (event.type) {
    case "promptStart": {
      const blocks = state.current ? closeCurrent(state.blocks, state.current) : state.blocks;
      const block: Block = { id: nextId(), promptMarker: markers.prompt ?? null, exitMarker: null, exitCode: null, cwd: state.cwd, hostname: state.hostname, startedAt: Date.now(), closedAt: null, status: "open" };
      return { ...state, current: block, blocks: [...blocks, block] };
    }
    case "commandEnd": {
      if (!state.current) return state;
      const closed: Block = { ...state.current, exitMarker: markers.exit ?? null, exitCode: event.exitCode, closedAt: Date.now(), status: "closed" };
      return { ...state, current: null, blocks: state.blocks.map((b) => (b.id === state.current!.id ? closed : b)) };
    }
    case "cwd": {
      const { path: cwd, hostname } = event;
      if (!state.current) return { ...state, cwd, hostname };
      const upd: Block = { ...state.current, cwd, hostname };
      return { ...state, cwd, hostname, current: upd, blocks: state.blocks.map((b) => (b.id === state.current!.id ? upd : b)) };
    }
    case "commandStart":
    case "outputStart": return state;
  }
}

export function disposeBlockModel(state: BlockModelState): void {
  for (const b of state.blocks) { try { b.promptMarker?.dispose(); } catch {} try { b.exitMarker?.dispose(); } catch {} }
  state.blocks.length = 0;
  (state as { current: Block | null }).current = null;
}
