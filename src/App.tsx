import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FolderOpen,
  Maximize2,
  Minimize2,
  Minus,
  SquareTerminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { EditorPane } from "./components/Editor/EditorPane";
import { useEditor } from "./components/Editor/useEditor";
import { FileTree } from "./components/FileTree/FileTree";
import { useFileTree } from "./components/FileTree/useFileTree";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { TerminalPane } from "./components/TerminalPane/TerminalPane";
import { useTerminal } from "./components/TerminalPane/useTerminal";
import type { FileNode, ShellKind } from "./types";
import "./App.css";

const appWindow = getCurrentWindow();

function App() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const shellKind: ShellKind = "cmd";

  const editor = useEditor({
    rootPath,
  });

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
    shellKind,
    workingDir: rootPath,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadDefaultRoot() {
      try {
        const defaultRoot = await invoke<string>("get_default_root");
        if (!cancelled) {
          setRootPath(defaultRoot);
        }
      } catch (reason) {
        if (!cancelled) {
          setBootError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    }

    void loadDefaultRoot();

    return () => {
      cancelled = true;
    };
  }, []);

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

  async function handlePickDirectory() {
    const result = await open({
      defaultPath: rootPath ?? undefined,
      directory: true,
      multiple: false,
      title: "Select Workspace Folder",
    });

    if (typeof result === "string") {
      setRootPath(result);
      setRefreshToken((value) => value + 1);
      setBootError(null);
    }
  }

  function handleTitlebarMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    if (isInteractiveTitlebarTarget(event.target)) {
      return;
    }

    void runWindowAction("start dragging the window", () => appWindow.startDragging());
  }

  function handleTitlebarDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0 || isInteractiveTitlebarTarget(event.target)) {
      return;
    }

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
      >
        <div className="app-titlebar__left">
          <div className="app-titlebar__brand-group">
            <SquareTerminal className="app-titlebar__brand-icon" size={16} />
          </div>

          <div className="app-titlebar__toolbar">
            <button
              className="titlebar-button titlebar-button--subtle"
              onClick={() => void handlePickDirectory()}
              type="button"
            >
              <FolderOpen size={14} />
              Open
            </button>
          </div>
        </div>

        <div className="app-titlebar__drag-space" />

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
              contextMenu={fileTree.contextMenu}
              dirtyPaths={editor.dirtyPaths}
              error={fileTree.error}
              expandedPaths={fileTree.expandedPaths}
              isLoading={fileTree.isLoading}
              loadingPaths={fileTree.loadingPaths}
              onCloseContextMenu={fileTree.closeContextMenu}
              onContextInsert={fileTree.insertContextSelection}
              onInsertSelection={fileTree.insertSelection}
              onNodeClick={fileTree.handleNodeClick}
              onNodeContextMenu={fileTree.handleNodeContextMenu}
              onRefresh={() => setRefreshToken((value) => value + 1)}
              rootNode={fileTree.rootNode}
              rootPath={rootPath}
              selectedPaths={fileTree.selectedPaths}
            />
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel defaultSize={80} minSize={36}>
            <section className="workbench">
              {bootError ? <div className="ide__error">{bootError}</div> : null}

              <PanelGroup className="workbench__content" direction="horizontal">
                <Panel defaultSize={66} minSize={40}>
                  <EditorPane
                    activeTab={editor.activeTab}
                    cursor={editor.cursor}
                    error={editor.error}
                    onCloseTab={editor.closeTab}
                    onContentChange={editor.updateActiveContent}
                    onCursorChange={editor.setCursorFromSelection}
                    onSelectTab={editor.setActiveTabPath}
                    tabs={editor.tabs}
                  />
                </Panel>

                <PanelResizeHandle className="resize-handle resize-handle--inner" />

                <Panel defaultSize={34} minSize={22}>
                  <TerminalPane
                    canLaunch={terminal.canLaunch}
                    isSessionActive={terminal.isSessionActive}
                    onClaude={terminal.launchClaude}
                    onClear={terminal.clearTerminal}
                    onClose={terminal.closeTerminal}
                    onCodex={terminal.launchCodex}
                    containerRef={terminal.containerRef}
                    error={terminal.error}
                    onFocus={terminal.focusTerminal}
                    onOpen={terminal.openShell}
                    sessionId={terminal.sessionId}
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
