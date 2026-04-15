import {
  ChevronRight,
  Circle,
  FileCode2,
  FileJson2,
  FileText,
  X,
} from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, type WheelEvent as ReactWheelEvent } from "react";
import type { editor, IDisposable } from "monaco-editor";
import type { EditorTab } from "../../types";
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
  const breadcrumbs = activeTab?.relPath.split(/[\\/]/).filter(Boolean) ?? [];
  const language = useMemo(() => resolveEditorLanguage(activeTab?.name), [activeTab?.name]);

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
                <span className="editor__tab-icon">{getFileIcon(tab.name)}</span>
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
        {activeTab ? (
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

function getFileIcon(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "css":
    case "html":
      return <FileCode2 size={14} />;
    case "json":
      return <FileJson2 size={14} />;
    default:
      return <FileText size={14} />;
  }
}
