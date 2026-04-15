import "@xterm/xterm/css/xterm.css";
import { History, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type Ref } from "react";
import type { TerminalSessionRecord } from "../../types";

interface TerminalPaneProps {
  canLaunch: boolean;
  containerRef: Ref<HTMLDivElement>;
  error: string | null;
  hasSessions: boolean;
  isSessionActive: boolean;
  onClaude: () => void;
  onClear: () => void;
  onClose: () => void;
  onCodex: () => void;
  onCopySelection: () => Promise<boolean>;
  onFocus: () => void;
  getTerminalSelectionText: () => string;
  onLocateSelectionFile: (selectionText: string) => Promise<void>;
  onOpen: () => void;
  onPaste: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
  selectedSession: TerminalSessionRecord | null;
  selectedSessionId: string | null;
  sessions: TerminalSessionRecord[];
  workingDir: string | null;
}

export function TerminalPane({
  canLaunch,
  containerRef,
  error,
  hasSessions,
  isSessionActive,
  onClaude,
  onClear,
  onClose,
  onCodex,
  onCopySelection,
  onFocus,
  getTerminalSelectionText,
  onLocateSelectionFile,
  onOpen,
  onPaste,
  onSelectSession,
  selectedSession,
  selectedSessionId,
  sessions,
  workingDir,
}: TerminalPaneProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    selectionText: string;
    x: number;
    y: number;
  } | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!historyRef.current?.contains(target)) {
        setIsHistoryOpen(false);
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

  const trimmedSelection = contextMenu?.selectionText.trim() ?? "";
  const canLocateSelection = Boolean(trimmedSelection);

  function handleViewportContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsHistoryOpen(false);
    setContextMenu({
      selectionText: getTerminalSelectionText(),
      x: event.clientX,
      y: event.clientY,
    });
  }

  const emptyState = !workingDir ? (
    <div className="terminal__empty-card">
      <div className="terminal__empty-title">No workspace selected</div>
      <div className="terminal__empty-copy">
        Open a folder first, then you can launch an integrated terminal for that project.
      </div>
    </div>
  ) : !hasSessions ? (
    <div className="terminal__empty-card">
      <div className="terminal__empty-title">Terminal not started</div>
      <div className="terminal__empty-copy">
        Use the terminal toolbar here to open a shell, Codex, or Claude Code in the current workspace.
      </div>
    </div>
  ) : !selectedSession ? (
    <div className="terminal__empty-card">
      <div className="terminal__empty-title">No session selected</div>
      <div className="terminal__empty-copy">
        Open the history list and switch to an existing terminal session.
      </div>
    </div>
  ) : null;

  return (
    <aside className="terminal">
      <header className="terminal__header">
        <div className="terminal__tabs">
          <span className="terminal__tab" data-active="true">
            {selectedSession?.title ?? "TERMINAL"}
          </span>
          {selectedSession ? (
            <span className="terminal__session-state" data-status={selectedSession.status}>
              {selectedSession.status === "active" ? "LIVE" : "DONE"}
            </span>
          ) : null}
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
          <div className="terminal__history" ref={historyRef}>
            <button
              className="terminal__icon-button"
              disabled={!sessions.length}
              onClick={() => setIsHistoryOpen((value) => !value)}
              title="Session history"
              type="button"
            >
              <History size={14} />
            </button>

            {isHistoryOpen ? (
              <div className="terminal__history-menu">
                {[...sessions].reverse().map((session) => (
                  <button
                    className="terminal__history-item"
                    data-active={session.id === selectedSessionId}
                    key={session.id}
                    onClick={() => {
                      onSelectSession(session.id);
                      setIsHistoryOpen(false);
                    }}
                    type="button"
                  >
                    <span className="terminal__history-item-title">{session.title}</span>
                    <span className="terminal__history-item-meta">
                      {formatSessionTime(session.startedAt)}
                    </span>
                    <span className="terminal__history-item-status" data-status={session.status}>
                      {session.status === "active" ? "Live" : "Done"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="terminal__icon-button"
            disabled={!selectedSession}
            onClick={onClear}
            title="Clear terminal"
            type="button"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="terminal__icon-button"
            disabled={!selectedSession}
            onClick={onClose}
            title={isSessionActive ? "Close session" : "Remove session"}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="terminal__body">
        <div
          className="terminal__viewport"
          onContextMenu={handleViewportContextMenu}
          onMouseDown={onFocus}
          ref={containerRef}
        />
        {emptyState ? <div className="terminal__empty">{emptyState}</div> : null}

        {contextMenu ? (
          <div
            className="context-menu"
            onClick={(event) => event.stopPropagation()}
            ref={contextMenuRef}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="context-menu__button"
              disabled={!canLocateSelection}
              onClick={() => {
                void onLocateSelectionFile(trimmedSelection);
                setContextMenu(null);
              }}
              type="button"
            >
              定位文件
            </button>
            <button
              className="context-menu__button"
              disabled={!canLocateSelection}
              onClick={() => {
                void onCopySelection();
                setContextMenu(null);
              }}
              type="button"
            >
              复制
            </button>
            <button
              className="context-menu__button"
              onClick={() => {
                void onPaste();
                setContextMenu(null);
              }}
              type="button"
            >
              粘贴
            </button>
          </div>
        ) : null}
      </div>

      {error ? <div className="terminal__error">{error}</div> : null}
    </aside>
  );
}

function formatSessionTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
