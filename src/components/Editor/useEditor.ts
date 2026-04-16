import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const tabsRef = useRef<EditorTab[]>([]);
  const activeTabPathRef = useRef<string | null>(null);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.absPath === activeTabPath) ?? null,
    [activeTabPath, tabs],
  );

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabPathRef.current = activeTabPath;
  }, [activeTabPath]);

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

    const existing = tabsRef.current.find((tab) => tab.absPath === node.absPath);
    if (existing && !existing.isReadOnly) {
      await activateTab(existing.absPath, { syncFromDisk: true });
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
        isReadOnly: false,
        name: node.name,
        relPath: node.relPath,
        savedContent: content,
      };

      const nextTabs = upsertEditorTabs(tabsRef.current, tab);
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      activeTabPathRef.current = node.absPath;
      setActiveTabPath(node.absPath);
      setCursor({ line: 1, column: 1 });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const openVirtualFile = useCallback((tab: EditorTab) => {
    const nextTab: EditorTab = {
      ...tab,
      isReadOnly: tab.isReadOnly ?? true,
      savedContent: tab.savedContent ?? tab.content,
    };
    const nextTabs = upsertEditorTabs(tabsRef.current, nextTab);
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    activeTabPathRef.current = nextTab.absPath;
    setActiveTabPath(nextTab.absPath);
    setCursor({ line: 1, column: 1 });
    setError(null);
  }, []);

  const reloadCleanTabsFromDisk = useCallback(async () => {
    if (!rootPath) {
      return;
    }

    const cleanTabs = tabsRef.current.filter(
      (tab) => !tab.isReadOnly && tab.content === tab.savedContent,
    );
    if (!cleanTabs.length) {
      return;
    }

    const snapshotContentByPath = new Map(
      cleanTabs.map((tab) => [tab.absPath, tab.savedContent] as const),
    );
    const results = await Promise.allSettled(
      cleanTabs.map(async (tab) => ({
        absPath: tab.absPath,
        content: await invoke<string>("read_file", {
          filePath: tab.absPath,
          rootPath,
        }),
      })),
    );
    const diskContentByPath = new Map<string, string>();

    for (const result of results) {
      if (result.status === "fulfilled") {
        diskContentByPath.set(result.value.absPath, result.value.content);
        continue;
      }

      console.error("[editor] Failed to reload file from disk.", result.reason);
    }

    if (!diskContentByPath.size) {
      return;
    }

    setTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.content !== tab.savedContent) {
          return tab;
        }

        if (snapshotContentByPath.get(tab.absPath) !== tab.savedContent) {
          return tab;
        }

        const nextContent = diskContentByPath.get(tab.absPath);
        if (typeof nextContent !== "string" || nextContent === tab.savedContent) {
          return tab;
        }

        return {
          ...tab,
          content: nextContent,
          savedContent: nextContent,
        };
      }),
    );
  }, [rootPath]);

  const reloadPathsFromDisk = useCallback(
    async (paths: string[], options?: { closeMissing?: boolean; onlyClean?: boolean }) => {
      if (!rootPath) {
        return;
      }

      const openTabs = tabsRef.current;
      const openTabsByPath = new Map(openTabs.map((tab) => [tab.absPath, tab] as const));
      const snapshotByPath = new Map(
        openTabs.map((tab) => [
          tab.absPath,
          {
            content: tab.content,
            savedContent: tab.savedContent,
          },
        ] as const),
      );
      const targetPaths = Array.from(new Set(paths)).filter((path) => {
        const tab = openTabsByPath.get(path);
        if (!tab || tab.isReadOnly) {
          return false;
        }

        if (options?.onlyClean && tab.content !== tab.savedContent) {
          return false;
        }

        return true;
      });

      if (!targetPaths.length) {
        return;
      }

      const results = await Promise.allSettled(
        targetPaths.map(async (absPath) => ({
          absPath,
          content: await invoke<string>("read_file", {
            filePath: absPath,
            rootPath,
          }),
        })),
      );

      const diskContentByPath = new Map<string, string>();
      const missingPaths = new Set<string>();
      let nextError: string | null = null;

      for (const [index, result] of results.entries()) {
        const targetPath = targetPaths[index];

        if (result.status === "fulfilled") {
          diskContentByPath.set(result.value.absPath, result.value.content);
          continue;
        }

        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);

        if (options?.closeMissing && targetPath && isMissingFileError(message)) {
          missingPaths.add(targetPath);
          continue;
        }

        console.error("[editor] Failed to reload file from disk.", result.reason);
        nextError = message;
      }

      const currentTabs = tabsRef.current;
      const nextTabs = currentTabs
        .filter((tab) => !(options?.closeMissing && missingPaths.has(tab.absPath)))
        .map((tab) => {
          const nextContent = diskContentByPath.get(tab.absPath);
          if (typeof nextContent !== "string") {
            return tab;
          }

          if (options?.onlyClean) {
            const snapshot = snapshotByPath.get(tab.absPath);
            if (
              !snapshot ||
              snapshot.content !== snapshot.savedContent ||
              tab.content !== tab.savedContent ||
              tab.content !== snapshot.content ||
              tab.savedContent !== snapshot.savedContent
            ) {
              return tab;
            }
          }

          if (nextContent === tab.content && nextContent === tab.savedContent) {
            return tab;
          }

          return {
            ...tab,
            content: nextContent,
            savedContent: nextContent,
          };
        });

      tabsRef.current = nextTabs;
      setTabs(nextTabs);

      const currentActiveTabPath = activeTabPathRef.current;
      if (currentActiveTabPath && !nextTabs.some((tab) => tab.absPath === currentActiveTabPath)) {
        const fallbackPath =
          nextTabs[Math.max(0, currentTabs.findIndex((tab) => tab.absPath === currentActiveTabPath) - 1)]
            ?.absPath ??
          nextTabs[0]?.absPath ??
          null;
        activeTabPathRef.current = fallbackPath;
        setActiveTabPath(fallbackPath);
      }

      setError(nextError);
    },
    [rootPath],
  );

  const reloadTabFromDisk = useCallback(
    async (absPath: string, options?: { closeMissing?: boolean; onlyClean?: boolean }) => {
      await reloadPathsFromDisk([absPath], options);
    },
    [reloadPathsFromDisk],
  );

  const reloadActiveTabFromDisk = useCallback(
    async (options?: { closeMissing?: boolean; onlyClean?: boolean }) => {
      const currentActiveTabPath = activeTabPathRef.current;
      if (!currentActiveTabPath) {
        return;
      }

      const currentActiveTab = tabsRef.current.find((tab) => tab.absPath === currentActiveTabPath);
      if (currentActiveTab?.isReadOnly) {
        return;
      }

      await reloadPathsFromDisk([currentActiveTabPath], options);
    },
    [reloadPathsFromDisk],
  );

  const activateTab = useCallback(
    async (absPath: string, options?: { syncFromDisk?: boolean }) => {
      setActiveTabPath(absPath);
      setError(null);

      if (!options?.syncFromDisk) {
        return;
      }

      await reloadTabFromDisk(absPath, {
        closeMissing: true,
        onlyClean: true,
      });
    },
    [reloadTabFromDisk],
  );

  function updateActiveContent(content: string) {
    if (!activeTabPath) {
      return;
    }

    setTabs((value) =>
      value.map((tab) => (tab.absPath === activeTabPath ? { ...tab, content } : tab)),
    );
  }

  async function saveActiveFile() {
    if (!rootPath || !activeTab || activeTab.isReadOnly) {
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

  const saveDirtyTabs = useCallback(async () => {
    if (!rootPath) {
      return [];
    }

    const dirtyTabs = tabsRef.current.filter(
      (tab) => !tab.isReadOnly && tab.content !== tab.savedContent,
    );
    if (!dirtyTabs.length) {
      return [];
    }

    const snapshotContentByPath = new Map(
      dirtyTabs.map((tab) => [tab.absPath, tab.content] as const),
    );

    setIsSaving(true);

    try {
      const results = await Promise.allSettled(
        dirtyTabs.map(async (tab) => {
          await invoke("write_file", {
            content: tab.content,
            filePath: tab.absPath,
            rootPath,
          });

          return {
            absPath: tab.absPath,
            content: tab.content,
          };
        }),
      );

      const savedContentByPath = new Map<string, string>();
      let nextError: string | null = null;

      for (const result of results) {
        if (result.status === "fulfilled") {
          savedContentByPath.set(result.value.absPath, result.value.content);
          continue;
        }

        nextError ??=
          result.reason instanceof Error ? result.reason.message : String(result.reason);
      }

      if (savedContentByPath.size > 0) {
        setTabs((currentTabs) => {
          const nextTabs = currentTabs.map((tab) => {
            const snapshotContent = snapshotContentByPath.get(tab.absPath);
            const savedContent = savedContentByPath.get(tab.absPath);

            if (typeof snapshotContent !== "string" || typeof savedContent !== "string") {
              return tab;
            }

            return {
              ...tab,
              savedContent,
            };
          });

          tabsRef.current = nextTabs;
          return nextTabs;
        });
      }

      setError(nextError);

      if (nextError) {
        throw new Error(nextError);
      }

      return Array.from(savedContentByPath.keys());
    } finally {
      setIsSaving(false);
    }
  }, [rootPath]);

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

  const dirtyPaths = tabs
    .filter((tab) => !tab.isReadOnly && tab.content !== tab.savedContent)
    .map((tab) => tab.absPath);

  return {
    activeTab,
    closeTab,
    cursor,
    dirtyPaths,
    error,
    isSaving,
    openFile,
    openVirtualFile,
    activateTab,
    reloadActiveTabFromDisk,
    reloadPathsFromDisk,
    reloadCleanTabsFromDisk,
    reloadTabFromDisk,
    saveActiveFile,
    saveDirtyTabs,
    setActiveTabPath,
    setCursorPosition,
    tabs,
    updateActiveContent,
  };
}

function upsertEditorTabs(tabs: EditorTab[], nextTab: EditorTab) {
  const index = tabs.findIndex((tab) => tab.absPath === nextTab.absPath);
  if (index === -1) {
    return [...tabs, nextTab];
  }

  const nextTabs = [...tabs];
  nextTabs[index] = nextTab;
  return nextTabs;
}

function isMissingFileError(message: string) {
  return /not found|cannot find|os error [23]|系统找不到指定的文件/i.test(message);
}
