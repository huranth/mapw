// Renderer-safe surface: constants + types + pure-logic helpers only.
// Zero Node-API imports so the renderer bundle (browser target) can include
// this without pulling in node:fs or node-pty. Heavy services (SettingsStore,
// PtyService) live on the package root subpath and are only imported from the
// Electron main process.

export { DEFAULT_SETTINGS } from "./types.js";
export type {
  PaneNodePersist,
  SavedLayout,
  Settings,
  ThemeId,
  WorkspacePersist,
} from "./types.js";
export { parseOscPayload, OscParser } from "./pty/osc.js";
export type { OscEvent } from "./pty/osc.js";
export type { PtyEvent, PtySpawnOptions, PtySpawnResponse } from "./pty/types.js";
export type { ShellKind } from "./pty/shellIntegration.js";
export type { DetectedCliTool, DetectCliToolsResult } from "./cli/types.js";
