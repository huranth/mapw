import { describe, expect, it } from "vitest";
import { buildUsageReport } from "@/components/usageReport";

const base = {
  firstSeen: Date.UTC(2026, 7, 1),
  sessions: 12,
  terminalsCreated: 24,
  commandsRun: 318,
  layoutsApplied: 3,
  activeSeconds: 2 * 3600 + 24 * 60,
  daily: {
    "2026-08-28": { seconds: 3600, commands: 40, terminals: 5, sessions: 1 },
    "2026-08-27": { seconds: 0, commands: 0, terminals: 0, sessions: 0 },
  },
};

describe("buildUsageReport", () => {
  const now = new Date(Date.UTC(2026, 7, 29, 12));

  it("includes lifetime totals", () => {
    const report = buildUsageReport(base, now);
    expect(report).toContain("# mapw usage — 2026-08-29");
    expect(report).toContain("2.4 hrs across 12 sessions");
    expect(report).toContain("Commands run: 318");
    expect(report).toContain("Terminals created: 24");
    expect(report).toContain("Layouts applied: 3");
  });

  it("lists only days with real activity", () => {
    const report = buildUsageReport(base, now);
    expect(report).toContain("1.0 hrs · 40 commands · 5 terminals");
    expect(report).not.toMatch(/0 commands · 0 terminals/);
  });

  it("says so when the week has no activity", () => {
    const report = buildUsageReport({ ...base, daily: {} }, now);
    expect(report).toContain("No recorded activity");
  });
});
