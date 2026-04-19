import { invoke } from "@tauri-apps/api/core";
import { DiffEditor } from "@monaco-editor/react";
import { LoaderCircle, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { IDisposable, editor } from "monaco-editor";
import type { GitDiffResult } from "../../types";
import { MONACO_THEME, resolveEditorLanguage } from "../Editor/monaco";

const GIT_DIFF_EDITOR_OPTIONS: editor.IDiffEditorConstructionOptions = {
  automaticLayout: true,
  codeLens: false,
  contextmenu: true,
  diffCodeLens: false,
  enableSplitViewResizing: false,
  fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
  fontSize: 13,
  glyphMargin: false,
  lineDecorationsWidth: 12,
  lineNumbersMinChars: 4,
  minimap: { enabled: false },
  originalEditable: false,
  padding: { bottom: 12, top: 12 },
  readOnly: false,
  renderIndicators: false,
  renderMarginRevertIcon: false,
  renderOverviewRuler: false,
  renderSideBySide: true,
  scrollBeyondLastLine: false,
  scrollbar: {
    alwaysConsumeMouseWheel: false,
    horizontalScrollbarSize: 8,
    verticalScrollbarSize: 8,
  },
  splitViewDefaultRatio: 0.5,
  useInlineViewWhenSpaceIsLimited: false,
  wordWrap: "off",
};

interface GitDiffViewerPaneProps {
  result: GitDiffResult;
  onFilesChanged?: (payload: { paths: string[] }) => Promise<void>;
  onDirtyStateChange?: (dirty: boolean) => void;
}

interface EditableDraft {
  path: string;
  baseContent: string;
  content: string;
}

export function GitDiffViewerPane({
  result,
  onFilesChanged,
  onDirtyStateChange,
}: GitDiffViewerPaneProps) {
  const fileName = getDisplayFileName(result.path);
  const language = resolveEditorLanguage(fileName);
  const hasTextPreview = result.originalContent !== null && result.modifiedContent !== null;
  const [draft, setDraft] = useState<EditableDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const draftRef = useRef<EditableDraft | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);
  const leftLabel = result.status === "added" ? "Empty" : "HEAD";
  const rightLabel = result.status === "deleted" ? "Empty" : "Workspace";
  const modifiedContent = draft?.content ?? result.modifiedContent ?? "";
  const isDirty = Boolean(draft && draft.content !== draft.baseContent);
  const saveTitle = !hasTextPreview
    ? "This file does not expose a text preview."
    : isDirty
      ? "Save the current Workspace content to disk and refresh the Git diff."
      : "No unsaved edits in Workspace.";

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!hasTextPreview || result.modifiedContent === null) {
      setDraft(null);
      return;
    }

    const nextModifiedContent = result.modifiedContent;
    setDraft((currentDraft) => syncEditableDraft(currentDraft, result.absPath, nextModifiedContent));
  }, [hasTextPreview, result.absPath, result.modifiedContent]);

  useEffect(() => {
    onDirtyStateChange?.(isDirty);
  }, [isDirty, onDirtyStateChange]);

  useEffect(
    () => () => {
      onDirtyStateChange?.(false);
      for (const disposable of disposablesRef.current) {
        disposable.dispose();
      }
      disposablesRef.current = [];
    },
    [onDirtyStateChange],
  );

  function handleDiffEditorMount(
    mountedEditor: editor.IStandaloneDiffEditor,
    monacoNamespace: typeof import("monaco-editor"),
  ) {
    for (const disposable of disposablesRef.current) {
      disposable.dispose();
    }

    const modifiedEditor = mountedEditor.getModifiedEditor();
    disposablesRef.current = [
      modifiedEditor.onDidChangeModelContent(() => {
        setDraft((currentDraft) => updateEditableDraft(currentDraft, modifiedEditor.getValue()));
      }),
    ];
    modifiedEditor.addCommand(
      monacoNamespace.KeyMod.CtrlCmd | monacoNamespace.KeyCode.KeyS,
      () => {
        void handleSave();
      },
    );
  }

  async function handleSave() {
    const currentDraft = draftRef.current;
    if (!currentDraft || currentDraft.content === currentDraft.baseContent) {
      setFeedback({
        text: "No unsaved edits in Workspace.",
        tone: "info",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      await invoke("write_file", {
        content: currentDraft.content,
        filePath: result.absPath,
        rootPath: result.rootPath,
      });

      setDraft({
        path: result.absPath,
        baseContent: currentDraft.content,
        content: currentDraft.content,
      });
      await onFilesChanged?.({
        paths: [result.absPath],
      });
      setFeedback({
        text: "Workspace content saved to disk and refreshed.",
        tone: "info",
      });
    } catch (reason) {
      setFeedback({
        text: reason instanceof Error ? reason.message : String(reason),
        tone: "error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="git-diff-pane">
      <header className="git-diff-pane__header">
        <div className="git-diff-pane__meta">
          <span className="git-diff-pane__status" data-status={result.status}>
            {formatStatusLabel(result.status)}
            {result.group === "unversioned" ? " · Unversioned" : ""}
          </span>
          <span className="git-diff-pane__path" title={result.path}>
            {result.path}
          </span>
          {result.previousPath ? (
            <span className="git-diff-pane__previous-path" title={result.previousPath}>
              from {result.previousPath}
            </span>
          ) : null}
        </div>
        <div className="git-diff-pane__actions">
          {isDirty ? <span className="git-diff-pane__draft">Workspace edited</span> : null}
          <button
            className="git-diff-pane__save-button"
            disabled={!hasTextPreview || !isDirty || isSaving}
            onClick={() => void handleSave()}
            title={saveTitle}
            type="button"
          >
            {isSaving ? <LoaderCircle size={13} /> : <Save size={13} />}
            <span>Save</span>
          </button>
        </div>
      </header>

      {feedback ? (
        <div className="git-diff-pane__feedback" data-tone={feedback.tone}>
          {feedback.text}
        </div>
      ) : null}

      {hasTextPreview ? (
        <div className="git-diff-pane__editor-shell">
          <div className="git-diff-pane__editor-badge git-diff-pane__editor-badge--source">
            {leftLabel}
          </div>
          <div className="git-diff-pane__editor-badge git-diff-pane__editor-badge--target">
            {rightLabel}
          </div>

          <DiffEditor
            className="git-diff-pane__monaco"
            height="100%"
            key={`${result.absPath}:${result.status}:${result.previousPath ?? ""}`}
            modified={modifiedContent}
            modifiedLanguage={language}
            modifiedModelPath={`${result.absPath}#git-modified`}
            onMount={handleDiffEditorMount}
            options={GIT_DIFF_EDITOR_OPTIONS}
            original={result.originalContent ?? ""}
            originalLanguage={language}
            originalModelPath={`${result.absPath}#git-original`}
            theme={MONACO_THEME}
            width="100%"
          />
        </div>
      ) : (
        <div className="git-diff-pane__empty">
          <div className="git-diff-pane__empty-title">Preview unavailable</div>
          <div className="git-diff-pane__empty-copy">{describeUnavailablePreview(result)}</div>
        </div>
      )}
    </section>
  );
}

function getDisplayFileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function formatStatusLabel(status: GitDiffResult["status"]) {
  switch (status) {
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    default:
      return "Modified";
  }
}

function describeUnavailablePreview(result: GitDiffResult) {
  if (result.isBinary) {
    return "Binary files are listed here, but they do not have a text diff preview.";
  }

  if (result.tooLarge) {
    return "This file is larger than the current preview limit.";
  }

  return "A textual diff preview is not available for this file.";
}

function syncEditableDraft(currentDraft: EditableDraft | null, path: string, nextContent: string) {
  if (!currentDraft || currentDraft.path !== path) {
    return {
      path,
      baseContent: nextContent,
      content: nextContent,
    };
  }

  if (currentDraft.baseContent === nextContent) {
    return currentDraft;
  }

  return currentDraft.content === currentDraft.baseContent
    ? {
        path,
        baseContent: nextContent,
        content: nextContent,
      }
    : {
        ...currentDraft,
        baseContent: nextContent,
      };
}

function updateEditableDraft(currentDraft: EditableDraft | null, content: string) {
  if (!currentDraft || currentDraft.content === content) {
    return currentDraft;
  }

  return {
    ...currentDraft,
    content,
  };
}
