import { AlertCircle, Bell, Code2, GitBranch, TriangleAlert } from "lucide-react";
import type { CursorPosition, EditorTab, ShellKind } from "../../types";

interface StatusBarProps {
  activeTab: EditorTab | null;
  cursor: CursorPosition;
  rootPath: string | null;
  shellKind: ShellKind;
}

export function StatusBar({ activeTab, cursor, rootPath, shellKind }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-bar__group">
        <span className="status-bar__item">
          <GitBranch size={12} />
          main
        </span>
        <span className="status-bar__item">
          <AlertCircle size={12} />
          0
        </span>
        <span className="status-bar__item">
          <TriangleAlert size={12} />
          0
        </span>
      </div>

      <div className="status-bar__group">
        <span className="status-bar__item">{activeTab?.name ?? "No file"}</span>
        <span className="status-bar__item">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className="status-bar__item">UTF-8</span>
        <span className="status-bar__item">
          <Code2 size={12} />
          {activeTab?.name.split(".").pop()?.toUpperCase() ?? "TXT"}
        </span>
        <span className="status-bar__item">{shellKind}</span>
        <span className="status-bar__item" title={rootPath ?? ""}>
          {rootPath ?? "No workspace"}
        </span>
        <span className="status-bar__item">
          <Bell size={12} />
        </span>
      </div>
    </footer>
  );
}
