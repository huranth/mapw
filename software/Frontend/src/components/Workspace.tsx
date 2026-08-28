// Workspace — the App.tsx 1fr row's body. Owns the phase state machine that
// decides which surface mounts inside the workspace region (TitleBar lives in
// the outer cell and stays visible across all phases).
//
// Phases:
//   - "loading": settings.hydrate is in flight (cold-boot read). Renders
//     blank for the brief window between mount and the first
//     `useSettingsStore.ensureLoaded()` resolution.
//   - "welcome": fresh launch OR the user clicked "Choose a new folder".
//     WelcomeSetupScreen fires the native picker from a CTA click, collects 1
//     (shared) or 4 (per-pane) cwds, and commits via onCommit — persisting
//     the fresh workspace skeleton + lastCwd, hydrating the canvas store, and
//     flipping phase → ready.
//   - "returning": a previous session was persisted (Settings.workspace with
//     nodes OR a pre-feature Settings.lastCwd). ReturningScreen renders
//     summary + Continue / Choose-new CTAs. Continue rehydrates the canvas
//     and flips phase → ready. Choose-new flips phase → welcome (the welcome
//     commit overwrites the old skeleton).
//   - "ready": TerminalCanvas mounts. Panes spawn RAW — the
//     famous-CLI chip strip on each pane header (see TerminalNode) is the
//     user's CLI-choice surface, NOT an auto-launch.
//
// Every native picker now fires from a button onClick (user-driven), not from
// a mount effect — so the retired `firstLaunchPickerPromise` StrictMode
// sentinel isn't needed. The busy ref guards a single in-flight phase
// transition against double-clicks.
//
// The curated-CLI scan (`window.bridge.detectCliTools`) is fired in the mount
// effect as fire-and-forget — the chip strips render once the result
// resolves, but phase resolution doesn't gate on it.

import { useEffect, useRef, useState } from "react";
import type { PaneNodePersist, SavedLayout } from "@bridgespace/backend/renderer";
import { LayoutsScreen } from "@/components/LayoutsScreen";
import { TerminalCanvas } from "@/components/TerminalCanvas";
import { ReturningScreen } from "@/components/ReturningScreen";
import { WelcomeSetupScreen } from "@/components/WelcomeSetupScreen";
import { useCanvasStore, seedNodesWithCwd } from "@/stores/canvas";
import { useCliToolsStore } from "@/stores/cliTools";
import { applyLayout } from "@/stores/layouts";
import { useSettingsStore } from "@/stores/settings";
import { type Phase, useUiState } from "@/stores/uiState";

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
  // Layouts panel open/close lives on useUiState (NOT local useState) so
  // TitleBar — mounted in App.tsx OUTSIDE Workspace's phase machine — can
  // toggle it without a prop chain back up. Workspace subscribes + renders
  // LayoutsScreen over the workspace cell when true; the panel-closed
  // branch resumes whichever phase the user was in.
  const layoutsPanelOpen = useUiState((s) => s.layoutsPanelOpen);
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
      // Fire the curated-CLI scan in the background — the chip strip on
      // every pane header needs it, but it's UI rather than a phase gate,
      // so phase resolution doesn't wait on it. The strip renders the
      // moment the store resolves.
      void useCliToolsStore.getState().ensureLoaded();
      const cur = useSettingsStore.getState().settings;
      const hasWorkspace = hasNonEmptySkeleton(cur.workspace);
      const hasLegacyFolder = cur.lastCwd != null;
      setPhase(hasWorkspace || hasLegacyFolder ? "returning" : "welcome");
    })();
    return () => {
      alive = false;
    };
  }, [ensureLoaded]);

  // Mirror the local phase into useUiState so TitleBar (rendered in App.tsx)
  // can gate Layouts-button visibility on `activePhase === "ready"` — Layouts
  // only makes sense when a canvas exists. Cheap effect (runs only on phase
  // change). Read-modify-write on `setActivePhase` is intentionally a plumbing
  // pass-through — the source of truth IS Workspace's local `phase`; this just
  // projects it onto the cross-component store.
  useEffect(() => {
    useUiState.getState().setActivePhase(phase);
  }, [phase]);

  async function commitWelcome(
    nodes: PaneNodePersist[],
    primaryCwd: string,
  ): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("loading");
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
    setPhase("loading");
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
      {phase === "welcome" && (
        <WelcomeSetupScreen onCommit={commitWelcome} />
      )}
      {phase === "returning" && (
        <ReturningScreen
          lastWorkspace={returnWorkspace}
          legacyLastCwd={returnCwd}
          onContinue={() => void continueReturning()}
          onChooseNew={() => setPhase("welcome")}
        />
      )}
      {phase === "ready" && <TerminalCanvas />}
      {layoutsPanelOpen && (
        // OVERLAY, not swap-replace. The previous implementation hard-swapped
        // the phase fragment (welcome/returning/ready) for LayoutsScreen on a
        // sibling-ternary — which unmounted TerminalCanvas entirely whenever
        // the user opened the panel, firing every TerminalPane's cleanup
        // (ptyKill + terminal.dispose) and destroying every PTY session. Just
        // PEEKING the panel killed every pane's shell + scrollback; reopening
        // remounted TerminalCanvas fresh (blank-prompt shells). Rendering the
        // panel as an ON-TOP surface (the phase fragments stay mounted
        // underneath, opaque and full-bleed per .layouts `position:absolute`) —
        // Welcome/Returning screens don't dispatch on mount so staying mounted
        // is harmless; the live canvas keeps its PTYs across the panel's open
        // window. Applying a layout still wholesale-replaces via hydrate (the
        // intentional re-key-then-unmount design) so apply retains its kill +
        // respawn behavior.
        <LayoutsScreen
          onApply={(layout: SavedLayout) => {
            // Cluster 12a — applyLayout is now async: it awaits the
            // Settings.workspace persist (the on-disk write that's symmetric
            // with the synchronous canvas-store hydrate) so by the time the
            // panel closes + the canvas mounts with the new panes, the
            // settings.json state already mirrors the live canvas. The
            // phase-flip + panel-close wait on the `.then` so a quit/drag/2nd-
            // apply inside the persist window can't lose the apply. The
            // persist window is one IPC + at most one disk write (~tens of
            // ms), so the panel-close UX is imperceptibly delayed. `void`
            // matches the `(layout: SavedLayout) => void` prop signature (no
            // Promise propagation up to LayoutsScreen — the void operator
            // discards the resulting promise).
            void applyLayout(layout)
              .then(() => {
                // If the user opened Layouts from welcome/returning, jump to
                // ready so the freshly-hydrated canvas mounts. If already
                // ready, setPhase("ready") is idempotent (React's identical-
                // state bail — phase === "ready" stays, no extra render).
                setPhase("ready");
                useUiState.getState().closeLayouts();
              })
              .catch((err) => {
                // Cluster 1 + 12a — if the persist rejects, DON'T close the
                // panel + DON'T flip phase (the user keeps the prior canvas
                // + can retry or pick another layout). Surface the rejection
                // to the renderer console so a failed apply isn't silently
                // swallowed as an unhandled promise rejection — the bridge's
                // `update` Promise rejects on disk-write error (unique-tmp-
                // write runs out of disk space, fs.rename gets virus-scanned
                // into a transient EACCES, the SettingsStore writeQueue
                // forwards the underlying rejection through the serialized
                // chain). The panel stays open so the apply is genuinely a
                // no-op from the user's POV; this log line is the only
                // diagnostic that something went wrong.
                console.error(
                  "[layouts] applyLayout failed — panel stays open:",
                  err,
                );
              });
          }}
          onClose={() => useUiState.getState().closeLayouts()}
        />
      )}
    </main>
  );
}
