import {
  ChevronRight,
  Circle,
  Eye,
  SquarePen,
  X,
} from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import type { editor, IDisposable } from "monaco-editor";
import type { EditorTab } from "../../types";
import { FileIcon, isMarkdownFile } from "../FileIcon/FileIcon";
import { renderMarkdown } from "./markdown";
import { MONACO_THEME, resolveEditorLanguage } from "./monaco";

interface EditorPaneProps {
  activeTab: EditorTab | null;
  error: string | null;
  onCloseTab: (absPath: string) => void;
  onContentChange: (content: string) => void;
  onCursorChange: (line: number, column: number) => void;
  onSelectTab: (absPath: string) => void;
  tabs: EditorTab[];
}

export function EditorPane({
  activeTab,
  error,
  onCloseTab,
  onContentChange,
  onCursorChange,
  onSelectTab,
  tabs,
}: EditorPaneProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const cursorListenerRef = useRef<IDisposable | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const [previewByPath, setPreviewByPath] = useState<Record<string, boolean>>({});
  const breadcrumbs = activeTab?.relPath.split(/[\\/]/).filter(Boolean) ?? [];
  const language = useMemo(() => resolveEditorLanguage(activeTab?.name), [activeTab?.name]);
  const markdownEnabled = isMarkdownFile(activeTab?.name);
  const isPreviewMode = Boolean(activeTab && markdownEnabled && previewByPath[activeTab.absPath]);
  const markdownHtml = useMemo(
    () => (activeTab && isPreviewMode ? renderMarkdown(activeTab.content) : ""),
    [activeTab, isPreviewMode],
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
    [],
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
    if (!activeTab) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const position = editorRef.current?.getPosition();
      if (position) {
        onCursorChange(position.lineNumber, position.column);
      } else {
        onCursorChange(1, 1);
      }

      const escapedPath =
        typeof window.CSS?.escape === "function"
          ? window.CSS.escape(activeTab.absPath)
          : activeTab.absPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const activeTabButton = tabListRef.current?.querySelector<HTMLButtonElement>(
        `.editor__tab[data-tab-path="${escapedPath}"]`,
      );

      activeTabButton?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, onCursorChange, tabs.length]);

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
    if (!activeTab || !markdownEnabled) {
      return;
    }

    setPreviewByPath((value) => ({
      ...value,
      [activeTab.absPath]: !value[activeTab.absPath],
    }));
  }

  return (
    <section className="editor">
      <header className="editor__tabs">
        <div className="editor__tab-list" onWheel={handleTabListWheel} ref={tabListRef}>
          {tabs.map((tab) => {
            const isActive = tab.absPath === activeTab?.absPath;
            const isDirty = tab.content !== tab.savedContent;

            return (
              <button
                className="editor__tab"
                data-active={isActive}
                data-tab-path={tab.absPath}
                key={tab.absPath}
                onClick={() => onSelectTab(tab.absPath)}
                type="button"
              >
                <span className="editor__tab-icon">
                  <FileIcon fileName={tab.name} size="compact" />
                </span>
                <span className="editor__tab-name">{tab.name}</span>
                {isDirty ? <Circle className="editor__tab-dirty" size={8} strokeWidth={4} /> : null}
                <X
                  className="editor__tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.absPath);
                  }}
                  size={12}
                />
              </button>
            );
          })}
        </div>

        <div className="editor__tab-actions">
          {activeTab && markdownEnabled ? (
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

      <div className="editor__surface">
        {activeTab && isPreviewMode ? (
          <article
            className="editor__markdown"
            dangerouslySetInnerHTML={{ __html: markdownHtml }}
          />
        ) : activeTab ? (
          <Editor
            className="editor__monaco"
            language={language}
            onChange={(value) => onContentChange(value ?? "")}
            onMount={handleEditorMount}
            options={editorOptions}
            path={activeTab.absPath}
            theme={MONACO_THEME}
            value={activeTab.content}
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
