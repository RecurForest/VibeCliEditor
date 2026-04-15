import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { ContextMenuState, FileNode } from "../../types";
import { replaceNodeChildren } from "../../utils/tree";

interface UseFileTreeOptions {
  onResolvedRootPath?: (rootPath: string) => void;
  rootPath: string | null;
  refreshToken: number;
  onInsertPaths: (paths: string[]) => Promise<void>;
  onOpenFile: (node: FileNode) => Promise<void> | void;
}

export function useFileTree({
  onResolvedRootPath,
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
  const rootNodeRef = useRef<FileNode | null>(null);

  useEffect(() => {
    rootNodeRef.current = rootNode;
  }, [rootNode]);

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
          onResolvedRootPath?.(node.absPath);
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
  }, [onResolvedRootPath, refreshToken, rootPath]);

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

  async function revealPath(targetPath: string) {
    const currentRootNode = rootNodeRef.current;
    const resolvedRootPath = currentRootNode?.absPath ?? rootPath;

    if (!resolvedRootPath || !currentRootNode || !isPathWithinRoot(targetPath, resolvedRootPath)) {
      return;
    }

    const ancestorPaths = getAncestorDirectoryPaths(resolvedRootPath, targetPath);
    let nextTree = currentRootNode;

    setExpandedPaths((value) => mergeUniquePaths(value, ancestorPaths));

    for (const dirPath of ancestorPaths) {
      const directoryNode = findNodeByPath(nextTree, dirPath);
      if (!directoryNode || !directoryNode.isDir || !directoryNode.hasChildren || directoryNode.children) {
        continue;
      }

      setLoadingPaths((value) => mergeUniquePaths(value, [dirPath]));

      try {
        const children = await invoke<FileNode[]>("read_directory", {
          dirPath,
          rootPath: resolvedRootPath,
        });
        nextTree = replaceNodeChildren(nextTree, dirPath, children);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      } finally {
        setLoadingPaths((value) => value.filter((path) => path !== dirPath));
      }
    }

    rootNodeRef.current = nextTree;
    setRootNode(nextTree);
    setExpandedPaths((value) => mergeUniquePaths(value, ancestorPaths));
    setSelectedPaths([targetPath]);
    setContextMenu(null);
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
    revealPath,
    rootNode,
    selectedPaths,
    toggleDirectory,
  };
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

function getAncestorDirectoryPaths(rootPath: string, targetPath: string) {
  const paths: string[] = [];
  let currentPath = getParentPath(targetPath);

  while (currentPath && isPathWithinRoot(currentPath, rootPath)) {
    paths.push(currentPath);
    if (currentPath === rootPath) {
      break;
    }

    currentPath = getParentPath(currentPath);
  }

  return Array.from(new Set(paths.reverse()));
}

function getParentPath(path: string) {
  const normalized = path.replace(/[/\\]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : null;
}

function isPathWithinRoot(path: string, rootPath: string) {
  const normalizedPath = path.toLowerCase();
  const normalizedRoot = rootPath.toLowerCase();
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`) || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function mergeUniquePaths(paths: string[], nextPaths: string[]) {
  return Array.from(new Set([...paths, ...nextPaths]));
}
