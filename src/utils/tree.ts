import type { FileNode } from "../types";

export function replaceNodeChildren(node: FileNode, targetPath: string, children: FileNode[]): FileNode {
  if (node.absPath === targetPath) {
    return {
      ...node,
      children,
      hasChildren: children.length > 0,
    };
  }

  return {
    ...node,
    children: node.children?.map((child) => replaceNodeChildren(child, targetPath, children)),
  };
}
