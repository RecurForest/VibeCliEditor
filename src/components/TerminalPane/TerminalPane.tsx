import "@xterm/xterm/css/xterm.css";
import { Plus, Trash2, X } from "lucide-react";
import type { Ref } from "react";
import type { ShellKind } from "../../types";

interface TerminalPaneProps {
  canLaunch: boolean;
  containerRef: Ref<HTMLDivElement>;
  error: string | null;
  isSessionActive: boolean;
  onClear: () => void;
  onClose: () => void;
  onFocus: () => void;
  onLaunchClaude: () => void;
  onLaunchCodex: () => void;
  onOpenShell: () => void;
  sessionId: string | null;
  shellKind: ShellKind;
  status: "idle" | "starting" | "ready" | "error";
  workingDir: string | null;
}

export function TerminalPane({
  canLaunch,
  containerRef,
  error,
  isSessionActive,
  onClear,
  onClose,
  onFocus,
  onLaunchClaude,
  onLaunchCodex,
  onOpenShell,
  sessionId,
  shellKind,
  status,
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
        Use <strong>Codex</strong>, <strong>Claude Code</strong>, or the <strong>+</strong> button above to
        launch a shell in the current workspace.
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
          <span className="terminal__tab">OUTPUT</span>
          <span className="terminal__tab">DEBUG CONSOLE</span>
        </div>

        <div className="terminal__actions">
          <button
            className="terminal__icon-button"
            disabled={!canLaunch}
            onClick={onOpenShell}
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

      <div className="terminal__meta">
        <span>{shellKind}</span>
        <span>{status}</span>
        <span>{sessionId ? "attached" : "detached"}</span>
      </div>

      <div className="terminal__cwd" title={workingDir ?? "No workspace selected"}>
        {workingDir ?? "No workspace selected"}
      </div>

      <div className="terminal__launchers">
        <button
          className="terminal__launcher-button"
          disabled={!canLaunch}
          onClick={onLaunchCodex}
          type="button"
        >
          Codex
        </button>
        <button
          className="terminal__launcher-button"
          disabled={!canLaunch}
          onClick={onLaunchClaude}
          type="button"
        >
          Claude Code
        </button>
      </div>

      <div className="terminal__body">
        <div className="terminal__viewport" onMouseDown={onFocus} ref={containerRef} />
        {emptyState ? <div className="terminal__empty">{emptyState}</div> : null}
      </div>

      {error ? <div className="terminal__error">{error}</div> : null}
    </aside>
  );
}
