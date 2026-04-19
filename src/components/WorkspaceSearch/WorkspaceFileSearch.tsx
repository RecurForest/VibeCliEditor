import { invoke } from "@tauri-apps/api/core";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Check, ChevronDown, LoaderCircle, Save, Search, X } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { editor } from "monaco-editor";
import type { FileSearchResult, TextSearchResult } from "../../types";
import { MONACO_THEME, resolveEditorLanguage } from "../Editor/monaco";

const SEARCH_DEBOUNCE_MS = 320;
const MIN_SEARCH_LENGTH = 2;
const TEXT_FILE_MASK_ALL = "*";
const COMMON_TEXT_FILE_MASKS = [
  TEXT_FILE_MASK_ALL,
  "*.js",
  "*.ts",
  "*.tsx",
  "*.jsx",
  "*.vue",
  "*.scss",
  "*.css",
  "*.json",
  "*.md",
  "*.yml",
  "*.yaml",
  "*.html",
  "*.cjs",
  "*.mjs",
  "*.cts",
  "*.mts",
  "*.rs",
  "*.py",
  "*.java",
] as const;

type WorkspaceSearchMode = "files" | "text";

export interface WorkspaceSearchShortcutRequest {
  sequence: number;
  mode?: WorkspaceSearchMode;
  query?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

interface WorkspaceFileSearchProps {
  activeEditorRelPath?: string | null;
  rootPath: string | null;
  onJumpToActiveEditorLocation?: (target: { line: number; column?: number }) => Promise<void> | void;
  onOpenFileResult: (result: FileSearchResult) => Promise<void> | void;
  onOpenTextResult: (result: TextSearchResult) => Promise<void> | void;
  onPreviewFileSaved?: (payload: { paths: string[] }) => Promise<void> | void;
  shortcutRequest?: WorkspaceSearchShortcutRequest | null;
}

interface EditableDraft {
  baseContent: string;
  content: string;
}

export function WorkspaceFileSearch({
  activeEditorRelPath,
  rootPath,
  onJumpToActiveEditorLocation,
  onOpenFileResult,
  onOpenTextResult,
  onPreviewFileSaved,
  shortcutRequest,
}: WorkspaceFileSearchProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const maskMenuRef = useRef<HTMLDivElement | null>(null);
  const previewEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const previewMonacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const previewDecorationIdsRef = useRef<string[]>([]);
  const previewRequestIdRef = useRef(0);
  const previewDraftsRef = useRef<Record<string, EditableDraft>>({});
  const highlightedTextResultRef = useRef<TextSearchResult | null>(null);
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<WorkspaceSearchMode>("files");
  const [textFileMask, setTextFileMask] = useState(TEXT_FILE_MASK_ALL);
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const [textResults, setTextResults] = useState<TextSearchResult[]>([]);
  const [previewContentByPath, setPreviewContentByPath] = useState<Record<string, EditableDraft>>({});
  const [isOpen, setIsOpen] = useState(false);
  const [isMaskMenuOpen, setIsMaskMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTextSelectionLocked, setIsTextSelectionLocked] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPreviewSaving, setIsPreviewSaving] = useState(false);
  const [previewFeedback, setPreviewFeedback] = useState<{
    text: string;
    tone: "error" | "info";
  } | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [previewEditorEpoch, setPreviewEditorEpoch] = useState(0);
  const [isLineJumpShortcutActive, setIsLineJumpShortcutActive] = useState(false);
  const [previewReloadVersion, setPreviewReloadVersion] = useState(0);

  const trimmedQuery = query.trim();
  const lineJumpTarget = useMemo(
    () => parseLineJumpQuery(trimmedQuery, isLineJumpShortcutActive),
    [isLineJumpShortcutActive, trimmedQuery],
  );
  const canSearch = Boolean(rootPath);
  const canJumpToActiveEditorLine = Boolean(activeEditorRelPath && onJumpToActiveEditorLocation);
  const canRunSearch = !lineJumpTarget && trimmedQuery.length >= MIN_SEARCH_LENGTH;
  const shouldShowPanel = isOpen && canSearch;
  const activeResultCount = mode === "files" ? fileResults.length : textResults.length;
  const textFileMaskOptions = useMemo(() => {
    const dynamicMasks = textResults
      .map((result) => extractTextResultFileMask(result))
      .filter((value): value is string => Boolean(value));

    return Array.from(
      new Set([TEXT_FILE_MASK_ALL, textFileMask, ...COMMON_TEXT_FILE_MASKS, ...dynamicMasks]),
    );
  }, [textFileMask, textResults]);
  const highlightedFileResult = useMemo(
    () => (mode === "files" ? fileResults[highlightedIndex] ?? fileResults[0] ?? null : null),
    [fileResults, highlightedIndex, mode],
  );
  const highlightedTextResult = useMemo(
    () => (mode === "text" ? textResults[highlightedIndex] ?? textResults[0] ?? null : null),
    [highlightedIndex, mode, textResults],
  );
  const previewContent = highlightedTextResult
    ? previewContentByPath[highlightedTextResult.absPath]?.content
    : undefined;
  const isPreviewDirty = Boolean(
    highlightedTextResult &&
      previewContentByPath[highlightedTextResult.absPath] &&
      previewContentByPath[highlightedTextResult.absPath]!.content !==
        previewContentByPath[highlightedTextResult.absPath]!.baseContent,
  );
  const previewLanguage = useMemo(
    () => resolveEditorLanguage(highlightedTextResult?.name),
    [highlightedTextResult?.name],
  );
  const jumpTargetLabel = useMemo(() => {
    if (!lineJumpTarget) {
      return null;
    }

    return lineJumpTarget.column > 1
      ? `Line ${lineJumpTarget.line}, Column ${lineJumpTarget.column}`
      : `Line ${lineJumpTarget.line}`;
  }, [lineJumpTarget]);
  const previewEditorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      contextmenu: true,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 11,
      glyphMargin: false,
      lineHeight: 18,
      lineNumbers: "on",
      lineNumbersMinChars: 4,
      minimap: { enabled: false },
      padding: { top: 10, bottom: 16 },
      readOnly: false,
      renderLineHighlight: "none",
      roundedSelection: false,
      scrollBeyondLastLine: false,
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        horizontalScrollbarSize: 8,
        verticalScrollbarSize: 8,
      },
      selectionHighlight: false,
      smoothScrolling: true,
      wordWrap: "off",
    }),
    [],
  );
  const emptyMessage = lineJumpTarget
    ? canJumpToActiveEditorLine
      ? activeEditorRelPath
        ? `Press Enter to jump to ${jumpTargetLabel} in ${activeEditorRelPath}.`
        : `Press Enter to jump to ${jumpTargetLabel}.`
      : "Open a text file first, then type :line and press Enter."
    : !canRunSearch
      ? `Type at least ${MIN_SEARCH_LENGTH} characters`
      : isLoading
        ? mode === "files"
          ? "Searching files..."
          : "Searching text..."
        : mode === "files"
          ? "No matching files"
          : "No matching text matches";
  const resultMetaText = lineJumpTarget
    ? canJumpToActiveEditorLine
      ? "Line jump command"
      : "Line jump unavailable"
    : canRunSearch && !isLoading
      ? `${activeResultCount} result${activeResultCount === 1 ? "" : "s"}`
      : emptyMessage;
  const actionMetaText = lineJumpTarget
    ? canJumpToActiveEditorLine
      ? "Enter jumps within the current editor tab."
      : "Line jump only works for an active text editor tab."
    : mode === "files"
      ? "Enter or click opens the file."
      : "Single click previews. Double click opens and collapses.";

  useEffect(() => {
    previewDraftsRef.current = previewContentByPath;
  }, [previewContentByPath]);

  useEffect(() => {
    highlightedTextResultRef.current = highlightedTextResult;
  }, [highlightedTextResult]);

  useEffect(() => {
    previewRequestIdRef.current += 1;
    setPreviewContentByPath({});
    setIsPreviewLoading(false);
    setIsTextSelectionLocked(false);
    setIsPreviewSaving(false);
    setPreviewFeedback(null);
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath) {
      requestIdRef.current += 1;
      setQuery("");
      setFileResults([]);
      setTextResults([]);
      setHighlightedIndex(0);
      setIsLoading(false);
      setIsPreviewLoading(false);
      setIsTextSelectionLocked(false);
      setIsPreviewSaving(false);
      setPreviewFeedback(null);
      setIsOpen(false);
      setIsMaskMenuOpen(false);
      setMode("files");
      setTextFileMask(TEXT_FILE_MASK_ALL);
      setPreviewContentByPath({});
      setIsLineJumpShortcutActive(false);
      return;
    }

    if (lineJumpTarget) {
      requestIdRef.current += 1;
      setFileResults([]);
      setTextResults([]);
      setHighlightedIndex(0);
      setIsLoading(false);
      setIsTextSelectionLocked(false);
      return;
    }

    if (!canRunSearch) {
      requestIdRef.current += 1;
      if (mode === "files") {
        setFileResults([]);
      } else {
        setTextResults([]);
      }
      setHighlightedIndex(0);
      setIsLoading(false);
      setIsTextSelectionLocked(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);

      try {
        if (mode === "files") {
          const nextResults = await invoke<FileSearchResult[]>("search_files", {
            query: trimmedQuery,
            rootPath,
          });

          if (requestIdRef.current === currentRequestId) {
            setFileResults(nextResults);
            setHighlightedIndex(0);
          }
        } else {
          const nextResults = await invoke<TextSearchResult[]>("search_text_in_files", {
            fileMask: textFileMask === TEXT_FILE_MASK_ALL ? null : textFileMask,
            query: trimmedQuery,
            rootPath,
          });

          if (requestIdRef.current === currentRequestId) {
            setTextResults(nextResults);
            setHighlightedIndex(0);
            setIsTextSelectionLocked(false);
          }
        }
      } catch {
        if (requestIdRef.current === currentRequestId) {
          if (mode === "files") {
            setFileResults([]);
          } else {
            setTextResults([]);
          }
          setHighlightedIndex(0);
          setIsTextSelectionLocked(false);
        }
      } finally {
        if (requestIdRef.current === currentRequestId) {
          setIsLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canRunSearch, lineJumpTarget, mode, previewReloadVersion, rootPath, textFileMask, trimmedQuery]);

  useEffect(() => {
    if (!shortcutRequest || !canSearch) {
      return;
    }

    setIsLineJumpShortcutActive(
      shortcutRequest.mode === "files" && typeof shortcutRequest.query === "string"
        ? shortcutRequest.query.trim() === ":"
        : false,
    );

    if (shortcutRequest.mode) {
      setMode(shortcutRequest.mode);
    }

    if (typeof shortcutRequest.query === "string") {
      setQuery(shortcutRequest.query);
    }

    setHighlightedIndex(0);
    setIsTextSelectionLocked(false);
    setIsMaskMenuOpen(false);
    setPreviewFeedback(null);
    setIsOpen(true);

    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }

      input.focus();

      const queryValue =
        typeof shortcutRequest.query === "string" ? shortcutRequest.query : input.value;
      const maxSelectionIndex = queryValue.length;
      const selectionStart = Math.min(
        Math.max(shortcutRequest.selectionStart ?? maxSelectionIndex, 0),
        maxSelectionIndex,
      );
      const selectionEnd = Math.min(
        Math.max(shortcutRequest.selectionEnd ?? selectionStart, selectionStart),
        maxSelectionIndex,
      );

      input.setSelectionRange(selectionStart, selectionEnd);
    });
  }, [canSearch, shortcutRequest]);

  useEffect(() => {
    const maxIndex = Math.max(activeResultCount - 1, 0);
    setHighlightedIndex((value) => Math.min(value, maxIndex));
  }, [activeResultCount]);

  useEffect(
    () => () => {
      if (!previewEditorRef.current || !previewDecorationIdsRef.current.length) {
        return;
      }

      previewEditorRef.current.deltaDecorations(previewDecorationIdsRef.current, []);
    },
    [],
  );

  useEffect(() => {
    if (!isMaskMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!maskMenuRef.current?.contains(target)) {
        setIsMaskMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isMaskMenuOpen]);

  useEffect(() => {
    if (!rootPath || mode !== "text" || !highlightedTextResult) {
      setIsPreviewLoading(false);
      return;
    }

    if (previewContentByPath[highlightedTextResult.absPath] !== undefined) {
      setIsPreviewLoading(false);
      return;
    }

    const currentRequestId = ++previewRequestIdRef.current;
    setIsPreviewLoading(true);

    void invoke<string>("read_file", {
      filePath: highlightedTextResult.absPath,
      rootPath,
    })
      .then((content) => {
        if (previewRequestIdRef.current !== currentRequestId) {
          return;
        }

        setPreviewContentByPath((value) =>
          syncPreviewDrafts(value, highlightedTextResult.absPath, content),
        );
      })
      .catch(() => {
        if (previewRequestIdRef.current !== currentRequestId) {
          return;
        }

        setPreviewContentByPath((value) =>
          syncPreviewDrafts(value, highlightedTextResult.absPath, ""),
        );
      })
      .finally(() => {
        if (previewRequestIdRef.current === currentRequestId) {
          setIsPreviewLoading(false);
        }
      });
  }, [highlightedTextResult, mode, previewContentByPath, rootPath]);

  useEffect(() => {
    if (!highlightedTextResult || typeof previewContent !== "string") {
      return;
    }

    const mountedEditor = previewEditorRef.current;
    const monaco = previewMonacoRef.current;
    const model = mountedEditor?.getModel();

    if (!mountedEditor || !monaco || !model) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const lineNumber = clampLineNumber(highlightedTextResult.line, model.getLineCount());
      const maxColumn = model.getLineMaxColumn(lineNumber);
      const startColumn = clampColumn(highlightedTextResult.column, maxColumn);
      const endColumn = clampEndColumn(
        startColumn,
        highlightedTextResult.matchLength,
        maxColumn,
      );

      previewDecorationIdsRef.current = mountedEditor.deltaDecorations(
        previewDecorationIdsRef.current,
        [
          {
            options: {
              className: "workspace-search__preview-hit-line",
              isWholeLine: true,
              linesDecorationsClassName: "workspace-search__preview-hit-gutter",
            },
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          },
          {
            options: {
              inlineClassName: "workspace-search__preview-hit-inline",
            },
            range: new monaco.Range(lineNumber, startColumn, lineNumber, endColumn),
          },
        ],
      );

      mountedEditor.setPosition({ lineNumber, column: startColumn });
      mountedEditor.revealLineInCenter(lineNumber);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [highlightedTextResult, previewContent, previewEditorEpoch]);

  useEffect(() => {
    setPreviewFeedback(null);
  }, [highlightedTextResult?.absPath]);

  function clearAndClose() {
    requestIdRef.current += 1;
    previewRequestIdRef.current += 1;
    setQuery("");
    setFileResults([]);
    setTextResults([]);
    setHighlightedIndex(0);
    setIsLoading(false);
    setIsPreviewLoading(false);
    setIsPreviewSaving(false);
    setIsTextSelectionLocked(false);
    setIsLineJumpShortcutActive(false);
    setIsOpen(false);
    setIsMaskMenuOpen(false);
    setPreviewFeedback(null);
  }

  async function handleFileResultOpen(result: FileSearchResult) {
    await onOpenFileResult(result);
    clearAndClose();
  }

  async function handleTextResultOpen(result: TextSearchResult) {
    await onOpenTextResult(result);
    clearAndClose();
  }

  async function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (lineJumpTarget) {
        return;
      }

      event.preventDefault();
      if (!activeResultCount) {
        return;
      }

      setIsOpen(true);
      setIsTextSelectionLocked(false);
      setHighlightedIndex((value) => (value + 1) % activeResultCount);
      return;
    }

    if (event.key === "ArrowUp") {
      if (lineJumpTarget) {
        return;
      }

      event.preventDefault();
      if (!activeResultCount) {
        return;
      }

      setIsOpen(true);
      setIsTextSelectionLocked(false);
      setHighlightedIndex((value) => (value - 1 + activeResultCount) % activeResultCount);
      return;
    }

    if (event.key === "Enter") {
      if (lineJumpTarget) {
        event.preventDefault();
        if (!canJumpToActiveEditorLine || !onJumpToActiveEditorLocation) {
          setIsOpen(true);
          return;
        }

        await onJumpToActiveEditorLocation(lineJumpTarget);
        clearAndClose();
        return;
      }

      if (mode === "files" && highlightedFileResult) {
        event.preventDefault();
        await handleFileResultOpen(highlightedFileResult);
        return;
      }

      if (mode === "text" && highlightedTextResult) {
        event.preventDefault();
        await handleTextResultOpen(highlightedTextResult);
      }
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  function handleModeChange(nextMode: WorkspaceSearchMode) {
    setMode(nextMode);
    setHighlightedIndex(0);
    setIsMaskMenuOpen(false);
    setIsTextSelectionLocked(false);
    setIsLineJumpShortcutActive(false);
    setPreviewFeedback(null);
    setIsOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  const handlePreviewEditorMount: OnMount = (mountedEditor, monaco) => {
    previewEditorRef.current = mountedEditor;
    previewMonacoRef.current = monaco;
    setPreviewEditorEpoch((value) => value + 1);
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void handlePreviewSave();
    });
  };

  function handlePreviewContentChange(content: string) {
    const currentPreview = highlightedTextResultRef.current;
    if (!currentPreview) {
      return;
    }

    setPreviewFeedback(null);
    setPreviewContentByPath((value) =>
      updatePreviewDraft(value, currentPreview.absPath, content),
    );
  }

  async function handlePreviewSave() {
    if (!rootPath) {
      return;
    }

    const currentPreview = highlightedTextResultRef.current;
    if (!currentPreview) {
      return;
    }

    const currentDraft = previewDraftsRef.current[currentPreview.absPath];
    if (!currentDraft || currentDraft.content === currentDraft.baseContent) {
      setPreviewFeedback({
        text: "No unsaved edits in preview.",
        tone: "info",
      });
      return;
    }

    setIsPreviewSaving(true);
    setPreviewFeedback(null);

    try {
      await invoke("write_file", {
        content: currentDraft.content,
        filePath: currentPreview.absPath,
        rootPath,
      });

      setPreviewContentByPath((value) =>
        markPreviewDraftSaved(value, currentPreview.absPath, currentDraft.content),
      );
      await onPreviewFileSaved?.({
        paths: [currentPreview.absPath],
      });
      setPreviewFeedback({
        text: "Preview changes saved to disk.",
        tone: "info",
      });
      setPreviewReloadVersion((value) => value + 1);
    } catch (reason) {
      setPreviewFeedback({
        text: reason instanceof Error ? reason.message : String(reason),
        tone: "error",
      });
    } finally {
      setIsPreviewSaving(false);
    }
  }

  return (
    <div className="workspace-search" data-no-drag="true" data-open={shouldShowPanel}>
      <label className="workspace-search__field" htmlFor={inputId}>
        <Search className="workspace-search__icon" size={14} />
        <input
          autoComplete="off"
          className="workspace-search__input"
          disabled={!canSearch}
          id={inputId}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsTextSelectionLocked(false);
            setPreviewFeedback(null);
            setIsOpen(true);
          }}
          onClick={() => setIsOpen(true)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => void handleInputKeyDown(event)}
          placeholder={
            canSearch
              ? mode === "files"
                ? "Search files or type :line"
                : "Search text or type :line"
              : "Open a workspace to search"
          }
          ref={inputRef}
          type="text"
          value={query}
        />
        {isLoading ? <LoaderCircle className="workspace-search__spinner" size={13} /> : null}
      </label>

      {shouldShowPanel ? (
        <div className="workspace-search__panel">
          <div className="workspace-search__panel-header">
            <div className="workspace-search__modes" role="tablist" aria-label="Workspace search mode">
              <button
                aria-selected={mode === "files"}
                className="workspace-search__mode"
                data-active={mode === "files"}
                onClick={() => handleModeChange("files")}
                role="tab"
                type="button"
              >
                Files
              </button>
              <button
                aria-selected={mode === "text"}
                className="workspace-search__mode"
                data-active={mode === "text"}
                onClick={() => handleModeChange("text")}
                role="tab"
                type="button"
              >
                Text
              </button>
            </div>

            <div className="workspace-search__panel-actions">
              {mode === "text" && !lineJumpTarget ? (
                <div className="workspace-search__mask" ref={maskMenuRef}>
                  <span className="workspace-search__mask-label">File mask</span>
                  <button
                    aria-expanded={isMaskMenuOpen}
                    className="workspace-search__mask-trigger"
                    onClick={() => setIsMaskMenuOpen((value) => !value)}
                    type="button"
                  >
                    <span className="workspace-search__mask-trigger-value">
                      {formatTextFileMask(textFileMask)}
                    </span>
                    <ChevronDown
                      className="workspace-search__mask-trigger-icon"
                      data-open={isMaskMenuOpen}
                      size={14}
                    />
                  </button>

                  {isMaskMenuOpen ? (
                    <div className="workspace-search__mask-menu">
                      {textFileMaskOptions.map((mask) => {
                        const isSelected = mask === textFileMask;

                        return (
                          <button
                            className="workspace-search__mask-option"
                            data-selected={isSelected}
                            key={mask}
                            onClick={() => {
                              setTextFileMask(mask);
                              setHighlightedIndex(0);
                              setIsTextSelectionLocked(false);
                              setIsMaskMenuOpen(false);
                            }}
                            type="button"
                          >
                            <span>{formatTextFileMask(mask)}</span>
                            {isSelected ? <Check size={14} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                className="workspace-search__close"
                onClick={() => setIsOpen(false)}
                title="Collapse search"
                type="button"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="workspace-search__meta">
            <span>{resultMetaText}</span>
            <span>{actionMetaText}</span>
          </div>

          {lineJumpTarget ? (
            <div className="workspace-search__results">
              <div className="workspace-search__empty">{emptyMessage}</div>
            </div>
          ) : mode === "files" ? (
            <div className="workspace-search__results">
              {fileResults.length ? (
                fileResults.map((result, index) => (
                  <button
                    className="workspace-search__result"
                    data-highlighted={index === highlightedIndex}
                    key={result.absPath}
                    onClick={() => void handleFileResultOpen(result)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    title={result.absPath}
                    type="button"
                  >
                    <span className="workspace-search__result-name">{result.name}</span>
                    <span className="workspace-search__result-path">{result.relPath}</span>
                  </button>
                ))
              ) : (
                <div className="workspace-search__empty">{emptyMessage}</div>
              )}
            </div>
          ) : (
            <PanelGroup
              className="workspace-search__text-layout"
              direction="vertical"
            >
              <Panel defaultSize={50} minSize={20}>
                <div className="workspace-search__results workspace-search__results--text">
                  {textResults.length ? (
                    textResults.map((result, index) => {
                      const key = createTextResultKey(result);
                      const isHighlighted = index === highlightedIndex;

                      return (
                        <button
                          className="workspace-search__result workspace-search__result--text"
                          data-highlighted={isHighlighted}
                          key={key}
                          onClick={() => {
                            setHighlightedIndex(index);
                            setIsTextSelectionLocked(true);
                          }}
                          onDoubleClick={() => void handleTextResultOpen(result)}
                          onMouseEnter={() => {
                            if (!isTextSelectionLocked) {
                              setHighlightedIndex(index);
                            }
                          }}
                          title={`${result.relPath}:${result.line}:${result.column}`}
                          type="button"
                        >
                          <span className="workspace-search__result-line">
                            {highlightSearchMatch(result.lineText, trimmedQuery)}
                          </span>
                          <span className="workspace-search__result-file-tag">{result.name}</span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="workspace-search__empty">{emptyMessage}</div>
                  )}
                </div>
              </Panel>

              <PanelResizeHandle
                className="workspace-search__splitter"
                role="separator"
                data-no-drag="true"
                title="Drag to resize preview"
              />

              <Panel defaultSize={50} minSize={20}>
                <div className="workspace-search__preview">
                  {highlightedTextResult ? (
                    <>
                      <div className="workspace-search__preview-header">
                        <div className="workspace-search__preview-meta">
                          <span className="workspace-search__preview-path">
                            {highlightedTextResult.relPath}
                          </span>
                          <span className="workspace-search__preview-location">
                            Ln {highlightedTextResult.line}, Col {highlightedTextResult.column}
                          </span>
                        </div>
                        <div className="workspace-search__preview-actions">
                          {isPreviewDirty ? (
                            <span className="workspace-search__preview-draft">Edited</span>
                          ) : null}
                          <button
                            className="workspace-search__preview-save"
                            disabled={!isPreviewDirty || isPreviewSaving}
                            onClick={() => void handlePreviewSave()}
                            title={
                              isPreviewDirty
                                ? "Save the current preview content to disk."
                                : "No unsaved edits in preview."
                            }
                            type="button"
                          >
                            {isPreviewSaving ? <LoaderCircle size={13} /> : <Save size={13} />}
                            <span>Save</span>
                          </button>
                        </div>
                      </div>

                      <div className="workspace-search__preview-body">
                        {isPreviewLoading && typeof previewContent !== "string" ? (
                          <div className="workspace-search__preview-empty">
                            Loading file preview...
                          </div>
                        ) : (
                          <>
                            {previewFeedback ? (
                              <div
                                className="workspace-search__preview-feedback"
                                data-tone={previewFeedback.tone}
                              >
                                {previewFeedback.text}
                              </div>
                            ) : null}
                            <Editor
                              className="workspace-search__preview-editor"
                              language={previewLanguage}
                              onChange={(value) => handlePreviewContentChange(value ?? "")}
                              onMount={handlePreviewEditorMount}
                              options={previewEditorOptions}
                              path={`${highlightedTextResult.absPath}#workspace-search-preview`}
                              saveViewState={false}
                              theme={MONACO_THEME}
                              value={previewContent ?? ""}
                            />
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="workspace-search__preview-empty">
                      Select a text match to preview it here.
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          )}
        </div>
      ) : null}
    </div>
  );
}

function createTextResultKey(result: TextSearchResult) {
  return `${result.absPath}:${result.line}:${result.column}`;
}

function extractTextResultFileMask(result: TextSearchResult) {
  const match = result.name.toLowerCase().match(/(\.[a-z0-9_-]+)$/i);
  return match ? `*${match[1]}` : null;
}

function formatTextFileMask(mask: string) {
  return mask === TEXT_FILE_MASK_ALL ? "All files" : mask;
}

function highlightSearchMatch(text: string, query: string): ReactNode {
  if (!query) {
    return text;
  }

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const startIndex = normalizedText.indexOf(normalizedQuery);

  if (startIndex === -1) {
    return text;
  }

  const endIndex = startIndex + query.length;
  return (
    <>
      {text.slice(0, startIndex)}
      <span className="workspace-search__match">{text.slice(startIndex, endIndex)}</span>
      {text.slice(endIndex)}
    </>
  );
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

function syncPreviewDrafts(
  currentDrafts: Record<string, EditableDraft>,
  path: string,
  nextContent: string,
) {
  const currentDraft = currentDrafts[path];
  if (!currentDraft) {
    return {
      ...currentDrafts,
      [path]: {
        baseContent: nextContent,
        content: nextContent,
      },
    };
  }

  if (currentDraft.baseContent === nextContent) {
    return currentDrafts;
  }

  return {
    ...currentDrafts,
    [path]:
      currentDraft.content === currentDraft.baseContent
        ? {
            baseContent: nextContent,
            content: nextContent,
          }
        : {
            ...currentDraft,
            baseContent: nextContent,
          },
  };
}

function updatePreviewDraft(
  currentDrafts: Record<string, EditableDraft>,
  path: string,
  content: string,
) {
  const currentDraft = currentDrafts[path];
  if (!currentDraft || currentDraft.content === content) {
    return currentDrafts;
  }

  return {
    ...currentDrafts,
    [path]: {
      ...currentDraft,
      content,
    },
  };
}

function markPreviewDraftSaved(
  currentDrafts: Record<string, EditableDraft>,
  path: string,
  content: string,
) {
  const currentDraft = currentDrafts[path];
  if (!currentDraft) {
    return currentDrafts;
  }

  if (currentDraft.baseContent === content && currentDraft.content === content) {
    return currentDrafts;
  }

  return {
    ...currentDrafts,
    [path]: {
      baseContent: content,
      content,
    },
  };
}

function parseLineJumpQuery(query: string, acceptBareLineNumber = false) {
  const match =
    query.match(/^:\s*(\d+)(?::(\d+))?$/) ??
    (acceptBareLineNumber ? query.match(/^(\d+)(?::(\d+))?$/) : null);
  if (!match) {
    return null;
  }

  const line = Number.parseInt(match[1] ?? "", 10);
  const column = Number.parseInt(match[2] ?? "1", 10);

  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
    return null;
  }

  return {
    line,
    column,
  };
}
