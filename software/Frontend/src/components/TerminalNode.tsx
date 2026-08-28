// TerminalNode — a React Flow custom node whose body is one
// <TerminalPane paneId={id}>. The node id doubles as the paneId: every node
// in the canvas store produces a unique shell, so React Flow's `node.id` and
// the terminalsStore paneId stay in 1:1 sync.
//
// The header is the drag handle (no `nodrag` class); the body carries
// `nodrag` so xterm cursor motion + selection inside it doesn't kick off a
// node drag. React Flow requires `<Handle>` mounts even with empty edges —
// we render them at top + bottom but keep them visually invisible so the
// node reads as a clean inked rectangle. Per-node resize is wired through
// React Flow's <NodeResizer> (mounted inside a `.node-terminal-wrap`
// positioning context so the overflow-hidden card doesn't clip the edge
// handles); the cursor already swaps to the matching arrow-resize cursor on
// hover — see the `.react-flow__resize-control` rules in styles.css for the
// hover accents + direction-arrow glyphs.

import { useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { CopyIcon, XIcon } from "@/components/Icons";
import { TerminalPane } from "@/terminals/TerminalPane";
import { paneBufferToText } from "@/terminals/terminalRegistry";
import { useCanvasStore } from "@/stores/canvas";
import { useCliToolsStore } from "@/stores/cliTools";
import { useTerminalsStore } from "@/stores/terminals";

// Minimum drag-down size for a resizable terminal node (px, React Flow user
// space). Floored so the 28px header + a usable xterm grid always fit; above
// this the user can grow a pane arbitrarily.
const MIN_NODE_W = 320;
const MIN_NODE_H = 160;

export function TerminalNode({ id, data }: NodeProps) {
  // Per-pane cwd override, carried on canvas node.data via the New Terminal
  // folder picker. null for the 4 boot seeds (data is {}); the chosen string
  // for "+ New terminal" panes. Forwarded to TerminalPane via prop — its
  // resolved-cwd chain prefers this over Settings.lastCwd. Xyflow's plain
  // `NodeProps` types `data` as `Record<string, unknown>`, so the picker's
  // `cwd` is cast defensively here to string|null.
  const cwd = (data?.cwd as string | undefined) ?? null;
  // Per-pane curated-CLI id bound by a saved layout (read from canvas node
  // data — set via hydrate(nodes-with-cliId) or addTerminal(cwd, cliId)).
  // Forwarded to TerminalPane via the cliId prop — its spawn-resolved ptyWrite
  // is the auto-launch primitive; this field is the layout's input.
  // null/undefined = raw-shell boot (the existing default pre-feature). NOT a
  // strip opt-out signal — TerminalPane's cursor + chip-strip machinery is
  // exactly the same regardless of cliId.
  const cliId = (data?.cliId as string | undefined) ?? null;
  const removeNode = useCanvasStore((s) => s.removeNode);
  // Famous-CLI chips populated by Workspace's app-boot scan (the curated list
  // in Backend/src/cli/types.ts filtered by what actually lives on PATH).
  // Only installed CLIs render — a fresh box without opencode shows an empty
  // strip instead of a 404-on-click ghost.
  const cliTools = useCliToolsStore((s) => s.cliTools);
  // TUI-running hide signal — set by TerminalPane on the first `\x1b[?1049h`
  // ("enter alt screen") chunk + cleared on `\x1b[?1049l` ("leave alt
  // screen"). When a TUI is running the chip strip is hidden (HTML5 `hidden`
  // attribute = UA-default `display: none`) so the user can't fire
  // `${cli}\r` into the running TUI's stdin by accident; it reappears when
  // the user exits back to the bare shell.
  const tuiRunning = useTerminalsStore((s) => s.panes[id]?.tuiRunning ?? false);
  // `copied` holds a transient "Copied" flash so the button flips green for
  // ~1s after a successful clipboard write — gives the user a click-landed
  // signal without needing a global toast.
  const [copied, setCopied] = useState(false);
  const onCopyClick = () => {
    const text = paneBufferToText(id);
    if (text == null) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    });
  };
  return (
    <div className="node-terminal-wrap" data-testid={`node-${id}`}>
      <div className="node-terminal">
        <Handle
          type="target"
          position={Position.Top}
          className="node-terminal__handle--hidden"
          isConnectable={false}
        />
        <header className="node-terminal__header">
          <div className="node-terminal__dots" aria-hidden="true">
            <span className="node-terminal__dot" />
            <span className="node-terminal__dot" />
            <span className="node-terminal__dot" />
          </div>
          <span className="node-terminal__label">{id}</span>
          {/* Focus tag — pill that lives in the header showing ONLY when the
              pane inside this node has focus (click → xterm's helper textarea
              grabs focus → `:focus-within` propagates up to `.node-terminal`
              → the CSS rule lights this pill). Replaces the previous 2 px-inset
              accent box-shadow on `.pane:focus-within` (the ring sat on codex's
              content and flickered against each codex per-frame repaint). The
              chip strip below may auto-hide while a TUI runs; this tag does
              not, so the focus cue persists through codex's entire run. The
              `aria-hidden` mirrors the dots' pattern: it's a presentational
              cue, not interactive — screen readers shouldn't read it twice. */}
          <span
            className="node-terminal__focus-tag"
            aria-hidden="true"
            data-testid={`node-${id}-focus-tag`}
          >
            Focus
          </span>
          <div
            className="node-terminal__chips"
            data-testid={`node-${id}-chips`}
            hidden={tuiRunning}
          >
            {cliTools.map((cli) => (
              <button
                key={cli.id}
                type="button"
                className="node-terminal__chip"
                aria-label={`Launch ${cli.name} in ${id}`}
                onClick={() => void window.bridge.ptyWrite(id, `${cli.launchCommand}\r`)}
              >
                {cli.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`node-terminal__copy${copied ? " node-terminal__copy--copied" : ""}`}
            aria-label={`Copy ${id} content`}
            onClick={onCopyClick}
          >
            {copied ? "Copied" : "Copy"}
            <CopyIcon style={{ marginLeft: 4 }} />
          </button>
          <button
            type="button"
            className="node-terminal__close"
            aria-label={`Close ${id}`}
            onClick={() => removeNode(id)}
          >
            <XIcon />
          </button>
        </header>
        <div className="node-terminal__body nodrag">
          <TerminalPane paneId={id} cwd={cwd} cliId={cliId} />
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="node-terminal__handle--hidden"
          isConnectable={false}
        />
      </div>
      <NodeResizer nodeId={id} minWidth={MIN_NODE_W} minHeight={MIN_NODE_H} />
    </div>
  );
}
