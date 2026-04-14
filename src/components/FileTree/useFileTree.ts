import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { ContextMenuState, FileNode } from "../../types";
import { replaceNodeChildren } from "../../utils/tree";

interface UseFileTreeOptions {
  rootPath: string | null;
  refreshToken: number;
  onInsertPaths: (paths: string[]) => Promise<void>;
  onOpenFile: (node: FileNode) => Promise<void> | void;
}

export function useFileTree({
  rootPath,
  refreshToken,
  onInsertPaths,
  onOpenFile,
}: UseFileTreeOptions) {
  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [loadingPaths, setLoadingPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const isLoading = Boolean(rootPath) && rootNode === null && error === null;

  useEffect(() => {
    let cancelled = false;

    async function loadTree() {
      if (!rootPath) {
        setRootNode(null);
        setSelectedPaths([]);
        setExpandedPaths([]);
        setError(null);
        return;
      }

      setRootNode(null);
      setSelectedPaths([]);
      setExpandedPaths([rootPath]);
      setError(null);

      try {
        const node = await invoke<FileNode>("scan_working_dir", { rootPath });
        if (!cancelled) {
          setRootNode(node);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    }

    void loadTree();

    return () => {
      cancelled = true;
    };
  }, [refreshToken, rootPath]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    function closeMenu() {
      setContextMenu(null);
    }

    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("click", closeMenu);

    return () => {
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("click", closeMenu);
    };
  }, []);

  async function toggleDirectory(node: FileNode) {
    if (!node.isDir) {
      return;
    }

    const isExpanded = expandedPaths.includes(node.absPath);
    if (isExpanded) {
      setExpandedPaths((value) => value.filter((path) => path !== node.absPath));
      return;
    }

    setExpandedPaths((value) => [...value, node.absPath]);

    if (!rootPath || !node.hasChildren || node.children) {
      return;
    }

    setLoadingPaths((value) => [...value, node.absPath]);

    try {
      const children = await invoke<FileNode[]>("read_directory", {
        dirPath: node.absPath,
        rootPath,
      });

      setRootNode((value) => (value ? replaceNodeChildren(value, node.absPath, children) : value));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingPaths((value) => value.filter((path) => path !== node.absPath));
    }
  }

  function handleNodeClick(node: FileNode, additive: boolean) {
    setContextMenu(null);
    setSelectedPaths((value) => {
      if (!additive) {
        return [node.absPath];
      }

      return value.includes(node.absPath)
        ? value.filter((path) => path !== node.absPath)
        : [...value, node.absPath];
    });

    if (!node.isDir) {
      void onOpenFile(node);
      return;
    }

    void toggleDirectory(node);
  }

  function handleNodeContextMenu(node: FileNode, x: number, y: number) {
    setSelectedPaths((value) => (value.includes(node.absPath) ? value : [node.absPath]));
    setContextMenu({
      targetPath: node.absPath,
      x,
      y,
    });
  }

  async function quickInsert(node: FileNode) {
    try {
      await onInsertPaths([node.absPath]);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function insertContextSelection() {
    if (!contextMenu) {
      return;
    }

    const paths = selectedPaths.includes(contextMenu.targetPath)
      ? selectedPaths
      : [contextMenu.targetPath];

    try {
      await onInsertPaths(paths);
      setError(null);
      setContextMenu(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function insertSelection() {
    if (!selectedPaths.length) {
      return;
    }

    try {
      await onInsertPaths(selectedPaths);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return {
    closeContextMenu: () => setContextMenu(null),
    contextMenu,
    error,
    expandedPaths,
    handleNodeClick,
    handleNodeContextMenu,
    insertSelection,
    insertContextSelection,
    isLoading,
    loadingPaths,
    quickInsert,
    rootNode,
    selectedPaths,
    toggleDirectory,
  };
}
