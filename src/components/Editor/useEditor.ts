import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type { CursorPosition, EditorTab, FileNode } from "../../types";

interface UseEditorOptions {
  rootPath: string | null;
}

export function useEditor({ rootPath }: UseEditorOptions) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.absPath === activeTabPath) ?? null,
    [activeTabPath, tabs],
  );

  useEffect(() => {
    setTabs([]);
    setActiveTabPath(null);
    setCursor({ line: 1, column: 1 });
    setError(null);
  }, [rootPath]);

  useEffect(() => {
    async function handleKeydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        await saveActiveFile();
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeTab, rootPath]);

  async function openFile(node: FileNode) {
    if (!rootPath || node.isDir) {
      return;
    }

    const existing = tabs.find((tab) => tab.absPath === node.absPath);
    if (existing) {
      setActiveTabPath(existing.absPath);
      setError(null);
      return;
    }

    try {
      const content = await invoke<string>("read_file", {
        filePath: node.absPath,
        rootPath,
      });

      const tab: EditorTab = {
        absPath: node.absPath,
        content,
        name: node.name,
        relPath: node.relPath,
        savedContent: content,
      };

      setTabs((value) => [...value, tab]);
      setActiveTabPath(node.absPath);
      setCursor({ line: 1, column: 1 });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function updateActiveContent(content: string) {
    if (!activeTabPath) {
      return;
    }

    setTabs((value) =>
      value.map((tab) => (tab.absPath === activeTabPath ? { ...tab, content } : tab)),
    );
  }

  async function saveActiveFile() {
    if (!rootPath || !activeTab) {
      return;
    }

    setIsSaving(true);

    try {
      await invoke("write_file", {
        content: activeTab.content,
        filePath: activeTab.absPath,
        rootPath,
      });

      setTabs((value) =>
        value.map((tab) =>
          tab.absPath === activeTab.absPath ? { ...tab, savedContent: tab.content } : tab,
        ),
      );
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsSaving(false);
    }
  }

  function closeTab(absPath: string) {
    setTabs((value) => {
      const nextTabs = value.filter((tab) => tab.absPath !== absPath);

      if (activeTabPath === absPath) {
        const closedIndex = value.findIndex((tab) => tab.absPath === absPath);
        const nextActive = nextTabs[Math.max(0, closedIndex - 1)] ?? nextTabs[0] ?? null;
        setActiveTabPath(nextActive?.absPath ?? null);
      }

      return nextTabs;
    });
  }

  function setCursorPosition(line: number, column: number) {
    setCursor({
      column,
      line,
    });
  }

  const dirtyPaths = tabs.filter((tab) => tab.content !== tab.savedContent).map((tab) => tab.absPath);

  return {
    activeTab,
    closeTab,
    cursor,
    dirtyPaths,
    error,
    isSaving,
    openFile,
    saveActiveFile,
    setActiveTabPath,
    setCursorPosition,
    tabs,
    updateActiveContent,
  };
}
