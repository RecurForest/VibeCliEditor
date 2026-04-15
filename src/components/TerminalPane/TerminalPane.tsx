import "@xterm/xterm/css/xterm.css";
import { Plus, Trash2, X } from "lucide-react";
import type { Ref } from "react";

interface TerminalPaneProps {
  canLaunch: boolean;
  containerRef: Ref<HTMLDivElement>;
  error: string | null;
  isSessionActive: boolean;
  onClaude: () => void;
  onClear: () => void;
  onClose: () => void;
  onCodex: () => void;
  onFocus: () => void;
  onOpen: () => void;
  sessionId: string | null;
  workingDir: string | null;
}

export function TerminalPane({
  canLaunch,
  containerRef,
  error,
  isSessionActive,
  onClaude,
  onClear,
  onClose,
  onCodex,
  onFocus,
  onOpen,
  sessionId,
  workingDir,
}: TerminalPaneProps) {
  const emptyState = !workingDir ? (
    <div className="terminal__empty-card">
      <div className="terminal__empty-title">No workspace selected</div>
      <div className="terminal__empty-copy">
        Open a folder first, then you can launch an integrated terminal for that project.
      </div>
    </div>
  ) : !sessionId ? (
    <div className="terminal__empty-card">
      <div className="terminal__empty-title">Terminal not started</div>
      <div className="terminal__empty-copy">
        Use the terminal toolbar here to open a shell, Codex, or Claude Code in the current workspace.
      </div>
    </div>
  ) : null;

  return (
    <aside className="terminal">
      <header className="terminal__header">
        <div className="terminal__tabs">
          <span className="terminal__tab" data-active="true">
            TERMINAL
          </span>
        </div>
        <div className="terminal__actions">
          <button
            className="terminal__toolbar-button"
            disabled={!canLaunch}
            onClick={onCodex}
            type="button"
          >
            Codex
          </button>
          <button
            className="terminal__toolbar-button"
            disabled={!canLaunch}
            onClick={onClaude}
            type="button"
          >
            Claude
          </button>
          <button
            className="terminal__icon-button"
            disabled={!canLaunch}
            onClick={onOpen}
            title="Open shell"
            type="button"
          >
            <Plus size={14} />
          </button>
          <button
            className="terminal__icon-button"
            disabled={!isSessionActive}
            onClick={onClear}
            title="Clear terminal"
            type="button"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="terminal__icon-button"
            disabled={!isSessionActive}
            onClick={onClose}
            title="Close terminal"
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="terminal__body">
        <div className="terminal__viewport" onMouseDown={onFocus} ref={containerRef} />
        {emptyState ? <div className="terminal__empty">{emptyState}</div> : null}
      </div>

      {error ? <div className="terminal__error">{error}</div> : null}
    </aside>
  );
}
