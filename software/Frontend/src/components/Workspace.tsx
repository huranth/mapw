import { useEffect, useRef, useState } from "react";
import type { PaneNodePersist, SavedLayout } from "@mapw/backend/renderer";
import { LayoutsScreen } from "@/components/LayoutsScreen";
import { TerminalCanvas } from "@/components/TerminalCanvas";
import { ReturningScreen } from "@/components/ReturningScreen";
import { WelcomeSetupScreen } from "@/components/WelcomeSetupScreen";
import { useCanvasStore, seedNodesWithCwd } from "@/stores/canvas";
import { useCliToolsStore } from "@/stores/cliTools";
import { applyLayout } from "@/stores/layouts";
import { useSettingsStore } from "@/stores/settings";
import { useUsageStore } from "@/stores/usage";
import { type Phase, useUiState } from "@/stores/uiState";

function hasNonEmptySkeleton(workspace: ReturnType<typeof useSettingsStore.getState>["settings"]["workspace"]): boolean {
  return workspace != null && workspace.nodes.length > 0;
}

export function Workspace() {
  const [phase, setPhase] = useState<Phase>("loading");
  const ensureLoaded = useSettingsStore((s) => s.ensureLoaded);
  const update = useSettingsStore((s) => s.update);
  const layoutsPanelOpen = useUiState((s) => s.layoutsPanelOpen);
  const hasEnteredWorkspace = useUiState((s) => s.hasEnteredWorkspace);
  const busyRef = useRef(false);

  useEffect(() => {
    if (hasEnteredWorkspace) {
      setPhase("ready");
      useUiState.getState().setActivePhase("ready");
      return;
    }
    let alive = true;
    void (async () => {
      await ensureLoaded();
      if (!alive) return;
      void useCliToolsStore.getState().ensureLoaded();
      const cur = useSettingsStore.getState().settings;
      setPhase(hasNonEmptySkeleton(cur.workspace) || cur.lastCwd != null ? "returning" : "welcome");
    })();
    return () => { alive = false; };
  }, [ensureLoaded, hasEnteredWorkspace]);

  useEffect(() => { useUiState.getState().setActivePhase(phase); }, [phase]);
  useEffect(() => { if (phase === "ready") useUiState.getState().markEnteredWorkspace(); }, [phase]);

  async function commitWelcome(nodes: PaneNodePersist[], primaryCwd: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("loading");
    try {
      await update({ lastCwd: primaryCwd, workspace: { nodes } });
      try {
        useCanvasStore.getState().hydrate(nodes);
      } catch (err) {
        console.error("[workspace] hydrate failed:", err);
      }
      try { useUsageStore.getState().recordTerminal(nodes.length); } catch {}
      setPhase("ready");
      useUiState.getState().markEnteredWorkspace();
    } finally { busyRef.current = false; }
  }

  async function continueReturning(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("loading");
    try {
      const cur = useSettingsStore.getState().settings;
      if (hasNonEmptySkeleton(cur.workspace)) {
        try {
          useCanvasStore.getState().hydrate([...cur.workspace!.nodes]);
        } catch (err) {
          console.error("[workspace] hydrate failed:", err);
        }
        try { useUsageStore.getState().recordTerminal(cur.workspace!.nodes.length); } catch {}
      } else if (cur.lastCwd) {
        const nodes = seedNodesWithCwd(cur.lastCwd);
        await update({ workspace: { nodes } });
        try {
          useCanvasStore.getState().hydrate(nodes);
        } catch (err) {
          console.error("[workspace] hydrate failed:", err);
        }
        try { useUsageStore.getState().recordTerminal(nodes.length); } catch {}
      }
      setPhase("ready");
      useUiState.getState().markEnteredWorkspace();
    } finally { busyRef.current = false; }
  }

  const settings = useSettingsStore((s) => s.settings);
  const returnWorkspace = hasNonEmptySkeleton(settings.workspace) ? settings.workspace : null;
  const returnCwd = settings.lastCwd;

  return (
    <main className="workspace">
      {phase === "welcome" && !layoutsPanelOpen && <WelcomeSetupScreen onCommit={commitWelcome} />}
      {phase === "returning" && !layoutsPanelOpen && <ReturningScreen lastWorkspace={returnWorkspace} legacyLastCwd={returnCwd} onContinue={() => void continueReturning()} onChooseNew={() => setPhase("welcome")} />}
      {phase === "ready" && <TerminalCanvas />}
      {layoutsPanelOpen && phase !== "ready" && (
        <div className="layouts" data-testid="layouts-screen">
          <button type="button" className="layouts__close" onClick={() => useUiState.getState().closeLayouts()} aria-label="Close Layouts panel" data-testid="layouts-close">×</button>
          <div className="layouts__header">
            <div className="layouts__hero" aria-hidden="true">
              <span className="layouts__hero-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <rect x="2" y="2" width="7" height="7" rx="1.4" stroke="#1C1917" strokeWidth="1.3" />
                  <rect x="11" y="2" width="7" height="7" rx="1.4" stroke="#1C1917" strokeWidth="1.3" />
                  <rect x="2" y="11" width="7" height="7" rx="1.4" stroke="#1C1917" strokeWidth="1.3" />
                  <rect x="11" y="11" width="7" height="7" rx="1.4" stroke="#1C1917" strokeWidth="1.3" />
                </svg>
              </span>
            </div>
            <h1 className="layouts__headline">Layouts</h1>
            <p className="layouts__sub" style={{ marginTop: 6, color: "#6B6560", fontSize: 12 }}>Pick a folder</p>
          </div>
          <WelcomeSetupScreen onCommit={commitWelcome} compact />
        </div>
      )}
      {layoutsPanelOpen && phase === "ready" && (
        <LayoutsScreen
          onApply={(layout: SavedLayout) => {
            void applyLayout(layout).then(() => { setPhase("ready"); useUiState.getState().closeLayouts(); useUiState.getState().setActiveView("workspace"); }).catch((err) => console.error("[layouts] applyLayout failed:", err));
          }}
          onClose={() => useUiState.getState().closeLayouts()}
        />
      )}
    </main>
  );
}