// StatusBar — the bottom strip. A ready dot + headline health line + the
// live pane count + the active shell/cwd + the theme chip (which is also
// where the M0-era active-theme-id testid moved once the editorial
// ContentPanel was retired for M1).

import { useTheme } from "@/themes";
import { useTerminalsStore } from "@/stores/terminals";

export function StatusBar() {
  const { theme } = useTheme();
  const panes = useTerminalsStore((s) => s.panes);
  const live = Object.values(panes).filter((p) => p.alive);
  const alive = live.length;
  const shell = live[0]?.shell ?? "—";
  const cwd = live[0]?.cwd ?? "—";

  return (
    <footer className="status">
      <span className="status__dot" aria-hidden="true" />
      <span className="status__pill">Ready</span>
      <span className="status__sep" aria-hidden="true">·</span>
      <span className="status__text">{alive} PTYs live</span>
      <span className="status__sep" aria-hidden="true">·</span>
      <span className="status__text">shell: {shell}</span>
      <span className="status__sep" aria-hidden="true">·</span>
      <span className="status__text">cwd: {cwd}</span>
      <span className="status__sep" aria-hidden="true">·</span>
      <span className="status__text">theme</span>
      <code className="status__code" data-testid="active-theme-id">{theme.id}</code>
      <span className="status__sep" aria-hidden="true">·</span>
      <span className="status__text status__text--accent">Next: M3 node-resize + edges</span>
      <span className="status__meta">v0.1.0</span>
    </footer>
  );
}
