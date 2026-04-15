import { invoke } from "@tauri-apps/api/core";
import { Code2, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import type { CursorPosition, EditorTab, ShellKind } from "../../types";

interface StatusBarProps {
  activeTab: EditorTab | null;
  cursor: CursorPosition;
  rootPath: string | null;
  shellKind: ShellKind;
}

const NO_GIT_LABEL = "No Git";

export function StatusBar({ activeTab, cursor, rootPath, shellKind }: StatusBarProps) {
  const [gitBranch, setGitBranch] = useState(NO_GIT_LABEL);

  useEffect(() => {
    if (!rootPath) {
      setGitBranch(NO_GIT_LABEL);
      return;
    }

    let cancelled = false;

    async function loadGitBranch() {
      try {
        const branch = await invoke<string>("get_git_branch", { rootPath });
        if (!cancelled) {
          setGitBranch(branch || NO_GIT_LABEL);
        }
      } catch {
        if (!cancelled) {
          setGitBranch(NO_GIT_LABEL);
        }
      }
    }

    void loadGitBranch();

    const handleWindowFocus = () => {
      void loadGitBranch();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadGitBranch();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [rootPath]);

  return (
    <footer className="status-bar">
      <div className="status-bar__group">
        <span className="status-bar__item">
          <GitBranch size={12} />
          {gitBranch}
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
      </div>
    </footer>
  );
}
