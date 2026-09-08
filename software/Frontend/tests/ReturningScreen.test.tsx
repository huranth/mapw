// ReturningScreen — the surface Workspace renders when its boot gate finds
// a persisted workspace skeleton OR a pre-feature legacy lastCwd (no skeleton
// yet). The summary block has three shapes:
//   - Skeleton present: per-pane rows (paneId + cwd) so the user can verify
//     exactly what they're restoring before clicking Continue.
//   - Legacy lastCwd only: a single "4 terminals in the same folder / <path>"
//     line — the upgrade-from-pre-feature-build path the existing settings.json
//     (which has lastCwd but no workspace) lands in.
//   - Both null: defensive empty-state title (Workspace's gate should never
//     route here, but the screen renders something sensible regardless).
// CTAs: Continue (primary, onContinues) and Choose a new folder (secondary,
// onChooseNews). Pure-React surface — no theme/bridge dependency, so ThemeProvider
// wrapping is unnecessary here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkspacePersist } from "@mapw/backend/renderer";
import { ReturningScreen } from "@/components/ReturningScreen";

afterEach(() => {
  cleanup();
});

// Helper: build a 4-pane (or N-pane) skeleton at the default 2x2 slot grid so
// tests don't repeat the (NODE_W + GRID_GAP = 596 / NODE_H + GRID_GAP = 356)
// arithmetic inline. cwd entries may be null to exercise the "—" placeholder.
function makeSkeleton(
  cwds: Array<string | null>,
): WorkspacePersist {
  const slots = [
    { x: 0, y: 0 },
    { x: 596, y: 0 },
    { x: 0, y: 356 },
    { x: 596, y: 356 },
  ];
  return {
    nodes: cwds.map((cwd, i) => ({
      paneId: `p${i + 1}`,
      cwd,
      position: slots[i] ?? { x: 0, y: 0 },
    })),
  };
}

describe("ReturningScreen", () => {
  it("workspace skeleton present: lists per-pane rows + fires onContinue on Continue click", () => {
    const onContinue = vi.fn();
    const onChooseNew = vi.fn();
    render(
      <ReturningScreen
        lastWorkspace={makeSkeleton(["/proj-a", "/proj-b", "/proj-c", "/proj-a"])}
        legacyLastCwd={null}
        onContinue={onContinue}
        onChooseNew={onChooseNew}
      />,
    );

    expect(screen.getByTestId("returning-screen")).toBeInTheDocument();
    expect(screen.getByText(/Last session: 4 terminals/i)).toBeInTheDocument();
    // Each unique cwd renders verbatim in a <code> block — proj-a appears for
    // both p1 and p4 (the original session's two panes in the same folder).
    expect(screen.getAllByText("/proj-a").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("/proj-b")).toBeInTheDocument();
    expect(screen.getByText("/proj-c")).toBeInTheDocument();
    // 4 pane rows total.
    expect(screen.getAllByText(/^p[1-4]$/)).toHaveLength(4);

    fireEvent.click(screen.getByTestId("returning-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    // Continue is the primary CTA; clicking it does NOT also fire choose-new.
    expect(onChooseNew).not.toHaveBeenCalled();
  });

  it("workspace skeleton with a null-cwd pane: renders the em-dash placeholder for that row", () => {
    render(
      <ReturningScreen
        lastWorkspace={makeSkeleton(["/proj-a", null, "/proj-c", "/proj-a"])}
        legacyLastCwd={null}
        onContinue={vi.fn()}
        onChooseNew={vi.fn()}
      />,
    );
    // p2's cwd was null → the row's <code> renders the em-dash placeholder so
    // the user sees an explicit "—" rather than empty whitespace (which would
    // read as a layout drop-out).
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("workspace skeleton with 1 pane: pluralization reads '1 terminal' (singular)", () => {
    render(
      <ReturningScreen
        lastWorkspace={makeSkeleton(["/solo"])}
        legacyLastCwd={null}
        onContinue={vi.fn()}
        onChooseNew={vi.fn()}
      />,
    );
    // The summary title uses a count → singular/plural branch; 1 panes triggers
    // the singular wording. The anchor ($ end) prevents a false match against
    // "Last session: 1 terminal(s)".
    expect(screen.getByText(/Last session: 1 terminal$/i)).toBeInTheDocument();
  });

  it("legacy lastCwd only (workspace null): renders the migration line + fires onChooseNew on Choose-new click", () => {
    const onContinue = vi.fn();
    const onChooseNew = vi.fn();
    // Wrap in `{...}` (JS expression container, not a double-quoted JSX
    // attribute) so the JS string's `\\`→`\` collapse actually runs and the
    // DOM renders single-backslash Windows path segments (matches what a real
    // settings.json migration would land in). A bare JSX attribute string
    // keeps `\\` verbatim — and the path matcher's regex /\\/=single-backslash
    // would then fail to find double-backslash text.
    const legacy = "C:\\Users\\dev\\Downloads\\proj-pre-feature";
    render(
      <ReturningScreen
        lastWorkspace={null}
        legacyLastCwd={legacy}
        onContinue={onContinue}
        onChooseNew={onChooseNew}
      />,
    );

    expect(
      screen.getByText(/4 terminals in the same folder/i),
    ).toBeInTheDocument();
    // The legacy path is rendered verbatim in a <code> block.
    expect(
      screen.getByText(/C:\\Users\\dev\\Downloads\\proj-pre-feature/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("returning-choose-new"));
    expect(onChooseNew).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("defensive empty state (both skeleton and lastCwd null): still renders both CTAs", () => {
    render(
      <ReturningScreen
        lastWorkspace={null}
        legacyLastCwd={null}
        onContinue={vi.fn()}
        onChooseNew={vi.fn()}
      />,
    );
    // Workspace's gate should never route here with both null, but the screen
    // degrades to a clear empty title rather than rendering nothing — and the
    // CTAs remain clickable so the user always has a forward path.
    expect(screen.getByText(/No previous session found/i)).toBeInTheDocument();
    expect(screen.getByTestId("returning-continue")).toBeInTheDocument();
    expect(screen.getByTestId("returning-choose-new")).toBeInTheDocument();
  });
});
