import "@xterm/xterm/css/xterm.css";
import { SquareTerminal, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTerminal } from "./useTerminal";

interface InlineCmdTerminalProps {
  launchDir: string | null;
  onClose: () => void;
  onSessionComplete?: () => void;
  workingDir: string | null;
}

export function InlineCmdTerminal({
  launchDir,
  onClose,
  onSessionComplete,
  workingDir,
}: InlineCmdTerminalProps) {
  const autoOpenKeyRef = useRef<string | null>(null);
  const terminal = useTerminal({
    launchDir,
    ownsSessionDiffLifecycle: false,
    onSessionComplete,
    shellKind: "cmd",
    workingDir,
  });

  useEffect(() => {
    const autoOpenKey = `${workingDir ?? ""}::${launchDir ?? ""}`;

    if (
      terminal.canLaunch &&
      !terminal.isSessionActive &&
      autoOpenKeyRef.current !== autoOpenKey
    ) {
      autoOpenKeyRef.current = autoOpenKey;
      terminal.openShell();
    }
  }, [launchDir, terminal.canLaunch, terminal.isSessionActive, terminal.openShell, workingDir]);

  return (
    <section className="inline-terminal">
      <header className="inline-terminal__header">
        <div className="inline-terminal__title">
          <SquareTerminal size={14} />
          <span>CMD</span>
          <span className="inline-terminal__path" title={launchDir ?? workingDir ?? ""}>
            {launchDir ?? workingDir ?? "No workspace selected"}
          </span>
        </div>

        <div className="inline-terminal__actions">
          <button
            className="terminal__icon-button"
            disabled={!terminal.selectedSession}
            onClick={terminal.clearTerminal}
            title="Clear terminal"
            type="button"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="terminal__icon-button"
            onClick={onClose}
            title="Close terminal"
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="inline-terminal__body">
        <div
          className="terminal__viewport inline-terminal__viewport"
          onMouseDown={terminal.focusTerminal}
          ref={terminal.containerRef}
        />
      </div>

      {terminal.error ? <div className="terminal__error">{terminal.error}</div> : null}
    </section>
  );
}
