// Pure-logic PTY types — browser-safe (no Node-API imports). Re-exported on
// BOTH the Backend root subpath (used by the Electron main process) AND the
// Browser-safe `./renderer` subpath (used by the React renderer bundle, which
// only needs the shapes for IPC typing — never spawns a Pty itself).

/** One pane's spawn request. Sent renderer -> main via `pty:spawn`. */
export interface PtySpawnOptions {
  /** Stable pane key used to route every subsequent ptyWrite/Resize/Kill +
   *  every streamed ptyData/ptyExit event back to this pane. */
  readonly paneId: string;
  /** Initial TTY geometry after spawn. Renderer refits once FitAddon measures
   *  the actual container; this default just bootstraps the buffer. */
  readonly cols: number;
  readonly rows: number;
  /** User-supplied shell override (Settings.shell). When null the PtyService
   *  falls back to the platform default (see shellIntegration.detectShell). */
  readonly shellOverride?: string | null;
  /** Override the initial working directory. Defaults to os.homedir(). */
  readonly cwdOverride?: string | null;
  /** Extra env vars merged on top of the main process's env. */
  readonly env?: Record<string, string>;
}

/** Spawn response. Sent main -> renderer via the `pty:spawn` invoke reply. */
export interface PtySpawnResponse {
  readonly paneId: string;
  /** The resolved ShellKind (see shellIntegration.ts). */
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
}

/** Streaming event from main -> renderer via `pty:data` / `pty:exit` channels.
 *  Discriminated union — narrow on `type` to fold out `data` / `exitCode`. */
export type PtyEvent =
  | { readonly paneId: string; readonly type: "data"; readonly data: string }
  | { readonly paneId: string; readonly type: "exit"; readonly exitCode: number };
