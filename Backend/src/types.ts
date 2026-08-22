// Shared data model types — owned by Backend, imported (type-only) by Frontend.

export type ThemeId = string;

/** Per-pane entry in the persisted workspace skeleton (Settings.workspace).
 *  Re-hydrated on the "Continue" returning path: Workspace.hydrate maps each
 *  entry to a React Flow Node whose `data.cwd` drives the pane's ptySpawn
 *  cwdOverride. position is the canvas-space slot the user dragged the node
 *  to. cwd null is a degraded state (TerminalPane falls back through lastCwd
 *  -> os.homedir). The legacy `lastCwd` field (below) is no longer written by
 *  the live "+ New terminal" picker — per-pane cwds ride on this skeleton
 *  instead, persisting across restarts when the user adds/removes/drags panes.
 *  Returned by helpers in the canvas store; serialized to disk via the
 *  SettingsStore's atomic `settings.json` write. */
export interface PaneNodePersist {
  readonly paneId: string;
  readonly cwd: string | null;
  readonly position: { readonly x: number; readonly y: number };
}

/** Persisted workspace skeleton. `null` (vs `{nodes: []}`) is reserved as the
 *  "first-ever launch" / pre-feature-build sentinel — Workspace's phase gate
 *  treats `{workspace: null} && {lastCwd: null}` as "fresh user, show the
 *  Welcome screen", and `{workspace: null} && {lastCwd: <some>} ` as a legacy
 *  upgrade to be migrated on the returning user's Continue click. */
export interface WorkspacePersist {
  readonly nodes: readonly PaneNodePersist[];
}

export interface Settings {
  theme: ThemeId;
  activeWorkspaceTabId: string | null;
  shell: string | null;
  fontFamily: string;
  fontSize: number;
  scrollbackLines: number;
  /** Welcome-screen "primary folder" + TerminalPane null-cwd fallback. Set
   *  by the Welcome flow's "Open workspace" commit (the primary folder = the
   *  shared pick, or the p1 pick in per-pane mode). Once the workspace
   *  skeleton took over per-pane cwd persistence, the live "+ New terminal"
   *  picker no longer writes this field — the skeleton's per-pane cwd is the
   *  honour-role for newly-added panes; lastCwd stays the welcome-flow
   *  default + TerminalPane's null-cwd fallback chain end. */
  lastCwd: string | null;
  /** Persisted workspace skeleton (boot-restore contract for the "Continue"
   *  returning-launch path). null = first-ever-launch or upgrade from a
   *  pre-feature build. SettingsStore.readFromDisk backfills this null via
   *  the DEFAULT_SETTINGS spread so existing `settings.json` upgrades
   *  cleanly. The frontend auto-persists the skeleton on every canvas
   *  mutation (add / remove / drag) via a debounced updateSettings round
   *  from TerminalCanvas. */
  workspace: WorkspacePersist | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "paper",
  activeWorkspaceTabId: null,
  shell: null,
  fontFamily: "JetBrains Mono",
  fontSize: 13,
  scrollbackLines: 10000,
  lastCwd: null,
  workspace: null,
};
