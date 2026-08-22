// Workspace — the App.tsx 1fr row's body. Owns the phase state machine that
// decides which surface mounts inside the workspace region (TitleBar +
// StatusBar live in the outer cell and stay visible across all phases).
//
// Phases:
//   - "loading": ensuring settings; body renders nothing.
//   - "welcome": fresh launch OR the user clicked "Choose a new folder".
//     WelcomeSetupScreen fires the native picker from a CTA click, collects 1
//     (shared) or 4 (per-pane) cwds, and commits via onCommit — persisting the
//     fresh workspace skeleton + lastCwd, hydrating the canvas store, and
//     flipping phase → ready.
//   - "returning": a previous session was persisted (Settings.workspace with
//     nodes OR a pre-feature Settings.lastCwd). ReturningScreen renders
//     summary + Continue / Choose-new CTAs. Continue rehydrates the canvas
//     and flips phase → ready. Choose-new flips phase → welcome (the welcome
//     commit overwrites the old skeleton).
//   - "ready": SideRail + TerminalCanvas mount.
//
// Every native picker now fires from a button onClick (user-driven), not from
// a mount effect — so the retired `firstLaunchPickerPromise` StrictMode
// sentinel isn't needed. The busy ref guards a single in-flight phase
// transition against double-clicks.

import { useEffect, useRef, useState } from "react";
import type { PaneNodePersist } from "@bridgespace/backend/renderer";
import { SideRail } from "@/components/SideRail";
import { TerminalCanvas } from "@/components/TerminalCanvas";
import { ReturningScreen } from "@/components/ReturningScreen";
import { WelcomeSetupScreen } from "@/components/WelcomeSetupScreen";
import { useCanvasStore, seedNodesWithCwd } from "@/stores/canvas";
import { useSettingsStore } from "@/stores/settings";

type Phase = "loading" | "welcome" | "returning" | "ready";

// Hydratable skeleton threshold: an empty persisted skeleton (workspace was
// saved with `nodes: []` because the user closed ALL their panes during a
// live session) must NOT be treated as a real restore source — otherwise
// the returning Continue would silently re-hydrate a stale snapshot of the
// panes the user explicitly cleared, and ReturningScreen would summarize
// "Last session: 0 terminals". Such empty skeletons collapse to "no
// skeleton" so the gate falls through to the lastCwd legacy path (or Welcome
// if lastCwd is also null).
function hasNonEmptySkeleton(
  workspace: ReturnType<typeof useSettingsStore.getState>["settings"]["workspace"],
): boolean {
  return workspace != null && workspace.nodes.length > 0;
}

export function Workspace() {
  const [phase, setPhase] = useState<Phase>("loading");
  const ensureLoaded = useSettingsStore((s) => s.ensureLoaded);
  const update = useSettingsStore((s) => s.update);
  // Guards a single in-flight phase transition — once a CTA fires, stays true
  // until setPhase("ready") lands. User CTAs live on onClick handlers so
  // StrictMode's double-mount doesn't refire them; the ref is only a net
  // against double-clicking Continue / Open workspace faster than the await.
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await ensureLoaded();
      if (!alive) return;
      const cur = useSettingsStore.getState().settings;
      const hasWorkspace = hasNonEmptySkeleton(cur.workspace);
      const hasLegacyFolder = cur.lastCwd != null;
      setPhase(hasWorkspace || hasLegacyFolder ? "returning" : "welcome");
    })();
    return () => {
      alive = false;
    };
  }, [ensureLoaded]);

  async function commitWelcome(
    nodes: PaneNodePersist[],
    primaryCwd: string,
  ): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      // lastCwd is the welcome-flow primary folder (the shared pick, or p1
      // in per-pane mode) + TerminalPane's null-cwd fallback. The workspace
      // skeleton carries per-pane cwd for the restored panes.
      await update({ lastCwd: primaryCwd, workspace: { nodes } });
      useCanvasStore.getState().hydrate(nodes);
      setPhase("ready");
    } finally {
      busyRef.current = false;
    }
  }

  async function continueReturning(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const cur = useSettingsStore.getState().settings;
      if (hasNonEmptySkeleton(cur.workspace)) {
        // Slice the array defensively: PaneNodePersist arrays are readonly on
        // the Settings shape but hydrate accepts `PaneNodePersist[]` (the
        // editable binding); a shallow copy is the lightest type repair.
        useCanvasStore.getState().hydrate([...cur.workspace!.nodes]);
      } else if (cur.lastCwd) {
        // Upgrade path: pre-feature build saved lastCwd but no skeleton,
        // OR the user closed ALL their panes during the last session and
        // only lastCwd survives. Migrate to a 4-pane same-folder skeleton so
        // the user keeps their primary folder context without re-picking.
        const nodes = seedNodesWithCwd(cur.lastCwd);
        await update({ workspace: { nodes } });
        useCanvasStore.getState().hydrate(nodes);
      } else {
        // Defensive: gate should not have sent us here. Canvas mounts empty
        // and the seed panes spawn in os.homedir() per TerminalPane's null-
        // cwd fallback.
      }
      setPhase("ready");
    } finally {
      busyRef.current = false;
    }
  }

  // Snapshot settings ONCE per render pass for the Returning screen props.
  // We deliberately do NOT subscribe (no `useSettingsStore((s) =>
  // s.settings)` selector) so the live debounced skeleton write-back from
  // TerminalCanvas — up to ~2.5Hz during a drag — doesn't churn Workspace
  // through the renderer.
  const cur = useSettingsStore.getState().settings;
  const returnWorkspace = hasNonEmptySkeleton(cur.workspace) ? cur.workspace : null;
  const returnCwd = cur.lastCwd;

  return (
    <main className="workspace">
      {phase === "loading" ? (
        <div className="workspace__loader">
          <div className="loader" role="status" aria-label="Loading">
            <span /><span /><span /><span /><span /><span />
          </div>
        </div>
      ) : phase === "welcome" ? (
        <WelcomeSetupScreen onCommit={commitWelcome} />
      ) : phase === "returning" ? (
        <ReturningScreen
          lastWorkspace={returnWorkspace}
          legacyLastCwd={returnCwd}
          onContinue={() => void continueReturning()}
          onChooseNew={() => setPhase("welcome")}
        />
      ) : (
        <>
          <SideRail />
          <TerminalCanvas />
        </>
      )}
    </main>
  );
}
