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
