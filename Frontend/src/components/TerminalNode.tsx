// TerminalNode — a React Flow custom node whose body is one
// <TerminalPane paneId={id}>. The node id doubles as the paneId: every node
// in the canvas store produces a unique shell, so React Flow's `node.id` and
// the terminalsStore paneId stay in 1:1 sync.
//
// The header is the drag handle (no `nodrag` class); the body carries
// `nodrag` so xterm cursor motion + selection inside it doesn't kick off a
// node drag. React Flow requires `<Handle>` mounts even with empty edges —
// we render them at top + bottom but keep them visually invisible so the
// node reads as a clean inked rectangle. No `+` resize affordance: per-node
// resize is deferred to M3.

import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CopyIcon, XIcon } from "@/components/Icons";
import { TerminalPane } from "@/terminals/TerminalPane";
import { paneBufferToText } from "@/terminals/terminalRegistry";
import { useCanvasStore } from "@/stores/canvas";

export function TerminalNode({ id, data }: NodeProps) {
  // Per-pane cwd override, carried on canvas node.data via the New Terminal
  // folder picker. null for the 4 boot seeds (data is {}); the chosen string
  // for "+ New terminal" panes. Forwarded to TerminalPane via prop — its
  // resolved-cwd chain prefers this over Settings.lastCwd. Xyflow's plain
  // `NodeProps` types `data` as `Record<string, unknown>`, so the picker's
  // `cwd` is cast defensively here to string|null.
  const cwd = (data?.cwd as string | undefined) ?? null;
  const removeNode = useCanvasStore((s) => s.removeNode);
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
    <div className="node-terminal" data-testid={`node-${id}`}>
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
        <TerminalPane paneId={id} cwd={cwd} />
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="node-terminal__handle--hidden"
        isConnectable={false}
      />
    </div>
  );
}
