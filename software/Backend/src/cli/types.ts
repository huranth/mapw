export interface DetectedCliTool {
  readonly id: string;
  readonly name: string;
  readonly binary: string;
  readonly launchCommand: string;
  readonly path: string;
}

export interface DetectCliToolsResult {
  readonly tools: DetectedCliTool[];
}

export const CURATED_CLIS: readonly {
  readonly id: string;
  readonly name: string;
  readonly binary: string;
  readonly launchCommand: string;
}[] = [
  { id: "opencode", name: "opencode", binary: "opencode", launchCommand: "opencode" },
  { id: "claude", name: "claude", binary: "claude", launchCommand: "claude" },
  { id: "aider", name: "aider", binary: "aider", launchCommand: "aider" },
  { id: "codex", name: "codex", binary: "codex", launchCommand: "codex" },
  { id: "gemini", name: "gemini", binary: "gemini", launchCommand: "gemini" },
  { id: "amp", name: "amp", binary: "amp", launchCommand: "amp" },
];