// ReturningScreen — the returning-launch surface. Fires whenever Workspace's
// gate resolves to `phase === "returning"` (Settings has either a persisted
// workspace skeleton OR a pre-feature lastCwd). The TitleBar stays live above
// so the user recognises they're still in the app.
//
// The summary has two shapes:
//   - Skeleton present: lists each pane id + last cwd so the user can see
//     exactly what they're restoring before clicking Continue.
//   - Legacy lastCwd only (workspace null): single "4 terminals in the same
//     folder / <path>" line — the upgrade-from-pre-feature-build path.
//     Continue migrates this lastCwd into a fresh 4-pane skeleton.
// "Continue" rehydrates from settings + sets phase → ready. "Choose a new
// folder" flips phase to "welcome" (the welcome commit overwrites the old
// skeleton).

import { ArrowRightIcon, FolderPlusIcon } from "@/components/Icons";
import type { WorkspacePersist } from "@bridgespace/backend/renderer";

export interface ReturningScreenProps {
  readonly lastWorkspace: WorkspacePersist | null;
  readonly legacyLastCwd: string | null;
  readonly onContinue: () => void;
  readonly onChooseNew: () => void;
}

export function ReturningScreen({
  lastWorkspace,
  legacyLastCwd,
  onContinue,
  onChooseNew,
}: ReturningScreenProps) {
  return (
    <div className="returning" data-testid="returning-screen">
      <h1 className="returning__headline">Welcome back</h1>
      <p className="returning__sub">
        Continue your last workspace, or start fresh with a new folder.
      </p>

      {lastWorkspace ? (
        <div className="returning__summary returning__summary--rows">
          <span className="returning__summary__title">
            {`Last session: ${lastWorkspace.nodes.length} terminal${
              lastWorkspace.nodes.length === 1 ? "" : "s"
            }`}
          </span>
          <ul className="returning__rows">
            {lastWorkspace.nodes.map((n) => (
              <li key={n.paneId} className="returning__row">
                <span className="returning__row__pane">{n.paneId}</span>
                <code className="returning__row__cwd" title={n.cwd ?? ""}>
                  {n.cwd ?? "—"}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : legacyLastCwd != null ? (
        <div className="returning__summary returning__summary--legacy">
          <span className="returning__summary__title">
            Last session: 4 terminals in the same folder
          </span>
          <code className="returning__row__cwd" title={legacyLastCwd}>
            {legacyLastCwd}
          </code>
        </div>
      ) : (
        // Defensive: Workspace's gate should never send us here with both
        // null, but render something sensible if it does. onContinue falls
        // through to a no-op hydrate + ready canvas — seed panes spawn in
        // os.homedir() per TerminalPane's cwd chain.
        <div className="returning__summary returning__summary--empty">
          <span className="returning__summary__title">
            No previous session found
          </span>
        </div>
      )}

      <div className="returning__cta-row">
        <button
          type="button"
          className="returning__cta returning__cta--primary"
          onClick={onContinue}
          data-testid="returning-continue"
        >
          Continue <ArrowRightIcon />
        </button>
        <button
          type="button"
          className="returning__cta returning__cta--secondary"
          onClick={onChooseNew}
          data-testid="returning-choose-new"
        >
          <FolderPlusIcon /> Choose a new folder
        </button>
      </div>
    </div>
  );
}
