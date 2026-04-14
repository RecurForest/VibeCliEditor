import {
  ChevronRight,
  Circle,
  FileCode2,
  FileJson2,
  FileText,
  Save,
  X,
} from "lucide-react";
import type { ChangeEvent } from "react";
import type { CursorPosition, EditorTab } from "../../types";

interface EditorPaneProps {
  activeTab: EditorTab | null;
  cursor: CursorPosition;
  error: string | null;
  isSaving: boolean;
  onCloseTab: (absPath: string) => void;
  onContentChange: (content: string) => void;
  onCursorChange: (content: string, selectionStart: number) => void;
  onSave: () => Promise<void>;
  onSelectTab: (absPath: string) => void;
  tabs: EditorTab[];
}

export function EditorPane({
  activeTab,
  cursor,
  error,
  isSaving,
  onCloseTab,
  onContentChange,
  onCursorChange,
  onSave,
  onSelectTab,
  tabs,
}: EditorPaneProps) {
  const activeContent = activeTab?.content ?? "";
  const lineCount = Math.max(1, activeContent.split("\n").length);
  const language = getLanguageLabel(activeTab?.name);
  const breadcrumbs = activeTab?.relPath.split(/[\\/]/).filter(Boolean) ?? [];

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextContent = event.currentTarget.value;
    onContentChange(nextContent);
    onCursorChange(nextContent, event.currentTarget.selectionStart);
  }

  return (
    <section className="editor">
      <header className="editor__tabs">
        <div className="editor__tab-list">
          {tabs.map((tab) => {
            const isActive = tab.absPath === activeTab?.absPath;
            const isDirty = tab.content !== tab.savedContent;

            return (
              <button
                className="editor__tab"
                data-active={isActive}
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

        <button className="editor__save" onClick={() => void onSave()} type="button">
          <Save size={14} />
          {isSaving ? "Saving" : "Save"}
        </button>
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
          <div className="editor__code">
            <div className="editor__line-numbers" aria-hidden="true">
              {Array.from({ length: lineCount }).map((_, index) => (
                <div className="editor__line-number" key={index + 1}>
                  {index + 1}
                </div>
              ))}
            </div>

            <textarea
              className="editor__textarea"
              onChange={handleChange}
              onClick={(event) =>
                onCursorChange(event.currentTarget.value, event.currentTarget.selectionStart)
              }
              onKeyUp={(event) =>
                onCursorChange(event.currentTarget.value, event.currentTarget.selectionStart)
              }
              spellCheck={false}
              value={activeContent}
            />
          </div>
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

      <div className="editor__footer">
        <span>{language}</span>
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
      </div>
    </section>
  );
}

function getLanguageLabel(fileName?: string) {
  if (!fileName) {
    return "Plain Text";
  }

  const extension = fileName.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "ts":
    case "tsx":
      return "TypeScript";
    case "js":
    case "jsx":
      return "JavaScript";
    case "json":
      return "JSON";
    case "md":
      return "Markdown";
    case "rs":
      return "Rust";
    case "css":
      return "CSS";
    case "html":
      return "HTML";
    default:
      return "Plain Text";
  }
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
