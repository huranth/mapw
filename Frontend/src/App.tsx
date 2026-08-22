import { useEffect } from "react";
import { StatusBar } from "@/components/StatusBar";
import { TitleBar } from "@/components/TitleBar";
import { Workspace } from "@/components/Workspace";
import { ThemeProvider } from "@/themes";
import { useSettingsStore } from "@/stores/settings";

export function App() {
  const ensureLoaded = useSettingsStore((s) => s.ensureLoaded);
  const fontFamily = useSettingsStore((s) => s.settings.fontFamily);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--bs-font-mono",
      `${fontFamily}, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`,
    );
    root.style.setProperty("--bs-font-size", `${fontSize}px`);
  }, [fontFamily, fontSize]);

  return (
    <ThemeProvider>
      <div className="app-shell">
        <TitleBar />
        <Workspace />
        <StatusBar />
      </div>
    </ThemeProvider>
  );
}
