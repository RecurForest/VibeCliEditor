import { RefreshCw, SquareTerminal } from "lucide-react";
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
  onRefresh,
  rootNode,
  rootPath,
  selectedPaths,
}: FileTreeProps) {
  return (
    <aside className="explorer">
      <div className="explorer__header">
        <div className="explorer__header-top">
          <div className="explorer__eyebrow">Explorer</div>
          <div className="explorer__header-actions">
            <button
              className="explorer__icon-button"
              disabled={!rootPath}
              onClick={onRefresh}
              title="Refresh workspace"
              type="button"
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="explorer__icon-button"
              disabled={!selectedPaths.length}
              onClick={() => void onInsertSelection()}
              title="Insert selected path"
              type="button"
            >
              <SquareTerminal size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="explorer__content">
        {error ? <div className="explorer__empty">{error}</div> : null}
        {!error && !rootNode && isLoading ? <div className="explorer__empty">Loading workspace...</div> : null}
        {!error && !isLoading && !rootNode ? (
          <div className="explorer__empty">Select a workspace folder to render the file tree.</div>
        ) : null}

        {rootNode ? (
          <div className="explorer-tree">
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
