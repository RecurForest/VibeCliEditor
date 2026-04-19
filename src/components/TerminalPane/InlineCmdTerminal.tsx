import "@xterm/xterm/css/xterm.css";
import { Plus, Trash2, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useViewportConstrainedMenuPosition } from "../../utils/contextMenu";
import { useTerminal } from "./useTerminal";

interface InlineTerminalTab {
  id: string;
  title: string;
}

interface InlineCmdTerminalProps {
  activeTabId: string | null;
  launchDir: string | null;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onInsertSelectionToMainTerminal?: (text: string) => void;
  onSelectTab: (tabId: string) => void;
  onSessionComplete?: () => void;
  tabs: InlineTerminalTab[];
  workingDir: string | null;
}

export function InlineCmdTerminal({
  activeTabId,
  launchDir,
  onAddTab,
  onCloseTab,
  onInsertSelectionToMainTerminal,
  onSelectTab,
  onSessionComplete,
  tabs,
  workingDir,
}: InlineCmdTerminalProps) {
  const resolvedActiveTabId = tabs.some((tab) => tab.id === activeTabId)
    ? activeTabId
    : tabs[0]?.id ?? null;

  return (
    <section className="inline-terminal">
      <header className="inline-terminal__header">
        <div aria-label="Inline terminal tabs" className="inline-terminal__tabs" role="tablist">
          {tabs.map((tab) => {
            const isActive = tab.id === resolvedActiveTabId;
            return (
              <button
                aria-selected={isActive}
                className="inline-terminal__tab"
                data-active={isActive}
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                onMouseDown={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onCloseTab(tab.id);
                  }
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                  }
                }}
                role="tab"
                title={tab.title}
                type="button"
              >
                {tab.title}
              </button>
            );
          })}
        </div>

        <div className="inline-terminal__header-side">
          <span className="inline-terminal__header-path" title={launchDir ?? workingDir ?? ""}>
            {launchDir ?? workingDir ?? "No workspace selected"}
          </span>
          <button
            className="terminal__icon-button"
            onClick={onAddTab}
            title="New terminal"
            type="button"
          >
            <Plus size={14} />
          </button>
        </div>
      </header>

      <div className="inline-terminal__stack">
        {tabs.map((tab) => (
          <InlineCmdTerminalSession
            isActive={tab.id === resolvedActiveTabId}
            key={tab.id}
            launchDir={launchDir}
            onClose={() => onCloseTab(tab.id)}
            onInsertSelectionToMainTerminal={onInsertSelectionToMainTerminal}
            onSessionComplete={onSessionComplete}
            workingDir={workingDir}
          />
        ))}
      </div>
    </section>
  );
}

interface InlineCmdTerminalSessionProps {
  isActive: boolean;
  launchDir: string | null;
  onClose: () => void;
  onInsertSelectionToMainTerminal?: (text: string) => void;
  onSessionComplete?: () => void;
  workingDir: string | null;
}

function InlineCmdTerminalSession({
  isActive,
  launchDir,
  onClose,
  onInsertSelectionToMainTerminal,
  onSessionComplete,
  workingDir,
}: InlineCmdTerminalSessionProps) {
  const autoOpenKeyRef = useRef<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    selectionText: string;
    x: number;
    y: number;
  } | null>(null);
  const contextMenuStyle = useViewportConstrainedMenuPosition(contextMenu, contextMenuRef);
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

  useEffect(() => {
    if (!isActive) {
      return;
    }

    terminal.focusTerminal();
  }, [isActive, terminal.focusTerminal]);

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
    <div className="inline-terminal__session" data-active={isActive}>
      <div className="inline-terminal__session-bar">
        <span className="inline-terminal__session-copy">Shell</span>

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
      </div>

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
            style={contextMenuStyle}
          >
            <button
              className="context-menu__button"
              disabled={!trimmedSelection}
              onClick={() => {
                onInsertSelectionToMainTerminal?.(contextMenu.selectionText);
                setContextMenu(null);
              }}
              type="button"
            >
              To terminal
            </button>
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
    </div>
  );
}
