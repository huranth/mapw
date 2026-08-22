export { SettingsStore } from "./store/SettingsStore.js";
export type { SettingsStoreOptions } from "./store/SettingsStore.js";
export { OscParser, parseOscPayload } from "./pty/osc.js";
export type { OscEvent } from "./pty/osc.js";
export { PtyService } from "./pty/PtyService.js";
export type {
  PtyDataListener,
  PtyExitListener,
  PtyServiceOptions,
} from "./pty/PtyService.js";
export type { PtyEvent, PtySpawnOptions, PtySpawnResponse } from "./pty/types.js";
export {
  detectShell,
  detectProfilePath,
  buildShellRc,
  spawnArgsFor,
  spawnEnv,
  resolveBinary,
  type ShellKind,
} from "./pty/shellIntegration.js";
export { DEFAULT_SETTINGS } from "./types.js";
export type { PaneNodePersist, Settings, ThemeId, WorkspacePersist } from "./types.js";
