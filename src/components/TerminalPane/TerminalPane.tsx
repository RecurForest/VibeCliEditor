import "@xterm/xterm/css/xterm.css";
import { Plus, Trash2, X } from "lucide-react";
import type { RefObject } from "react";
import type { ShellKind } from "../../types";

interface TerminalPaneProps {
  containerRef: RefObject<HTMLDivElement | null>;
  error: string | null;
  sessionId: string | null;
  shellKind: ShellKind;
  status: "idle" | "starting" | "ready" | "error";
  workingDir: string | null;
}

export function TerminalPane({
  containerRef,
  error,
  sessionId,
  shellKind,
  status,
  workingDir,
}: TerminalPaneProps) {
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
          <button className="terminal__icon-button" type="button">
            <Plus size={14} />
          </button>
          <button className="terminal__icon-button" type="button">
            <Trash2 size={14} />
          </button>
          <button className="terminal__icon-button" type="button">
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="terminal__meta">
        <span>{shellKind}</span>
        <span>{status}</span>
        <span>{sessionId ? "attached" : "detached"}</span>
      </div>

      {workingDir ? (
        <>
          <div className="terminal__cwd" title={workingDir}>
            {workingDir}
          </div>
          <div className="terminal__viewport" ref={containerRef} />
        </>
      ) : (
        <div className="terminal__empty">Open a workspace folder to start the integrated terminal.</div>
      )}

      {error ? <div className="terminal__error">{error}</div> : null}
    </aside>
  );
}
