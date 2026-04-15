import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  ChevronDown,
  FolderOpen,
  Maximize2,
  Minimize2,
  Minus,
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
import { EditorPane } from "./components/Editor/EditorPane";
import { useEditor } from "./components/Editor/useEditor";
import appIcon from "./assets/jterminal.png";
import { FileTree } from "./components/FileTree/FileTree";
import { useFileTree } from "./components/FileTree/useFileTree";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { InlineCmdTerminal } from "./components/TerminalPane/InlineCmdTerminal";
import { TerminalPane } from "./components/TerminalPane/TerminalPane";
import { useTerminal } from "./components/TerminalPane/useTerminal";
import { WorkspaceFileSearch } from "./components/WorkspaceSearch/WorkspaceFileSearch";
import type { FileNode, FileSearchResult, ShellKind } from "./types";
import "./App.css";

const appWindow = getCurrentWindow();
const RECENT_FOLDERS_STORAGE_KEY = "jterminal.recentFolders";
const MAX_RECENT_FOLDERS = 8;

function App() {
  const [recentFolders, setRecentFolders] = useState<string[]>(() => loadRecentFolders());
  const [rootPath, setRootPath] = useState<string | null>(() =>
    getInitialWorkspacePath(recentFolders),
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isInlineTerminalVisible, setIsInlineTerminalVisible] = useState(false);
  const shellKind: ShellKind = "cmd";
  const workspaceSwitcherRef = useRef<HTMLDivElement | null>(null);
  const titlebarPointerPressedRef = useRef(false);

  const refreshFileTree = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const editor = useEditor({
    rootPath,
  });

  const currentWorkspaceName = useMemo(() => getWorkspaceName(rootPath), [rootPath]);
  const currentWorkspaceInitials = useMemo(
    () => getWorkspaceInitials(currentWorkspaceName),
    [currentWorkspaceName],
  );
  const visibleRecentFolders = useMemo(
    () => recentFolders.filter((path) => path !== rootPath),
    [recentFolders, rootPath],
  );

  const handleResolvedRootPath = useCallback((resolvedRootPath: string) => {
    setRootPath((currentRootPath) =>
      currentRootPath === resolvedRootPath ? currentRootPath : resolvedRootPath,
    );
  }, []);

  const fileTree = useFileTree({
    onResolvedRootPath: handleResolvedRootPath,
    onInsertPaths: async (paths) => {
      if (!rootPath) {
        return;
      }

      await terminal.insertPaths(paths, rootPath, "projectRelative");
    },
    onOpenFile: editor.openFile,
    refreshToken,
    rootPath,
  });

  const terminalLaunchDir = useMemo(
    () => resolveTerminalLaunchDir(rootPath, fileTree.rootNode, fileTree.selectedPaths),
    [rootPath, fileTree.rootNode, fileTree.selectedPaths],
  );

  const terminal = useTerminal({
    launchDir: terminalLaunchDir,
    onSessionComplete: refreshFileTree,
    shellKind,
    workingDir: rootPath,
  });

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
          title: "Jterminal",
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
      editor.openFile(createFileNodeFromSearchResult(result)),
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
          <Panel defaultSize={20} minSize={14}>
            <FileTree
              activeFilePath={editor.activeTab?.absPath ?? null}
              canLocateActiveFile={Boolean(editor.activeTab)}
              contextMenu={fileTree.contextMenu}
              dirtyPaths={editor.dirtyPaths}
              error={fileTree.error}
              expandedPaths={fileTree.expandedPaths}
              isLoading={fileTree.isLoading}
              loadingPaths={fileTree.loadingPaths}
              onContextOpenInFileManager={handleOpenInFileManager}
              onContextInsert={fileTree.insertContextSelection}
              onLocateActiveFile={handleLocateActiveFile}
              onNodeClick={fileTree.handleNodeClick}
              onNodeContextMenu={fileTree.handleNodeContextMenu}
              onOpenFolder={() => void handlePickDirectory("current")}
              onRefresh={refreshFileTree}
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
                        <EditorPane
                          activeTab={editor.activeTab}
                          error={editor.error}
                          onCloseTab={editor.closeTab}
                          onContentChange={editor.updateActiveContent}
                          onCursorChange={editor.setCursorPosition}
                          onSelectTab={editor.setActiveTabPath}
                          tabs={editor.tabs}
                        />
                      </Panel>

                      <PanelResizeHandle className="resize-handle resize-handle--row" />

                      <Panel defaultSize={30} minSize={18}>
                        <InlineCmdTerminal
                          launchDir={terminalLaunchDir}
                          onClose={() => setIsInlineTerminalVisible(false)}
                          onSessionComplete={refreshFileTree}
                          workingDir={rootPath}
                        />
                      </Panel>
                    </PanelGroup>
                  ) : (
                    <EditorPane
                      activeTab={editor.activeTab}
                      error={editor.error}
                      onCloseTab={editor.closeTab}
                      onContentChange={editor.updateActiveContent}
                      onCursorChange={editor.setCursorPosition}
                      onSelectTab={editor.setActiveTabPath}
                      tabs={editor.tabs}
                    />
                  )}
                </Panel>

                <PanelResizeHandle className="resize-handle resize-handle--inner" />

                <Panel defaultSize={34} minSize={22}>
                  <TerminalPane
                    canLaunch={terminal.canLaunch}
                    hasSessions={terminal.hasSessions}
                    isSessionActive={terminal.isSessionActive}
                    onClaude={terminal.launchClaude}
                    onClear={terminal.clearTerminal}
                    onClose={terminal.closeTerminal}
                    onCodex={terminal.launchCodex}
                    onCopySelection={terminal.copySelection}
                    containerRef={terminal.containerRef}
                    error={terminal.error}
                    onFocus={terminal.focusTerminal}
                    getTerminalSelectionText={terminal.getSelectionText}
                    onLocateSelectionFile={handleLocateTerminalSelectionFile}
                    onOpen={terminal.openShell}
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

function resolveTerminalLaunchDir(
  rootPath: string | null,
  rootNode: FileNode | null,
  selectedPaths: string[],
) {
  if (!rootPath) {
    return null;
  }

  const selectedPath = selectedPaths[0];
  if (!selectedPath || !rootNode) {
    return rootPath;
  }

  const node = findNodeByPath(rootNode, selectedPath);
  if (!node) {
    return rootPath;
  }

  return node.isDir ? node.absPath : getParentPath(node.absPath) ?? rootPath;
}

function findNodeByPath(node: FileNode, targetPath: string): FileNode | null {
  if (node.absPath === targetPath) {
    return node;
  }

  for (const child of node.children ?? []) {
    const match = findNodeByPath(child, targetPath);
    if (match) {
      return match;
    }
  }

  return null;
}

function getParentPath(path: string) {
  const normalized = path.replace(/[/\\]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : null;
}

function loadRecentFolders() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(RECENT_FOLDERS_STORAGE_KEY);
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
