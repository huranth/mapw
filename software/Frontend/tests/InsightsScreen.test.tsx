import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InsightsScreen } from "@/components/InsightsScreen";
import { ThemeProvider } from "@/themes";
import { useUsageStore } from "@/stores/usage";

function renderInsights() {
  return render(
    <ThemeProvider>
      <InsightsScreen />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InsightsScreen", () => {
  it("copies a real usage report from the share button", () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderInsights();
    fireEvent.click(screen.getByRole("button", { name: "Copy usage report" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]![0]).toContain("# mapw usage");
  });

  it("renders top stats bar with professional metrics", () => {
    useUsageStore.setState({ sessions: 4, activeSeconds: 5400 });
    renderInsights();
    expect(screen.getByText("Usage stats")).toBeInTheDocument();
    expect(screen.getByText("Total time")).toBeInTheDocument();
    expect(screen.getByText("Peak day")).toBeInTheDocument();
    expect(screen.getByText("Current streak")).toBeInTheDocument();
    expect(screen.getByText("Longest streak")).toBeInTheDocument();
  });

  it("renders activity heatmap and daily trend like z-code", () => {
    renderInsights();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Daily time trend")).toBeInTheDocument();
    expect(screen.getByText("Activity breakdown")).toBeInTheDocument();
    expect(screen.getByText("Time range")).toBeInTheDocument();
  });
});
