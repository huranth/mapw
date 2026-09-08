import { useState } from "react";
import type { PaneNodePersist } from "@mapw/backend/renderer";
import { ArrowRightIcon, CompassIcon, FolderIcon, FolderPlusIcon, GridIcon, RefreshIcon, TerminalIcon } from "@/components/Icons";
import { seedNodes } from "@/stores/canvas";

export interface WelcomeSetupScreenProps { onCommit: (nodes: PaneNodePersist[], primaryCwd: string) => void; compact?: boolean; }
type SlotId = "shared" | 0 | 1 | 2 | 3;

export function WelcomeSetupScreen({ onCommit, compact = false }: WelcomeSetupScreenProps) {
  const [perPane, setPerPane] = useState(false);
  const [sharedCwd, setSharedCwd] = useState<string | null>(null);
  const [perPaneCwds, setPerPaneCwds] = useState<(string | null)[]>([null, null, null, null]);

  const pick = async (slot: SlotId) => {
    const result = await window.bridge.openDirectoryDialog();
    if (!result || result.canceled || result.filePaths.length === 0) return;
    const [cwd] = result.filePaths;
    if (cwd === undefined) return;
    if (slot === "shared") setSharedCwd(cwd);
    else setPerPaneCwds((prev) => prev.map((c, i) => (i === slot ? cwd : c)));
  };

  const ready = perPane ? perPaneCwds.every((c) => c != null) : sharedCwd != null;

  const onOpenWorkspace = () => {
    if (!ready) return;
    const cwds = perPane ? perPaneCwds : [sharedCwd, sharedCwd, sharedCwd, sharedCwd];
    const primaryCwd = cwds[0] ?? null;
    if (primaryCwd === null) return;
    onCommit(seedNodes(cwds), primaryCwd);
  };

  return (
    <div className="welcome" data-testid="welcome-screen">
      {!compact && <><div className="welcome__hero" aria-hidden="true"><span className="welcome__hero-icon" aria-hidden="true"><CompassIcon size={22} style={{ color: "#1C1917" }} /></span></div><h1 className="welcome__headline">Welcome</h1><p className="welcome__sub">Pick a folder to begin.</p></>}
      {perPane ? (
        <div className="welcome__grid">
          {([0, 1, 2, 3] as const).map((slot) => (
            <PickerCard key={slot} label={`Terminal p${slot + 1}`} cwd={perPaneCwds[slot] ?? null} onPick={() => void pick(slot)} />
          ))}
        </div>
      ) : (
        <PickerCard label="Folder" cwd={sharedCwd} onPick={() => void pick("shared")} full />
      )}
      <label className="welcome__toggle">
        <input type="checkbox" checked={perPane} onChange={(e) => setPerPane(e.target.checked)} />
        <span className="welcome__toggle__label"><GridIcon size={12} style={{ marginRight: 6, color: "#57534E" }} />Use a different folder per pane</span>
      </label>
      <button type="button" className="welcome__cta" disabled={!ready} onClick={onOpenWorkspace} data-testid="welcome-open-workspace"><TerminalIcon size={13} style={{ marginRight: 7, color: "#FFF" }} />Open workspace <ArrowRightIcon size={13} style={{ marginLeft: 6, color: "#FFF" }} /></button>
    </div>
  );
}

function PickerCard({ label, cwd, onPick, full }: { label: string; cwd: string | null; onPick: () => void; full?: boolean }) {
  const idx = label.match(/p(\d)/)?.[1];
  return (
    <div className={`welcome__card${full ? " welcome__card--full" : ""}`}>
      <span className="welcome__card__label"><FolderIcon size={12} style={{ marginRight: 6, color: "#D97706" }} />{label}{idx ? <span className="welcome__card__num">· p{idx}</span> : null}</span>
      {cwd !== null ? (
        <>
          <code className="welcome__card__path" title={cwd}>{cwd}</code>
          <button type="button" className="welcome__filechip" onClick={onPick} aria-label={`Change ${label}`}><RefreshIcon size={12} style={{ marginRight: 6, color: "#2563EB" }} />Change</button>
        </>
      ) : (
        <button type="button" className="welcome__filechip welcome__filechip--primary" onClick={onPick} aria-label={`Choose folder for ${label}`}><FolderPlusIcon size={12} style={{ marginRight: 6, color: "#D97706" }} />Choose folder</button>
      )}
    </div>
  );
}