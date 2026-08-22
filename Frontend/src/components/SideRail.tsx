// SideRail — left navigation + environment panel. Terminals is the live
// surface; Editor / Files are deferred rows. The active Terminals row carries
// an accent left-edge stripe + a live pane count fed from the terminals store
// so the rail reflects reality rather than a static milestone tag.

import { useTerminalsStore } from "@/stores/terminals";

interface NavRow {
  readonly index: string;
  readonly name: string;
  readonly deferred: boolean;
}

interface EnvRow {
  readonly name: string;
  readonly value: string;
}

const NAV_ROWS: ReadonlyArray<NavRow> = [
  { index: "01", name: "Terminals", deferred: false },
  { index: "02", name: "Editor", deferred: true },
  { index: "03", name: "Files", deferred: true },
];

const ENV_ROWS: ReadonlyArray<EnvRow> = [
  { name: "OS", value: navigator.platform },
  { name: "Electron", value: "32" },
  { name: "Node", value: "≥ 20.10" },
];

export function SideRail() {
  const alive = useTerminalsStore(
    (s) => Object.values(s.panes).filter((p) => p.alive).length,
  );

  return (
    <aside className="rail" aria-label="Workspace navigation">
      <section className="rail__group">
        <h2 className="rail__label">01 · Navigation</h2>
        <ul className="rail__list">
          {NAV_ROWS.map((row) => {
            const isActive = !row.deferred;
            const status = isActive ? (alive > 0 ? `${alive}` : "—") : "M1+";
            const className = `rail__row ${
              isActive ? "rail__row--active" : "rail__row--pending"
            }`;
            return (
              <li
                key={row.index}
                className={className}
                data-active={isActive ? "true" : undefined}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="rail__row__index">{row.index}</span>
                <span className="rail__row__name">{row.name}</span>
                <span className="rail__row__status">{status}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="rail__group">
        <h2 className="rail__label">02 · Environment</h2>
        <ul className="rail__list">
          {ENV_ROWS.map((row) => (
            <li key={row.name} className="rail__row rail__row--info">
              <span className="rail__row__name">{row.name}</span>
              <span className="rail__row__value">{row.value}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
