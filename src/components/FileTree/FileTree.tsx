import { FolderOpen, MoreHorizontal, RefreshCw, TerminalSquare } from "lucide-react";
import { FileTreeItem } from "./FileTreeItem";
import type { ContextMenuState, FileNode } from "../../types";

interface FileTreeProps {
  activeFilePath: string | null;
  contextMenu: ContextMenuState | null;
  dirtyPaths: string[];
  error: string | null;
  expandedPaths: string[];
  isLoading: boolean;
  loadingPaths: string[];
  onCloseContextMenu: () => void;
  onContextInsert: () => Promise<void>;
  onInsertSelection: () => Promise<void>;
  onNodeClick: (node: FileNode, additive: boolean) => void;
  onNodeContextMenu: (node: FileNode, x: number, y: number) => void;
  onPickDirectory: () => Promise<void>;
  onRefresh: () => void;
  rootNode: FileNode | null;
  rootPath: string | null;
  selectedPaths: string[];
}

export function FileTree({
  activeFilePath,
  contextMenu,
  dirtyPaths,
  error,
  expandedPaths,
  isLoading,
  loadingPaths,
  onCloseContextMenu,
  onContextInsert,
  onInsertSelection,
  onNodeClick,
  onNodeContextMenu,
  onPickDirectory,
  onRefresh,
  rootNode,
  rootPath,
  selectedPaths,
}: FileTreeProps) {
  return (
    <aside className="explorer">
      <div className="explorer__header">
        <div>
          <div className="explorer__eyebrow">Explorer</div>
          <div className="explorer__workspace" title={rootPath ?? ""}>
            {rootNode?.name ?? "No Folder Opened"}
          </div>
        </div>
        <button className="explorer__icon-button" type="button">
          <MoreHorizontal size={14} />
        </button>
      </div>

      <div className="explorer__actions">
        <button className="explorer__action" onClick={() => void onPickDirectory()} type="button">
          <FolderOpen size={14} />
          Open Folder
        </button>
        <button className="explorer__action" onClick={onRefresh} type="button">
          <RefreshCw size={14} />
          Refresh
        </button>
        <button
          className="explorer__action"
          disabled={!selectedPaths.length}
          onClick={() => void onInsertSelection()}
          type="button"
        >
          <TerminalSquare size={14} />
          Insert Path
        </button>
      </div>

      <div className="explorer__content">
        {error ? <div className="explorer__empty">{error}</div> : null}
        {!error && !rootNode && isLoading ? <div className="explorer__empty">Loading workspace...</div> : null}
        {!error && !isLoading && !rootNode ? (
          <div className="explorer__empty">Select a workspace folder to render the file tree.</div>
        ) : null}

        {rootNode ? (
          <div className="explorer-tree">
            {rootNode.children?.map((node) => (
              <FileTreeItem
                activeFilePath={activeFilePath}
                depth={0}
                dirtyPaths={dirtyPaths}
                expandedPaths={expandedPaths}
                key={node.id}
                loadingPaths={loadingPaths}
                node={node}
                onNodeClick={onNodeClick}
                onNodeContextMenu={onNodeContextMenu}
                selectedPaths={selectedPaths}
              />
            ))}
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
            Insert selected paths into terminal
          </button>
          <button className="context-menu__button" onClick={onCloseContextMenu} type="button">
            Cancel
          </button>
        </div>
      ) : null}
    </aside>
  );
}
