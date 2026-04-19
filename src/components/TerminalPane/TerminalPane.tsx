import "@xterm/xterm/css/xterm.css";
import { History, Plus, SquareTerminal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type Ref } from "react";
import type { TerminalSessionRecord } from "../../types";
import { useViewportConstrainedMenuPosition } from "../../utils/contextMenu";
import { TerminalComposer } from "./TerminalComposer";

interface TerminalPaneProps {
  canLaunch: boolean;
  composerEnabled: boolean;
  composerExternalInsertSequence?: number;
  composerExternalInsertText?: string;
  composerPlaceholder?: string;
  onComposerSubmit: (text: string) => Promise<void>;
  containerRef: Ref<HTMLDivElement>;
  error: string | null;
  getTerminalSelectionText: () => string;
  hasSessions: boolean;
  isSessionActive: boolean;
  onClaude: () => void;
  onClear: () => void;
  onClose: () => void;
  onCodex: () => void;
  onCopySelection: () => Promise<boolean>;
  onFocus: () => void;
  onLocateSelectionFile: (selectionText: string) => Promise<void>;
  onPaste: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
  onShell: () => void;
  selectedSession: TerminalSessionRecord | null;
  selectedSessionId: string | null;
  sessions: TerminalSessionRecord[];
  workingDir: string | null;
}

export function TerminalPane({
  canLaunch,
  composerEnabled,
  composerExternalInsertSequence = 0,
  composerExternalInsertText = "",
  composerPlaceholder,
  containerRef,
  error,
  getTerminalSelectionText,
  hasSessions,
  isSessionActive,
  onClaude,
  onClear,
  onClose,
  onCodex,
  onComposerSubmit,
  onCopySelection,
  onFocus,
  onLocateSelectionFile,
  onPaste,
  onSelectSession,
  onShell,
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
  const contextMenuStyle = useViewportConstrainedMenuPosition(contextMenu, contextMenuRef);

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
    <div className="terminal__empty-card terminal__empty-card--launch">
      <div className="terminal__empty-title">Open a workspace and start</div>
      <div className="terminal__empty-copy">
        Choose a workspace folder first. After that, Codex or Claude Code will open automatically.
      </div>
      <div className="terminal__empty-actions">
        <button
          className="terminal__empty-action terminal__empty-action--primary"
          onClick={onCodex}
          type="button"
        >
          Open Codex
        </button>
        <button
          className="terminal__empty-action"
          onClick={onClaude}
          type="button"
        >
          Open Claude Code
        </button>
      </div>
    </div>
  ) : !hasSessions ? (
    <div className="terminal__empty-card terminal__empty-card--launch">
      <div className="terminal__empty-title">Start an AI session</div>
      <div className="terminal__empty-copy">
        The terminal stays blank until you open Codex or Claude Code for this workspace.
      </div>
      <div className="terminal__empty-actions">
        <button
          className="terminal__empty-action terminal__empty-action--primary"
          onClick={onCodex}
          type="button"
        >
          Open Codex
        </button>
        <button
          className="terminal__empty-action"
          onClick={onClaude}
          type="button"
        >
          Open Claude Code
        </button>
      </div>
    </div>
  ) : !selectedSession ? (
    <div className="terminal__empty-card terminal__empty-card--launch">
      <div className="terminal__empty-title">Start a new AI session</div>
      <div className="terminal__empty-copy">
        Previous terminal history is available from the list above. Open Codex or Claude Code to start a fresh session here.
      </div>
      <div className="terminal__empty-actions">
        <button
          className="terminal__empty-action terminal__empty-action--primary"
          onClick={onCodex}
          type="button"
        >
          Open Codex
        </button>
        <button
          className="terminal__empty-action"
          onClick={onClaude}
          type="button"
        >
          Open Claude Code
        </button>
      </div>
    </div>
  ) : null;

  return (
    <aside className="terminal">
      <header className="terminal__header">
        <div className="terminal__tabs">
          <span className="terminal__tab" data-active="true">
            {selectedSession ? renderSessionLabel(selectedSession) : "TERMINAL"}
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
            onClick={onShell}
            title="Open shell"
            type="button"
          >
            <SquareTerminal size={14} />
          </button>
          <button
            className="terminal__icon-button"
            disabled={!canLaunch}
            onClick={onCodex}
            title="New Codex session"
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
                    <span className="terminal__history-item-title">{renderSessionLabel(session)}</span>
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
            style={contextMenuStyle}
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
              Locate File
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
              Copy
            </button>
            <button
              className="context-menu__button"
              onClick={() => {
                void onPaste();
                setContextMenu(null);
              }}
              type="button"
            >
              Paste
            </button>
          </div>
        ) : null}
      </div>

      {composerEnabled ? (
        <TerminalComposer
          canSubmit={Boolean(workingDir)}
          externalInsertSequence={composerExternalInsertSequence}
          externalInsertText={composerExternalInsertText}
          onSubmit={onComposerSubmit}
          placeholder={composerPlaceholder}
          workingDir={workingDir}
        />
      ) : null}

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

function renderSessionLabel(session: TerminalSessionRecord) {
  const agentModel = session.agent?.requestedProfile.model?.trim();
  if (!agentModel) {
    return session.title;
  }

  return `${session.title} / ${agentModel}`;
}
