export type ThemeId = string;

export interface PaneNodePersist {
  readonly paneId: string;
  readonly cwd: string | null;
  readonly position: { readonly x: number; readonly y: number };
  readonly cliId?: string | null;
  readonly size?: { readonly width: number; readonly height: number } | null;
}

export interface WorkspacePersist {
  readonly nodes: readonly PaneNodePersist[];
}

export interface SavedLayout {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly PaneNodePersist[];
  readonly builtin?: boolean;
}

export interface Settings {
  theme: ThemeId;
  activeWorkspaceTabId: string | null;
  shell: string | null;
  fontFamily: string;
  fontSize: number;
  scrollbackLines: number;
  lastCwd: string | null;
  workspace: WorkspacePersist | null;
  savedLayouts: readonly SavedLayout[];
  /** Display name for the local profile; "" until bootstrapped from the OS account. */
  userName: string;
  /** Client-generated uuid identifying this install for anonymous heartbeats. */
  installId: string;
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
  userName: "",
  installId: "",
};

/** Auto-update lifecycle, broadcast from main to the renderer. */
export interface UpdateProgress {
  phase: "checking" | "available" | "downloading" | "staged" | "up-to-date" | "error";
  version?: string;
  receivedBytes?: number;
  totalBytes?: number;
  message?: string;
}
