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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { editor, IDisposable } from "monaco-editor";
import type {
  EditorNavigationRequest,
  EditorTab,
  GitDiffTab,
  SessionDiffTab,
  WorkbenchTab,
} from "../../types";
import { DiffViewerPane } from "../DiffViewer/DiffViewerPane";
import { FileIcon, isMarkdownFile, isSvgFile } from "../FileIcon/FileIcon";
import { GitDiffViewerPane } from "../GitPanel/GitDiffViewerPane";
import { renderMarkdown } from "./markdown";
import { MONACO_THEME, resolveEditorLanguage } from "./monaco";

interface EditorPaneProps {
  activeTab: WorkbenchTab | null;
  error: string | null;
  navigationRequest?: EditorNavigationRequest | null;
  onCloseTab: (tabId: string) => void;
  onContentChange: (content: string) => void;
  onCursorChange: (line: number, column: number) => void;
  onRequestCloseActiveTabShortcut?: () => void;
  onRequestFileSearchShortcut?: () => void;
  onFocusWithin?: () => void;
  onRequestGotoLineShortcut?: () => void;
  onRequestNextTabShortcut?: () => void;
  onRequestPreviousTabShortcut?: () => void;
  onRequestSaveAllShortcut?: () => void;
  onRequestTextSearchShortcut?: () => void;
  onGitDiffDirtyChange?: (dirty: boolean) => void;
  onInlineFilesChanged?: (payload: { paths: string[]; sessionId?: string }) => Promise<void>;
  onSessionDiffDirtyChange?: (dirty: boolean) => void;
  onSelectTab: (tabId: string) => void;
  tabs: WorkbenchTab[];
}

export function EditorPane({
  activeTab,
  error,
  navigationRequest,
  onCloseTab,
  onContentChange,
  onCursorChange,
  onRequestCloseActiveTabShortcut,
  onRequestFileSearchShortcut,
  onFocusWithin,
  onRequestGotoLineShortcut,
  onRequestNextTabShortcut,
  onRequestPreviousTabShortcut,
  onRequestSaveAllShortcut,
  onRequestTextSearchShortcut,
  onGitDiffDirtyChange,
  onInlineFilesChanged,
  onSessionDiffDirtyChange,
  onSelectTab,
  tabs,
}: EditorPaneProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const cursorListenerRef = useRef<IDisposable | null>(null);
  const searchDecorationIdsRef = useRef<string[]>([]);
  const searchDecoratedModelRef = useRef<editor.ITextModel | null>(null);
  const searchDecorationTimeoutRef = useRef<number | null>(null);
  const handledNavigationIdRef = useRef<number | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const markdownScrollTopByPathRef = useRef<Record<string, number>>({});
  const shortcutHandlersRef = useRef({
    closeActiveTab: onRequestCloseActiveTabShortcut,
    fileSearch: onRequestFileSearchShortcut,
    gotoLine: onRequestGotoLineShortcut,
    nextTab: onRequestNextTabShortcut,
    previousTab: onRequestPreviousTabShortcut,
    saveAll: onRequestSaveAllShortcut,
    textSearch: onRequestTextSearchShortcut,
  });
  const [previewByPath, setPreviewByPath] = useState<Record<string, boolean>>({});
  const [editorMountVersion, setEditorMountVersion] = useState(0);
  const activeEditorTab = isEditorTab(activeTab) ? activeTab : null;
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
  const svgEnabled = isSvgFile(activeEditorTab?.name);
  const supportsTogglePreview = Boolean(
    activeEditorTab && activeEditorTab.contentKind !== "image" && (markdownEnabled || svgEnabled),
  );
  const isImagePreview = activeEditorTab?.contentKind === "image";
  const isMarkdownPreview = Boolean(
    activeEditorTab && markdownEnabled && previewByPath[activeEditorTab.absPath],
  );
  const isSvgPreview = Boolean(activeEditorTab && svgEnabled && previewByPath[activeEditorTab.absPath]);
  const isPreviewMode = isImagePreview || isMarkdownPreview || isSvgPreview;
  const markdownHtml = useMemo(
    () => (activeEditorTab && isMarkdownPreview ? renderMarkdown(activeEditorTab.content) : ""),
    [activeEditorTab, isMarkdownPreview],
  );
  const svgPreviewSrc = useMemo(
    () => (activeEditorTab && isSvgPreview ? createSvgPreviewSource(activeEditorTab.content) : ""),
    [activeEditorTab, isSvgPreview],
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

  const clearSearchDecorations = useCallback(() => {
    if (searchDecorationTimeoutRef.current !== null) {
      window.clearTimeout(searchDecorationTimeoutRef.current);
      searchDecorationTimeoutRef.current = null;
    }

    if (!searchDecoratedModelRef.current || !searchDecorationIdsRef.current.length) {
      searchDecorationIdsRef.current = [];
      searchDecoratedModelRef.current = null;
      return;
    }

    searchDecorationIdsRef.current = searchDecoratedModelRef.current.deltaDecorations(
      searchDecorationIdsRef.current,
      [],
    );
    searchDecoratedModelRef.current = null;
  }, []);

  useEffect(() => {
    shortcutHandlersRef.current = {
      closeActiveTab: onRequestCloseActiveTabShortcut,
      fileSearch: onRequestFileSearchShortcut,
      gotoLine: onRequestGotoLineShortcut,
      nextTab: onRequestNextTabShortcut,
      previousTab: onRequestPreviousTabShortcut,
      saveAll: onRequestSaveAllShortcut,
      textSearch: onRequestTextSearchShortcut,
    };
  }, [
    onRequestCloseActiveTabShortcut,
    onRequestFileSearchShortcut,
    onRequestGotoLineShortcut,
    onRequestNextTabShortcut,
    onRequestPreviousTabShortcut,
    onRequestSaveAllShortcut,
    onRequestTextSearchShortcut,
  ]);

  const handleEditorMount: OnMount = (mountedEditor, monaco) => {
    editorRef.current = mountedEditor;
    monacoRef.current = monaco;
    setEditorMountVersion((value) => value + 1);

    const runEditorAction = (actionId: string) => {
      void mountedEditor.getAction(actionId)?.run();
    };

    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => {
      shortcutHandlersRef.current.gotoLine?.();
    });
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR, () => {
      shortcutHandlersRef.current.fileSearch?.();
    });
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
      shortcutHandlersRef.current.textSearch?.();
    });
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => {
      shortcutHandlersRef.current.saveAll?.();
    });
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      shortcutHandlersRef.current.closeActiveTab?.();
    });
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.PageDown, () => {
      shortcutHandlersRef.current.nextTab?.();
    });
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.PageUp, () => {
      shortcutHandlersRef.current.previousTab?.();
    });
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
      runEditorAction("editor.action.deleteLines");
    });
    mountedEditor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
      runEditorAction("editor.action.moveLinesUpAction");
    });
    mountedEditor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
      runEditorAction("editor.action.moveLinesDownAction");
    });

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
      clearSearchDecorations();
    },
    [clearSearchDecorations],
  );

  useEffect(() => {
    if (activeEditorTab) {
      return;
    }

    cursorListenerRef.current?.dispose();
    cursorListenerRef.current = null;
    editorRef.current = null;
    monacoRef.current = null;
    clearSearchDecorations();
  }, [activeEditorTab]);

  useEffect(() => {
    if (!activeTab) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (isSessionDiffTab(activeTab) || isPreviewMode) {
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
  }, [activeTab, isPreviewMode, onCursorChange, tabs.length]);

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
    };
  }, [activeEditorTab?.absPath, isPreviewMode]);

  useEffect(() => {
    clearSearchDecorations();
  }, [activeEditorTab?.absPath, clearSearchDecorations]);

  useEffect(() => {
    if (!navigationRequest || !activeEditorTab) {
      return;
    }

    if (handledNavigationIdRef.current === navigationRequest.id) {
      return;
    }

    if (activeEditorTab.absPath !== navigationRequest.absPath) {
      return;
    }

    if (isPreviewMode && activeEditorTab.contentKind !== "image") {
      setPreviewByPath((value) =>
        value[activeEditorTab.absPath]
          ? {
              ...value,
              [activeEditorTab.absPath]: false,
            }
          : value,
      );
      return;
    }

    if (!editorRef.current || !monacoRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const mountedEditor = editorRef.current;
      const monaco = monacoRef.current;
      const model = mountedEditor?.getModel();

      if (!mountedEditor || !monaco || !model) {
        return;
      }

      handledNavigationIdRef.current = navigationRequest.id;
      clearSearchDecorations();

      const lineNumber = clampLineNumber(navigationRequest.line, model.getLineCount());
      const column = clampColumn(navigationRequest.column, model.getLineMaxColumn(lineNumber));
      const endColumn = clampEndColumn(
        column,
        navigationRequest.matchLength,
        model.getLineMaxColumn(lineNumber),
      );

      searchDecoratedModelRef.current = model;
      searchDecorationIdsRef.current = model.deltaDecorations(
        searchDecorationIdsRef.current,
        [
          {
            options: {
              className: "editor__search-hit-line",
              isWholeLine: true,
              linesDecorationsClassName: "editor__search-hit-gutter",
            },
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          },
          {
            options: {
              inlineClassName: "editor__search-hit-inline",
            },
            range: new monaco.Range(lineNumber, column, lineNumber, endColumn),
          },
        ],
      );

      mountedEditor.setPosition({ lineNumber, column });
      mountedEditor.revealLineInCenter(lineNumber);
      mountedEditor.focus();
      onCursorChange(lineNumber, column);
      searchDecorationTimeoutRef.current = window.setTimeout(() => {
        clearSearchDecorations();
      }, 1800);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    activeEditorTab,
    clearSearchDecorations,
    editorMountVersion,
    isPreviewMode,
    navigationRequest,
    onCursorChange,
  ]);

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
    if (!activeEditorTab || !supportsTogglePreview) {
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

    if (isSessionDiffTab(activeTab) || isGitDiffTab(activeTab)) {
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
            const isDirty = isEditorTab(tab) && tab.content !== tab.savedContent;

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
                  {isSessionDiffTab(tab) || isGitDiffTab(tab) ? (
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
          {supportsTogglePreview ? (
            <button
              className="editor__action-button"
              onClick={togglePreviewMode}
              title={isPreviewMode ? "Back to editor" : markdownEnabled ? "Preview Markdown" : "Preview SVG"}
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
          isMarkdownPreview ? (
            <div
              className="editor__markdown"
              dangerouslySetInnerHTML={{ __html: markdownHtml }}
              onScroll={(event) => {
                markdownScrollTopByPathRef.current[activeEditorTab.absPath] = event.currentTarget.scrollTop;
              }}
              ref={markdownRef}
            />
          ) : (
            <div
              className="editor__media-preview"
              onScroll={(event) => {
                markdownScrollTopByPathRef.current[activeEditorTab.absPath] = event.currentTarget.scrollTop;
              }}
              ref={markdownRef}
            >
              <img
                alt={activeEditorTab.name}
                className="editor__media-image"
                src={isImagePreview ? activeEditorTab.content : svgPreviewSrc}
              />
              <div className="editor__media-meta">{activeEditorTab.relPath}</div>
            </div>
          )
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
        ) : isGitDiffTab(activeTab) ? (
          <GitDiffViewerPane
            onDirtyStateChange={onGitDiffDirtyChange}
            onFilesChanged={onInlineFilesChanged}
            result={activeTab.result}
          />
        ) : isSessionDiffTab(activeTab) ? (
          <DiffViewerPane
            onDirtyStateChange={onSessionDiffDirtyChange}
            onSessionDiffFilesChanged={onInlineFilesChanged}
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

function isEditorTab(tab: WorkbenchTab | null): tab is EditorTab {
  return Boolean(tab && !("tabType" in tab));
}

function isGitDiffTab(tab: WorkbenchTab | null): tab is GitDiffTab {
  return Boolean(tab && "tabType" in tab && tab.tabType === "gitDiff");
}

function isSessionDiffTab(tab: WorkbenchTab | null): tab is SessionDiffTab {
  return Boolean(tab && "tabType" in tab && tab.tabType === "sessionDiff");
}

function getWorkbenchTabId(tab: WorkbenchTab) {
  return isEditorTab(tab) ? tab.absPath : tab.id;
}

function createSvgPreviewSource(content: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
}

function clampLineNumber(lineNumber: number, lineCount: number) {
  return Math.min(Math.max(lineNumber, 1), Math.max(lineCount, 1));
}

function clampColumn(column: number, maxColumn: number) {
  return Math.min(Math.max(column, 1), Math.max(maxColumn, 1));
}

function clampEndColumn(column: number, matchLength: number, maxColumn: number) {
  const resolvedMaxColumn = Math.max(maxColumn, column + 1);
  const minimumEndColumn = Math.min(resolvedMaxColumn, column + 1);
  const targetEndColumn = column + Math.max(matchLength, 1);
  return Math.min(Math.max(targetEndColumn, minimumEndColumn), resolvedMaxColumn);
}
