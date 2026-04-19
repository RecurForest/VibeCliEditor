import {
  useEffect,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Crosshair, FolderOpen, RefreshCw } from "lucide-react";
import { FileTreeItem } from "./FileTreeItem";
import type { ContextMenuState, FileNode } from "../../types";
import type { ClipboardPastePayload } from "./useFileTree";
import { useViewportConstrainedMenuPosition } from "../../utils/contextMenu";
import {
  readClipboardPastePayloadFromDataTransfer,
  readClipboardPastePayloadFromNavigatorClipboard,
  shouldIgnoreClipboardPasteTarget,
} from "../../utils/clipboard";

interface FileTreeProps {
  activeFilePath: string | null;
  canLocateActiveFile: boolean;
  canCreateInContextTarget: boolean;
  canCopyContextSelection: boolean;
  canDeleteContextSelection: boolean;
  canDeleteSelection: boolean;
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
  onContextCopy: () => Promise<void>;
  onContextDelete: () => Promise<void>;
  onDeleteSelection: () => Promise<void>;
  onContextOpenInFileManager: (targetPath: string) => Promise<void>;
  onContextPaste: (payload: ClipboardPastePayload) => Promise<void>;
  onContextRename: () => Promise<void>;
  onContextInsert: () => Promise<void>;
  onExplorerBackgroundClick: () => void;
  onExplorerBackgroundContextMenu: (x: number, y: number) => void;
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
  canCopyContextSelection,
  canDeleteContextSelection,
  canDeleteSelection,
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
  onContextCopy,
  onContextDelete,
  onDeleteSelection,
  onContextOpenInFileManager,
  onContextPaste,
  onContextRename,
  onContextInsert,
  onExplorerBackgroundClick,
  onExplorerBackgroundContextMenu,
  onLocateActiveFile,
  onNodeClick,
  onNodeContextMenu,
  onOpenFolder,
  onRefresh,
  rootNode,
  rootPath,
  selectedPaths,
}: FileTreeProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuStyle = useViewportConstrainedMenuPosition(contextMenu, contextMenuRef);

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

  function handleExplorerMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isExplorerBackgroundEventTarget(event.target)) {
      return;
    }

    contentRef.current?.focus();
    onExplorerBackgroundClick();
  }

  function handleExplorerContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!rootNode || !isExplorerBackgroundEventTarget(event.target)) {
      return;
    }

    event.preventDefault();
    contentRef.current?.focus();
    onExplorerBackgroundContextMenu(event.clientX, event.clientY);
  }

  function handleExplorerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.key !== "Delete") {
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !canDeleteSelection) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void onDeleteSelection();
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

      <div
        className="explorer__content"
        onContextMenu={handleExplorerContextMenu}
        onKeyDown={handleExplorerKeyDown}
        onMouseDown={handleExplorerMouseDown}
        onPaste={handleExplorerPaste}
        ref={contentRef}
        tabIndex={0}
      >
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
          ref={contextMenuRef}
          style={contextMenuStyle}
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
            disabled={!canCopyContextSelection}
            onClick={() => void onContextCopy()}
            type="button"
          >
            Copy
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

function isExplorerBackgroundEventTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && !target.closest(".explorer-tree__row");
}
