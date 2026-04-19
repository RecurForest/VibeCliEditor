export type ShellKind = "cmd" | "powershell";

export type PathInsertMode = "projectRelative" | "absolute";

export type AgentProvider = "codex" | "claude";

export type RuntimeModelSwitchStrategy =
  | "provider-passthrough"
  | "successor-session"
  | "next-launch-only";

export interface AgentSessionProfile {
  provider: AgentProvider;
  model?: string | null;
  effort?: string | null;
  profile?: string | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
}

export interface AgentSessionMeta {
  provider: AgentProvider;
  requestedProfile: AgentSessionProfile;
  runtimeModelSwitchStrategy: RuntimeModelSwitchStrategy;
}

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

export interface TextSearchResult {
  absPath: string;
  name: string;
  relPath: string;
  line: number;
  column: number;
  matchLength: number;
  lineText: string;
  preview: string;
  previewStartLine: number;
}

export interface TerminalSessionInfo {
  sessionId: string;
  shellKind: ShellKind;
  workingDir: string;
}

export type TerminalSessionMode = "shell" | "codex" | "claude";

export type TerminalSessionStatus = "starting" | "active" | "completed";

export interface TerminalSessionRecord {
  agent?: AgentSessionMeta | null;
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

export type SessionDiffFileStatus = "added" | "deleted" | "modified";

export interface SessionDiffFile {
  path: string;
  absPath: string;
  status: SessionDiffFileStatus;
  isBinary: boolean;
  tooLarge: boolean;
  originalContent: string | null;
  modifiedContent: string | null;
}

export interface SessionDiffResult {
  sessionId: string;
  rootPath: string;
  generatedAt: number;
  files: SessionDiffFile[];
}

export type SessionDiffBaselineStatus = "idle" | "preparing" | "ready" | "error";

export interface CodexDiffSessionState {
  sessionId: string;
  baselineStatus: SessionDiffBaselineStatus;
  isDiffLoading: boolean;
  error: string | null;
}

export type SessionDiffViewButtonState = "idle" | "preparing" | "loading" | "ready";

export interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  targetNode: FileNode;
}

export interface EditorTab {
  absPath: string;
  relPath: string;
  name: string;
  content: string;
  savedContent: string;
  contentKind?: "text" | "image";
  isReadOnly?: boolean;
}

export interface SessionDiffTab {
  id: string;
  name: string;
  relPath: string;
  result: SessionDiffResult;
  sessionTitle?: string | null;
  tabType: "sessionDiff";
}

export type GitChangeStatus = "added" | "deleted" | "modified" | "renamed";

export type GitChangeGroup = "changes" | "unversioned";

export interface GitChangeEntry {
  path: string;
  absPath: string;
  status: GitChangeStatus;
  group: GitChangeGroup;
  previousPath: string | null;
}

export interface GitRepositoryChanges {
  rootPath: string;
  name: string;
  relativePath: string;
  branch: string;
  changes: GitChangeEntry[];
  unversioned: GitChangeEntry[];
}

export interface GitChangesResult {
  rootPath: string;
  hasRepository: boolean;
  repositories: GitRepositoryChanges[];
}

export interface GitDiffResult {
  rootPath: string;
  branch: string;
  path: string;
  absPath: string;
  status: GitChangeStatus;
  group: GitChangeGroup;
  previousPath: string | null;
  isBinary: boolean;
  tooLarge: boolean;
  originalContent: string | null;
  modifiedContent: string | null;
}

export interface GitCommitResult {
  branch: string;
  commitOid: string;
  summary: string;
}

export interface GitDiffTab {
  id: string;
  name: string;
  relPath: string;
  result: GitDiffResult;
  tabType: "gitDiff";
}

export type WorkbenchTab = EditorTab | SessionDiffTab | GitDiffTab;

export interface CursorPosition {
  line: number;
  column: number;
}

export interface EditorNavigationRequest {
  id: number;
  absPath: string;
  line: number;
  column: number;
  matchLength: number;
}
