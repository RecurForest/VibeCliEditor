import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

function App() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [shellKind, setShellKind] = useState<ShellKind>("cmd");
  const [bootError, setBootError] = useState<string | null>(null);

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

  return (
    <main className="ide">
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
              onPickDirectory={handlePickDirectory}
              onRefresh={() => setRefreshToken((value) => value + 1)}
              rootNode={fileTree.rootNode}
              rootPath={rootPath}
              selectedPaths={fileTree.selectedPaths}
            />
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel defaultSize={80} minSize={36}>
            <section className="workbench">
              <div className="workbench__titlebar">
                <div className="workbench__title">
                  Jterminal
                  <span className="workbench__workspace-name">{fileTree.rootNode?.name ?? "Workspace"}</span>
                </div>
                <div className="workbench__controls">
                  <button
                    className="workbench__button"
                    onClick={() => void handlePickDirectory()}
                    type="button"
                  >
                    <FolderOpen size={14} />
                    Open Folder
                  </button>
                  <label className="workbench__control">
                    Shell
                    <select
                      className="workbench__select"
                      onChange={(event) => setShellKind(event.currentTarget.value as ShellKind)}
                      value={shellKind}
                    >
                      <option value="cmd">cmd.exe</option>
                      <option value="powershell">PowerShell</option>
                    </select>
                  </label>
                </div>
              </div>

              {bootError ? <div className="ide__error">{bootError}</div> : null}

              <PanelGroup className="workbench__content" direction="horizontal">
                <Panel defaultSize={66} minSize={40}>
                  <EditorPane
                    activeTab={editor.activeTab}
                    cursor={editor.cursor}
                    error={editor.error}
                    isSaving={editor.isSaving}
                    onCloseTab={editor.closeTab}
                    onContentChange={editor.updateActiveContent}
                    onCursorChange={editor.setCursorFromSelection}
                    onSave={editor.saveActiveFile}
                    onSelectTab={editor.setActiveTabPath}
                    tabs={editor.tabs}
                  />
                </Panel>

                <PanelResizeHandle className="resize-handle resize-handle--inner" />

                <Panel defaultSize={34} minSize={22}>
                  <TerminalPane
                    canLaunch={terminal.canLaunch}
                    containerRef={terminal.containerRef}
                    error={terminal.error}
                    isSessionActive={terminal.isSessionActive}
                    onClear={terminal.clearTerminal}
                    onClose={terminal.closeTerminal}
                    onFocus={terminal.focusTerminal}
                    onLaunchClaude={terminal.launchClaude}
                    onLaunchCodex={terminal.launchCodex}
                    onOpenShell={terminal.openShell}
                    sessionId={terminal.sessionId}
                    shellKind={terminal.activeShellKind ?? shellKind}
                    status={terminal.status}
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
