import {
  ChevronRight,
  Circle,
  Eye,
  GitCompareArrows,
  SquarePen,
  X,
} from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { editor, IDisposable } from "monaco-editor";
import type { SessionDiffTab, WorkbenchTab } from "../../types";
import { DiffViewerPane } from "../DiffViewer/DiffViewerPane";
import { FileIcon, isMarkdownFile } from "../FileIcon/FileIcon";
import { renderMarkdown } from "./markdown";
import { MONACO_THEME, resolveEditorLanguage } from "./monaco";

interface EditorPaneProps {
  activeTab: WorkbenchTab | null;
  error: string | null;
  onCloseTab: (tabId: string) => void;
  onContentChange: (content: string) => void;
  onCursorChange: (line: number, column: number) => void;
  onFocusWithin?: () => void;
  onSessionDiffFilesReverted?: (payload: { paths: string[]; sessionId: string }) => Promise<void>;
  onSelectTab: (tabId: string) => void;
  tabs: WorkbenchTab[];
}

export function EditorPane({
  activeTab,
  error,
  onCloseTab,
  onContentChange,
  onCursorChange,
  onFocusWithin,
  onSessionDiffFilesReverted,
  onSelectTab,
  tabs,
}: EditorPaneProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const cursorListenerRef = useRef<IDisposable | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLElement | null>(null);
  const markdownScrollTopByPathRef = useRef<Record<string, number>>({});
  const [previewByPath, setPreviewByPath] = useState<Record<string, boolean>>({});
  const activeEditorTab = activeTab && !isSessionDiffTab(activeTab) ? activeTab : null;
  const breadcrumbs = activeTab?.relPath.split(/[\\/]/).filter(Boolean) ?? [];
  const language = useMemo(() => resolveEditorLanguage(activeEditorTab?.name), [activeEditorTab?.name]);
  const sessionDiffSummary = useMemo(() => {
    if (!isSessionDiffTab(activeTab)) {
      return null;
    }

    return activeTab.result.files.reduce(
      (counts, file) => {
        counts[file.status] += 1;
        return counts;
      },
      { added: 0, deleted: 0, modified: 0 },
    );
  }, [activeTab]);
  const markdownEnabled = isMarkdownFile(activeEditorTab?.name);
  const isPreviewMode = Boolean(
    activeEditorTab && markdownEnabled && previewByPath[activeEditorTab.absPath],
  );
  const markdownHtml = useMemo(
    () => (activeEditorTab && isPreviewMode ? renderMarkdown(activeEditorTab.content) : ""),
    [activeEditorTab, isPreviewMode],
  );

  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      contextmenu: true,
      cursorBlinking: "blink",
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      glyphMargin: false,
      lineHeight: 22,
      minimap: { enabled: false },
      overviewRulerBorder: false,
      padding: { bottom: 12, top: 12 },
      readOnly: Boolean(activeEditorTab?.isReadOnly),
      renderLineHighlight: "line",
      roundedSelection: false,
      scrollBeyondLastLine: false,
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        horizontalScrollbarSize: 8,
        verticalScrollbarSize: 8,
      },
      smoothScrolling: true,
      tabSize: 2,
      wordWrap: "off",
    }),
    [activeEditorTab?.isReadOnly],
  );

  const handleEditorMount: OnMount = (mountedEditor) => {
    editorRef.current = mountedEditor;

    cursorListenerRef.current?.dispose();
    cursorListenerRef.current = mountedEditor.onDidChangeCursorPosition((event) => {
      onCursorChange(event.position.lineNumber, event.position.column);
    });

    const position = mountedEditor.getPosition();
    if (position) {
      onCursorChange(position.lineNumber, position.column);
    }
  };

  useEffect(
    () => () => {
      cursorListenerRef.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    if (activeEditorTab) {
      return;
    }

    cursorListenerRef.current?.dispose();
    cursorListenerRef.current = null;
    editorRef.current = null;
  }, [activeEditorTab]);

  useEffect(() => {
    if (!activeTab) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (isSessionDiffTab(activeTab)) {
        onCursorChange(1, 1);
      } else {
        const position = editorRef.current?.getPosition();
        if (position) {
          onCursorChange(position.lineNumber, position.column);
        } else {
          onCursorChange(1, 1);
        }
      }

      const activeTabId = getWorkbenchTabId(activeTab);
      const escapedPath =
        typeof window.CSS?.escape === "function"
          ? window.CSS.escape(activeTabId)
          : activeTabId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const activeTabButton = tabListRef.current?.querySelector<HTMLButtonElement>(
        `.editor__tab[data-tab-id="${escapedPath}"]`,
      );

      activeTabButton?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, onCursorChange, tabs.length]);

  useEffect(() => {
    if (!activeEditorTab || !isPreviewMode) {
      return;
    }

    const tabPath = activeEditorTab.absPath;
    const frame = window.requestAnimationFrame(() => {
      const markdownElement = markdownRef.current;
      if (!markdownElement) {
        return;
      }

      markdownElement.scrollTop = markdownScrollTopByPathRef.current[tabPath] ?? 0;
    });

    return () => {
      window.cancelAnimationFrame(frame);

      if (!markdownRef.current) {
        return;
      }

      markdownScrollTopByPathRef.current[tabPath] = markdownRef.current.scrollTop;
    };
  }, [activeEditorTab?.absPath, isPreviewMode]);

  function handleTabListWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const tabListElement = event.currentTarget;

    if (tabListElement.scrollWidth <= tabListElement.clientWidth) {
      return;
    }

    const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
    if (delta === 0) {
      return;
    }

    event.preventDefault();
    tabListElement.scrollLeft += delta;
  }

  function togglePreviewMode() {
    if (!activeEditorTab || !markdownEnabled) {
      return;
    }

    setPreviewByPath((value) => ({
      ...value,
      [activeEditorTab.absPath]: !value[activeEditorTab.absPath],
    }));
  }

  function handleFocusCapture(event: ReactFocusEvent<HTMLElement>) {
    const previousTarget = event.relatedTarget;
    if (previousTarget instanceof Node && event.currentTarget.contains(previousTarget)) {
      return;
    }

    if (isSessionDiffTab(activeTab)) {
      return;
    }

    onFocusWithin?.();
  }

  return (
    <section className="editor" onFocusCapture={handleFocusCapture}>
      <header className="editor__tabs">
        <div className="editor__tab-list" onWheel={handleTabListWheel} ref={tabListRef}>
          {tabs.map((tab) => {
            const tabId = getWorkbenchTabId(tab);
            const isActive = tabId === (activeTab ? getWorkbenchTabId(activeTab) : null);
            const isDirty = !isSessionDiffTab(tab) && tab.content !== tab.savedContent;

            return (
              <button
                className="editor__tab"
                data-active={isActive}
                data-tab-id={tabId}
                key={tabId}
                onClick={() => onSelectTab(tabId)}
                type="button"
              >
                <span className="editor__tab-icon">
                  {isSessionDiffTab(tab) ? (
                    <GitCompareArrows className="editor__tab-icon--diff" size={14} />
                  ) : (
                    <FileIcon fileName={tab.name} size="compact" />
                  )}
                </span>
                <span className="editor__tab-name">{tab.name}</span>
                {isDirty ? <Circle className="editor__tab-dirty" size={8} strokeWidth={4} /> : null}
                <X
                  className="editor__tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tabId);
                  }}
                  size={12}
                />
              </button>
            );
          })}
        </div>

        <div className="editor__tab-actions">
          {activeEditorTab && markdownEnabled ? (
            <button
              className="editor__action-button"
              onClick={togglePreviewMode}
              title={isPreviewMode ? "Back to editor" : "Preview Markdown"}
              type="button"
            >
              {isPreviewMode ? <SquarePen size={14} /> : <Eye size={14} />}
            </button>
          ) : null}
        </div>
      </header>

      <div className="editor__breadcrumbs">
        <div className="editor__breadcrumbs-trail">
          {breadcrumbs.length ? (
            breadcrumbs.map((segment, index) => (
              <span className="editor__breadcrumb" key={`${segment}-${index}`}>
                {index > 0 ? <ChevronRight size={12} /> : null}
                <span>{segment}</span>
              </span>
            ))
          ) : (
            <span className="editor__breadcrumb editor__breadcrumb--muted">Open a file from Explorer</span>
          )}
        </div>

        {sessionDiffSummary ? (
          <div className="editor__breadcrumbs-summary">
            <span className="editor__breadcrumbs-summary-item" data-status="added">
              {sessionDiffSummary.added} added
            </span>
            <span className="editor__breadcrumbs-summary-separator">/</span>
            <span className="editor__breadcrumbs-summary-item" data-status="modified">
              {sessionDiffSummary.modified} modified
            </span>
            <span className="editor__breadcrumbs-summary-separator">/</span>
            <span className="editor__breadcrumbs-summary-item" data-status="deleted">
              {sessionDiffSummary.deleted} deleted
            </span>
          </div>
        ) : null}
      </div>

      <div className="editor__surface">
        {activeEditorTab && isPreviewMode ? (
          <article
            className="editor__markdown"
            dangerouslySetInnerHTML={{ __html: markdownHtml }}
            onScroll={(event) => {
              markdownScrollTopByPathRef.current[activeEditorTab.absPath] = event.currentTarget.scrollTop;
            }}
            ref={markdownRef}
          />
        ) : activeEditorTab ? (
          <Editor
            className="editor__monaco"
            language={language}
            onChange={(value) => onContentChange(value ?? "")}
            onMount={handleEditorMount}
            options={editorOptions}
            path={activeEditorTab.absPath}
            saveViewState
            theme={MONACO_THEME}
            value={activeEditorTab.content}
          />
        ) : isSessionDiffTab(activeTab) ? (
          <DiffViewerPane
            onSessionDiffFilesReverted={onSessionDiffFilesReverted}
            result={activeTab.result}
            sessionTitle={activeTab.sessionTitle}
          />
        ) : (
          <div className="editor__empty">
            <div className="editor__empty-title">No file selected</div>
            <div className="editor__empty-copy">
              Choose a file from the Explorer to preview and edit it here.
            </div>
          </div>
        )}
      </div>

      {error ? <div className="editor__error">{error}</div> : null}
    </section>
  );
}

function isSessionDiffTab(tab: WorkbenchTab | null): tab is SessionDiffTab {
  return Boolean(tab && "tabType" in tab && tab.tabType === "sessionDiff");
}

function getWorkbenchTabId(tab: WorkbenchTab) {
  return isSessionDiffTab(tab) ? tab.id : tab.absPath;
}
