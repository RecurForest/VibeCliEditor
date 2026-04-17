import { useEffect, useRef, type ClipboardEvent as ReactClipboardEvent } from "react";
import { Crosshair, FolderOpen, RefreshCw } from "lucide-react";
import { FileTreeItem } from "./FileTreeItem";
import type { ContextMenuState, FileNode } from "../../types";
import type { ClipboardImportFile, ClipboardPastePayload } from "./useFileTree";

interface FileTreeProps {
  activeFilePath: string | null;
  canLocateActiveFile: boolean;
  canCreateInContextTarget: boolean;
  canDeleteContextSelection: boolean;
  canPasteIntoContextTarget: boolean;
  canRenameContextTarget: boolean;
  contextMenu: ContextMenuState | null;
  dirtyPaths: string[];
  error: string | null;
  expandedPaths: string[];
  isLoading: boolean;
  loadingPaths: string[];
  onContextCreateFile: () => Promise<void>;
  onContextCreateFolder: () => Promise<void>;
  onContextDelete: () => Promise<void>;
  onContextOpenInFileManager: (targetPath: string) => Promise<void>;
  onContextPaste: (payload: ClipboardPastePayload) => Promise<void>;
  onContextRename: () => Promise<void>;
  onContextInsert: () => Promise<void>;
  onLocateActiveFile: () => Promise<void>;
  onNodeClick: (node: FileNode, additive: boolean) => void;
  onNodeContextMenu: (node: FileNode, x: number, y: number) => void;
  onOpenFolder: () => void;
  onRefresh: () => void;
  rootNode: FileNode | null;
  rootPath: string | null;
  selectedPaths: string[];
}

export function FileTree({
  activeFilePath,
  canLocateActiveFile,
  canCreateInContextTarget,
  canDeleteContextSelection,
  canPasteIntoContextTarget,
  canRenameContextTarget,
  contextMenu,
  dirtyPaths,
  error,
  expandedPaths,
  isLoading,
  loadingPaths,
  onContextCreateFile,
  onContextCreateFolder,
  onContextDelete,
  onContextOpenInFileManager,
  onContextPaste,
  onContextRename,
  onContextInsert,
  onLocateActiveFile,
  onNodeClick,
  onNodeContextMenu,
  onOpenFolder,
  onRefresh,
  rootNode,
  rootPath,
  selectedPaths,
}: FileTreeProps) {
  const treeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const selectedPath = selectedPaths[0];
    if (!selectedPath || !treeRef.current) {
      return;
    }

    const escapedPath =
      typeof window.CSS?.escape === "function"
        ? window.CSS.escape(selectedPath)
        : selectedPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const target = treeRef.current.querySelector<HTMLButtonElement>(
      `.explorer-tree__row[data-path="${escapedPath}"]`,
    );

    target?.scrollIntoView({
      block: "nearest",
    });
  }, [rootNode, selectedPaths]);

  async function handleExplorerPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (shouldIgnoreClipboardPasteTarget(event.target)) {
      return;
    }

    let payload = await readClipboardPastePayloadFromDataTransfer(event.clipboardData);
    if (!payload.sourcePaths.length && !payload.files.length) {
      payload = await readClipboardPastePayloadFromNavigatorClipboard();
    }

    if (!payload.sourcePaths.length && !payload.files.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void onContextPaste(payload);
  }

  async function handleContextPasteClick() {
    const payload = await readClipboardPastePayloadFromNavigatorClipboard();
    void onContextPaste(payload);
  }

  return (
    <aside className="explorer">
      <div className="explorer__header">
        <div className="explorer__header-top">
          <div className="explorer__eyebrow">Explorer</div>
          <div className="explorer__header-actions">
            <button
              className="explorer__icon-button"
              disabled={!canLocateActiveFile}
              onClick={() => void onLocateActiveFile()}
              title="Locate active file"
              type="button"
            >
              <Crosshair size={14} />
            </button>
            <button
              className="explorer__icon-button"
              disabled={!rootPath}
              onClick={onRefresh}
              title="Refresh workspace"
              type="button"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="explorer__content" onPaste={handleExplorerPaste} tabIndex={0}>
        {!error && !rootNode && isLoading ? <div className="explorer__empty">Loading workspace...</div> : null}
        {!isLoading && !rootNode ? (
          <div className="explorer__empty-state">
            <div className="explorer__empty-title">
              {error ? "Workspace unavailable" : "No workspace open"}
            </div>
            <div className="explorer__empty-copy">
              {error
                ? error
                : "Open a folder to load the file tree and start working in this window."}
            </div>
            <button className="explorer__empty-action" onClick={onOpenFolder} type="button">
              <FolderOpen size={14} />
              Open Folder
            </button>
          </div>
        ) : null}

        {rootNode ? (
          <div className="explorer-tree" ref={treeRef}>
            <FileTreeItem
              activeFilePath={activeFilePath}
              depth={0}
              detailText={rootPath ?? undefined}
              dirtyPaths={dirtyPaths}
              expandedPaths={expandedPaths}
              key={rootNode.id}
              loadingPaths={loadingPaths}
              node={rootNode}
              onNodeClick={onNodeClick}
              onNodeContextMenu={onNodeContextMenu}
              selectedPaths={selectedPaths}
            />
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <div
          className="context-menu"
          onClick={(event) => event.stopPropagation()}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="context-menu__button" onClick={() => void onContextInsert()} type="button">
            To terminal
          </button>
          <button
            className="context-menu__button"
            onClick={() => void onContextOpenInFileManager(contextMenu.targetPath)}
            type="button"
          >
            Open in Explorer
          </button>
          <button
            className="context-menu__button"
            disabled={!canCreateInContextTarget}
            onClick={() => void onContextCreateFile()}
            type="button"
          >
            New File
          </button>
          <button
            className="context-menu__button"
            disabled={!canCreateInContextTarget}
            onClick={() => void onContextCreateFolder()}
            type="button"
          >
            New Folder
          </button>
          <button
            className="context-menu__button"
            disabled={!canRenameContextTarget}
            onClick={() => void onContextRename()}
            type="button"
          >
            Rename
          </button>
          <button
            className="context-menu__button"
            disabled={!canPasteIntoContextTarget}
            onClick={() => void handleContextPasteClick()}
            type="button"
          >
            Paste
          </button>
          <button
            className="context-menu__button"
            disabled={!canDeleteContextSelection}
            onClick={() => void onContextDelete()}
            type="button"
          >
            Delete
          </button>
        </div>
      ) : null}
    </aside>
  );
}

async function readClipboardPastePayloadFromDataTransfer(
  dataTransfer: DataTransfer | null,
): Promise<ClipboardPastePayload> {
  if (!dataTransfer) {
    return {
      files: [],
      sourcePaths: [],
    };
  }

  const sourcePaths = extractClipboardFilePaths([
    dataTransfer.getData("text/uri-list"),
    dataTransfer.getData("text/plain"),
  ]);

  if (sourcePaths.length) {
    return {
      files: [],
      sourcePaths,
    };
  }

  const files = await Promise.all(
    Array.from(dataTransfer.files).map((file, index) =>
      blobToClipboardImportFile(file, index, file.name),
    ),
  );

  return {
    files: files.filter((file): file is ClipboardImportFile => Boolean(file)),
    sourcePaths: [],
  };
}

async function readClipboardPastePayloadFromNavigatorClipboard(): Promise<ClipboardPastePayload> {
  const clipboard = navigator.clipboard;
  const rawTexts: string[] = [];
  const files: ClipboardImportFile[] = [];

  if (clipboard?.read) {
    try {
      const items = await clipboard.read();

      for (const [itemIndex, item] of items.entries()) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type === "text/plain" || type === "text/uri-list") {
            rawTexts.push(await blob.text());
            continue;
          }

          const file = await blobToClipboardImportFile(blob, itemIndex, null);
          if (file) {
            files.push(file);
          }
        }
      }
    } catch (reason) {
      console.warn("[explorer] Failed to read clipboard items.", reason);
    }
  }

  if (clipboard?.readText) {
    try {
      rawTexts.push(await clipboard.readText());
    } catch (reason) {
      console.warn("[explorer] Failed to read clipboard text.", reason);
    }
  }

  const sourcePaths = extractClipboardFilePaths(rawTexts);
  if (sourcePaths.length) {
    return {
      files: [],
      sourcePaths,
    };
  }

  return {
    files,
    sourcePaths: [],
  };
}

async function blobToClipboardImportFile(
  blob: Blob,
  index: number,
  preferredName: string | null,
): Promise<ClipboardImportFile | null> {
  const name = resolveClipboardFileName(blob, index, preferredName);
  if (!name) {
    return null;
  }

  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  return {
    bytes,
    name,
  };
}

function resolveClipboardFileName(blob: Blob, index: number, preferredName: string | null) {
  const sanitizedPreferredName = sanitizeClipboardFileName(preferredName);
  if (sanitizedPreferredName) {
    return sanitizedPreferredName;
  }

  const extension = inferExtensionFromMimeType(blob.type);
  return `clipboard-${Date.now()}-${index + 1}${extension}`;
}

function sanitizeClipboardFileName(value: string | null) {
  if (!value) {
    return null;
  }

  const fileName = value
    .trim()
    .split(/[/\\]+/)
    .pop()
    ?.trim();

  return fileName ? fileName : null;
}

function inferExtensionFromMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "text/plain":
      return ".txt";
    case "application/json":
      return ".json";
    default:
      return "";
  }
}

function extractClipboardFilePaths(rawTexts: string[]) {
  const paths = new Set<string>();

  for (const rawText of rawTexts) {
    for (const line of rawText.split(/\r?\n/)) {
      const trimmedLine = stripWrappingQuotes(line.trim());
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      if (trimmedLine.toLowerCase().startsWith("file://")) {
        const pathFromUri = decodeFileUri(trimmedLine);
        if (pathFromUri) {
          paths.add(pathFromUri);
        }
        continue;
      }

      if (looksLikeAbsolutePath(trimmedLine)) {
        paths.add(trimmedLine);
      }
    }
  }

  return Array.from(paths);
}

function stripWrappingQuotes(value: string) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function decodeFileUri(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") {
      return null;
    }

    const decodedPath = decodeURIComponent(url.pathname);
    if (url.host) {
      return `\\\\${url.host}${decodedPath.replace(/\//g, "\\")}`;
    }

    if (/^\/[A-Za-z]:/.test(decodedPath)) {
      return decodedPath.slice(1).replace(/\//g, "\\");
    }

    return decodedPath;
  } catch {
    return null;
  }
}

function looksLikeAbsolutePath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/");
}

function shouldIgnoreClipboardPasteTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(target.closest("input, textarea, [contenteditable='true']"))
    : false;
}
