import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ContextMenuState, FileNode } from "../../types";
import { replaceNodeChildren } from "../../utils/tree";

interface UseFileTreeOptions {
  onDeletePaths?: (paths: string[]) => Promise<void> | void;
  onInsertPaths: (paths: string[]) => Promise<void>;
  onOpenFile: (node: FileNode) => Promise<void> | void;
  onRenamePath?: (payload: {
    fromPath: string;
    isDir: boolean;
    toPath: string;
  }) => Promise<void> | void;
  onResolvedRootPath?: (rootPath: string) => void;
  refreshToken: number;
  requestTextInput?: (options: {
    initialValue?: string;
    placeholder: string;
    submitLabel: string;
  }) => Promise<string | null>;
  rootPath: string | null;
}

export interface ClipboardImportFile {
  bytes: number[];
  name: string;
}

export interface ClipboardPastePayload {
  files: ClipboardImportFile[];
  sourcePaths: string[];
}

export function useFileTree({
  onDeletePaths,
  onInsertPaths,
  onOpenFile,
  onRenamePath,
  onResolvedRootPath,
  refreshToken,
  requestTextInput,
  rootPath,
}: UseFileTreeOptions) {
  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [loadingPaths, setLoadingPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [localRefreshToken, setLocalRefreshToken] = useState(0);

  const previousRootPathRef = useRef<string | null>(null);
  const rootNodeRef = useRef<FileNode | null>(null);
  const expandedPathsRef = useRef<string[]>([]);
  const selectedPathsRef = useRef<string[]>([]);
  const pendingReloadResolversRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    rootNodeRef.current = rootNode;
  }, [rootNode]);

  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  useEffect(() => {
    selectedPathsRef.current = selectedPaths;
  }, [selectedPaths]);

  useEffect(() => {
    let cancelled = false;

    async function loadTree() {
      if (!rootPath) {
        setRootNode(null);
        setSelectedPaths([]);
        setExpandedPaths([]);
        setLoadingPaths([]);
        setError(null);
        setIsLoading(false);
        previousRootPathRef.current = null;
        flushPendingReloads(pendingReloadResolversRef);
        return;
      }

      const shouldPreserveState = previousRootPathRef.current === rootPath;
      const preservedExpandedPaths = shouldPreserveState
        ? expandedPathsRef.current.filter((path) => isPathWithinRoot(path, rootPath))
        : [];
      const preservedSelectedPaths = shouldPreserveState
        ? selectedPathsRef.current.filter((path) => isPathWithinRoot(path, rootPath))
        : [];

      if (!shouldPreserveState) {
        setSelectedPaths([]);
        setExpandedPaths([rootPath]);
        setLoadingPaths([]);
      }

      setContextMenu(null);
      setError(null);
      setIsLoading(true);

      try {
        const nextRootNode = await invoke<FileNode>("scan_working_dir", { rootPath });
        let nextTree = nextRootNode;
        const nextExpandedPaths = mergeUniquePaths(
          [nextRootNode.absPath],
          preservedExpandedPaths.filter((path) => path !== nextRootNode.absPath),
        );

        nextTree = await hydrateExpandedDirectories(
          nextTree,
          nextRootNode.absPath,
          nextExpandedPaths,
          setLoadingPaths,
        );

        if (cancelled) {
          return;
        }

        const validExpandedPaths = nextExpandedPaths.filter(
          (path) => path === nextRootNode.absPath || Boolean(findNodeByPath(nextTree, path)),
        );
        const validSelectedPaths = preservedSelectedPaths.filter((path) =>
          Boolean(findNodeByPath(nextTree, path)),
        );

        rootNodeRef.current = nextTree;
        previousRootPathRef.current = nextRootNode.absPath;
        setRootNode(nextTree);
        setExpandedPaths(validExpandedPaths);
        setSelectedPaths(validSelectedPaths);
        onResolvedRootPath?.(nextRootNode.absPath);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setLoadingPaths([]);
          flushPendingReloads(pendingReloadResolversRef);
        }
      }
    }

    void loadTree();

    return () => {
      cancelled = true;
    };
  }, [localRefreshToken, onResolvedRootPath, refreshToken, rootPath]);

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

    setExpandedPaths((value) => mergeUniquePaths(value, [node.absPath]));

    if (!rootPath || !node.hasChildren || node.children) {
      return;
    }

    setLoadingPaths((value) => mergeUniquePaths(value, [node.absPath]));

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
      targetNode: node,
      targetPath: node.absPath,
      x,
      y,
    });
  }

  function handleExplorerBackgroundClick() {
    setContextMenu(null);
    setSelectedPaths([]);
  }

  function handleExplorerBackgroundContextMenu(x: number, y: number) {
    const rootNode = rootNodeRef.current;
    if (!rootNode) {
      return;
    }

    setSelectedPaths([]);
    setContextMenu({
      targetNode: rootNode,
      targetPath: rootNode.absPath,
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
    const paths = resolveContextSelectionPaths();
    if (!paths.length) {
      return;
    }

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

  function resolveContextSelectionPaths() {
    if (!contextMenu) {
      return [];
    }

    return selectedPathsRef.current.includes(contextMenu.targetPath)
      ? selectedPathsRef.current
      : [contextMenu.targetPath];
  }

  async function copyContextSelection() {
    const sourcePaths = Array.from(
      new Set(resolveContextSelectionPaths().map((path) => path.trim()).filter(Boolean)),
    );
    if (!sourcePaths.length) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setError("Clipboard write is not available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(sourcePaths.join("\r\n"));
      setError(null);
      setContextMenu(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function requestReload() {
    return new Promise<void>((resolve) => {
      pendingReloadResolversRef.current.push(resolve);
      setLocalRefreshToken((value) => value + 1);
    });
  }

  async function createContextItem(kind: "file" | "folder") {
    const targetNode = contextMenu?.targetNode;
    if (!rootPath || !targetNode?.isDir) {
      return;
    }

    const label = kind === "file" ? "file" : "folder";
    const rawName = requestTextInput
      ? await requestTextInput({
          placeholder: kind === "file" ? "File name" : "Folder name",
          submitLabel: kind === "file" ? "Create File" : "Create Folder",
        })
      : window.prompt(`New ${label}`, "");
    if (rawName === null) {
      setContextMenu(null);
      return;
    }

    const nextName = rawName.trim();
    if (!nextName) {
      setError(`Enter a ${label} name.`);
      return;
    }

    if (!isValidNodeName(nextName)) {
      setError(`${label} names cannot include path separators.`);
      return;
    }

    const nextPath = joinPath(targetNode.absPath, nextName);

    try {
      if (kind === "file") {
        await invoke("upsert_file", {
          content: "",
          filePath: nextPath,
          rootPath,
        });
      } else {
        await invoke("create_directory", {
          dirPath: nextPath,
          rootPath,
        });
      }

      setContextMenu(null);
      setError(null);
      await requestReload();
      await revealPath(nextPath);

      if (kind === "file") {
        const createdNode = findNodeByPath(rootNodeRef.current, nextPath);
        await onOpenFile(
          createdNode ?? {
            absPath: nextPath,
            children: undefined,
            hasChildren: false,
            id: nextPath,
            isDir: false,
            name: nextName,
            relPath: toRelativePath(rootPath, nextPath),
          },
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function renameContextTarget() {
    const targetNode = contextMenu?.targetNode;
    const workspaceRootPath = rootNodeRef.current?.absPath ?? rootPath;
    if (!rootPath || !targetNode || isWorkspaceRootPath(targetNode.absPath, workspaceRootPath)) {
      return;
    }

    const rawName = requestTextInput
      ? await requestTextInput({
          initialValue: targetNode.name,
          placeholder: targetNode.isDir ? "Folder name" : "File name",
          submitLabel: "Save",
        })
      : window.prompt(targetNode.isDir ? "Rename folder" : "Rename file", targetNode.name);
    if (rawName === null) {
      setContextMenu(null);
      return;
    }

    const nextName = rawName.trim();
    if (!nextName) {
      setError("Enter a new name.");
      return;
    }

    if (!isValidNodeName(nextName)) {
      setError("Names cannot include path separators.");
      return;
    }

    if (nextName === targetNode.name) {
      setContextMenu(null);
      return;
    }

    const parentPath = getParentPath(targetNode.absPath);
    if (!parentPath) {
      setError("Unable to resolve the parent directory.");
      return;
    }

    const nextPath = joinPath(parentPath, nextName);

    try {
      await invoke("rename_path", {
        fromPath: targetNode.absPath,
        rootPath,
        toPath: nextPath,
      });
      await onRenamePath?.({
        fromPath: targetNode.absPath,
        isDir: targetNode.isDir,
        toPath: nextPath,
      });

      setContextMenu(null);
      setError(null);
      await requestReload();
      await revealPath(nextPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function deleteContextSelection() {
    if (!contextMenu) {
      return;
    }

    const targetPaths = selectedPathsRef.current.includes(contextMenu.targetPath)
      ? selectedPathsRef.current
      : [contextMenu.targetPath];

    await deletePaths(targetPaths, { closeContextMenuOnCancel: true });
  }

  async function deleteSelection() {
    await deletePaths(selectedPathsRef.current);
  }

  async function deletePaths(
    paths: string[],
    options: {
      closeContextMenuOnCancel?: boolean;
    } = {},
  ) {
    if (!rootPath) {
      return;
    }

    const workspaceRootPath = rootNodeRef.current?.absPath ?? rootPath;
    const targetPaths = collapseDeleteTargets(
      paths.filter((path) => !isWorkspaceRootPath(path, workspaceRootPath)),
    );

    if (!targetPaths.length) {
      return;
    }

    const confirmMessage =
      targetPaths.length === 1
        ? `Delete "${getBaseName(targetPaths[0])}"?`
        : `Delete ${targetPaths.length} selected items?`;

    if (!window.confirm(confirmMessage)) {
      if (options.closeContextMenuOnCancel) {
        setContextMenu(null);
      }
      return;
    }

    try {
      await Promise.all(
        targetPaths.map((targetPath) =>
          invoke("delete_path", {
            rootPath,
            targetPath,
          }),
        ),
      );
      await onDeletePaths?.(targetPaths);

      setContextMenu(null);
      setError(null);
      await requestReload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function resolvePasteTargetDirectory(fromContextMenu: boolean) {
    const currentRootPath = rootNodeRef.current?.absPath ?? rootPath;
    if (!currentRootPath) {
      return null;
    }

    if (fromContextMenu) {
      const targetNode = contextMenu?.targetNode;
      if (!targetNode) {
        return null;
      }

      return targetNode.isDir ? targetNode.absPath : getParentPath(targetNode.absPath);
    }

    const selectedPath = selectedPathsRef.current[0];
    if (selectedPath) {
      const selectedNode = findNodeByPath(rootNodeRef.current, selectedPath);
      if (selectedNode) {
        return selectedNode.isDir ? selectedNode.absPath : getParentPath(selectedNode.absPath);
      }

      return getParentPath(selectedPath);
    }

    return currentRootPath;
  }

  async function pasteIntoSelection(payload: ClipboardPastePayload) {
    const targetDirPath = resolvePasteTargetDirectory(Boolean(contextMenu));
    if (!rootPath || !targetDirPath) {
      return;
    }

    const normalizedSourcePaths = Array.from(
      new Set(payload.sourcePaths.map((path) => path.trim()).filter(Boolean)),
    );
    const normalizedFiles = payload.files.filter((file) => file.name.trim().length > 0);

    if (!normalizedSourcePaths.length && !normalizedFiles.length) {
      setError("Clipboard does not contain files to paste.");
      return;
    }

    try {
      const pastedPaths = await invoke<string[]>("paste_clipboard_items", {
        files: normalizedFiles,
        rootPath,
        sourcePaths: normalizedSourcePaths,
        targetDirPath,
      });

      setContextMenu(null);
      setError(null);
      await requestReload();

      if (!pastedPaths.length) {
        return;
      }

      await revealPath(pastedPaths[0]);
      if (pastedPaths.length > 1) {
        setSelectedPaths(pastedPaths);
      }
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

  const workspaceRootPath = rootNodeRef.current?.absPath ?? rootPath;
  const deletableSelectionPaths = collapseDeleteTargets(
    selectedPaths.filter((path) => !isWorkspaceRootPath(path, workspaceRootPath)),
  );
  const contextSelectionPaths = contextMenu
    ? selectedPaths.includes(contextMenu.targetPath)
      ? selectedPaths
      : [contextMenu.targetPath]
    : [];
  const deletableContextPaths = collapseDeleteTargets(
    contextSelectionPaths.filter((path) => !isWorkspaceRootPath(path, workspaceRootPath)),
  );
  const contextPasteTargetDirectory = resolvePasteTargetDirectory(true);

  return {
    canCreateInContextTarget: Boolean(contextMenu?.targetNode.isDir),
    canCopyContextSelection: Boolean(contextMenu),
    canDeleteContextSelection: deletableContextPaths.length > 0,
    canDeleteSelection: deletableSelectionPaths.length > 0,
    canPasteIntoContextTarget: Boolean(rootPath && contextPasteTargetDirectory),
    canRenameContextTarget: Boolean(
      contextMenu && !isWorkspaceRootPath(contextMenu.targetPath, workspaceRootPath),
    ),
    closeContextMenu: () => setContextMenu(null),
    copyContextSelection,
    contextMenu,
    createContextFile: () => createContextItem("file"),
    createContextFolder: () => createContextItem("folder"),
    deleteContextSelection,
    deleteSelection,
    error,
    expandedPaths,
    handleExplorerBackgroundClick,
    handleExplorerBackgroundContextMenu,
    handleNodeClick,
    handleNodeContextMenu,
    insertContextSelection,
    insertSelection,
    isLoading,
    loadingPaths,
    pasteIntoSelection,
    quickInsert,
    renameContextTarget,
    revealPath,
    rootNode,
    selectedPaths,
    toggleDirectory,
  };
}

async function hydrateExpandedDirectories(
  rootNode: FileNode,
  rootPath: string,
  expandedPaths: string[],
  setLoadingPaths: Dispatch<SetStateAction<string[]>>,
) {
  let nextTree = rootNode;

  for (const dirPath of [...expandedPaths].sort((left, right) => left.length - right.length)) {
    if (dirPath === rootPath) {
      continue;
    }

    const directoryNode = findNodeByPath(nextTree, dirPath);
    if (!directoryNode || !directoryNode.isDir || !directoryNode.hasChildren) {
      continue;
    }

    setLoadingPaths((value) => mergeUniquePaths(value, [dirPath]));

    try {
      const children = await invoke<FileNode[]>("read_directory", {
        dirPath,
        rootPath,
      });
      nextTree = replaceNodeChildren(nextTree, dirPath, children);
    } finally {
      setLoadingPaths((value) => value.filter((path) => path !== dirPath));
    }
  }

  return nextTree;
}

function findNodeByPath(node: FileNode | null, targetPath: string): FileNode | null {
  if (!node) {
    return null;
  }

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
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}\\`) ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

function mergeUniquePaths(paths: string[], nextPaths: string[]) {
  return Array.from(new Set([...paths, ...nextPaths]));
}

function flushPendingReloads(resolversRef: { current: Array<() => void> }) {
  const resolvers = resolversRef.current;
  resolversRef.current = [];

  for (const resolve of resolvers) {
    resolve();
  }
}

function isValidNodeName(name: string) {
  return !/[\\/]/.test(name);
}

function joinPath(basePath: string, name: string) {
  const separator = basePath.includes("\\") ? "\\" : "/";
  return `${basePath.replace(/[/\\]+$/, "")}${separator}${name}`;
}

function toRelativePath(rootPath: string, absPath: string) {
  if (absPath === rootPath) {
    return ".";
  }

  if (absPath.startsWith(`${rootPath}\\`) || absPath.startsWith(`${rootPath}/`)) {
    return absPath.slice(rootPath.length + 1);
  }

  return absPath;
}

function collapseDeleteTargets(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths)).sort((left, right) => left.length - right.length);

  return uniquePaths.filter(
    (path, index) =>
      !uniquePaths
        .slice(0, index)
        .some((parentPath) => path === parentPath || isPathWithinRoot(path, parentPath)),
  );
}

function isWorkspaceRootPath(path: string, workspaceRootPath: string | null) {
  return Boolean(workspaceRootPath && path === workspaceRootPath);
}

function getBaseName(path: string) {
  const normalized = path.replace(/[/\\]+$/, "");
  return normalized.split(/[/\\]/).pop() || normalized;
}
