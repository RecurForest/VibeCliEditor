import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { ActivityBar } from "./components/ActivityBar/ActivityBar";
import { EditorPane } from "./components/Editor/EditorPane";
import { useEditor } from "./components/Editor/useEditor";
import { FileTree } from "./components/FileTree/FileTree";
import { useFileTree } from "./components/FileTree/useFileTree";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { TerminalPane } from "./components/TerminalPane/TerminalPane";
import { useTerminal } from "./components/TerminalPane/useTerminal";
import type { ShellKind } from "./types";
import "./App.css";

function App() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [shellKind, setShellKind] = useState<ShellKind>("cmd");
  const [bootError, setBootError] = useState<string | null>(null);

  const terminal = useTerminal({
    shellKind,
    workingDir: rootPath,
  });

  const editor = useEditor({
    rootPath,
  });

  const fileTree = useFileTree({
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
        <ActivityBar />

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

        <section className="workbench">
          <div className="workbench__titlebar">
            <div className="workbench__title">
              Jterminal
              <span className="workbench__workspace-name">{fileTree.rootNode?.name ?? "Workspace"}</span>
            </div>
            <div className="workbench__controls">
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

          <div className="workbench__content">
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

            <TerminalPane
              containerRef={terminal.containerRef}
              error={terminal.error}
              sessionId={terminal.sessionId}
              shellKind={shellKind}
              status={terminal.status}
              workingDir={rootPath}
            />
          </div>
        </section>
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
