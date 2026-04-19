import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  ChevronDown,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Maximize2,
  Minimize2,
  Minus,
  PenLine,
  RefreshCw,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ConfirmDialog } from "./components/Dialog/ConfirmDialog";
import { InputDialog } from "./components/Dialog/InputDialog";
import { EditorPane } from "./components/Editor/EditorPane";
import { useEditor } from "./components/Editor/useEditor";
import appIcon from "./assets/vibe-cli-editor-logo.svg";
import { FileTree } from "./components/FileTree/FileTree";
import { useFileTree } from "./components/FileTree/useFileTree";
import { GitPanel } from "./components/GitPanel/GitPanel";
import { useGitPanel } from "./components/GitPanel/useGitPanel";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { InlineCmdTerminal } from "./components/TerminalPane/InlineCmdTerminal";
import { TerminalPane } from "./components/TerminalPane/TerminalPane";
import { useTerminal } from "./components/TerminalPane/useTerminal";
import {
  WorkspaceFileSearch,
  type WorkspaceSearchShortcutRequest,
} from "./components/WorkspaceSearch/WorkspaceFileSearch";
import type {
  AgentProvider,
  EditorNavigationRequest,
  EditorTab,
  FileNode,
  FileSearchResult,
  GitChangeEntry,
  GitDiffResult,
  GitDiffTab,
  SessionDiffFile,
  SessionDiffResult,
  SessionDiffTab,
  ShellKind,
  TextSearchResult,
  WorkbenchTab,
} from "./types";
import { resolveProjectRelativePath } from "./utils/paths";
import "./App.css";

const appWindow = getCurrentWindow();
const APP_WINDOW_TITLE = "VibeCliEditor";
const RECENT_FOLDERS_STORAGE_KEY = "vibeCliEditor.recentFolders";
const LEGACY_RECENT_FOLDERS_STORAGE_KEY = "jterminal.recentFolders";
const MAX_RECENT_FOLDERS = 8;
const CURRENT_WINDOW_LABEL = appWindow.label;
const INITIAL_RECENT_FOLDERS = loadRecentFolders();
const INITIAL_WORKSPACE_PATH = getInitialWorkspacePath(INITIAL_RECENT_FOLDERS);
const INITIAL_LAUNCH_PROVIDER = getInitialLaunchProvider();
const SHOULD_REPLACE_BOOTSTRAP_WINDOW =
  CURRENT_WINDOW_LABEL === "main" &&
  INITIAL_WORKSPACE_PATH !== null &&
  getWorkspacePathFromLocation() === null;
let hasTriggeredBootstrapWindowReplacement = false;

syncWindowTitle(buildWindowTitle(null, getWorkspaceName(INITIAL_WORKSPACE_PATH)));

interface FileTreeInputDialogState {
  initialValue: string;
  placeholder: string;
  submitLabel: string;
}

interface FileTreeConfirmDialogState {
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  title: string;
  tone: "default" | "danger";
}

interface InlineTerminalTabState {
  id: string;
  title: string;
}

interface WorkspaceShortcutRequest extends WorkspaceSearchShortcutRequest {}

function App() {
  const [recentFolders, setRecentFolders] = useState<string[]>(() => INITIAL_RECENT_FOLDERS);
  const [rootPath, setRootPath] = useState<string | null>(() => INITIAL_WORKSPACE_PATH);
  const [refreshToken, setRefreshToken] = useState(0);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [inlineTerminalTabs, setInlineTerminalTabs] = useState<InlineTerminalTabState[]>([]);
  const [activeInlineTerminalTabId, setActiveInlineTerminalTabId] = useState<string | null>(null);
  const [isComposerEnabled, setIsComposerEnabled] = useState(true);
  const [editorNavigationRequest, setEditorNavigationRequest] =
    useState<EditorNavigationRequest | null>(null);
  const [mainTerminalComposerInsertRequest, setMainTerminalComposerInsertRequest] = useState<{
    sequence: number;
    text: string;
  }>({
    sequence: 0,
    text: "",
  });
  const editorNavigationSequenceRef = useRef(0);
  const workspaceSearchShortcutSequenceRef = useRef(0);
  const [fileTreeInputDialog, setFileTreeInputDialog] = useState<FileTreeInputDialogState | null>(
    null,
  );
  const [fileTreeConfirmDialog, setFileTreeConfirmDialog] = useState<FileTreeConfirmDialogState | null>(
    null,
  );
  const [workspaceSearchShortcutRequest, setWorkspaceSearchShortcutRequest] =
    useState<WorkspaceShortcutRequest | null>(null);
  const [pendingAgentLaunchProvider, setPendingAgentLaunchProvider] =
    useState<AgentProvider | null>(() => INITIAL_LAUNCH_PROVIDER);
  const [leftSidebarView, setLeftSidebarView] = useState<"explorer" | "git">("explorer");
  const [gitDiffTab, setGitDiffTab] = useState<GitDiffTab | null>(null);
  const [isGitDiffTabActive, setIsGitDiffTabActive] = useState(false);
  const [sessionDiffTab, setSessionDiffTab] = useState<SessionDiffTab | null>(null);
  const [isSessionDiffTabActive, setIsSessionDiffTabActive] = useState(false);
  const [isGitDiffInlineDirty, setIsGitDiffInlineDirty] = useState(false);
  const [isSessionDiffInlineDirty, setIsSessionDiffInlineDirty] = useState(false);
  const shellKind: ShellKind = "cmd";
  const workspaceSwitcherRef = useRef<HTMLDivElement | null>(null);
  const inlineTerminalTabSequenceRef = useRef(0);
  const inlineTerminalTabsRef = useRef<InlineTerminalTabState[]>([]);
  const titlebarPointerPressedRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);
  const fileTreeInputDialogResolverRef = useRef<((value: string | null) => void) | null>(null);
  const fileTreeConfirmDialogResolverRef = useRef<((value: boolean) => void) | null>(null);

  const editor = useEditor({
    rootPath,
  });
  const gitPanel = useGitPanel({
    rootPath,
  });
  const refreshWorkspace = useCallback(() => {
    setRefreshToken((value) => value + 1);
    void editor.reloadCleanTabsFromDisk();
    void gitPanel.refresh();
  }, [editor.reloadCleanTabsFromDisk, gitPanel.refresh]);

  const currentWorkspaceName = useMemo(() => getWorkspaceName(rootPath), [rootPath]);
  const currentWorkspaceInitials = useMemo(
    () => getWorkspaceInitials(currentWorkspaceName),
    [currentWorkspaceName],
  );
  const insertIntoMainTerminalComposer = useCallback((text: string) => {
    if (!text) {
      return;
    }

    setMainTerminalComposerInsertRequest((currentRequest) => ({
      sequence: currentRequest.sequence + 1,
      text,
    }));
  }, []);
  const visibleRecentFolders = useMemo(
    () => recentFolders.filter((path) => path !== rootPath),
    [recentFolders, rootPath],
  );
  const isInlineTerminalVisible = inlineTerminalTabs.length > 0;
  const openEditorFile = useCallback(
    async (node: FileNode) => {
      setIsSessionDiffTabActive(false);
      setIsGitDiffTabActive(false);
      await editor.openFile(node);
    },
    [editor],
  );

  const handleResolvedRootPath = useCallback((resolvedRootPath: string) => {
    setRootPath((currentRootPath) =>
      currentRootPath === resolvedRootPath ? currentRootPath : resolvedRootPath,
    );
  }, []);

  useEffect(() => {
    setEditorNavigationRequest(null);
  }, [rootPath]);

  useEffect(() => {
    inlineTerminalTabsRef.current = inlineTerminalTabs;
  }, [inlineTerminalTabs]);

  const fileTree = useFileTree({
    onDeletePaths: (paths) => {
      editor.removePaths(paths);
    },
    onResolvedRootPath: handleResolvedRootPath,
    onRenamePath: ({ fromPath, isDir, toPath }) => {
      editor.renamePath({ fromPath, isDir, toPath });
    },
    onInsertPaths: async (paths) => {
      if (!rootPath) {
        return;
      }

      if (isComposerEnabled) {
        insertIntoMainTerminalComposer(buildComposerPathInsertText(paths, rootPath, shellKind));
        return;
      }

      await terminal.insertPaths(paths, rootPath, "projectRelative");
    },
    onOpenFile: openEditorFile,
    requestTextInput: ({ initialValue = "", placeholder, submitLabel }) =>
      new Promise<string | null>((resolve) => {
        fileTreeInputDialogResolverRef.current = resolve;
        setFileTreeInputDialog({
          initialValue,
          placeholder,
          submitLabel,
        });
      }),
    requestConfirmation: ({
      cancelLabel = "Cancel",
      confirmLabel = "Confirm",
      message,
      title = "Confirm Action",
      tone = "default",
    }) =>
      new Promise<boolean>((resolve) => {
        fileTreeConfirmDialogResolverRef.current?.(false);
        fileTreeConfirmDialogResolverRef.current = resolve;
        setFileTreeConfirmDialog({
          cancelLabel,
          confirmLabel,
          message,
          title,
          tone,
        });
      }),
    refreshToken,
    rootPath,
  });

  const terminalLaunchDir = rootPath;

  const terminal = useTerminal({
    launchDir: terminalLaunchDir,
    onSessionComplete: refreshWorkspace,
    shellKind,
    workingDir: rootPath,
  });
  const refreshSessionDiffTab = useCallback(
    async (sessionId: string) => {
      const refreshedResult = await terminal.loadSessionDiff(sessionId);
      setSessionDiffTab((currentTab) => {
        if (!currentTab || currentTab.result.sessionId !== sessionId) {
          return currentTab;
        }

        const sessionTitle =
          currentTab.sessionTitle ??
          terminal.sessions.find((session) => session.id === sessionId)?.title ??
          "AI Session";

        return createSessionDiffTab(refreshedResult, sessionTitle);
      });
    },
    [terminal],
  );
  const refreshGitDiffTab = useCallback(
    async (absPath: string) => {
      const refreshedResult = await gitPanel.openDiff(absPath);
      if (!refreshedResult) {
        return;
      }

      setGitDiffTab(createGitDiffTab(refreshedResult));
    },
    [gitPanel.openDiff],
  );
  const workbenchTabs = useMemo<WorkbenchTab[]>(
    () => [
      ...editor.tabs,
      ...(gitDiffTab ? [gitDiffTab] : []),
      ...(sessionDiffTab ? [sessionDiffTab] : []),
    ],
    [editor.tabs, gitDiffTab, sessionDiffTab],
  );
  const activeWorkbenchTab = useMemo<WorkbenchTab | null>(
    () =>
      isSessionDiffTabActive
        ? sessionDiffTab
        : isGitDiffTabActive
          ? gitDiffTab
          : editor.activeTab,
    [editor.activeTab, gitDiffTab, isGitDiffTabActive, isSessionDiffTabActive, sessionDiffTab],
  );
  const activeLineJumpTab = useMemo<EditorTab | null>(
    () =>
      !isSessionDiffTabActive &&
      !isGitDiffTabActive &&
      editor.activeTab &&
      editor.activeTab.contentKind !== "image"
        ? editor.activeTab
        : null,
    [editor.activeTab, isGitDiffTabActive, isSessionDiffTabActive],
  );
  const requestWorkspaceShortcut = useCallback(
    (request: Omit<WorkspaceShortcutRequest, "sequence">) => {
      workspaceSearchShortcutSequenceRef.current += 1;
      setWorkspaceSearchShortcutRequest({
        sequence: workspaceSearchShortcutSequenceRef.current,
        ...request,
      });
    },
    [],
  );
  const handleOpenWorkspaceFileSearchShortcut = useCallback(() => {
    if (!rootPath) {
      return;
    }

    requestWorkspaceShortcut({
      mode: "files",
      query: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
  }, [requestWorkspaceShortcut, rootPath]);
  const handleOpenWorkspaceTextSearchShortcut = useCallback(() => {
    if (!rootPath) {
      return;
    }

    requestWorkspaceShortcut({
      mode: "text",
      query: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
  }, [requestWorkspaceShortcut, rootPath]);
  const handleOpenLineJumpShortcut = useCallback(() => {
    if (!activeLineJumpTab) {
      return;
    }

    requestWorkspaceShortcut({
      mode: "files",
      query: ":",
      selectionStart: 1,
      selectionEnd: 1,
    });
  }, [activeLineJumpTab, requestWorkspaceShortcut]);
  const windowTitle = useMemo(
    () => buildWindowTitle(activeWorkbenchTab?.name, currentWorkspaceName),
    [activeWorkbenchTab?.name, currentWorkspaceName],
  );
  const refreshActiveWorkbenchTab = useCallback(async () => {
    if (isSessionDiffTabActive) {
      if (!sessionDiffTab) {
        return;
      }

      if (isSessionDiffInlineDirty) {
        return;
      }

      await refreshSessionDiffTab(sessionDiffTab.result.sessionId);
      return;
    }

    if (isGitDiffTabActive) {
      if (!gitDiffTab) {
        return;
      }

      if (isGitDiffInlineDirty) {
        return;
      }

      await refreshGitDiffTab(gitDiffTab.result.absPath);
      return;
    }

    if (!editor.activeTab) {
      return;
    }

    await editor.reloadActiveTabFromDisk({
      closeMissing: true,
      onlyClean: true,
    });
  }, [
    editor.activeTab,
    gitDiffTab,
    isGitDiffInlineDirty,
    isGitDiffTabActive,
    editor.reloadActiveTabFromDisk,
    isSessionDiffInlineDirty,
    isSessionDiffTabActive,
    refreshGitDiffTab,
    refreshSessionDiffTab,
    sessionDiffTab,
  ]);

  const triggerAutoRefreshActiveEditorTab = useCallback(() => {
    const now = Date.now();
    if (now - lastAutoRefreshAtRef.current < 250) {
      return;
    }

    lastAutoRefreshAtRef.current = now;
    void refreshActiveWorkbenchTab();
    void gitPanel.refresh();
  }, [gitPanel.refresh, refreshActiveWorkbenchTab]);

  useEffect(() => {
    let disposed = false;
    let unlistenResize: (() => void) | undefined;

    async function syncWindowState() {
      const maximized = await appWindow.isMaximized();
      if (!disposed) {
        setIsWindowMaximized(maximized);
      }
    }

    void syncWindowState();
    void appWindow.onResized(() => {
      void syncWindowState();
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlistenResize = dispose;
      }
    });

    return () => {
      disposed = true;
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    if (!rootPath) {
      return;
    }

    setRecentFolders((currentFolders) => {
      const nextFolders = pushRecentFolder(currentFolders, rootPath);
      if (areStringArraysEqual(currentFolders, nextFolders)) {
        return currentFolders;
      }

      persistRecentFolders(nextFolders);
      return nextFolders;
    });
  }, [rootPath]);

  useEffect(() => {
    void invoke("cleanup_stale_composer_attachment_temp").catch((error) => {
      console.warn("[composer] Failed to clean stale temporary attachments.", error);
    });
  }, []);

  useEffect(() => {
    if (!pendingAgentLaunchProvider || !rootPath || !terminal.canLaunch) {
      return;
    }

    if (pendingAgentLaunchProvider === "codex") {
      terminal.launchCodex();
    } else {
      terminal.launchClaude();
    }

    setPendingAgentLaunchProvider(null);
  }, [
    pendingAgentLaunchProvider,
    rootPath,
    terminal.canLaunch,
    terminal.launchClaude,
    terminal.launchCodex,
  ]);

  useEffect(() => {
    syncWindowTitle(windowTitle);
  }, [windowTitle]);

  useEffect(() => {
    setSessionDiffTab(null);
    setIsSessionDiffTabActive(false);
    setGitDiffTab(null);
    setIsGitDiffTabActive(false);
  }, [rootPath]);

  useEffect(() => {
    if (!sessionDiffTab) {
      return;
    }

    const hasActiveSession = terminal.sessions.some(
      (session) => session.id === sessionDiffTab.result.sessionId,
    );
    if (!hasActiveSession) {
      setSessionDiffTab(null);
      setIsSessionDiffTabActive(false);
    }
  }, [sessionDiffTab, terminal.sessions]);

  useEffect(() => {
    if (!gitDiffTab) {
      return;
    }

    const hasMatchingGitEntry = gitPanel.entries.some(
      (entry) => entry.absPath === gitDiffTab.result.absPath,
    );
    if (!hasMatchingGitEntry) {
      setGitDiffTab(null);
      setIsGitDiffTabActive(false);
    }
  }, [gitDiffTab, gitPanel.entries]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!workspaceSwitcherRef.current?.contains(target)) {
        setIsWorkspaceMenuOpen(false);
      }
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsWorkspaceMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeydown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  useEffect(() => {
    function handleWindowFocus() {
      triggerAutoRefreshActiveEditorTab();
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        return;
      }

      triggerAutoRefreshActiveEditorTab();
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [triggerAutoRefreshActiveEditorTab]);

  const rememberRecentFolder = useCallback((nextRootPath: string) => {
    setRecentFolders((currentFolders) => {
      const nextFolders = pushRecentFolder(currentFolders, nextRootPath);
      if (areStringArraysEqual(currentFolders, nextFolders)) {
        return currentFolders;
      }

      persistRecentFolders(nextFolders);
      return nextFolders;
    });
  }, []);

  const openWorkspaceInReplacementWindow = useCallback(
    (nextRootPath: string, launchProvider: AgentProvider | null = null) => {
      rememberRecentFolder(nextRootPath);
      setIsWorkspaceMenuOpen(false);

      try {
        const replacementWindow = new WebviewWindow(createWorkspaceWindowLabel(), {
          decorations: false,
          height: 920,
          minHeight: 680,
          minWidth: 1080,
          theme: "dark",
          title: buildWindowTitle(null, getWorkspaceName(nextRootPath)),
          url: createWorkspaceWindowUrl(nextRootPath, launchProvider),
          width: 1440,
        });

        void replacementWindow.once("tauri://created", () => {
          void appWindow.close().catch((error) => {
            console.error("[window] Failed to close bootstrap workspace window.", error);
          });
        });
        void replacementWindow.once("tauri://error", (error) => {
          console.error("[workspace] Failed to create replacement workspace window.", error);
        });
      } catch (error) {
        console.error("[workspace] Failed to open replacement workspace window.", error);
      }
    },
    [rememberRecentFolder],
  );

  useEffect(() => {
    if (!SHOULD_REPLACE_BOOTSTRAP_WINDOW || hasTriggeredBootstrapWindowReplacement) {
      return;
    }

    hasTriggeredBootstrapWindowReplacement = true;
    openWorkspaceInReplacementWindow(INITIAL_WORKSPACE_PATH, INITIAL_LAUNCH_PROVIDER);
  }, [openWorkspaceInReplacementWindow]);

  const openWorkspaceInCurrentWindow = useCallback(
    (nextRootPath: string) => {
      if (CURRENT_WINDOW_LABEL === "main" && !rootPath) {
        openWorkspaceInReplacementWindow(nextRootPath);
        return;
      }

      rememberRecentFolder(nextRootPath);
      syncWindowTitle(buildWindowTitle(null, getWorkspaceName(nextRootPath)));
      setRootPath(nextRootPath);
      inlineTerminalTabSequenceRef.current = 0;
      inlineTerminalTabsRef.current = [];
      setInlineTerminalTabs([]);
      setActiveInlineTerminalTabId(null);
      setIsWorkspaceMenuOpen(false);
    },
    [openWorkspaceInReplacementWindow, rememberRecentFolder, rootPath],
  );

  const openWorkspaceInNewWindow = useCallback(
    (nextRootPath: string) => {
      rememberRecentFolder(nextRootPath);
      setIsWorkspaceMenuOpen(false);

      try {
        new WebviewWindow(createWorkspaceWindowLabel(), {
          decorations: false,
          height: 920,
          minHeight: 680,
          minWidth: 1080,
          theme: "dark",
          title: buildWindowTitle(null, getWorkspaceName(nextRootPath)),
          url: createWorkspaceWindowUrl(nextRootPath),
          width: 1440,
        });
      } catch (error) {
        console.error("[workspace] Failed to open workspace in a new window.", error);
      }
    },
    [rememberRecentFolder],
  );

  const createInlineTerminalTab = useCallback((): InlineTerminalTabState => {
    inlineTerminalTabSequenceRef.current += 1;
    const sequence = inlineTerminalTabSequenceRef.current;
    return {
      id: `inline-terminal-${sequence}`,
      title: `CMD ${sequence}`,
    };
  }, []);

  const openInlineTerminal = useCallback(() => {
    const nextTab = createInlineTerminalTab();
    const nextTabs = [...inlineTerminalTabsRef.current, nextTab];
    inlineTerminalTabsRef.current = nextTabs;
    setInlineTerminalTabs(nextTabs);
    setActiveInlineTerminalTabId(nextTab.id);
    setIsWorkspaceMenuOpen(false);
  }, [createInlineTerminalTab]);

  const closeInlineTerminalTab = useCallback((tabId: string) => {
    const currentTabs = inlineTerminalTabsRef.current;
    const tabIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex === -1) {
      return;
    }

    const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
    const fallbackTab =
      nextTabs[tabIndex] ??
      nextTabs[tabIndex - 1] ??
      nextTabs[nextTabs.length - 1] ??
      null;

    inlineTerminalTabsRef.current = nextTabs;
    setInlineTerminalTabs(nextTabs);
    setActiveInlineTerminalTabId((currentActiveTabId) => {
      if (currentActiveTabId !== tabId && nextTabs.some((tab) => tab.id === currentActiveTabId)) {
        return currentActiveTabId;
      }

      return fallbackTab?.id ?? null;
    });
  }, []);

  const pickWorkspaceDirectory = useCallback(async () => {
    setIsWorkspaceMenuOpen(false);

    const result = await open({
      defaultPath: rootPath ?? undefined,
      directory: true,
      multiple: false,
      title: "Select Workspace Folder",
    });

    return typeof result === "string" ? result : null;
  }, [rootPath]);

  async function handlePickDirectory(target: "current" | "newWindow" = rootPath ? "newWindow" : "current") {
    const result = await pickWorkspaceDirectory();
    if (!result) {
      return;
    }

    if (target === "current") {
      openWorkspaceInCurrentWindow(result);
    } else {
      openWorkspaceInNewWindow(result);
    }
  }

  const launchAgentFromShortcut = useCallback(
    async (provider: AgentProvider) => {
      if (!rootPath) {
        const nextRootPath = await pickWorkspaceDirectory();
        if (!nextRootPath) {
          return;
        }

        if (CURRENT_WINDOW_LABEL === "main") {
          openWorkspaceInReplacementWindow(nextRootPath, provider);
          return;
        }

        setPendingAgentLaunchProvider(provider);
        openWorkspaceInCurrentWindow(nextRootPath);
        return;
      }

      if (!terminal.canLaunch) {
        setPendingAgentLaunchProvider(provider);
        return;
      }

      if (provider === "codex") {
        terminal.launchCodex();
        return;
      }

      terminal.launchClaude();
    },
    [
      openWorkspaceInReplacementWindow,
      openWorkspaceInCurrentWindow,
      pickWorkspaceDirectory,
      rootPath,
      terminal.canLaunch,
      terminal.launchClaude,
      terminal.launchCodex,
    ],
  );

  async function handleWorkspaceSearchOpen(result: FileSearchResult) {
    await Promise.all([
      fileTree.revealPath(result.absPath),
      openEditorFile(createFileNodeFromSearchResult(result)),
    ]);
  }

  async function handleWorkspaceTextSearchOpen(result: TextSearchResult) {
    await Promise.all([
      fileTree.revealPath(result.absPath),
      openEditorFile(createFileNodeFromSearchResult(result)),
    ]);

    editorNavigationSequenceRef.current += 1;
    setEditorNavigationRequest({
      id: editorNavigationSequenceRef.current,
      absPath: result.absPath,
      line: result.line,
      column: result.column,
      matchLength: result.matchLength,
    });
  }

  const handleWorkspaceSearchLineJump = useCallback(
    async ({ column = 1, line }: { line: number; column?: number }) => {
      if (!activeLineJumpTab) {
        return;
      }

      editorNavigationSequenceRef.current += 1;
      setEditorNavigationRequest({
        id: editorNavigationSequenceRef.current,
        absPath: activeLineJumpTab.absPath,
        line,
        column,
        matchLength: 1,
      });
    },
    [activeLineJumpTab],
  );

  async function handleLocateTerminalSelectionFile(selectionText: string) {
    if (!rootPath) {
      return;
    }

    const result = await findFileSearchResultFromTerminalSelection(rootPath, selectionText);
    if (!result) {
      console.warn("[terminal] No workspace file matched selection:", selectionText);
      return;
    }

    await handleWorkspaceSearchOpen(result);
  }

  async function handleLocateActiveFile() {
    if (!editor.activeTab) {
      return;
    }

    await fileTree.revealPath(editor.activeTab.absPath);
  }

  async function handleOpenInFileManager(targetPath: string) {
    try {
      await invoke("open_in_file_manager", { targetPath });
      fileTree.closeContextMenu();
    } catch (error) {
      console.error("[explorer] Failed to open target in file manager.", error);
    }
  }

  const handleInsertIntoMainTerminal = useCallback(
    async (text: string) => {
      if (!text) {
        return;
      }

      if (isComposerEnabled) {
        insertIntoMainTerminalComposer(text);
        return;
      }

      await terminal.sendToSelectedSession(text, {
        appendNewline: false,
        startShellIfMissing: true,
        trackTitleInput: false,
      });
    },
    [insertIntoMainTerminalComposer, isComposerEnabled, terminal],
  );
  const handleLaunchCodexShortcut = useCallback(() => {
    void launchAgentFromShortcut("codex");
  }, [launchAgentFromShortcut]);
  const handleLaunchClaudeShortcut = useCallback(() => {
    void launchAgentFromShortcut("claude");
  }, [launchAgentFromShortcut]);

  const handleFileTreeInputDialogClose = useCallback((value: string | null) => {
    fileTreeInputDialogResolverRef.current?.(value);
    fileTreeInputDialogResolverRef.current = null;
    setFileTreeInputDialog(null);
  }, []);

  const handleFileTreeConfirmDialogClose = useCallback((value: boolean) => {
    fileTreeConfirmDialogResolverRef.current?.(value);
    fileTreeConfirmDialogResolverRef.current = null;
    setFileTreeConfirmDialog(null);
  }, []);

  useEffect(
    () => () => {
      fileTreeInputDialogResolverRef.current?.(null);
      fileTreeInputDialogResolverRef.current = null;
      fileTreeConfirmDialogResolverRef.current?.(false);
      fileTreeConfirmDialogResolverRef.current = null;
    },
    [],
  );

  function handleTitlebarMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    if (isInteractiveTitlebarTarget(event.target)) {
      titlebarPointerPressedRef.current = false;
      return;
    }

    titlebarPointerPressedRef.current = true;
  }

  function handleTitlebarMouseMove(event: ReactMouseEvent<HTMLElement>) {
    if (!titlebarPointerPressedRef.current || event.buttons !== 1) {
      return;
    }

    if (isInteractiveTitlebarTarget(event.target)) {
      titlebarPointerPressedRef.current = false;
      return;
    }

    titlebarPointerPressedRef.current = false;
    void runWindowAction("start dragging the window", () => appWindow.startDragging());
  }

  function handleTitlebarDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0 || isInteractiveTitlebarTarget(event.target)) {
      return;
    }

    titlebarPointerPressedRef.current = false;
    void runWindowAction("toggle maximize", () => appWindow.toggleMaximize());
  }

  function handleWindowMinimize() {
    void runWindowAction("minimize the window", () => appWindow.minimize());
  }

  function handleWindowToggleMaximize() {
    void runWindowAction("toggle maximize", () => appWindow.toggleMaximize());
  }

  function handleWindowClose() {
    void runWindowAction("close the window", () => appWindow.close());
  }

  async function handleOpenSessionDiff() {
    try {
      await editor.saveDirtyTabs();
      const result = await terminal.viewSelectedSessionDiff();
      const sessionTitle =
        terminal.sessions.find((session) => session.id === result.sessionId)?.title ?? "AI Session";

      setSessionDiffTab(createSessionDiffTab(result, sessionTitle));
      setIsSessionDiffTabActive(true);
      setIsGitDiffTabActive(false);
    } catch (error) {
      console.error("[diff] Failed to load session diff.", error);
    }
  }

  const handleRebuildSessionDiffBaseline = useCallback(async () => {
    const sessionId = terminal.selectedSession?.id;
    await editor.saveDirtyTabs();
    await terminal.rebuildSelectedSessionDiffBaseline();

    if (sessionId && sessionDiffTab?.result.sessionId === sessionId) {
      await refreshSessionDiffTab(sessionId);
    }
  }, [editor, refreshSessionDiffTab, sessionDiffTab, terminal]);

  const handleViewSessionDiffFiles = useCallback(async () => {
    try {
      await editor.saveDirtyTabs();
      const result = await terminal.viewSelectedSessionDiff();
      if (!result.files.length) {
        return;
      }

      const targets = result.files.map((file) => createSessionDiffOpenTarget(file));
      setIsSessionDiffTabActive(false);
      setIsGitDiffTabActive(false);

      for (const target of targets) {
        if (target.type === "disk") {
          await editor.openFile(target.node);
        } else {
          editor.openVirtualFile(target.tab);
        }
      }

      const firstTarget = targets[0];
      if (!firstTarget) {
        return;
      }

      const firstPath =
        firstTarget.type === "disk" ? firstTarget.node.absPath : firstTarget.tab.absPath;
      await editor.activateTab(firstPath);
    } catch (error) {
      console.error("[diff] Failed to open changed files in the content area.", error);
    }
  }, [editor, terminal]);

  const handleInlineFilesChanged = useCallback(
    async ({ paths, sessionId }: { paths: string[]; sessionId?: string }) => {
      setRefreshToken((value) => value + 1);
      await editor.reloadPathsFromDisk(paths, { closeMissing: true });

      await gitPanel.refresh();

      const shouldRefreshSessionDiff = sessionId
        ? sessionDiffTab?.result.sessionId === sessionId
        : Boolean(
            sessionDiffTab &&
              paths.some((path) =>
                sessionDiffTab.result.files.some((file) => file.absPath === path),
              ),
          );

      if (shouldRefreshSessionDiff) {
        const targetSessionId = sessionId ?? sessionDiffTab?.result.sessionId;
        if (targetSessionId) {
          await refreshSessionDiffTab(targetSessionId);
        }
      }

      if (gitDiffTab && paths.includes(gitDiffTab.result.absPath)) {
        try {
          await refreshGitDiffTab(gitDiffTab.result.absPath);
        } catch (error) {
          console.error("[git] Failed to refresh Git diff tab after inline save.", error);
        }
      }
    },
    [
      editor.reloadPathsFromDisk,
      gitDiffTab,
      gitPanel.refresh,
      refreshGitDiffTab,
      refreshSessionDiffTab,
      sessionDiffTab,
    ],
  );

  const handleSelectWorkbenchTab = useCallback(
    (tabId: string) => {
      if (sessionDiffTab && tabId === sessionDiffTab.id) {
        setIsGitDiffTabActive(false);
        setIsSessionDiffTabActive(true);
        if (isSessionDiffInlineDirty) {
          return;
        }
        void (async () => {
          try {
            await editor.saveDirtyTabs();
            await refreshSessionDiffTab(sessionDiffTab.result.sessionId);
          } catch (error) {
            console.error("[diff] Failed to refresh session diff tab.", error);
          }
        })();
        return;
      }

      if (gitDiffTab && tabId === gitDiffTab.id) {
        setIsSessionDiffTabActive(false);
        setIsGitDiffTabActive(true);
        if (isGitDiffInlineDirty) {
          return;
        }
        void (async () => {
          try {
            await editor.saveDirtyTabs();
            await refreshGitDiffTab(gitDiffTab.result.absPath);
          } catch (error) {
            console.error("[git] Failed to refresh Git diff tab.", error);
          }
        })();
        return;
      }

      setIsSessionDiffTabActive(false);
      setIsGitDiffTabActive(false);
      void editor.activateTab(tabId, { syncFromDisk: true });
    },
    [
      editor,
      gitDiffTab,
      isGitDiffInlineDirty,
      isSessionDiffInlineDirty,
      refreshGitDiffTab,
      refreshSessionDiffTab,
      sessionDiffTab,
    ],
  );

  const handleCloseWorkbenchTab = useCallback(
    (tabId: string) => {
      if (sessionDiffTab && tabId === sessionDiffTab.id) {
        setSessionDiffTab(null);
        setIsSessionDiffTabActive(false);
        return;
      }

      if (gitDiffTab && tabId === gitDiffTab.id) {
        setGitDiffTab(null);
        setIsGitDiffTabActive(false);
        return;
      }

      editor.closeTab(tabId);
    },
    [editor, gitDiffTab, sessionDiffTab],
  );
  const handleCloseActiveWorkbenchTabShortcut = useCallback(() => {
    if (!activeWorkbenchTab) {
      return;
    }

    handleCloseWorkbenchTab(getWorkbenchTabId(activeWorkbenchTab));
  }, [activeWorkbenchTab, handleCloseWorkbenchTab]);
  const handleCycleWorkbenchTabShortcut = useCallback(
    (direction: -1 | 1) => {
      if (workbenchTabs.length < 2) {
        return;
      }

      const activeTabId = activeWorkbenchTab ? getWorkbenchTabId(activeWorkbenchTab) : null;
      const activeIndex = activeTabId
        ? workbenchTabs.findIndex((tab) => getWorkbenchTabId(tab) === activeTabId)
        : -1;
      const nextIndex =
        activeIndex === -1
          ? direction > 0
            ? 0
            : workbenchTabs.length - 1
          : (activeIndex + direction + workbenchTabs.length) % workbenchTabs.length;
      const nextTab = workbenchTabs[nextIndex];
      if (!nextTab) {
        return;
      }

      handleSelectWorkbenchTab(getWorkbenchTabId(nextTab));
    },
    [activeWorkbenchTab, handleSelectWorkbenchTab, workbenchTabs],
  );

  useEffect(() => {
    function handleGlobalShortcutKeydown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      if (shouldIgnoreWorkbenchShortcutTarget(event.target)) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();

      if (!event.shiftKey && normalizedKey === "l") {
        if (!activeLineJumpTab) {
          return;
        }

        event.preventDefault();
        handleOpenLineJumpShortcut();
        return;
      }

      if (event.shiftKey && normalizedKey === "r") {
        if (!rootPath) {
          return;
        }

        event.preventDefault();
        handleOpenWorkspaceFileSearchShortcut();
        return;
      }

      if (!event.shiftKey && normalizedKey === "h") {
        if (!rootPath) {
          return;
        }

        event.preventDefault();
        handleOpenWorkspaceTextSearchShortcut();
        return;
      }

      if (event.shiftKey && normalizedKey === "s") {
        event.preventDefault();
        void editor.saveDirtyTabs().catch((error) => {
          console.error("[editor] Failed to save all dirty tabs.", error);
        });
        return;
      }

      if (!event.shiftKey && normalizedKey === "w") {
        if (!activeWorkbenchTab) {
          return;
        }

        event.preventDefault();
        handleCloseActiveWorkbenchTabShortcut();
        return;
      }

      if (!event.shiftKey && event.key === "PageDown") {
        event.preventDefault();
        handleCycleWorkbenchTabShortcut(1);
        return;
      }

      if (!event.shiftKey && event.key === "PageUp") {
        event.preventDefault();
        handleCycleWorkbenchTabShortcut(-1);
      }
    }

    window.addEventListener("keydown", handleGlobalShortcutKeydown);
    return () => window.removeEventListener("keydown", handleGlobalShortcutKeydown);
  }, [
    activeLineJumpTab,
    activeWorkbenchTab,
    editor.saveDirtyTabs,
    handleCloseActiveWorkbenchTabShortcut,
    handleCycleWorkbenchTabShortcut,
    handleOpenLineJumpShortcut,
    handleOpenWorkspaceFileSearchShortcut,
    handleOpenWorkspaceTextSearchShortcut,
    rootPath,
  ]);

  const editorPane = (
    <EditorPane
      activeTab={activeWorkbenchTab}
      error={editor.error}
      navigationRequest={editorNavigationRequest}
      onCloseTab={handleCloseWorkbenchTab}
      onContentChange={editor.updateActiveContent}
      onCursorChange={editor.setCursorPosition}
      onFocusWithin={triggerAutoRefreshActiveEditorTab}
      onGitDiffDirtyChange={setIsGitDiffInlineDirty}
      onInlineFilesChanged={handleInlineFilesChanged}
      onRequestCloseActiveTabShortcut={handleCloseActiveWorkbenchTabShortcut}
      onRequestFileSearchShortcut={handleOpenWorkspaceFileSearchShortcut}
      onRequestGotoLineShortcut={handleOpenLineJumpShortcut}
      onRequestNextTabShortcut={() => handleCycleWorkbenchTabShortcut(1)}
      onRequestPreviousTabShortcut={() => handleCycleWorkbenchTabShortcut(-1)}
      onRequestSaveAllShortcut={() => {
        void editor.saveDirtyTabs().catch((error) => {
          console.error("[editor] Failed to save all dirty tabs.", error);
        });
      }}
      onRequestTextSearchShortcut={handleOpenWorkspaceTextSearchShortcut}
      onSessionDiffDirtyChange={setIsSessionDiffInlineDirty}
      onSelectTab={handleSelectWorkbenchTab}
      tabs={workbenchTabs}
    />
  );
  const sessionDiffViewButtonState = terminal.canViewSelectedSessionDiff
    ? "ready"
    : terminal.selectedSessionDiffViewButtonLabel === "Loading"
      ? "loading"
      : terminal.selectedSessionDiffViewButtonLabel === "Preparing"
        ? "preparing"
        : "idle";
  const supportsSelectedSessionDiff =
    terminal.selectedSession?.mode === "codex" || terminal.selectedSession?.mode === "claude";
  const sessionDiffFilesButtonTitle =
    !terminal.isSessionDiffEnabled
      ? "Turn on Diff tracking first."
      : !terminal.selectedSession
          ? "Select a Codex or Claude session first."
        : !supportsSelectedSessionDiff
          ? "Diff is available for Codex and Claude sessions only."
          : sessionDiffViewButtonState === "loading"
            ? "Loading changed files for the current baseline."
            : sessionDiffViewButtonState === "preparing"
              ? "Building a baseline snapshot for this AI session."
              : terminal.selectedSessionDiffState?.error
              ? terminal.selectedSessionDiffState.error
                : "Open changed files in the content area.";
  const mainTerminalComposerPlaceholder = useMemo(
    () => getTerminalComposerPlaceholder(rootPath),
    [rootPath],
  );
  const handleMainTerminalComposerSubmit = useCallback(
    async (text: string) => {
      await terminal.sendToSelectedSession(text, {
        appendNewline: false,
        startShellIfMissing: true,
        trackTitleInput: false,
      });
    },
    [terminal],
  );
  const handleOpenGitDiff = useCallback(
    async (absPath: string) => {
      try {
        await editor.saveDirtyTabs();
        await gitPanel.refresh();
        const result = await gitPanel.openDiff(absPath);
        if (!result) {
          return;
        }

        setGitDiffTab(createGitDiffTab(result));
        setIsGitDiffTabActive(true);
        setIsSessionDiffTabActive(false);
      } catch (error) {
        console.error("[git] Failed to open Git diff.", error);
      }
    },
    [editor.saveDirtyTabs, gitPanel.openDiff, gitPanel.refresh],
  );
  const handleCommitGitSelection = useCallback(
    async () => {
      try {
        await editor.saveDirtyTabs();
        await gitPanel.refresh();
        await gitPanel.commitSelected();
      } catch (error) {
        console.error("[git] Failed to commit selected changes.", error);
      }
    },
    [editor.saveDirtyTabs, gitPanel.commitSelected, gitPanel.refresh],
  );
  const handlePushGitBranch = useCallback(
    async () => {
      try {
        await gitPanel.pushBranch();
      } catch (error) {
        reportGitActionError("push branch", error, "Unable to push the current branch.");
      }
    },
    [gitPanel.pushBranch],
  );
  const handleStageGitPaths = useCallback(
    async (absPaths: string[]) => {
      try {
        await editor.saveDirtyTabs();
        await gitPanel.stagePaths(absPaths);
      } catch (error) {
        reportGitActionError("stage files", error, "Unable to add the selected files to VCS.");
      }
    },
    [editor.saveDirtyTabs, gitPanel.stagePaths],
  );
  const handleRollbackGitPaths = useCallback(
    async (absPaths: string[]) => {
      const targetLabel =
        absPaths.length === 1 ? "this change" : `${absPaths.length} selected changes`;
      if (!window.confirm(`Roll back ${targetLabel}? This will discard local edits on disk.`)) {
        return;
      }

      try {
        await editor.saveDirtyTabs();
        await gitPanel.rollbackPaths(absPaths);
        await editor.reloadCleanTabsFromDisk();
      } catch (error) {
        reportGitActionError("roll back files", error, "Unable to roll back the selected changes.");
      }
    },
    [editor.reloadCleanTabsFromDisk, editor.saveDirtyTabs, gitPanel.rollbackPaths],
  );
  const handleIgnoreGitPaths = useCallback(
    async (absPaths: string[]) => {
      try {
        await gitPanel.ignorePaths(absPaths);
      } catch (error) {
        reportGitActionError(
          "update .gitignore",
          error,
          "Unable to add the selected files to .gitignore.",
        );
      }
    },
    [gitPanel.ignorePaths],
  );
  const handleDeleteGitPaths = useCallback(
    async (absPaths: string[]) => {
      const targetLabel =
        absPaths.length === 1 ? `"${getBaseName(absPaths[0])}"` : `${absPaths.length} selected files`;
      if (!window.confirm(`Delete ${targetLabel}? This will remove the file from disk.`)) {
        return;
      }

      try {
        await gitPanel.deletePaths(absPaths);
        editor.removePaths(absPaths);
        setRefreshToken((value) => value + 1);

        if (gitDiffTab && absPaths.includes(gitDiffTab.result.absPath)) {
          try {
            await refreshGitDiffTab(gitDiffTab.result.absPath);
          } catch {
            setGitDiffTab(null);
            setIsGitDiffTabActive(false);
          }
        }
      } catch (error) {
        reportGitActionError("delete files", error, "Unable to delete the selected files.");
      }
    },
    [editor.removePaths, gitDiffTab, gitPanel.deletePaths, refreshGitDiffTab],
  );
  const handleJumpToGitSource = useCallback(
    async (entry: GitChangeEntry) => {
      if (entry.status === "deleted") {
        return;
      }

      try {
        await Promise.all([
          fileTree.revealPath(entry.absPath),
          openEditorFile(createFileNodeFromGitChangeEntry(entry)),
        ]);
      } catch (error) {
        reportGitActionError("open the source file", error, "Unable to open the selected file.");
      }
    },
    [fileTree, openEditorFile],
  );

  return (
    <main className="ide">
      <header
        className="app-titlebar"
        onDoubleClick={handleTitlebarDoubleClick}
        onMouseDown={handleTitlebarMouseDown}
        onMouseLeave={() => {
          titlebarPointerPressedRef.current = false;
        }}
        onMouseMove={handleTitlebarMouseMove}
        onMouseUp={() => {
          titlebarPointerPressedRef.current = false;
        }}
      >
        <div className="app-titlebar__left">
          <div className="app-titlebar__app-icon" aria-hidden="true">
            <img alt="" className="app-titlebar__app-icon-image" src={appIcon} />
          </div>

          <div className="workspace-switcher" data-no-drag="true" ref={workspaceSwitcherRef}>
            <button
              aria-expanded={isWorkspaceMenuOpen}
              className="workspace-switcher__trigger"
              onClick={() => setIsWorkspaceMenuOpen((value) => !value)}
              type="button"
            >
              <span className="workspace-switcher__avatar" aria-hidden="true">
                {currentWorkspaceInitials}
              </span>
              <span className="workspace-switcher__copy">
                <span className="workspace-switcher__label" title={rootPath ?? currentWorkspaceName}>
                  {currentWorkspaceName}
                </span>
              </span>
              <ChevronDown
                className="workspace-switcher__chevron"
                data-open={isWorkspaceMenuOpen}
                size={14}
              />
            </button>

            <button
              className="workspace-switcher__terminal-button"
              disabled={!rootPath}
              onClick={openInlineTerminal}
              title={isInlineTerminalVisible ? "New bottom terminal" : "Open bottom terminal"}
              type="button"
            >
              <SquareTerminal size={16} />
            </button>

            <button
              aria-pressed={leftSidebarView === "git"}
              className="workspace-switcher__git-button"
              data-active={leftSidebarView === "git"}
              disabled={!rootPath}
              onClick={() =>
                setLeftSidebarView((currentView) =>
                  currentView === "git" ? "explorer" : "git",
                )
              }
              title={leftSidebarView === "git" ? "Show Explorer" : "Show Git panel"}
              type="button"
            >
              <GitBranch size={16} />
            </button>

            {isWorkspaceMenuOpen ? (
              <div className="workspace-switcher__menu" data-no-drag="true">
                <button
                  className="workspace-switcher__action"
                  onClick={() => void handlePickDirectory()}
                  type="button"
                >
                  <FolderOpen size={14} />
                  Open Folder
                </button>

                <div className="workspace-switcher__section">
                  <div className="workspace-switcher__section-label">Recent Folders</div>

                  {visibleRecentFolders.length ? (
                    visibleRecentFolders.map((path) => {
                      const name = getWorkspaceName(path);

                      return (
                        <button
                          className="workspace-switcher__recent-item"
                          key={path}
                          onClick={() => openWorkspaceInNewWindow(path)}
                          title={path}
                          type="button"
                        >
                          <span className="workspace-switcher__recent-avatar" aria-hidden="true">
                            {getWorkspaceInitials(name)}
                          </span>
                          <span className="workspace-switcher__recent-copy">
                            <span className="workspace-switcher__recent-name">{name}</span>
                            <span className="workspace-switcher__recent-path">{path}</span>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="workspace-switcher__empty">No recent folders yet.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="app-titlebar__drag-space">
          <WorkspaceFileSearch
            activeEditorRelPath={activeLineJumpTab?.relPath ?? null}
            onJumpToActiveEditorLocation={handleWorkspaceSearchLineJump}
            onOpenFileResult={handleWorkspaceSearchOpen}
            onPreviewFileSaved={handleInlineFilesChanged}
            onOpenTextResult={handleWorkspaceTextSearchOpen}
            rootPath={rootPath}
            shortcutRequest={workspaceSearchShortcutRequest}
          />
        </div>

        <div className="app-titlebar__right">
          <div className="app-titlebar__session-actions">
            <button
              aria-checked={terminal.isSessionDiffEnabled}
              className="app-titlebar__session-switch"
              data-state={terminal.isSessionDiffEnabled ? "enabled" : "disabled"}
              onClick={terminal.toggleSessionDiff}
              role="switch"
              title={terminal.sessionDiffToggleTitle}
              type="button"
            >
              <span className="app-titlebar__session-switch-copy">
                <GitCompareArrows size={13} />
                Diff
              </span>
              <span className="app-titlebar__session-switch-track" aria-hidden="true">
                <span className="app-titlebar__session-switch-thumb" />
              </span>
            </button>
            <button
              className="terminal__toolbar-button terminal__toolbar-button--diff-view"
              data-state={sessionDiffViewButtonState}
              disabled={!terminal.canViewSelectedSessionDiff}
              onClick={() => void handleOpenSessionDiff()}
              title={terminal.selectedSessionDiffViewButtonTitle}
              type="button"
            >
              {terminal.selectedSessionDiffViewButtonLabel}
            </button>
            <button
              className="terminal__toolbar-button terminal__toolbar-button--diff-view"
              data-state={sessionDiffViewButtonState}
              disabled={!terminal.canViewSelectedSessionDiff}
              onClick={() => void handleViewSessionDiffFiles()}
              title={sessionDiffFilesButtonTitle}
              type="button"
            >
              View
            </button>
            <button
              className="terminal__toolbar-button terminal__toolbar-button--baseline"
              data-state={
                sessionDiffViewButtonState === "preparing"
                  ? "preparing"
                  : !terminal.canRebuildSelectedSessionDiffBaseline
                    ? "disabled"
                    : terminal.selectedSessionDiffState?.error
                      ? "error"
                      : terminal.selectedSessionDiffState?.baselineStatus === "ready"
                        ? "ready"
                        : "actionable"
              }
              data-busy={sessionDiffViewButtonState === "preparing"}
                    disabled={!terminal.canRebuildSelectedSessionDiffBaseline}
                    onClick={() => {
                      void handleRebuildSessionDiffBaseline().catch((error) => {
                        console.error("[diff] Failed to rebuild baseline.", error);
                      });
                    }}
              title={terminal.selectedSessionDiffBaselineButtonTitle}
              type="button"
            >
              <RefreshCw size={12} />
              {terminal.selectedSessionDiffBaselineButtonLabel}
            </button>
            <button
              aria-pressed={isComposerEnabled}
              className="app-titlebar__composer-toggle"
              data-state={isComposerEnabled ? "enabled" : "disabled"}
              onClick={() => setIsComposerEnabled((value) => !value)}
              title={isComposerEnabled ? "Hide composer" : "Show composer"}
              type="button"
            >
              <PenLine size={14} />
            </button>
          </div>
          <div className="window-controls">
            <button
              className="window-control"
              onClick={handleWindowMinimize}
              title="Minimize"
              type="button"
            >
              <Minus size={14} />
            </button>
            <button
              className="window-control"
              onClick={handleWindowToggleMaximize}
              title={isWindowMaximized ? "Restore" : "Maximize"}
              type="button"
            >
              {isWindowMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              className="window-control window-control--close"
              onClick={handleWindowClose}
              title="Close"
              type="button"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="ide__main">
        <PanelGroup className="ide__panels" direction="horizontal">
          <Panel defaultSize={20} minSize={10}>
            <section className="sidebar-pane">
              <div className="sidebar-pane__body">
                {leftSidebarView === "explorer" ? (
                  <FileTree
                    activeFilePath={editor.activeTab?.absPath ?? null}
                    canCreateInContextTarget={fileTree.canCreateInContextTarget}
                    canCopyContextSelection={fileTree.canCopyContextSelection}
                    canDeleteContextSelection={fileTree.canDeleteContextSelection}
                    canDeleteSelection={fileTree.canDeleteSelection}
                    canLocateActiveFile={Boolean(editor.activeTab)}
                    canPasteIntoContextTarget={fileTree.canPasteIntoContextTarget}
                    canRenameContextTarget={fileTree.canRenameContextTarget}
                    contextMenu={fileTree.contextMenu}
                    dirtyPaths={editor.dirtyPaths}
                    error={fileTree.error}
                    expandedPaths={fileTree.expandedPaths}
                    isLoading={fileTree.isLoading}
                    loadingPaths={fileTree.loadingPaths}
                    onContextCreateFile={fileTree.createContextFile}
                    onContextCreateFolder={fileTree.createContextFolder}
                    onContextCopy={fileTree.copyContextSelection}
                    onContextDelete={fileTree.deleteContextSelection}
                    onDeleteSelection={fileTree.deleteSelection}
                    onContextOpenInFileManager={handleOpenInFileManager}
                    onContextPaste={fileTree.pasteIntoSelection}
                    onContextRename={fileTree.renameContextTarget}
                    onContextInsert={fileTree.insertContextSelection}
                    onExplorerBackgroundClick={fileTree.handleExplorerBackgroundClick}
                    onExplorerBackgroundContextMenu={fileTree.handleExplorerBackgroundContextMenu}
                    onLocateActiveFile={handleLocateActiveFile}
                    onNodeClick={fileTree.handleNodeClick}
                    onNodeContextMenu={fileTree.handleNodeContextMenu}
                    onOpenFolder={() => void handlePickDirectory("current")}
                    onRefresh={refreshWorkspace}
                    rootNode={fileTree.rootNode}
                    rootPath={rootPath}
                    selectedPaths={fileTree.selectedPaths}
                  />
                ) : (
                  <GitPanel
                    activePath={gitPanel.activePath}
                    activeRepositoryRoot={gitPanel.activeRepositoryRoot}
                    amend={gitPanel.amend}
                    branch={gitPanel.branch}
                    changes={gitPanel.changes}
                    checkedPaths={gitPanel.checkedPaths}
                    commitError={gitPanel.commitError}
                    commitFeedback={gitPanel.commitFeedback}
                    commitMessage={gitPanel.commitMessage}
                    error={gitPanel.error}
                    hasRepository={gitPanel.hasRepository}
                    isCommitBusy={gitPanel.isCommitBusy}
                    isLoading={gitPanel.isLoading}
                    isPushBusy={gitPanel.isPushBusy}
                    onActivatePath={(absPath) => {
                      void handleOpenGitDiff(absPath);
                    }}
                    onAddToGitignore={(absPaths) => {
                      void handleIgnoreGitPaths(absPaths);
                    }}
                    onCommit={() => {
                      void handleCommitGitSelection();
                    }}
                    onDeletePaths={(absPaths) => {
                      void handleDeleteGitPaths(absPaths);
                    }}
                    onJumpToSource={(entry) => {
                      void handleJumpToGitSource(entry);
                    }}
                    onPush={() => {
                      void handlePushGitBranch();
                    }}
                    onRefresh={() => {
                      void gitPanel.refresh();
                    }}
                    onRollbackPaths={(absPaths) => {
                      void handleRollbackGitPaths(absPaths);
                    }}
                    onSelectRepository={gitPanel.selectRepository}
                    onSetAmend={gitPanel.setAmend}
                    onSetCommitMessage={gitPanel.setCommitMessage}
                    onSetGroupChecked={gitPanel.setGroupChecked}
                    repositories={gitPanel.repositories}
                    onStagePaths={(absPaths) => {
                      void handleStageGitPaths(absPaths);
                    }}
                    onToggleCheckedPath={gitPanel.toggleCheckedPath}
                    unversioned={gitPanel.unversioned}
                  />
                )}
              </div>
            </section>
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel defaultSize={80} minSize={36}>
            <section className="workbench">
              <PanelGroup className="workbench__content" direction="horizontal">
                <Panel defaultSize={66} minSize={40}>
                  {isInlineTerminalVisible ? (
                    <PanelGroup className="editor-stack" direction="vertical">
                      <Panel defaultSize={70} minSize={28}>
                        {editorPane}
                      </Panel>

                      <PanelResizeHandle className="resize-handle resize-handle--row" />

                      <Panel defaultSize={30} minSize={18}>
                        <InlineCmdTerminal
                          activeTabId={activeInlineTerminalTabId}
                          launchDir={terminalLaunchDir}
                          onAddTab={openInlineTerminal}
                          onCloseTab={closeInlineTerminalTab}
                          onInsertSelectionToMainTerminal={handleInsertIntoMainTerminal}
                          onSelectTab={setActiveInlineTerminalTabId}
                          onSessionComplete={refreshWorkspace}
                          tabs={inlineTerminalTabs}
                          workingDir={rootPath}
                        />
                      </Panel>
                    </PanelGroup>
                  ) : (
                    editorPane
                  )}
                </Panel>

                <PanelResizeHandle className="resize-handle resize-handle--inner" />

                <Panel defaultSize={34} minSize={22}>
                  <TerminalPane
                    canLaunch={terminal.canLaunch}
                    composerEnabled={isComposerEnabled}
                    composerExternalInsertSequence={mainTerminalComposerInsertRequest.sequence}
                    composerExternalInsertText={mainTerminalComposerInsertRequest.text}
                    composerPlaceholder={mainTerminalComposerPlaceholder}
                    hasSessions={terminal.hasSessions}
                    isSessionActive={terminal.isSessionActive}
                    onClaude={handleLaunchClaudeShortcut}
                    onClear={terminal.clearTerminal}
                    onClose={terminal.closeTerminal}
                    onComposerSubmit={handleMainTerminalComposerSubmit}
                    onCodex={handleLaunchCodexShortcut}
                    onCopySelection={terminal.copySelection}
                    containerRef={terminal.containerRef}
                    error={terminal.error}
                    onFocus={terminal.focusTerminal}
                    getTerminalSelectionText={terminal.getSelectionText}
                    onLocateSelectionFile={handleLocateTerminalSelectionFile}
                    onShell={terminal.openShell}
                    onPaste={terminal.pasteFromClipboard}
                    onSelectSession={terminal.selectSession}
                    selectedSession={terminal.selectedSession}
                    selectedSessionId={terminal.selectedSessionId}
                    sessions={terminal.sessions}
                    workingDir={terminal.launchDir}
                  />
                </Panel>
              </PanelGroup>
            </section>
          </Panel>
        </PanelGroup>
      </div>

      <StatusBar
        activeTab={activeWorkbenchTab}
        cursor={editor.cursor}
        rootPath={rootPath}
        shellKind={shellKind}
      />

      <InputDialog
        initialValue={fileTreeInputDialog?.initialValue ?? ""}
        isOpen={Boolean(fileTreeInputDialog)}
        onCancel={() => handleFileTreeInputDialogClose(null)}
        onSubmit={(value) => handleFileTreeInputDialogClose(value)}
        placeholder={fileTreeInputDialog?.placeholder ?? ""}
        submitLabel={fileTreeInputDialog?.submitLabel ?? "Confirm"}
      />
      <ConfirmDialog
        cancelLabel={fileTreeConfirmDialog?.cancelLabel ?? "Cancel"}
        confirmLabel={fileTreeConfirmDialog?.confirmLabel ?? "Confirm"}
        isOpen={Boolean(fileTreeConfirmDialog)}
        message={fileTreeConfirmDialog?.message ?? ""}
        onCancel={() => handleFileTreeConfirmDialogClose(false)}
        onConfirm={() => handleFileTreeConfirmDialogClose(true)}
        title={fileTreeConfirmDialog?.title ?? "Confirm Action"}
        tone={fileTreeConfirmDialog?.tone ?? "default"}
      />
    </main>
  );
}

export default App;

function isInteractiveTitlebarTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest("button, select, input, textarea, option, [data-no-drag='true']"));
}

function shouldIgnoreWorkbenchShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest(".workspace-search__input")) {
    return false;
  }

  if (target.closest(".monaco-editor, .xterm, .terminal-composer__input, .input-dialog__field, .confirm-dialog__panel")) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function getWorkbenchTabId(tab: WorkbenchTab) {
  return "tabType" in tab ? tab.id : tab.absPath;
}

async function runWindowAction(label: string, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    console.error(`[window] Failed to ${label}.`, error);
  }
}

function syncWindowTitle(title: string) {
  if (typeof document !== "undefined") {
    document.title = title;
  }

  void appWindow.setTitle(title).catch((error) => {
    console.error("[window] Failed to sync window title.", error);
  });
}

function loadRecentFolders() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue =
      window.localStorage.getItem(RECENT_FOLDERS_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_RECENT_FOLDERS_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue)
      ? parsedValue.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function persistRecentFolders(paths: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(RECENT_FOLDERS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Ignore storage errors and continue without persistence.
  }
}

function pushRecentFolder(paths: string[], nextPath: string) {
  return [nextPath, ...paths.filter((path) => path !== nextPath)].slice(0, MAX_RECENT_FOLDERS);
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getWorkspaceName(path: string | null) {
  if (!path) {
    return "Open Workspace";
  }

  const normalized = path.replace(/[/\\]+$/, "");
  return normalized.split(/[/\\]/).pop() || normalized;
}

function getWorkspaceInitials(name: string) {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  const compactName = (parts[0] ?? name.replace(/[^A-Za-z0-9]/g, "")).toUpperCase();
  return compactName.slice(0, 2) || "JT";
}

function createFileNodeFromSearchResult(result: {
  absPath: string;
  name: string;
  relPath: string;
}): FileNode {
  return {
    absPath: result.absPath,
    children: undefined,
    hasChildren: false,
    id: result.absPath,
    isDir: false,
    name: result.name,
    relPath: result.relPath,
  };
}

function createFileNodeFromGitChangeEntry(entry: GitChangeEntry): FileNode {
  return {
    absPath: entry.absPath,
    children: undefined,
    hasChildren: false,
    id: entry.absPath,
    isDir: false,
    name: getBaseName(entry.path),
    relPath: entry.path,
  };
}

function createSessionDiffOpenTarget(file: SessionDiffFile) {
  if (!file.isBinary && !file.tooLarge && file.status !== "deleted") {
    return {
      node: createFileNodeFromSessionDiffFile(file),
      type: "disk" as const,
    };
  }

  return {
    tab: createEditorTabFromSessionDiffFile(file),
    type: "virtual" as const,
  };
}

function createFileNodeFromSessionDiffFile(file: SessionDiffFile): FileNode {
  return {
    absPath: file.absPath,
    children: undefined,
    hasChildren: false,
    id: file.absPath,
    isDir: false,
    name: getBaseName(file.path),
    relPath: file.path,
  };
}

function createEditorTabFromSessionDiffFile(file: SessionDiffFile): EditorTab {
  const content = resolveSessionDiffTabContent(file);

  return {
    absPath: file.absPath,
    content,
    isReadOnly: true,
    name: getBaseName(file.path),
    relPath: file.path,
    savedContent: content,
  };
}

function resolveSessionDiffTabContent(file: SessionDiffFile) {
  if (file.isBinary) {
    return "[Binary diff file cannot be opened in the text content area.]";
  }

  if (file.tooLarge) {
    return "[Diff file is too large to open in the text content area.]";
  }

  if (file.status === "deleted") {
    return file.originalContent ?? "";
  }

  return file.modifiedContent ?? file.originalContent ?? "";
}

function getBaseName(path: string) {
  const normalized = path.replace(/[/\\]+$/, "");
  return normalized.split(/[/\\]/).pop() || normalized;
}

function reportGitActionError(label: string, error: unknown, fallbackMessage: string) {
  console.error(`[git] Failed to ${label}.`, error);
  window.alert(resolveErrorMessage(error, fallbackMessage));
}

function resolveErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallbackMessage;
}

async function findFileSearchResultFromTerminalSelection(
  rootPath: string,
  selectionText: string,
) {
  const queries = extractTerminalFileQueries(selectionText);

  for (const query of queries) {
    try {
      const results = await invoke<FileSearchResult[]>("search_files", {
        query,
        rootPath,
      });
      const match = pickBestSearchResult(query, results);
      if (match) {
        return match;
      }
    } catch (error) {
      console.error("[terminal] Failed to search files from selection.", error);
    }
  }

  return null;
}

function extractTerminalFileQueries(selectionText: string) {
  const queries = new Set<string>();

  pushTerminalFileQuery(queries, selectionText);

  for (const token of selectionText.match(/[^\s"'`()[\]{}<>|,]+/g) ?? []) {
    pushTerminalFileQuery(queries, token);
  }

  return Array.from(queries);
}

function pushTerminalFileQuery(target: Set<string>, value: string) {
  const normalized = normalizeTerminalFileQuery(value);
  if (!normalized) {
    return;
  }

  target.add(normalized);

  const fileName = normalized.split("/").pop();
  if (fileName && fileName !== normalized) {
    target.add(fileName);
  }
}

function normalizeTerminalFileQuery(value: string) {
  let normalized = value.trim();
  if (!normalized) {
    return null;
  }

  normalized = normalized
    .replace(/^file:\/\/+/i, "")
    .replace(/^[\s"'`([{<]+/, "")
    .replace(/[\s"'`)\]}>]+$/, "")
    .replace(/[\\/]+/g, "/")
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/[.,;:]+$/, "")
    .replace(/^\.\/+/, "");

  if (!normalized || normalized === "." || normalized === "..") {
    return null;
  }

  if (!/[/.\\-]/.test(normalized) && !/\.[A-Za-z0-9]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function pickBestSearchResult(query: string, results: FileSearchResult[]) {
  if (!results.length) {
    return null;
  }

  const normalizedQuery = normalizeComparablePath(query);
  const fileName = normalizedQuery.split("/").pop() ?? normalizedQuery;

  return (
    results.find((result) => normalizeComparablePath(result.relPath) === normalizedQuery) ??
    results.find((result) => normalizeComparablePath(result.absPath).endsWith(normalizedQuery)) ??
    results.find((result) => result.name.toLowerCase() === fileName.toLowerCase()) ??
    results[0]
  );
}

function normalizeComparablePath(value: string) {
  return value.replace(/[\\/]+/g, "/").toLowerCase();
}

function getInitialWorkspacePath(recentFolders: string[]) {
  const workspacePathFromUrl = getWorkspacePathFromLocation();
  if (workspacePathFromUrl) {
    return workspacePathFromUrl;
  }

  return recentFolders[0] ?? null;
}

function getWorkspacePathFromLocation() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const url = new URL(window.location.href);
    return normalizeWorkspaceQueryValue(url.searchParams.get("workspace"));
  } catch {
    return null;
  }
}

function getInitialLaunchProvider(): AgentProvider | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const url = new URL(window.location.href);
    const provider = url.searchParams.get("launchProvider");
    return provider === "codex" || provider === "claude" ? provider : null;
  } catch {
    return null;
  }
}

function normalizeWorkspaceQueryValue(value: string | null) {
  return value && value.trim().length > 0 ? value : null;
}

function createWorkspaceWindowUrl(
  workspacePath: string,
  launchProvider: AgentProvider | null = null,
) {
  if (typeof window === "undefined") {
    const providerQuery = launchProvider ? `&launchProvider=${encodeURIComponent(launchProvider)}` : "";
    return `/?workspace=${encodeURIComponent(workspacePath)}${providerQuery}`;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("workspace", workspacePath);
  if (launchProvider) {
    url.searchParams.set("launchProvider", launchProvider);
  } else {
    url.searchParams.delete("launchProvider");
  }
  return url.toString();
}

function createWorkspaceWindowLabel() {
  return `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildWindowTitle(activeItemName: string | null | undefined, workspaceName: string) {
  const normalizedActiveItemName = activeItemName?.trim();
  const normalizedWorkspaceName = workspaceName.trim();

  if (normalizedActiveItemName) {
    if (normalizedWorkspaceName && normalizedWorkspaceName !== "Open Workspace") {
      return `${normalizedActiveItemName} - ${normalizedWorkspaceName} - ${APP_WINDOW_TITLE}`;
    }

    return `${normalizedActiveItemName} - ${APP_WINDOW_TITLE}`;
  }

  if (normalizedWorkspaceName && normalizedWorkspaceName !== "Open Workspace") {
    return `${normalizedWorkspaceName} - ${APP_WINDOW_TITLE}`;
  }

  return APP_WINDOW_TITLE;
}

function buildComposerPathInsertText(paths: string[], projectRoot: string, shellKind: ShellKind) {
  const escapedPaths = paths.map((path) =>
    escapeComposerInsertPath(resolveProjectRelativePath(projectRoot, path), shellKind),
  );

  if (!escapedPaths.length) {
    return "";
  }

  return `${escapedPaths.join(" ")} `;
}
function escapeComposerInsertPath(path: string, shellKind: ShellKind) {
  if (shellKind === "powershell") {
    return `'${path.replace(/'/g, "''")}'`;
  }

  return `"${path.replace(/"/g, '""')}"`;
}

function getTerminalComposerPlaceholder(rootPath: string | null) {
  if (!rootPath) {
    return "Open a workspace first.";
  }

  return "Enter inserts text into the current terminal input. If no terminal is running, a shell starts automatically. Shift+Enter inserts a newline.";
}

function createSessionDiffTab(result: SessionDiffResult, sessionTitle: string): SessionDiffTab {
  return {
    id: createSessionDiffTabId(result.sessionId),
    name: `${sessionTitle} Diff`,
    relPath: `Session Diff/${sessionTitle}`,
    result,
    sessionTitle,
    tabType: "sessionDiff",
  };
}

function createSessionDiffTabId(sessionId: string) {
  return `session-diff:${sessionId}`;
}

function createGitDiffTab(result: GitDiffResult): GitDiffTab {
  return {
    id: createGitDiffTabId(result.absPath),
    name: getBaseName(result.path),
    relPath: `Git Changes/${result.path}`,
    result,
    tabType: "gitDiff",
  };
}

function createGitDiffTabId(absPath: string) {
  return `git-diff:${absPath}`;
}
