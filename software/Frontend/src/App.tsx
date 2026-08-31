import { useEffect } from "react";
import { InsightsScreen } from "@/components/InsightsScreen";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { Workspace } from "@/components/Workspace";
import { ThemeProvider } from "@/themes";
import { useSettingsStore } from "@/stores/settings";
import { useUiState } from "@/stores/uiState";
import { useUsageStore } from "@/stores/usage";

export function App() {
  const ensureLoaded = useSettingsStore((s) => s.ensureLoaded);
  const fontFamily = useSettingsStore((s) => s.settings.fontFamily);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const activeView = useUiState((s) => s.activeView);

  useEffect(() => { void ensureLoaded(); try { useUsageStore.getState().hydrate(); } catch {} }, [ensureLoaded]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--bs-font-mono", `${fontFamily}, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`);
    root.style.setProperty("--bs-font-size", `${fontSize}px`);
  }, [fontFamily, fontSize]);

  return (
    <ThemeProvider>
      <div className="app-shell">
        <div className="app-shell__sidebar"><Sidebar /></div>
        <div className="app-shell__main">
          <TitleBar />
          <div className="app-main">
            {activeView === "insights" ? <InsightsScreen /> : <Workspace />}
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
