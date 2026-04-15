export type ShellKind = "cmd" | "powershell";

export type PathInsertMode = "projectRelative" | "absolute";

export interface FileNode {
  id: string;
  name: string;
  absPath: string;
  relPath: string;
  isDir: boolean;
  size?: number;
  modifiedAt?: number;
  hasChildren: boolean;
  children?: FileNode[];
}

export interface FileSearchResult {
  absPath: string;
  name: string;
  relPath: string;
}

export interface TerminalSessionInfo {
  sessionId: string;
  shellKind: ShellKind;
  workingDir: string;
}

export type TerminalSessionMode = "shell" | "codex" | "claude";

export type TerminalSessionStatus = "starting" | "active" | "completed";

export interface TerminalSessionRecord {
  id: string;
  exitCode?: number | null;
  finishedAt?: number;
  mode: TerminalSessionMode;
  output: string;
  shellKind: ShellKind;
  startedAt: number;
  status: TerminalSessionStatus;
  title: string;
  workingDir: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  data: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode?: number | null;
}

export interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
}

export interface EditorTab {
  absPath: string;
  relPath: string;
  name: string;
  content: string;
  savedContent: string;
}

export interface CursorPosition {
  line: number;
  column: number;
}
