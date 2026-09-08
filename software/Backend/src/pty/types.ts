export interface PtySpawnOptions {

  readonly paneId: string;

  readonly cols: number;
  readonly rows: number;

  readonly shellOverride?: string | null;

  readonly cwdOverride?: string | null;

  readonly env?: Record<string, string>;
}

export interface PtySpawnResponse {
  readonly paneId: string;

  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
}

export type PtyEvent =
  | { readonly paneId: string; readonly type: "data"; readonly data: string }
  | { readonly paneId: string; readonly type: "exit"; readonly exitCode: number };