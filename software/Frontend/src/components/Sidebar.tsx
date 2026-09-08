import { useEffect, useState } from "react";
import { BarChart3Icon, GridIcon, LayersIcon, MapwLogo } from "@/components/Icons";
import { useSettingsStore } from "@/stores/settings";
import { useUiState } from "@/stores/uiState";
import { useUsageStore } from "@/stores/usage";

const NAV = [
  { id: "panes" as const, label: "Panes", Icon: GridIcon },
  { id: "usage" as const, label: "Usage", Icon: BarChart3Icon },
  { id: "layouts" as const, label: "Layouts", Icon: LayersIcon },
] as const;

const initialsOf = (name: string): string => name.trim().split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
const formatTotal = (seconds: number): string => (seconds < 3600 ? `${Math.floor(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} hrs`);

export function Sidebar() {
  const activeView = useUiState((s) => s.activeView);
  const layoutsOpen = useUiState((s) => s.layoutsPanelOpen);
  const setActiveView = useUiState((s) => s.setActiveView);
  const openLayouts = useUiState((s) => s.openLayouts);
  const userName = useSettingsStore((s) => s.settings.userName);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const sessions = useUsageStore((s) => s.sessions);
  const activeSeconds = useUsageStore((s) => s.activeSeconds);
  const [readyVersion, setReadyVersion] = useState<string | null>(null);

  // The auto
  // Honest line
  useEffect(
    () =>
      window.bridge.onUpdateStatus((status) => {
        if (status.phase === "staged" && status.version) setReadyVersion(status.version);
      }),
    [],
  );

  // Bootstrap the
  // Adopt the
  useEffect(() => {
    if (!settingsLoaded || userName) return;
    let cancelled = false;
    window.bridge.whoami()
      .then((name) => {
        if (!cancelled && name) void useSettingsStore.getState().update({ userName: name });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [settingsLoaded, userName]);

  const displayName = userName || "Local";
  const subLine = sessions > 0 ? `${sessions} sessions, ${formatTotal(activeSeconds)}` : "No sessions yet";

  const onNav = (id: typeof NAV[number]["id"]) => {
    if (id === "usage") { setActiveView("insights"); useUiState.getState().closeLayouts(); return; }
    if (id === "panes") { setActiveView("workspace"); useUiState.getState().closeLayouts(); return; }
    if (id === "layouts") { setActiveView("workspace"); openLayouts(); }
  };
  return (
    <aside className="sidebar" data-testid="sidebar" aria-label="Navigation">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark" aria-hidden="true"><MapwLogo size={22} /></span>
        <span className="sidebar__brand-name" aria-label="MAPW" data-brand="MAPW" />
      </div>
      <nav className="sidebar__nav" aria-label="Primary">
        {NAV.map(({ id, label, Icon }) => {
          const isActive = (id === "layouts" && layoutsOpen) || (id === "panes" && activeView === "workspace" && !layoutsOpen) || (id === "usage" && activeView === "insights" && !layoutsOpen);
          return (
            <button key={id} type="button" className={`sidebar__item${isActive ? " sidebar__item--active" : ""}`} aria-current={isActive ? "page" : undefined} onClick={() => onNav(id)} data-testid={`sidebar-${id}`}>
              <Icon size={16} style={{ flexShrink: 0 }} />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="sidebar__bottom">
        {readyVersion ? (
          <div className="sidebar__update" role="status">
            <span className="sidebar__update-dot" aria-hidden="true" />
            Update {readyVersion} ready
          </div>
        ) : null}
        <div className="sidebar__user" role="button" tabIndex={0} onClick={() => setActiveView("insights")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveView("insights"); } }} aria-label="Open usage">
          <span className="sidebar__user-avatar" aria-hidden="true">{initialsOf(displayName)}</span>
          <span className="sidebar__user-meta"><span className="sidebar__user-name">{displayName}</span><span className="sidebar__user-sub">{subLine}</span></span>
        </div>
      </div>
    </aside>
  );
}