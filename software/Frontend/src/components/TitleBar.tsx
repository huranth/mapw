import { MapwLogo } from "@/components/Icons";

export function TitleBar() {
  return (
    <header className="titlebar">
      <span className="titlebar__mark" aria-hidden="true"><MapwLogo size={22} /></span>
      <span className="titlebar__brand">MAPW</span>
      <span className="titlebar__sep" aria-hidden="true">·</span>
      <span className="titlebar__codename">Multi-pane workspace</span>
    </header>
  );
}
