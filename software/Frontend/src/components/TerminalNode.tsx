import { useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { CheckIcon, CliIcon, CopyIcon, SparklesIcon, TerminalIcon, XIcon } from "@/components/Icons";
import { TerminalPane } from "@/terminals/TerminalPane";
import { paneBufferToText } from "@/terminals/terminalRegistry";
import { useCanvasStore } from "@/stores/canvas";
import { useCliToolsStore } from "@/stores/cliTools";
import { useTerminalsStore } from "@/stores/terminals";

const MIN_NODE_W = 320;
const MIN_NODE_H = 160;

export function TerminalNode({ id, data }: NodeProps) {
  const cwd = (data?.cwd as string | undefined) ?? null;
  const cliId = (data?.cliId as string | undefined) ?? null;
  const removeNode = useCanvasStore((s) => s.removeNode);
  const cliTools = useCliToolsStore((s) => s.cliTools);
  const tuiRunning = useTerminalsStore((s) => s.panes[id]?.tuiRunning ?? false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => { if (timerRef.current != null) clearTimeout(timerRef.current); }, []);
  const onCopyClick = () => {
    const text = paneBufferToText(id);
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1000);
    }).catch(() => {});
  };
  return (
    <div className="node-terminal-wrap" data-testid={`node-${id}`}>
      <div className="node-terminal">
        <Handle type="target" position={Position.Top} className="node-terminal__handle--hidden" isConnectable={false} />
        <header className="node-terminal__header">
          <div className="node-terminal__dots" aria-hidden="true">
            <span className="node-terminal__dot" /><span className="node-terminal__dot" /><span className="node-terminal__dot" />
          </div>
          <span className="node-terminal__label"><TerminalIcon size={10} style={{ marginRight: 6, color: "#134E4A" }} />{id}</span>
          <span className="node-terminal__focus-tag" aria-hidden="true" data-testid={`node-${id}-focus-tag`}><SparklesIcon size={9} style={{ marginRight: 4, color: "#FFF" }} />Focus</span>
          <div className="node-terminal__chips" data-testid={`node-${id}-chips`} hidden={tuiRunning}>
            {cliTools.map((cli) => (
              <button key={cli.id} type="button" className="node-terminal__chip" aria-label={`Launch ${cli.name} in ${id}`} onClick={() => { void window.bridge.ptyWrite(id, `${cli.launchCommand}\r`).catch(() => {}); }}><CliIcon id={cli.id} size={11} style={{ marginRight: 5 }} />{cli.name}</button>
            ))}
          </div>
          <button type="button" className={`node-terminal__copy${copied ? " node-terminal__copy--copied" : ""}`} aria-label={`Copy ${id} content`} onClick={onCopyClick}>{copied ? <><CheckIcon size={11} style={{ marginRight: 4, color: "#059669" }} />Copied</> : <>Copy<CopyIcon size={11} style={{ marginLeft: 4, color: "#2563EB" }} /></>}</button>
          <button type="button" className="node-terminal__close" aria-label={`Close ${id}`} onClick={() => removeNode(id)}><XIcon size={12} style={{ color: "#DC2626" }} /></button>
        </header>
        <div className="node-terminal__body nodrag"><TerminalPane paneId={id} cwd={cwd} cliId={cliId} /></div>
        <Handle type="source" position={Position.Bottom} className="node-terminal__handle--hidden" isConnectable={false} />
      </div>
      <NodeResizer nodeId={id} minWidth={MIN_NODE_W} minHeight={MIN_NODE_H} />
    </div>
  );
}
