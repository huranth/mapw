import { useTheme } from "@/themes";

export function TitleBar() {
  const { availableThemes, theme, setTheme } = useTheme();

  return (
    <header className="titlebar">
      <span className="titlebar__brand">MAPW</span>
      <span className="titlebar__sep" aria-hidden="true">·</span>
      <span className="titlebar__codename">Multi-pane workspace</span>
      <nav className="titlebar__themes" aria-label="Active theme">
        {availableThemes.map((t) => (
          <button
            key={t.id}
            type="button"
            className="titlebar__theme"
            data-active={t.id === theme.id}
            onClick={() => setTheme(t.id)}
            title={`Active theme: ${t.name}`}
          >
            {t.name}
          </button>
        ))}
      </nav>
    </header>
  );
}
