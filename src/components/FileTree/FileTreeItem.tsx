import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { FileNode } from "../../types";
import { FileIcon } from "../FileIcon/FileIcon";

interface FileTreeItemProps {
  activeFilePath: string | null;
  detailText?: string;
  depth: number;
  dirtyPaths: string[];
  expandedPaths: string[];
  loadingPaths: string[];
  node: FileNode;
  onNodeClick: (node: FileNode, additive: boolean) => void;
  onNodeContextMenu: (node: FileNode, x: number, y: number) => void;
  selectedPaths: string[];
}

export function FileTreeItem({
  activeFilePath,
  detailText,
  depth,
  dirtyPaths,
  expandedPaths,
  loadingPaths,
  node,
  onNodeClick,
  onNodeContextMenu,
  selectedPaths,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.includes(node.absPath);
  const isLoading = loadingPaths.includes(node.absPath);
  const isSelected = selectedPaths.includes(node.absPath);
  const isActive = activeFilePath === node.absPath;
  const canExpand = node.isDir && node.hasChildren;
  const isDirty = dirtyPaths.includes(node.absPath);

  return (
    <div className="explorer-tree__item">
      <button
        className="explorer-tree__row"
        data-active={isActive}
        data-path={node.absPath}
        data-selected={isSelected}
        onClick={(event) => onNodeClick(node, event.ctrlKey || event.metaKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          onNodeContextMenu(node, event.clientX, event.clientY);
        }}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={detailText ?? node.relPath}
        type="button"
      >
        <span className="explorer-tree__chevron">
          {node.isDir ? (
            canExpand ? (
              isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )
            ) : (
              <span className="explorer-tree__chevron-placeholder" />
            )
          ) : (
            <span className="explorer-tree__chevron-placeholder" />
          )}
        </span>

        <span className="explorer-tree__icon">
          {node.isDir ? (
            isExpanded ? (
              <FolderOpen size={15} />
            ) : (
              <Folder size={15} />
            )
          ) : (
            <FileIcon fileName={node.name} />
          )}
        </span>

        <span
          className={`explorer-tree__content${detailText ? " explorer-tree__content--with-detail" : ""}`}
        >
          <span className="explorer-tree__label">{node.name}</span>
          {detailText ? <span className="explorer-tree__detail">{detailText}</span> : null}
        </span>

        {isLoading ? <span className="explorer-tree__badge">...</span> : null}
        {isDirty ? <span className="explorer-tree__badge explorer-tree__badge--dirty">M</span> : null}
      </button>

      {node.isDir && isExpanded && node.children?.length ? (
        <div className="explorer-tree__children">
          {node.children.map((child) => (
            <FileTreeItem
              activeFilePath={activeFilePath}
              depth={depth + 1}
              dirtyPaths={dirtyPaths}
              expandedPaths={expandedPaths}
              key={child.id}
              loadingPaths={loadingPaths}
              node={child}
              onNodeClick={onNodeClick}
              onNodeContextMenu={onNodeContextMenu}
              selectedPaths={selectedPaths}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
