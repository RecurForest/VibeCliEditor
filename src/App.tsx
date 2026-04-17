import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  ChevronDown,
  FolderOpen,
  GitCompareArrows,
  Maximize2,
  Minimize2,
  Minus,
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
import { InputDialog } from "./components/Dialog/InputDialog";
import { EditorPane } from "./components/Editor/EditorPane";
import { useEditor } from "./components/Editor/useEditor";
import appIcon from "./assets/vibe-cli-editor-logo.svg";
import { FileTree } from "./components/FileTree/FileTree";
import { useFileTree } from "./components/FileTree/useFileTree";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { InlineCmdTerminal } from "./components/TerminalPane/InlineCmdTerminal";
import { TerminalPane } from "./components/TerminalPane/TerminalPane";
import { getAgentProviderLabel, patchAgentProfile } from "./components/TerminalPane/agentSessionProfiles";
import {
  TERMINAL_COMPOSER_SEND_STRATEGY_OPTIONS,
  isTerminalComposerSendStrategy,
  type TerminalComposerSendStrategy,
} from "./components/TerminalPane/terminalComposerSendStrategy";
import { resolveTerminalComposerInput } from "./components/TerminalPane/terminalSlashRouter";
import { useTerminal } from "./components/TerminalPane/useTerminal";
import { WorkspaceFileSearch } from "./components/WorkspaceSearch/WorkspaceFileSearch";
import type {
  AgentProvider,
  ComposerTarget,
  EditorTab,
  FileNode,
  FileSearchResult,
  SessionDiffFile,
  SessionDiffResult,
  SessionDiffTab,
  ShellKind,
  WorkbenchTab,
} from "./types";
import "./App.css";

const appWindow = getCurrentWindow();
const APP_WINDOW_TITLE = "VibeCliEditor";
const RECENT_FOLDERS_STORAGE_KEY = "vibeCliEditor.recentFolders";
const LEGACY_RECENT_FOLDERS_STORAGE_KEY = "jterminal.recentFolders";
const MAX_RECENT_FOLDERS = 8;
const TERMINAL_COMPOSER_SEND_STRATEGY_STORAGE_KEY = "vibeCliEditor.terminalComposer.sendStrategy";
const LEGACY_TERMINAL_COMPOSER_SEND_STRATEGY_STORAGE_KEY =
  "jterminal.terminalComposer.sendStrategy";

interface FileTreeInputDialogState {
  initialValue: string;
  placeholder: string;
  submitLabel: string;
}

function App() {
  const [recentFolders, setRecentFolders] = useState<string[]>(() => loadRecentFolders());
  const [rootPath, setRootPath] = useState<string | null>(() =>
    getInitialWorkspacePath(recentFolders),
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isInlineTerminalVisible, setIsInlineTerminalVisible] = useState(false);
  const [terminalComposerSendStrategy, setTerminalComposerSendStrategy] =
    useState<TerminalComposerSendStrategy>(() => loadTerminalComposerSendStrategy());
  const [fileTreeInputDialog, setFileTreeInputDialog] = useState<FileTreeInputDialogState | null>(
    null,
  );
  const [sessionDiffTab, setSessionDiffTab] = useState<SessionDiffTab | null>(null);
  const [isSessionDiffTabActive, setIsSessionDiffTabActive] = useState(false);
  const shellKind: ShellKind = "cmd";
  const workspaceSwitcherRef = useRef<HTMLDivElement | null>(null);
  const titlebarPointerPressedRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);
  const fileTreeInputDialogResolverRef = useRef<((value: string | null) => void) | null>(null);

  const editor = useEditor({
    rootPath,
  });
  const refreshWorkspace = useCallback(() => {
    setRefreshToken((value) => value + 1);
    void editor.reloadCleanTabsFromDisk();
  }, [editor.reloadCleanTabsFromDisk]);

  const currentWorkspaceName = useMemo(() => getWorkspaceName(rootPath), [rootPath]);
  const currentWorkspaceInitials = useMemo(
    () => getWorkspaceInitials(currentWorkspaceName),
    [currentWorkspaceName],
  );
  const visibleRecentFolders = useMemo(
    () => recentFolders.filter((path) => path !== rootPath),
    [recentFolders, rootPath],
  );
  const openEditorFile = useCallback(
    async (node: FileNode) => {
      setIsSessionDiffTabActive(false);
      await editor.openFile(node);
    },
    [editor],
  );

  const handleResolvedRootPath = useCallback((resolvedRootPath: string) => {
    setRootPath((currentRootPath) =>
      currentRootPath === resolvedRootPath ? currentRootPath : resolvedRootPath,
    );
  }, []);

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
  const workbenchTabs = useMemo<WorkbenchTab[]>(
    () => (sessionDiffTab ? [...editor.tabs, sessionDiffTab] : editor.tabs),
    [editor.tabs, sessionDiffTab],
  );
  const activeWorkbenchTab = useMemo<WorkbenchTab | null>(
    () => (isSessionDiffTabActive ? sessionDiffTab : editor.activeTab),
    [editor.activeTab, isSessionDiffTabActive, sessionDiffTab],
  );
  const windowTitle = useMemo(
    () => buildWindowTitle(activeWorkbenchTab?.name, currentWorkspaceName),
    [activeWorkbenchTab?.name, currentWorkspaceName],
  );
  const refreshActiveWorkbenchTab = useCallback(async () => {
    if (isSessionDiffTabActive) {
      if (!sessionDiffTab) {
        return;
      }

      await refreshSessionDiffTab(sessionDiffTab.result.sessionId);
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
    editor.reloadActiveTabFromDisk,
    isSessionDiffTabActive,
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
  }, [refreshActiveWorkbenchTab]);

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
    persistTerminalComposerSendStrategy(terminalComposerSendStrategy);
  }, [terminalComposerSendStrategy]);

  useEffect(() => {
    document.title = windowTitle;
    void appWindow.setTitle(windowTitle).catch((error) => {
      console.error("[window] Failed to sync window title.", error);
    });
  }, [windowTitle]);

  useEffect(() => {
    setSessionDiffTab(null);
    setIsSessionDiffTabActive(false);
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

  const openWorkspaceInCurrentWindow = useCallback(
    (nextRootPath: string) => {
      rememberRecentFolder(nextRootPath);
      setRootPath(nextRootPath);
      setIsInlineTerminalVisible(false);
      setIsWorkspaceMenuOpen(false);
    },
    [rememberRecentFolder],
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

  const openInlineTerminal = useCallback(() => {
    setIsInlineTerminalVisible(true);
    setIsWorkspaceMenuOpen(false);
  }, []);

  async function handlePickDirectory(target: "current" | "newWindow" = rootPath ? "newWindow" : "current") {
    setIsWorkspaceMenuOpen(false);

    const result = await open({
      defaultPath: rootPath ?? undefined,
      directory: true,
      multiple: false,
      title: "Select Workspace Folder",
    });

    if (typeof result === "string") {
      if (target === "current") {
        openWorkspaceInCurrentWindow(result);
      } else {
        openWorkspaceInNewWindow(result);
      }
    }
  }

  async function handleWorkspaceSearchOpen(result: FileSearchResult) {
    await Promise.all([
      fileTree.revealPath(result.absPath),
      openEditorFile(createFileNodeFromSearchResult(result)),
    ]);
  }

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

      await terminal.sendToSelectedSession(text, {
        appendNewline: false,
        startShellIfMissing: true,
        trackTitleInput: false,
      });
    },
    [terminal],
  );

  const handleFileTreeInputDialogClose = useCallback((value: string | null) => {
    fileTreeInputDialogResolverRef.current?.(value);
    fileTreeInputDialogResolverRef.current = null;
    setFileTreeInputDialog(null);
  }, []);

  useEffect(
    () => () => {
      fileTreeInputDialogResolverRef.current?.(null);
      fileTreeInputDialogResolverRef.current = null;
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

  const handleSessionDiffFilesReverted = useCallback(
    async ({ paths, sessionId }: { paths: string[]; sessionId: string }) => {
      setRefreshToken((value) => value + 1);
      await editor.reloadPathsFromDisk(paths, { closeMissing: true });

      await refreshSessionDiffTab(sessionId);
    },
    [editor.reloadPathsFromDisk, refreshSessionDiffTab],
  );

  function handleSelectWorkbenchTab(tabId: string) {
    if (sessionDiffTab && tabId === sessionDiffTab.id) {
      setIsSessionDiffTabActive(true);
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

    setIsSessionDiffTabActive(false);
    void editor.activateTab(tabId, { syncFromDisk: true });
  }

  function handleCloseWorkbenchTab(tabId: string) {
    if (sessionDiffTab && tabId === sessionDiffTab.id) {
      setSessionDiffTab(null);
      setIsSessionDiffTabActive(false);
      return;
    }

    editor.closeTab(tabId);
  }

  const editorPane = (
    <EditorPane
      activeTab={activeWorkbenchTab}
      error={editor.error}
      onCloseTab={handleCloseWorkbenchTab}
      onContentChange={editor.updateActiveContent}
      onCursorChange={editor.setCursorPosition}
      onFocusWithin={triggerAutoRefreshActiveEditorTab}
      onSessionDiffFilesReverted={handleSessionDiffFilesReverted}
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
  const mainTerminalComposerTarget = useMemo(
    () => getTerminalComposerTarget(terminal.selectedSession, terminal.preferredAgentProvider),
    [terminal.preferredAgentProvider, terminal.selectedSession],
  );
  const mainTerminalComposerPlaceholder = useMemo(
    () =>
      getTerminalComposerPlaceholder(
        terminal.selectedSession,
        terminal.preferredAgentProvider,
        rootPath,
      ),
    [rootPath, terminal.preferredAgentProvider, terminal.selectedSession],
  );
  const mainTerminalComposerQuickActions = useMemo(
    () => getTerminalComposerQuickActions(terminal.selectedSession, terminal.preferredAgentProvider),
    [terminal.preferredAgentProvider, terminal.selectedSession],
  );
  const mainTerminalComposerUsesTerminalSendStrategy =
    mainTerminalComposerTarget.kind === "shellSession";
  const handleMainTerminalComposerSubmit = useCallback(
    async (text: string) => {
      const resolution = resolveTerminalComposerInput({
        pendingProfiles: terminal.pendingAgentProfiles,
        selectedSession: terminal.selectedSession,
        target: mainTerminalComposerTarget,
        text,
      });

      if (resolution.kind === "reject") {
        throw new Error(resolution.message);
      }

      if (resolution.kind === "update_pending_profile") {
        terminal.updatePendingAgentProfile(resolution.provider, resolution.patchProfile);
        return;
      }

      if (resolution.kind === "spawn_successor_session") {
        await terminal.startAgentSession(resolution.profile);
        return;
      }

      if (resolution.kind === "provider_passthrough") {
        const activeSession = terminal.selectedSession;
        if (!activeSession || activeSession.status !== "active") {
          throw new Error("Select an active Claude session first.");
        }

        const baseProfile =
          activeSession.agent?.requestedProfile ?? terminal.pendingAgentProfiles.claude;
        await terminal.startAgentSession(patchAgentProfile(baseProfile, resolution.patchProfile), {
          continueFromLast: true,
          continueFromSessionId: activeSession.id,
        });
        await terminal.endSession(activeSession.id);
        return;
      }

      const activeSession = terminal.selectedSession;
      if (
        activeSession?.status === "active" &&
        (activeSession.mode === "codex" || activeSession.mode === "claude")
      ) {
        const baseProfile =
          activeSession.agent?.requestedProfile ?? terminal.pendingAgentProfiles[activeSession.mode];
        await terminal.startAgentSession(baseProfile, {
          continueFromLast: true,
          continueFromSessionId: activeSession.id,
          prompt: resolution.text,
        });
        await terminal.endSession(activeSession.id);
        return;
      }

      if (mainTerminalComposerTarget.kind === "agentLauncher" && mainTerminalComposerTarget.provider) {
        await terminal.startAgentSession(
          terminal.pendingAgentProfiles[mainTerminalComposerTarget.provider],
          {
            prompt: resolution.text,
          },
        );
        return;
      }

      await terminal.sendToSelectedSession(resolution.text, {
        appendNewline: true,
        sendStrategy: terminalComposerSendStrategy,
      });
    },
    [mainTerminalComposerTarget, terminal, terminalComposerSendStrategy],
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
              title="Open bottom terminal"
              type="button"
            >
              <SquareTerminal size={14} />
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
          <WorkspaceFileSearch onOpenResult={handleWorkspaceSearchOpen} rootPath={rootPath} />
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
            <FileTree
              activeFilePath={editor.activeTab?.absPath ?? null}
              canCreateInContextTarget={fileTree.canCreateInContextTarget}
              canDeleteContextSelection={fileTree.canDeleteContextSelection}
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
              onContextDelete={fileTree.deleteContextSelection}
              onContextOpenInFileManager={handleOpenInFileManager}
              onContextPaste={fileTree.pasteIntoSelection}
              onContextRename={fileTree.renameContextTarget}
              onContextInsert={fileTree.insertContextSelection}
              onLocateActiveFile={handleLocateActiveFile}
              onNodeClick={fileTree.handleNodeClick}
              onNodeContextMenu={fileTree.handleNodeContextMenu}
              onOpenFolder={() => void handlePickDirectory("current")}
              onRefresh={refreshWorkspace}
              rootNode={fileTree.rootNode}
              rootPath={rootPath}
              selectedPaths={fileTree.selectedPaths}
            />
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
                          launchDir={terminalLaunchDir}
                          onClose={() => setIsInlineTerminalVisible(false)}
                          onInsertSelectionToMainTerminal={handleInsertIntoMainTerminal}
                          onSessionComplete={refreshWorkspace}
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
                    composerEnabled={false}
                    composerPlaceholder={mainTerminalComposerPlaceholder}
                    composerQuickActions={mainTerminalComposerQuickActions}
                    composerSendStrategy={
                      mainTerminalComposerUsesTerminalSendStrategy
                        ? terminalComposerSendStrategy
                        : undefined
                    }
                    composerSendStrategyOptions={
                      mainTerminalComposerUsesTerminalSendStrategy
                        ? TERMINAL_COMPOSER_SEND_STRATEGY_OPTIONS
                        : []
                    }
                    hasSessions={terminal.hasSessions}
                    isSessionActive={terminal.isSessionActive}
                    onClaude={terminal.launchClaude}
                    onClear={terminal.clearTerminal}
                    onClose={terminal.closeTerminal}
                    onComposerSendStrategyChange={setTerminalComposerSendStrategy}
                    onComposerSubmit={handleMainTerminalComposerSubmit}
                    onCodex={terminal.launchCodex}
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
        activeTab={editor.activeTab}
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

async function runWindowAction(label: string, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    console.error(`[window] Failed to ${label}.`, error);
  }
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

function loadTerminalComposerSendStrategy(): TerminalComposerSendStrategy {
  if (typeof window === "undefined") {
    return "auto";
  }

  try {
    const rawValue =
      window.localStorage.getItem(TERMINAL_COMPOSER_SEND_STRATEGY_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_TERMINAL_COMPOSER_SEND_STRATEGY_STORAGE_KEY);
    return isTerminalComposerSendStrategy(rawValue) ? rawValue : "auto";
  } catch {
    return "auto";
  }
}

function persistTerminalComposerSendStrategy(strategy: TerminalComposerSendStrategy) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(TERMINAL_COMPOSER_SEND_STRATEGY_STORAGE_KEY, strategy);
  } catch {
    // Ignore storage failures and continue without persisting the strategy.
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

function createFileNodeFromSearchResult(result: FileSearchResult): FileNode {
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
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const url = new URL(window.location.href);
    const workspacePath = url.searchParams.get("workspace");
    if (workspacePath && workspacePath.trim().length > 0) {
      return workspacePath;
    }
  } catch {
    return recentFolders[0] ?? null;
  }

  return recentFolders[0] ?? null;
}

function createWorkspaceWindowUrl(workspacePath: string) {
  if (typeof window === "undefined") {
    return `/?workspace=${encodeURIComponent(workspacePath)}`;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("workspace", workspacePath);
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

function getTerminalComposerTarget(
  selectedSession: ReturnType<typeof useTerminal>["selectedSession"],
  preferredAgentProvider: AgentProvider,
): ComposerTarget {
  if (selectedSession?.status === "active") {
    if (selectedSession.mode === "shell") {
      return {
        kind: "shellSession",
        sessionId: selectedSession.id,
        shellKind: selectedSession.shellKind,
      };
    }

    if (selectedSession.mode === "codex" || selectedSession.mode === "claude") {
      return {
        kind: "agentSession",
        provider: selectedSession.mode,
        sessionId: selectedSession.id,
      };
    }
  }

  if (selectedSession?.mode === "codex" || selectedSession?.mode === "claude") {
    return {
      kind: "agentLauncher",
      provider: selectedSession.mode,
    };
  }

  return {
    kind: "agentLauncher",
    provider: preferredAgentProvider,
  };
}

function getTerminalComposerPlaceholder(
  selectedSession: ReturnType<typeof useTerminal>["selectedSession"],
  preferredAgentProvider: AgentProvider,
  rootPath: string | null,
) {
  if (!rootPath) {
    return "Open a workspace first.";
  }

  if (!selectedSession) {
    return `Start a shell, Codex, or Claude session. /model applies to the next ${getAgentProviderLabel(preferredAgentProvider)} launch.`;
  }

  if (selectedSession.mode === "shell") {
    return "Send shell input. Enter sends, Shift+Enter inserts a newline.";
  }

  if (selectedSession.status !== "active") {
    return `${getAgentProviderLabel(selectedSession.mode)} session is complete. /model updates the next launch profile.`;
  }

  if (selectedSession.mode === "claude") {
    return "Message Claude. Enter sends. /model forwards to Claude.";
  }

  return "Message Codex. Enter sends. /model starts a successor Codex session.";
}

function getTerminalComposerQuickActions(
  selectedSession: ReturnType<typeof useTerminal>["selectedSession"],
  preferredAgentProvider: AgentProvider,
) {
  if (!selectedSession) {
    return preferredAgentProvider === "claude"
      ? [
          { label: "/model", text: "/model " },
          { label: "Explain", text: "Explain the current codebase issue." },
          { label: "Fix", text: "Fix the current issue." },
        ]
      : [
          { label: "/model", text: "/model " },
          { label: "Review", text: "Review the latest changes." },
          { label: "Build", text: "Investigate the current build issue." },
        ];
  }

  if (selectedSession.mode === "shell") {
    return [
      { label: "git status", text: "git status" },
      { label: "pnpm build", text: "pnpm build" },
      { label: "dir", text: "dir" },
    ];
  }

  if (selectedSession.mode === "claude") {
    return [
      { label: "/model", text: "/model " },
      { label: "Explain", text: "Explain the current issue." },
      { label: "Fix", text: "Fix the current issue." },
    ];
  }

  return [
    { label: "/model", text: "/model " },
    { label: "Review", text: "Review the current changes." },
    { label: "Implement", text: "Implement the requested change." },
  ];
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
