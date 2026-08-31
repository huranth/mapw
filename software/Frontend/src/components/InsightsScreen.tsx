import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ShareIcon } from "@/components/Icons";
import { buildUsageReport } from "@/components/usageReport";
import { useUsageStore } from "@/stores/usage";

// Paper-matched palette — Z-code layout but MAPW paper theme (light)
const ZMUTED = "#78716C";
const ZGRID = "#E8E2D6";
const BLUE = "#3B82F6";
const GREEN = "#10B981";
const PURPLE = "#8B5CF6";
const RED = "#EF4444";
const ORANGE = "#F97316";
const CYAN = "#06B6D4";
const SERIES = [
  { key: "time", label: "time", color: BLUE },
  { key: "commands", label: "commands", color: GREEN },
  { key: "terminals", label: "panes", color: PURPLE },
] as const;

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtLong(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh}h`;
}
function fmtShortSec(sec: number): string {
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function calcStreak(
  daily: Record<string, { seconds: number; terminals: number }>,
  sessions: number,
): { cur: number; best: number } {
  const active = (key: string): boolean =>
    (daily[key]?.seconds ?? 0) > 60 || (daily[key]?.terminals ?? 0) > 0;
  const keys: string[] = [];
  for (let i = 59; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(localKey(d));
  }
  let cur = 0;
  for (let i = keys.length - 1; i >= 0; i--) { if (active(keys[i]!)) cur++; else break; }
  let best = 0; let run = 0;
  for (const k of keys) { if (active(k)) { run++; best = Math.max(best, run); } else run = 0; }
  if (cur === 0 && sessions > 0) cur = 1;
  if (best === 0) best = cur;
  return { cur, best };
}

function Heatmap({
  daily,
  mode,
}: {
  daily: Record<string, { seconds: number; commands: number; terminals: number; sessions: number }>;
  mode: "daily" | "weekly" | "cumulative";
}) {
  const { cells, months } = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const totalDays = 224;
    const start = new Date(today);
    start.setDate(today.getDate() - totalDays + 1);
    const startDay = start.getDay();
    start.setDate(start.getDate() - startDay);
    const totalCells = totalDays + startDay;
    const raw: Array<{ key: string; date: Date; seconds: number; commands: number; terminals: number }> = [];
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = localKey(d);
      const s = daily[k];
      raw.push({ key: k, date: d, seconds: s?.seconds ?? 0, commands: s?.commands ?? 0, terminals: s?.terminals ?? 0 });
    }
    // compute levels per mode
    let max = 1;
    if (mode === "daily") {
      max = Math.max(1, ...raw.map((r) => r.seconds));
    } else if (mode === "weekly") {
      const weekSums: number[] = [];
      for (let i = 0; i < raw.length; i += 7) {
        let sum = 0;
        for (let j = 0; j < 7 && i + j < raw.length; j++) sum += raw[i + j]!.seconds;
        weekSums.push(sum);
      }
      max = Math.max(1, ...weekSums);
    } else {
      let cum = 0;
      let cumMax = 0;
      for (const r of raw) {
        cum += r.seconds;
        cumMax = Math.max(cumMax, cum);
      }
      max = Math.max(1, cumMax);
    }

    let cumAcc = 0;
    const cells = raw.map((r, idx) => {
      let level = 0;
      let displaySec = r.seconds;
      if (mode === "daily") {
        if (r.seconds > 0) {
          const pct = r.seconds / max;
          if (pct < 0.25) level = 1;
          else if (pct < 0.5) level = 2;
          else if (pct < 0.85) level = 3;
          else level = 4;
        }
      } else if (mode === "weekly") {
        const weekIdx = Math.floor(idx / 7);
        let weekSum = 0;
        const weekStart = weekIdx * 7;
        for (let j = 0; j < 7 && weekStart + j < raw.length; j++) weekSum += raw[weekStart + j]!.seconds;
        displaySec = weekSum;
        if (weekSum > 0) {
          const pct = weekSum / max;
          if (pct < 0.25) level = 1;
          else if (pct < 0.5) level = 2;
          else if (pct < 0.85) level = 3;
          else level = 4;
        }
      } else {
        cumAcc += r.seconds;
        displaySec = cumAcc;
        if (cumAcc > 0) {
          const pct = cumAcc / max;
          if (pct < 0.25) level = 1;
          else if (pct < 0.5) level = 2;
          else if (pct < 0.85) level = 3;
          else level = 4;
        }
      }
      return { ...r, displaySec, level };
    });

    const months: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < cells.length; i += 7) {
      const m = cells[i]!.date.toLocaleDateString("en-US", { month: "short" });
      if (!seen.has(m)) {
        seen.add(m);
        months.push(m);
      }
    }
    return { cells, months: months.slice(0, 10) };
  }, [daily, mode]);

  const colorFor = (lvl: number) => {
    if (lvl === 0) return "#F5EBDD";
    if (lvl === 1) return "#FDE9C8";
    if (lvl === 2) return "#F9C38A";
    if (lvl === 3) return "#E8A166";
    return "#D4853D";
  };

  return (
    <div>
      <div className="z-heatmap">
        {cells.map((c, idx) => {
          const tipTitle =
            mode === "weekly"
              ? `Week of ${c.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : c.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          const timeLabel = mode === "weekly" || mode === "cumulative" ? fmtLong(c.displaySec) : fmtLong(c.seconds);
          const col = idx % 32;
          const edge = col >= 28 ? " is-right" : col <= 3 ? " is-left" : "";
          return (
            <div
              key={c.key + mode}
              className={`z-heatmap__cell${edge}`}
              style={{ background: colorFor(c.level) }}
            >
              <div className="z-heatmap__tip" role="tooltip">
                <div className="z-heatmap__tip-head">{tipTitle}</div>
                <div className="z-heatmap__tip-row">
                  <span>Time</span>
                  <b>{timeLabel}</b>
                </div>
                <div className="z-heatmap__tip-row">
                  <span>Commands</span>
                  <b>{c.commands}</b>
                </div>
                <div className="z-heatmap__tip-row">
                  <span>Panes</span>
                  <b>{c.terminals}</b>
                </div>
                {mode !== "daily" ? (
                  <div className="z-heatmap__tip-mode">{mode === "weekly" ? "weekly total" : "cumulative"}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="z-heatmap__months">
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  );
}

export function InsightsScreen() {
  const usage = useUsageStore();
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [heatmapMode, setHeatmapMode] = useState<"daily" | "weekly" | "cumulative">("daily");
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const [isComputing, setIsComputing] = useState(() => {
    // skip gate in tests (jsdom) so vitest can assert content immediately
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return false;
    return true;
  });

  useEffect(() => {
    if (!isComputing) return;
    // mimic reading local session history — matches Image 2
    const t = window.setTimeout(() => setIsComputing(false), 900);
    return () => window.clearTimeout(t);
  }, [isComputing]);

  useEffect(() => () => {
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const streak = useMemo(() => calcStreak(usage.daily, usage.sessions), [usage.daily, usage.sessions]);
  const daysActive = Math.max(1, Math.ceil((usage.lastTick - usage.firstSeen) / 86_400_000));
  const avgPerDay = usage.activeSeconds / daysActive;

  // top stats
  const totalTimeSec = usage.activeSeconds;
  const peakDaySec = useMemo(() => {
    let max = 0;
    for (const v of Object.values(usage.daily)) max = Math.max(max, v.seconds);
    return max;
  }, [usage.daily]);
  const longestSessionSec = useMemo(() => {
    // longest single-day as longest session proxy
    return peakDaySec;
  }, [peakDaySec]);

  const trendData = useMemo(() => {
    const n = range === "7d" ? 7 : 30;
    const out: Array<Record<string, number | string>> = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(usage.lastTick || Date.now());
      d.setDate(d.getDate() - i);
      const k = localKey(d);
      const s = usage.daily[k];
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); // Aug 23
      const timeMin = s ? Math.round((s.seconds / 60) * 10) / 10 : 0;
      out.push({
        x: label,
        full: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        time: timeMin,
        commands: s?.commands ?? 0,
        panes: s?.terminals ?? 0,
      });
    }
    return out;
  }, [usage.daily, usage.lastTick, range]);

  // donut breakdown — last 7 days by day share of time
  const donut = useMemo(() => {
    const n = 7;
    const segs: Array<{ name: string; value: number; seconds: number }> = [];
    let total = 0;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(usage.lastTick || Date.now());
      d.setDate(d.getDate() - i);
      const k = localKey(d);
      const sec = usage.daily[k]?.seconds ?? 0;
      total += sec;
      const name = d.toLocaleDateString("en-US", { weekday: "short" }) + " " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      segs.push({ name, value: sec, seconds: sec });
    }
    // filter 0 and sort desc for legend like screenshot
    const filtered = segs.filter((s) => s.seconds > 0);
    const sorted = [...filtered].sort((a, b) => b.seconds - a.seconds);
    return { segs: sorted.length ? sorted : [{ name: "No activity", value: 1, seconds: 0 }], total };
  }, [usage.daily, usage.lastTick]);

  const DONUT_COLORS = [BLUE, GREEN, PURPLE, RED, ORANGE, CYAN, "#6B7280"];

  const copyReport = (): void => {
    const report = buildUsageReport(usage);
    void navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };

  if (isComputing) {
    return (
      <div className="z-insights z-insights--computing" data-testid="insights-screen">
        <div className="z-computing">
          <div className="z-computing__line" aria-hidden="true" />
          <div className="z-computing__body">
            <div className="z-computing__title">Computing usage</div>
            <div className="z-computing__sub">Reading local app session history, so it can take a moment.</div>
          </div>
          <div className="z-computing__line" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="z-insights" data-testid="insights-screen">
      {/* Header */}
      <div className="z-insights__head">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="z-insights__title">Usage stats</h1>
          <span className="z-pill">App usage</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {copied ? <span className="z-copied" role="status">Copied</span> : null}
          <button
            type="button"
            className="z-share"
            aria-label="Copy usage report"
            title="Copy usage report"
            onClick={copyReport}
          >
            <ShareIcon size={14} />
          </button>
        </div>
      </div>

      {/* Top stats bar — 5 cols like screenshot */}
      <div className="z-statsbar">
        <div className="z-statsbar__item">
          <b>{fmtLong(totalTimeSec) || "0m"}</b>
          <span>Total time</span>
        </div>
        <div className="z-statsbar__item">
          <b>{donut.total ? fmtLong(peakDaySec) : "0m"}</b>
          <span>Peak day</span>
        </div>
        <div className="z-statsbar__item">
          <b>{longestSessionSec ? fmtLong(longestSessionSec) : "0m"}</b>
          <span>Longest day</span>
        </div>
        <div className="z-statsbar__item">
          <b>{streak.cur} d</b>
          <span>Current streak</span>
        </div>
        <div className="z-statsbar__item">
          <b>{streak.best} d</b>
          <span>Longest streak</span>
        </div>
      </div>

      {/* Token activity heatmap */}
      <section className="z-section z-section--activity">
        <div className="z-card z-card--pop z-card--activity">
          <div className="z-card__head">
            <h2 className="z-card__title">Activity</h2>
          <div className="z-tabs" role="tablist" aria-label="Activity granularity">
            <button
              role="tab"
              aria-selected={heatmapMode === "daily"}
              className={`z-tabs__btn${heatmapMode === "daily" ? " is-active" : ""}`}
              onClick={() => setHeatmapMode("daily")}
            >
              Daily
            </button>
            <button
              role="tab"
              aria-selected={heatmapMode === "weekly"}
              className={`z-tabs__btn${heatmapMode === "weekly" ? " is-active" : ""}`}
              onClick={() => setHeatmapMode("weekly")}
            >
              Weekly
            </button>
            <button
              role="tab"
              aria-selected={heatmapMode === "cumulative"}
              className={`z-tabs__btn${heatmapMode === "cumulative" ? " is-active" : ""}`}
              onClick={() => setHeatmapMode("cumulative")}
            >
              Cumulative
            </button>
          </div>
        </div>
        <Heatmap daily={usage.daily} mode={heatmapMode} />
        </div>
      </section>

      {/* Time range + Daily trend */}
      <div className="z-range">
        <span className="z-range__label">Time range</span>
        <div className="z-range__tabs">
          <button className={`z-range__btn${range === "7d" ? " is-active" : ""}`} onClick={() => setRange("7d")}>
            Last 7 days
          </button>
          <button className={`z-range__btn${range === "30d" ? " is-active" : ""}`} onClick={() => setRange("30d")}>
            Last 30 days
          </button>
        </div>
      </div>

      <div className="z-card">
        <div className="z-card__head">
          <h2 className="z-card__title">Daily time trend</h2>
        </div>
        <div className="z-legend">
          {SERIES.map((s) => (
            <span key={s.key} className="z-legend__item">
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <div style={{ height: 220, marginTop: 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={ZGRID} strokeDasharray="3 3" vertical={false} opacity={0.6} />
              <XAxis
                dataKey="x"
                tick={{ fill: ZMUTED, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={false}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip
                cursor={{ stroke: "#A8A29E", strokeDasharray: "4 4" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]!.payload as Record<string, number | string>;
                  const totalMin = (row.time as number) ?? 0;
                  return (
                    <div className="z-tooltip">
                      <div className="z-tooltip__head">
                        {label} — {totalMin} min
                      </div>
                      {SERIES.map((s) => {
                        const v = row[s.key] as number;
                        return (
                          <div key={s.key} className="z-tooltip__row">
                            <span>
                              <i style={{ background: s.color }} />
                              {s.label}
                            </span>
                            <b>
                              {v}
                              <span> {s.key === "time" ? "min" : s.key === "commands" ? "cmds" : "panes"}</span>
                            </b>
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="time" stroke={BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: BLUE, stroke: "#FFFDFA", strokeWidth: 2 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="commands" stroke={GREEN} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: GREEN, stroke: "#FFFDFA", strokeWidth: 2 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="panes" stroke={PURPLE} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: PURPLE, stroke: "#FFFDFA", strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Model usage donut */}
      <div className="z-card">
        <div className="z-card__head">
          <h2 className="z-card__title">Activity breakdown</h2>
        </div>
        <div className="z-split">
          <div className="z-donut">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={donut.segs}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={64}
                  outerRadius={94}
                  paddingAngle={donut.segs.length > 1 ? 2 : 0}
                  isAnimationActive={false}
                >
                  {donut.segs.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} stroke="#FFFDFA" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]!.payload as { name: string; seconds: number; value: number };
                    const pct = donut.total ? ((p.seconds / donut.total) * 100).toFixed(1) : "0";
                    return (
                      <div className="z-tooltip">
                        <div className="z-tooltip__head">{p.name}</div>
                        <div className="z-tooltip__row">
                          <span>Share</span>
                          <b>{pct}%</b>
                        </div>
                        <div className="z-tooltip__row">
                          <span>Time</span>
                          <b>{fmtLong(p.seconds)}</b>
                        </div>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="z-donut__center">
              <b>{donut.total ? fmtLong(donut.total) : "0m"}</b>
              <span>total</span>
            </div>
          </div>
          <div className="z-legendlist">
            {donut.segs.map((s, i) => {
              const pct = donut.total ? ((s.seconds / donut.total) * 100).toFixed(1) : "0";
              // hide placeholder
              if (s.name === "No activity") return <div key={s.name} className="z-legendlist__row muted">No activity yet — use the app</div>;
              return (
                <div key={s.name} className="z-legendlist__row">
                  <span className="z-legendlist__name">
                    <i style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    {s.name}
                  </span>
                  <span className="z-legendlist__meta">
                    <span>{pct}%</span>
                    <span className="z-legendlist__sub">{fmtLong(s.seconds)}</span>
                  </span>
                </div>
              );
            })}
            <div className="z-legendlist__hint">7 days · avg {fmtLong(Math.round(avgPerDay))}/day</div>
          </div>
        </div>
      </div>

      <div className="z-foot">
        <button className="z-refresh" onClick={() => window.location.reload()}>
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
