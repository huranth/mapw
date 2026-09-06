import { ArrowRightIcon, ClockIcon, FolderIcon, FolderPlusIcon, HistoryIcon, TerminalIcon } from "@/components/Icons";
import type { WorkspacePersist } from "@bridgespace/backend/renderer";

export interface ReturningScreenProps {
  readonly lastWorkspace: WorkspacePersist | null;
  readonly legacyLastCwd: string | null;
  readonly onContinue: () => void;
  readonly onChooseNew: () => void;
}

export function ReturningScreen({ lastWorkspace, legacyLastCwd, onContinue, onChooseNew }: ReturningScreenProps) {
  return (
    <div className="returning" data-testid="returning-screen">
      <div className="returning__hero" aria-hidden="true"><span className="returning__hero-icon" aria-hidden="true"><HistoryIcon size={22} style={{ color: "#1C1917" }} /></span></div>
      <h1 className="returning__headline">Welcome back</h1>
      <p className="returning__sub">Continue or start fresh.</p>
      {lastWorkspace ? (
        <div className="returning__summary">
          <span className="returning__summary__title"><ClockIcon size={12} style={{ marginRight: 6, color: "#134E4A" }} />{`Last session: ${lastWorkspace.nodes.length} terminal${lastWorkspace.nodes.length === 1 ? "" : "s"}`}</span>
          <ul className="returning__rows">
            {lastWorkspace.nodes.map((n) => (
              <li key={n.paneId} className="returning__row">
                <span className="returning__row__pane"><TerminalIcon size={10} style={{ marginRight: 5, color: "#2563EB" }} />{n.paneId}</span>
                <code className="returning__row__cwd" title={n.cwd ?? ""}><FolderIcon size={11} style={{ marginRight: 6, color: "#D97706", flexShrink: 0 }} />{n.cwd ?? "—"}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : legacyLastCwd ? (
        <div className="returning__summary">
          <span className="returning__summary__title"><ClockIcon size={12} style={{ marginRight: 6, color: "#134E4A" }} />Last session: 4 terminals in the same folder</span>
          <code className="returning__row__cwd" title={legacyLastCwd}><FolderIcon size={11} style={{ marginRight: 6, color: "#D97706" }} />{legacyLastCwd}</code>
        </div>
      ) : (
        <div className="returning__summary"><span className="returning__summary__title"><TerminalIcon size={12} style={{ marginRight: 6, color: "#7C3AED" }} />No previous session found</span></div>
      )}
      <div className="returning__cta-row">
        <button type="button" className="layouts__chip layouts__chip--primary" onClick={onContinue} data-testid="returning-continue">Continue <ArrowRightIcon size={11} style={{ marginLeft: 6, color: "#FFF" }} /></button>
        <button type="button" className="layouts__chip" onClick={onChooseNew} data-testid="returning-choose-new"><FolderPlusIcon size={11} style={{ marginRight: 5, color: "#134E4A" }} />Choose a new folder</button>
      </div>
    </div>
  );
}
