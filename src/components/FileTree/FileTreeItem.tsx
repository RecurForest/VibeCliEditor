import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { FileNode } from "../../types";

interface FileTreeItemProps {
  activeFilePath: string | null;
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
        data-selected={isSelected}
        onClick={(event) => onNodeClick(node, event.ctrlKey || event.metaKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          onNodeContextMenu(node, event.clientX, event.clientY);
        }}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={node.relPath}
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
            getFileIcon(node.name)
          )}
        </span>

        <span className="explorer-tree__label">{node.name}</span>

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

function getFileIcon(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "css":
    case "html":
      return <FileCode2 size={15} />;
    case "json":
      return <FileJson2 size={15} />;
    default:
      return <FileText size={15} />;
  }
}
