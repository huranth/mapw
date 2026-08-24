// TitleBar — the App.tsx top row. Carries the wordmark + codename + (now)
// a Layouts actions cluster on the right. The bar is a window-drag region
// (`-webkit-app-region: drag` on `.titlebar` in styles.css) so the actions
// cluster + its buttons carry the explicit `-webkit-app-region: no-drag`
// override — without that the OS would treat clicks anywhere on the bar
// (including buttons) as a drag handle + swallow the click. The Layouts
// button gates visibility on `useUiState.activePhase === "ready"` — Layouts
// is only useful when a canvas exists; the pre-folder welcome/returning
// phases hide the button. Clicking opens the panel (useUiState.openLayouts);
// Workspace's render branch renders the panel surface; the button itself
// never closes the panel (close is via the panel's X button or an apply).

import { useUiState } from "@/stores/uiState";

export function TitleBar() {
  // Subscribe to activePhase only — TitleBar should NOT render the button on
  // loading/welcome/returning. layoutsPanelOpen isn't tracked here (Workspace
  // owns the panel-open render branch); the button is the entry point, the
  // open click just flips the shared flag.
  const isReady = useUiState((s) => s.activePhase === "ready");
  const openLayouts = useUiState((s) => s.openLayouts);
  return (
    <header className="titlebar">
      <span className="titlebar__brand">MAPW</span>
      <span className="titlebar__sep" aria-hidden="true">·</span>
      <span className="titlebar__codename">Multi-pane workspace</span>
      {isReady && (
        <div className="titlebar__actions">
          <button
            type="button"
            className="titlebar__button"
            onClick={openLayouts}
            aria-label="Open Layouts panel"
            data-testid="titlebar-layouts-btn"
          >
            Layouts
          </button>
        </div>
      )}
    </header>
  );
}
