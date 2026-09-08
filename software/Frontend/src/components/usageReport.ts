interface UsageSnapshot {
  firstSeen: number;
  sessions: number;
  terminalsCreated: number;
  commandsRun: number;
  layoutsApplied: number;
  activeSeconds: number;
  daily: Record<string, { seconds: number; commands: number; terminals: number }>;
}

function fmtHours(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hrs`;
}

export function buildUsageReport(usage: UsageSnapshot, now: Date = new Date()): string {
  const dayLines: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const stats = usage.daily[key];
    if (!stats || (stats.seconds <= 0 && stats.commands <= 0 && stats.terminals <= 0)) continue;
    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    dayLines.push(`- ${label}: ${fmtHours(stats.seconds)} · ${stats.commands} commands · ${stats.terminals} terminals`);
  }
  return [
    `# mapw usage — ${now.toISOString().slice(0, 10)}`,
    ``,
    `Member since ${new Date(usage.firstSeen).toISOString().slice(0, 10)}`,
    ``,
    `- Active time: ${fmtHours(usage.activeSeconds)} across ${usage.sessions} session${usage.sessions === 1 ? "" : "s"}`,
    `- Commands run: ${usage.commandsRun}`,
    `- Terminals created: ${usage.terminalsCreated}`,
    `- Layouts applied: ${usage.layoutsApplied}`,
    ``,
    `## Last 7 days`,
    dayLines.length > 0 ? dayLines.join("\n") : `- No recorded activity`,
    ``,
  ].join("\n");
}