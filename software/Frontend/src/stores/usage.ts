import { create } from "zustand";

type DayKey = string;
interface DayStats { terminals: number; commands: number; sessions: number; seconds: number; }
interface UsageState {
  firstSeen: number;
  sessions: number;
  lastTick: number;
  terminalsCreated: number;
  commandsRun: number;
  layoutsApplied: number;
  activeSeconds: number;
  daily: Record<DayKey, DayStats>;
  recordSession: () => void;
  recordTerminal: (n?: number) => void;
  recordCommand: (n?: number) => void;
  recordLayout: () => void;
  tick: (sec?: number) => void;
  hydrate: () => void;
  flush: () => void;
}

const KEY = "mapw:usage";
const TICK_MS = 1000;
const SAVE_MS = 5000;
function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const todayKey = (offsetMs = 0): string => localKey(new Date(Date.now() + offsetMs));

let dirty = false;

const load = (): Partial<UsageState> => {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
};

const persist = (s: UsageState): void => {
  dirty = false;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      firstSeen: s.firstSeen,
      sessions: s.sessions,
      terminalsCreated: s.terminalsCreated,
      commandsRun: s.commandsRun,
      layoutsApplied: s.layoutsApplied,
      activeSeconds: s.activeSeconds,
      daily: s.daily,
    }));
  } catch {}
};

function bumpDaily(s: UsageState, patch: Partial<DayStats>): Record<DayKey, DayStats> {
  const dk = todayKey();
  const cur = s.daily[dk] ?? { terminals: 0, commands: 0, sessions: 0, seconds: 0 };
  return { ...s.daily, [dk]: { terminals: cur.terminals + (patch.terminals ?? 0), commands: cur.commands + (patch.commands ?? 0), sessions: cur.sessions + (patch.sessions ?? 0), seconds: cur.seconds + (patch.seconds ?? 0) } };
}

export const useUsageStore = create<UsageState>((set, get) => ({
  firstSeen: Date.now(),
  sessions: 0,
  lastTick: Date.now(),
  terminalsCreated: 0,
  commandsRun: 0,
  layoutsApplied: 0,
  activeSeconds: 0,
  daily: {},
  flush: () => { if (dirty) persist(get()); },
  hydrate: () => {
    const p = load();
    set((s) => ({
      firstSeen: (p.firstSeen as number) ?? s.firstSeen,
      sessions: (p.sessions as number) ?? 0,
      lastTick: Date.now(),
      terminalsCreated: (p.terminalsCreated as number) ?? 0,
      commandsRun: (p.commandsRun as number) ?? 0,
      layoutsApplied: (p.layoutsApplied as number) ?? 0,
      activeSeconds: (p.activeSeconds as number) ?? 0,
      daily: (p.daily as Record<string, DayStats>) ?? {},
    }));
    dirty = false;
    get().recordSession();
    set({ lastTick: Date.now() });
  },
  recordSession: () => {
    dirty = true;
    set((s) => ({ ...s, lastTick: Date.now(), sessions: s.sessions + 1, daily: bumpDaily(s, { sessions: 1 }) }));
  },
  recordTerminal: (n = 1) => {
    dirty = true;
    set((s) => ({ ...s, lastTick: Date.now(), terminalsCreated: s.terminalsCreated + n, daily: bumpDaily(s, { terminals: n }) }));
  },
  recordCommand: (n = 1) => {
    dirty = true;
    set((s) => ({ ...s, lastTick: Date.now(), commandsRun: s.commandsRun + n, daily: bumpDaily(s, { commands: n }) }));
  },
  recordLayout: () => {
    dirty = true;
    set((s) => ({ ...s, lastTick: Date.now(), layoutsApplied: s.layoutsApplied + 1 }));
  },
  tick: (sec = 1) => set((s) => {
    dirty = true;
    return { ...s, lastTick: s.lastTick + sec * 1000, activeSeconds: s.activeSeconds + sec, daily: bumpDaily(s, { seconds: sec }) };
  }),
}));

if (typeof window !== "undefined") {
  let tickId: number | null = null;
  let saveId: number | null = null;
  const start = (): void => {
    if (tickId == null) tickId = window.setInterval(() => useUsageStore.getState().tick(1), TICK_MS);
    if (saveId == null) saveId = window.setInterval(() => useUsageStore.getState().flush(), SAVE_MS);
  };
  const stop = (): void => {
    if (tickId != null) { clearInterval(tickId); tickId = null; }
    if (saveId != null) { clearInterval(saveId); saveId = null; }
    useUsageStore.getState().flush();
  };
  window.addEventListener("focus", start);
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else start(); });
  window.addEventListener("pagehide", () => useUsageStore.getState().flush());
  start();
}
