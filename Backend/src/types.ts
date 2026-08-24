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
  /** Optional curated-CLI id (one of the ids in
   *  `Backend/src/cli/types.ts`'s CLIS table — `opencode`/`claude`/`aider`/
   *  `codex`/`gemini`/`amp`) bound to this pane by a saved layout. When
   *  non-null AND the CLI is installed at apply time, TerminalPane auto-fires
   *  `${launchCommand}\r` once after ptySpawn resolves (the same primitive the
   *  chip-strip click in TerminalNode uses). null = pane boots raw shell and
   *  the chip strip remains the runtime CLI-choice surface. Missing on
   *  pre-feature skeletons; upgraded by the DEFAULT_SETTINGS spread + the
   *  `?? null` coercion on the read side (canvas.nodesFromPersist). */
  readonly cliId?: string | null;
  /** Optional persisted node size (px, React Flow user space) for the M3
   *  per-node resize. Written by TerminalCanvas's debounced skeleton
   *  serializer from the live `node.width` / `node.height` that React Flow
   *  mutates on a <NodeResizer> drag; read back by `canvas.nodesFromPersist`
   *  so a "Continue" restore re-applies each pane's last dragged footprint.
   *  Missing on pre-feature skeletons (and the boot seeds, until the user
   *  resizes) — `nodesFromPersist` falls back to the canonical NODE_W/NODE_H.
   *  `null` is treated the same as missing for back-compat with settings.json
   *  files written before the field existed. */
  readonly size?: { readonly width: number; readonly height: number } | null;
}

/** Persisted workspace skeleton. `null` (vs `{nodes: []}`) is reserved as the
 *  "first-ever launch" / pre-feature-build sentinel — Workspace's phase gate
 *  treats `{workspace: null} && {lastCwd: null}` as "fresh user, show the
 *  Welcome screen", and `{workspace: null} && {lastCwd: <some>} ` as a legacy
 *  upgrade to be migrated on the returning user's Continue click. */
export interface WorkspacePersist {
  readonly nodes: readonly PaneNodePersist[];
}

/** A named snapshot of a pane arrangement — either a built-in preset
 *  (shipped as the renderer constant `BUILTIN_LAYOUTS` in
 *  `Frontend/src/stores/layouts.ts` with `builtin: true`) or a layout the
 *  user saved (lives on `Settings.savedLayouts`, no `builtin` flag). `nodes`
 *  mirrors `WorkspacePersist.nodes` so `applyLayout` feeds the exact same
 *  `hydrate`-from-skeleton path the Returning flow uses; the saved layout's
 *  per-pane cliId + cwd + position survive the snapshot round-trip. */
export interface SavedLayout {
  /** Stable id used as the React key + the saved-layouts splice index. Built-
   *  ins carry `builtin:...` ids; user-saved layouts get a fresh id at save
   *  time (see `saveCurrentLayout` in layouts.ts). */
  readonly id: string;
  /** User-facing name. Built-ins render this as their card heading; user-
   *  saved layouts render it inline-editable in their row. */
  readonly name: string;
  /** Slot layout: one PaneNodePersist per pane, carrying paneId + position +
   *  (optional) cwd + (optional) cliId. `applyLayout` re-keys each paneId via
   *  the canvas counter so React Flow reconciles them as mounts (the prior
   *  canvas's panes unmount + ptyKill cleanly; the new layout's panes spawn
   *  fresh + auto-launch their bound CLI). */
  readonly nodes: readonly PaneNodePersist[];
  /** True iff this is a built-in preset (renderer constant). LayoutsScreen
   *  hides Rename/Delete affordances for built-ins; renameSavedLayout +
   *  deleteSavedLayout skip entries with `builtin: true`. User-saved layouts
   *  omit the flag (their entries live only in Settings.savedLayouts). */
  readonly builtin?: boolean;
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
  /** User-saved named layouts, accessible from the titlebar's Layouts panel
   *  across every workspace/folder. settings.json is global — there's no
   *  per-folder layout scope today — so this array is shared. Built-in
   *  presets ship as renderer constants (`BUILTIN_LAYOUTS`) and are NOT
   *  persisted here; this array only ever holds the user's own saves. Read-
   *  modify-write through `useSettingsStore.update({ savedLayouts })` —
   *  `SettingsStore.update` does a shallow top-level merge, so callers splice
   *  into the array and write the whole array back. DEFAULT_SETTINGS emits
   *  `savedLayouts: []` so existing settings.json files upgrade cleanly. */
  savedLayouts: readonly SavedLayout[];
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
  savedLayouts: [],
};
