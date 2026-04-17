import "@xterm/xterm/css/xterm.css";
import { SquareTerminal, Trash2, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    selectionText: string;
    x: number;
    y: number;
  } | null>(null);
  const terminal = useTerminal({
    launchDir,
    ownsSessionDiffLifecycle: false,
    onSessionComplete,
    persistSessions: false,
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

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!contextMenuRef.current?.contains(target)) {
        setContextMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleViewportContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      selectionText: terminal.getSelectionText(),
      x: event.clientX,
      y: event.clientY,
    });
  }

  const trimmedSelection = contextMenu?.selectionText.trim() ?? "";

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
          onContextMenu={handleViewportContextMenu}
          onMouseDown={terminal.focusTerminal}
          ref={terminal.containerRef}
        />

        {contextMenu ? (
          <div
            className="context-menu"
            onClick={(event) => event.stopPropagation()}
            ref={contextMenuRef}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="context-menu__button"
              disabled={!trimmedSelection}
              onClick={() => {
                void terminal.copySelection();
                setContextMenu(null);
              }}
              type="button"
            >
              Copy
            </button>
            <button
              className="context-menu__button"
              onClick={() => {
                void terminal.pasteFromClipboard();
                setContextMenu(null);
              }}
              type="button"
            >
              Paste
            </button>
          </div>
        ) : null}
      </div>

      {terminal.error ? <div className="terminal__error">{terminal.error}</div> : null}
    </section>
  );
}
