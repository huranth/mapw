// WelcomeSetupScreen — first-ever-launch + "Choose a new folder" picker
// surface. Replaces the legacy silent native-picker auto-pop at first boot
// (which read as "did a virus just pop up?") with a calm in-app card. TitleBar
// + StatusBar stay live above + below so the user sees they never left the
// app.
//
// Two modes:
//   - Shared (default): one picker card; the picked folder seeds all 4 panes.
//   - Per pane (opt-in): 2x2 grid of 4 picker cards, each independently
//     chosen. CTA stays disabled until ALL 4 slots are filled.
// "Open workspace" commits the chosen cwds + SEED positions to
// Settings.workspace AND Settings.lastCwd, hydrates the canvas store, then
// flips phase → ready (canvas mounts). Native picker fires only on a button
// onClick — not on mount — so StrictMode's double-mount is harmless.

import { useState } from "react";
import type { PaneNodePersist } from "@bridgespace/backend/renderer";
import { ArrowRightIcon, FolderIcon, FolderPlusIcon, RefreshIcon } from "@/components/Icons";
import { seedNodes } from "@/stores/canvas";

export interface WelcomeSetupScreenProps {
  onCommit: (nodes: PaneNodePersist[], primaryCwd: string) => void;
}

// "shared" refers to the Folder card in shared mode; 0..3 index a per-pane
// slot whose paneId is `p${slot+1}`.
type SlotId = "shared" | 0 | 1 | 2 | 3;

export function WelcomeSetupScreen({ onCommit }: WelcomeSetupScreenProps) {
  const [perPane, setPerPane] = useState(false);
  const [sharedCwd, setSharedCwd] = useState<string | null>(null);
  const [perPaneCwds, setPerPaneCwds] = useState<(string | null)[]>([
    null,
    null,
    null,
    null,
  ]);

  // The native picker fires from this onClick (user-driven), not from a
  // mount effect — StrictMode's double-mount simply calls useState on the
  // same instance twice and is harmless. The picker resolves async; only
  // a non-canceled result mutates the slot's cwd.
  const pick = async (slot: SlotId) => {
    const result = await window.bridge.openDirectoryDialog();
    if (!result || result.canceled || result.filePaths.length === 0) return;
    const [cwd] = result.filePaths;
    if (cwd === undefined) return;
    if (slot === "shared") setSharedCwd(cwd);
    else setPerPaneCwds((prev) => prev.map((c, i) => (i === slot ? cwd : c)));
  };

  const ready = perPane
    ? perPaneCwds.every((c) => c != null)
    : sharedCwd != null;

  const onOpenWorkspace = () => {
    if (!ready) return;
    const cwds = perPane
      ? perPaneCwds
      : [sharedCwd, sharedCwd, sharedCwd, sharedCwd];
    // shared mode verifies sharedCwd != null via `ready`; per-pane mode
    // verifies every entry. primaryCwd is cwds[0] — the live lastCwd +
    // TerminalPane null-cwd fallback. Per-pane mode picks p1 as primary by
    // convention.
    const primaryCwd = cwds[0] ?? null;
    if (primaryCwd === null) return;
    const nodes = seedNodes(cwds);
    onCommit(nodes, primaryCwd);
  };

  return (
    <div className="welcome" data-testid="welcome-screen">
      <h1 className="welcome__headline">Welcome</h1>
      <p className="welcome__sub">
        Set up a working folder for your four terminals. Pick once and we'll
        open all four in it — or use a different folder per pane.
      </p>

      {perPane ? (
        <div className="welcome__grid">
          {([0, 1, 2, 3] as const).map((slot) => (
            <PickerCard
              key={slot}
              label={`Terminal p${slot + 1}`}
              // perPaneCwds is indexed via `noUncheckedIndexedAccess` →
              // `string | null | undefined`; coalesce to `string | null` so
              // PickerCard's cwd prop matches the contract.
              cwd={perPaneCwds[slot] ?? null}
              onPick={() => void pick(slot)}
            />
          ))}
        </div>
      ) : (
        <PickerCard
          label="Folder"
          cwd={sharedCwd}
          onPick={() => void pick("shared")}
          full
        />
      )}

      <label className="welcome__toggle">
        <input
          type="checkbox"
          checked={perPane}
          onChange={(e) => setPerPane(e.target.checked)}
        />
        <span className="welcome__toggle__label">
          Use a different folder per pane
        </span>
      </label>

      <button
        type="button"
        className="welcome__cta"
        disabled={!ready}
        onClick={onOpenWorkspace}
        data-testid="welcome-open-workspace"
      >
        Open workspace <ArrowRightIcon />
      </button>
    </div>
  );
}

interface PickerCardProps {
  readonly label: string;
  readonly cwd: string | null;
  readonly onPick: () => void;
  readonly full?: boolean;
}

function PickerCard({ label, cwd, onPick, full }: PickerCardProps) {
  return (
    <div
      className={`welcome__card${full ? " welcome__card--full" : ""}`}
      data-state={cwd === null ? "empty" : "picked"}
    >
      <span className="welcome__card__label">
        <FolderIcon /> {label}
      </span>
      {cwd !== null ? (
        <>
          <code className="welcome__card__path" title={cwd}>
            {cwd}
          </code>
          <button
            type="button"
            className="welcome__filechip"
            onClick={onPick}
            aria-label={`Change ${label}`}
          >
            <RefreshIcon /> Change
          </button>
        </>
      ) : (
        <button
          type="button"
          className="welcome__filechip"
          onClick={onPick}
          aria-label={`Choose folder for ${label}`}
        >
          <FolderPlusIcon /> Choose folder
        </button>
      )}
    </div>
  );
}
