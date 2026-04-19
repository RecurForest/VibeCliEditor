import { invoke } from "@tauri-apps/api/core";
import { DiffEditor } from "@monaco-editor/react";
import { ArrowDown, ArrowUp, LoaderCircle, RotateCcw, Save } from "lucide-react";
import { type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IDisposable, editor } from "monaco-editor";
import type { SessionDiffFile, SessionDiffResult } from "../../types";
import { FileIcon } from "../FileIcon/FileIcon";
import { MONACO_THEME, resolveEditorLanguage } from "../Editor/monaco";

interface DiffViewerPaneProps {
  result: SessionDiffResult;
  sessionTitle?: string | null;
  onSessionDiffFilesChanged?: (payload: {
    paths: string[];
    sessionId: string;
  }) => Promise<void>;
  onDirtyStateChange?: (dirty: boolean) => void;
}

interface DiffPoint {
  modifiedLine: number | null;
  originalLine: number | null;
}

interface DiffFeedback {
  text: string;
  tone: "error" | "info";
}

interface MonacoRangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface MonacoRevertRangeMapping {
  originalRange: MonacoRangeLike;
  modifiedRange: MonacoRangeLike;
}

interface MonacoLineRange {
  endLineNumberExclusive: number;
  startLineNumber: number;
  toExclusiveRange?: () => MonacoRangeLike;
}

interface MonacoLineRangeMapping {
  innerChanges?: MonacoRevertRangeMapping[];
  modified: MonacoLineRange;
  original: MonacoLineRange;
  toRangeMapping?: () => MonacoRevertRangeMapping;
  toRangeMapping2?: (
    originalLines: string[],
    modifiedLines: string[],
  ) => MonacoRevertRangeMapping;
}

interface InternalDiffComputationResult {
  changes2?: MonacoLineRangeMapping[];
}

interface InternalDiffMapping {
  lineRangeMapping: MonacoLineRangeMapping;
}

interface PreparedHunk {
  buildNextContent?: (originalContent: string, modifiedContent: string) => string;
  id: string;
  lineMapping: MonacoLineRangeMapping;
}

interface HunkOverlay {
  anchorLeft: number;
  id: string;
  top: number;
}

interface EditableDraft {
  baseContent: string;
  content: string;
}

type BusyAction = `hunk:${string}` | "file" | "all" | "save" | null;

type DiffEditorWithInternals = editor.IStandaloneDiffEditor & {
  _diffModel?: {
    get?: () =>
      | {
          diff: {
            get: () => {
              mappings: InternalDiffMapping[];
            } | null;
          };
        }
      | null
      | undefined;
  };
  getDiffComputationResult?: () => InternalDiffComputationResult | null;
  revert?: (diff: MonacoLineRangeMapping) => void;
  revertRangeMappings?: (diffs: MonacoRevertRangeMapping[]) => void;
};

const DIFF_EDITOR_OPTIONS: editor.IDiffEditorConstructionOptions = {
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

const HUNK_BUTTON_HEIGHT = 18;
const diffEditorViewStateByFileKey = new Map<string, editor.IDiffEditorViewState>();
const diffFileListScrollLeftBySessionId = new Map<string, number>();
const diffSelectedPathBySessionId = new Map<string, string>();

export function DiffViewerPane({
  result,
  sessionTitle,
  onSessionDiffFilesChanged,
  onDirtyStateChange,
}: DiffViewerPaneProps) {
  void sessionTitle;

  const [selectedPath, setSelectedPath] = useState<string | null>(
    () => diffSelectedPathBySessionId.get(result.sessionId) ?? result.files[0]?.path ?? null,
  );
  const [modifiedDraftsByPath, setModifiedDraftsByPath] = useState<Record<string, EditableDraft>>(
    {},
  );
  const [diffPoints, setDiffPoints] = useState<DiffPoint[]>([]);
  const [lastNavigatedChangeIndex, setLastNavigatedChangeIndex] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [feedback, setFeedback] = useState<DiffFeedback | null>(null);
  const [hunkOverlays, setHunkOverlays] = useState<HunkOverlay[]>([]);
  const [editorEpoch, setEditorEpoch] = useState(0);

  const diffEditorRef = useRef<DiffEditorWithInternals | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const fileStripRef = useRef<HTMLDivElement | null>(null);
  const originalDecorationIdsRef = useRef<string[]>([]);
  const modifiedDecorationIdsRef = useRef<string[]>([]);
  const disposablesRef = useRef<IDisposable[]>([]);
  const selectedFileRef = useRef<SessionDiffFile | null>(null);
  const preparedHunksRef = useRef<PreparedHunk[]>([]);
  const overlayFrameRef = useRef<number | null>(null);
  const diffViewStateKeyRef = useRef<string | null>(null);
  const modifiedDraftsRef = useRef<Record<string, EditableDraft>>({});

  useEffect(() => {
    setSelectedPath((currentPath) => {
      if (currentPath && result.files.some((file) => file.path === currentPath)) {
        return currentPath;
      }

      const persistedPath = diffSelectedPathBySessionId.get(result.sessionId);
      if (persistedPath && result.files.some((file) => file.path === persistedPath)) {
        return persistedPath;
      }

      return result.files[0]?.path ?? null;
    });
  }, [result]);

  useEffect(() => {
    modifiedDraftsRef.current = modifiedDraftsByPath;
  }, [modifiedDraftsByPath]);

  useEffect(() => {
    setModifiedDraftsByPath({});
  }, [result.sessionId]);

  useEffect(() => {
    setModifiedDraftsByPath((currentDrafts) => syncEditableDrafts(currentDrafts, result.files));
  }, [result.files]);

  const hasDirtyDrafts = useMemo(
    () => Object.values(modifiedDraftsByPath).some((draft) => draft.content !== draft.baseContent),
    [modifiedDraftsByPath],
  );

  useEffect(() => {
    onDirtyStateChange?.(hasDirtyDrafts);
  }, [hasDirtyDrafts, onDirtyStateChange]);

  useEffect(
    () => () => {
      onDirtyStateChange?.(false);
    },
    [onDirtyStateChange],
  );

  const selectedFile = result.files.find((file) => file.path === selectedPath) ?? result.files[0] ?? null;
  selectedFileRef.current = selectedFile;
  const diffViewStateKey = selectedFile
    ? createDiffEditorViewStateKey(result.sessionId, selectedFile.absPath)
    : null;
  diffViewStateKeyRef.current = diffViewStateKey;
  const selectedDraft = selectedFile ? modifiedDraftsByPath[selectedFile.path] : null;
  const selectedModifiedContent = selectedDraft?.content ?? selectedFile?.modifiedContent ?? "";

  const selectedFileName = selectedFile ? getDisplayFileName(selectedFile.path) : null;
  const selectedFileLanguage = resolveEditorLanguage(selectedFileName ?? undefined);
  const hasTextPreview =
    selectedFile?.originalContent !== null && selectedFile?.modifiedContent !== null;
  const canNavigateChanges = hasTextPreview && diffPoints.length > 0;
  const isBusy = busyAction !== null;
  const supportedFiles = useMemo(
    () => result.files.filter((file) => canRevertSessionDiffFile(file)),
    [result.files],
  );
  const unsupportedFiles = useMemo(
    () => result.files.filter((file) => !canRevertSessionDiffFile(file)),
    [result.files],
  );
  const canRevertSelectedFile = Boolean(selectedFile && canRevertSessionDiffFile(selectedFile));
  const selectedFileRevertTitle = selectedFile
    ? getSelectedFileRevertTitle(selectedFile)
    : "Select a changed file first.";
  const isSelectedFileDirty = Boolean(
    selectedDraft && selectedDraft.content !== selectedDraft.baseContent,
  );
  const canSaveSelectedFile = hasTextPreview && isSelectedFileDirty && !isBusy;
  const selectedFileSaveTitle = !hasTextPreview
    ? "This file does not expose a text preview."
    : isSelectedFileDirty
      ? "Save the current Target content to disk and refresh the diff."
      : "No unsaved edits in Target.";
  const revertAllTitle =
    supportedFiles.length === 0
      ? "No revertable files are available in this diff."
      : unsupportedFiles.length > 0
        ? `Revert ${supportedFiles.length} supported files and skip ${unsupportedFiles.length} unsupported files.`
        : "Revert every file in this session diff back to Source, save them, and refresh.";
  const changePositionLabel =
    lastNavigatedChangeIndex === null || !diffPoints.length
      ? `${diffPoints.length} changes`
      : `${lastNavigatedChangeIndex + 1} / ${diffPoints.length}`;

  useEffect(() => {
    if (selectedPath) {
      diffSelectedPathBySessionId.set(result.sessionId, selectedPath);
      return;
    }

    diffSelectedPathBySessionId.delete(result.sessionId);
  }, [result.sessionId, selectedPath]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const fileStripElement = fileStripRef.current;
      if (!fileStripElement) {
        return;
      }

      fileStripElement.scrollLeft = diffFileListScrollLeftBySessionId.get(result.sessionId) ?? 0;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [result.sessionId, result.files.length]);

  const handleFileStripWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const fileStripElement = fileStripRef.current;
    if (!fileStripElement || fileStripElement.scrollWidth <= fileStripElement.clientWidth) {
      return;
    }

    const rawDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (rawDelta === 0) {
      return;
    }

    const multiplier =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? fileStripElement.clientWidth
          : 1;
    const previousScrollLeft = fileStripElement.scrollLeft;

    fileStripElement.scrollLeft += rawDelta * multiplier;

    if (fileStripElement.scrollLeft !== previousScrollLeft) {
      event.preventDefault();
    }
  }, []);

  useEffect(() => {
    return () => {
      persistCurrentDiffViewState(diffViewStateKey);
    };
  }, [diffViewStateKey, editorEpoch]);

  const layoutHunkOverlays = useCallback(() => {
    const shellElement = editorShellRef.current;
    const diffEditor = diffEditorRef.current;

    if (!shellElement || !diffEditor || !preparedHunksRef.current.length) {
      setHunkOverlays([]);
      return;
    }

    const originalEditor = diffEditor.getOriginalEditor();
    const modifiedEditor = diffEditor.getModifiedEditor();
    const shellRect = shellElement.getBoundingClientRect();
    const nextOverlays: HunkOverlay[] = [];

    for (const hunk of preparedHunksRef.current) {
      const placement = getHunkPlacement(hunk.lineMapping);
      const targetEditor = placement.side === "modified" ? modifiedEditor : originalEditor;
      const targetDomNode = targetEditor.getDomNode();
      const targetModel = targetEditor.getModel();

      if (!targetDomNode || !targetModel) {
        continue;
      }

      const anchorLine = clampLineNumber(placement.endLineNumber, targetModel.getLineCount());
      const anchorColumn = targetModel.getLineMaxColumn(anchorLine);
      const visiblePosition = targetEditor.getScrolledVisiblePosition({
        column: anchorColumn,
        lineNumber: anchorLine,
      });

      if (!visiblePosition) {
        continue;
      }

      const editorRect = targetDomNode.getBoundingClientRect();
      const blockBottom =
        editorRect.top -
        shellRect.top +
        visiblePosition.top +
        visiblePosition.height;
      const overlayBottom = blockBottom + HUNK_BUTTON_HEIGHT;

      if (overlayBottom < -4 || blockBottom > shellRect.height + 4) {
        continue;
      }

      nextOverlays.push({
        anchorLeft: editorRect.left - shellRect.left + editorRect.width + 2,
        id: hunk.id,
        top: Math.max(0, Math.min(blockBottom, shellRect.height - HUNK_BUTTON_HEIGHT)),
      });
    }

    setHunkOverlays(nextOverlays);
  }, []);

  const scheduleHunkOverlayLayout = useCallback(() => {
    if (overlayFrameRef.current !== null) {
      window.cancelAnimationFrame(overlayFrameRef.current);
    }

    overlayFrameRef.current = window.requestAnimationFrame(() => {
      overlayFrameRef.current = null;
      layoutHunkOverlays();
    });
  }, [layoutHunkOverlays]);

  useEffect(() => {
    setDiffPoints([]);
    setLastNavigatedChangeIndex(null);
    setFeedback(null);
    setHunkOverlays([]);
  }, [selectedPath]);

  useEffect(() => {
    if (!selectedFile || selectedFile.originalContent === null || selectedFile.modifiedContent === null) {
      clearDiffDecorations();
      preparedHunksRef.current = [];
      setDiffPoints([]);
      setHunkOverlays([]);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      refreshDiffEditorState();
      restorePersistedDiffViewState(diffViewStateKey);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [diffViewStateKey, selectedFile, selectedModifiedContent]);

  useEffect(() => {
    function handleWindowResize() {
      scheduleHunkOverlayLayout();
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [scheduleHunkOverlayLayout]);

  useEffect(
    () => () => {
      persistCurrentDiffViewState();
      clearDiffDecorations();
      disposeEditorSubscriptions();
      if (overlayFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayFrameRef.current);
      }
      preparedHunksRef.current = [];
      diffEditorRef.current = null;
      monacoRef.current = null;
    },
    [],
  );

  function handleDiffEditorMount(
    mountedEditor: editor.IStandaloneDiffEditor,
    monacoNamespace: typeof import("monaco-editor"),
  ) {
    const diffEditor = mountedEditor as DiffEditorWithInternals;

    disposeEditorSubscriptions();
    diffEditorRef.current = diffEditor;
    monacoRef.current = monacoNamespace;

    const originalEditor = diffEditor.getOriginalEditor();
    const modifiedEditor = diffEditor.getModifiedEditor();

    disposablesRef.current = [
      diffEditor.onDidUpdateDiff(() => {
        refreshDiffEditorState();
      }),
      diffEditor.onDidChangeModel(() => {
        window.requestAnimationFrame(() => refreshDiffEditorState());
      }),
      originalEditor.onDidScrollChange(() => {
        scheduleHunkOverlayLayout();
      }),
      modifiedEditor.onDidScrollChange(() => {
        scheduleHunkOverlayLayout();
      }),
      originalEditor.onDidLayoutChange(() => {
        scheduleHunkOverlayLayout();
      }),
      modifiedEditor.onDidLayoutChange(() => {
        scheduleHunkOverlayLayout();
      }),
      modifiedEditor.onDidChangeModelContent(() => {
        const currentSelectedFile = selectedFileRef.current;
        if (!currentSelectedFile || currentSelectedFile.modifiedContent === null) {
          return;
        }

        setModifiedDraftsByPath((currentDrafts) =>
          updateEditableDraft(currentDrafts, currentSelectedFile.path, modifiedEditor.getValue()),
        );
      }),
    ];
    modifiedEditor.addCommand(
      monacoNamespace.KeyMod.CtrlCmd | monacoNamespace.KeyCode.KeyS,
      () => {
        void handleSaveSelectedFile();
      },
    );

    window.requestAnimationFrame(() => {
      refreshDiffEditorState();
      restorePersistedDiffViewState(diffViewStateKeyRef.current);
    });
  }

  function handleNavigateDiff(direction: 1 | -1) {
    if (!diffPoints.length) {
      return;
    }

    const nextIndex =
      lastNavigatedChangeIndex === null
        ? direction > 0
          ? 0
          : diffPoints.length - 1
        : (lastNavigatedChangeIndex + direction + diffPoints.length) % diffPoints.length;
    const nextPoint = diffPoints[nextIndex];

    revealDiffPoint(nextPoint);
    setLastNavigatedChangeIndex(nextIndex);
  }

  function refreshDiffEditorState() {
    const diffEditor = diffEditorRef.current;
    const monaco = monacoRef.current;
    const nextSelectedFile = selectedFileRef.current;

    if (
      !diffEditor ||
      !monaco ||
      !nextSelectedFile ||
      nextSelectedFile.originalContent === null ||
      nextSelectedFile.modifiedContent === null
    ) {
      clearDiffDecorations();
      preparedHunksRef.current = [];
      setDiffPoints([]);
      setHunkOverlays([]);
      return;
    }

    const originalEditor = diffEditor.getOriginalEditor();
    const modifiedEditor = diffEditor.getModifiedEditor();
    const originalModel = originalEditor.getModel();
    const modifiedModel = modifiedEditor.getModel();

    if (!originalModel || !modifiedModel) {
      clearDiffDecorations();
      preparedHunksRef.current = [];
      setDiffPoints([]);
      setHunkOverlays([]);
      return;
    }

    const modelsReady =
      originalModel.getValue() === nextSelectedFile.originalContent &&
      modifiedModel.getValue() ===
        (modifiedDraftsRef.current[nextSelectedFile.path]?.content ?? nextSelectedFile.modifiedContent);

    if (!modelsReady) {
      clearDiffDecorations();
      preparedHunksRef.current = [];
      setDiffPoints([]);
      setHunkOverlays([]);
      return;
    }

    const lineChanges = diffEditor.getLineChanges() ?? [];
    const preparedHunks = getPreparedHunks(diffEditor, originalModel, modifiedModel);
    const originalLineCount = getLineCount(nextSelectedFile.originalContent);
    const modifiedLineCount = getLineCount(
      modifiedDraftsRef.current[nextSelectedFile.path]?.content ?? nextSelectedFile.modifiedContent,
    );
    const originalDecorations: editor.IModelDeltaDecoration[] = [];
    const modifiedDecorations: editor.IModelDeltaDecoration[] = [];
    const nextDiffPoints: DiffPoint[] = [];

    for (const lineChange of lineChanges) {
      const hasOriginal = hasLineRange(
        lineChange.originalStartLineNumber,
        lineChange.originalEndLineNumber,
      );
      const hasModified = hasLineRange(
        lineChange.modifiedStartLineNumber,
        lineChange.modifiedEndLineNumber,
      );

      nextDiffPoints.push({
        modifiedLine: hasModified
          ? lineChange.modifiedStartLineNumber
          : clampLineNumber(lineChange.originalStartLineNumber, modifiedLineCount),
        originalLine: hasOriginal
          ? lineChange.originalStartLineNumber
          : clampLineNumber(lineChange.modifiedStartLineNumber, originalLineCount),
      });

      if (hasOriginal) {
        originalDecorations.push(
          createWholeLineDecoration(
            monaco,
            lineChange.originalStartLineNumber,
            lineChange.originalEndLineNumber,
            "delete",
          ),
        );
      }

      if (hasModified) {
        modifiedDecorations.push(
          createWholeLineDecoration(
            monaco,
            lineChange.modifiedStartLineNumber,
            lineChange.modifiedEndLineNumber,
            "insert",
          ),
        );
      }

      for (const charChange of lineChange.charChanges ?? []) {
        if (hasColumnRange(charChange.originalStartColumn, charChange.originalEndColumn)) {
          originalDecorations.push(
            createCharacterDecoration(
              monaco,
              charChange.originalStartLineNumber,
              charChange.originalStartColumn,
              charChange.originalEndLineNumber,
              charChange.originalEndColumn,
              "delete",
            ),
          );
        }

        if (hasColumnRange(charChange.modifiedStartColumn, charChange.modifiedEndColumn)) {
          modifiedDecorations.push(
            createCharacterDecoration(
              monaco,
              charChange.modifiedStartLineNumber,
              charChange.modifiedStartColumn,
              charChange.modifiedEndLineNumber,
              charChange.modifiedEndColumn,
              "insert",
            ),
          );
        }
      }
    }

    originalDecorationIdsRef.current = originalEditor.deltaDecorations(
      originalDecorationIdsRef.current,
      originalDecorations,
    );
    modifiedDecorationIdsRef.current = modifiedEditor.deltaDecorations(
      modifiedDecorationIdsRef.current,
      modifiedDecorations,
    );

    preparedHunksRef.current = preparedHunks;
    setDiffPoints(nextDiffPoints);
    scheduleHunkOverlayLayout();

    setLastNavigatedChangeIndex((currentIndex) => {
      if (!nextDiffPoints.length || currentIndex === null) {
        return null;
      }

      return currentIndex >= nextDiffPoints.length ? nextDiffPoints.length - 1 : currentIndex;
    });
  }

  function clearDiffDecorations() {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) {
      originalDecorationIdsRef.current = [];
      modifiedDecorationIdsRef.current = [];
      return;
    }

    originalDecorationIdsRef.current = diffEditor
      .getOriginalEditor()
      .deltaDecorations(originalDecorationIdsRef.current, []);
    modifiedDecorationIdsRef.current = diffEditor
      .getModifiedEditor()
      .deltaDecorations(modifiedDecorationIdsRef.current, []);
  }

  function disposeEditorSubscriptions() {
    for (const disposable of disposablesRef.current) {
      disposable.dispose();
    }

    disposablesRef.current = [];
  }

  function revealDiffPoint(diffPoint: DiffPoint) {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) {
      return;
    }

    const originalEditor = diffEditor.getOriginalEditor();
    const modifiedEditor = diffEditor.getModifiedEditor();

    if (diffPoint.originalLine) {
      originalEditor.revealLineInCenter(diffPoint.originalLine);
    }

    if (diffPoint.modifiedLine) {
      modifiedEditor.revealLineInCenter(diffPoint.modifiedLine);
    }

    const targetEditor = diffPoint.modifiedLine ? modifiedEditor : originalEditor;
    targetEditor.focus();
    targetEditor.setPosition({
      column: 1,
      lineNumber: diffPoint.modifiedLine ?? diffPoint.originalLine ?? 1,
    });
  }

  function persistCurrentDiffViewState(viewStateKey = diffViewStateKeyRef.current) {
    if (!viewStateKey) {
      return;
    }

    const viewState = diffEditorRef.current?.saveViewState();
    if (!viewState) {
      return;
    }

    diffEditorViewStateByFileKey.set(viewStateKey, viewState);
  }

  function restorePersistedDiffViewState(viewStateKey: string | null) {
    if (!viewStateKey) {
      return;
    }

    const diffEditor = diffEditorRef.current;
    const viewState = diffEditorViewStateByFileKey.get(viewStateKey);
    if (!diffEditor || !viewState) {
      return;
    }

    diffEditor.restoreViewState(viewState);
    scheduleHunkOverlayLayout();
  }

  async function handleRevertHunk(hunkId: string) {
    const selected = selectedFileRef.current;
    const diffEditor = diffEditorRef.current;
    const preparedHunk = preparedHunksRef.current.find((hunk) => hunk.id === hunkId);
    const modifiedModel = diffEditor?.getModifiedEditor().getModel();

    if (!selected || !preparedHunk || !diffEditor || !modifiedModel) {
      setFeedback({
        text: "The diff hunk could not be resolved. Refresh the diff and try again.",
        tone: "error",
      });
      return;
    }

    if (!canApplyPreparedHunkRevert(preparedHunk, diffEditor)) {
      setFeedback({
        text: "The diff hunk could not be resolved. Refresh the diff and try again.",
        tone: "error",
      });
      return;
    }

    setBusyAction(`hunk:${hunkId}`);
    setFeedback(null);

    try {
      const nextContent = buildPreparedHunkContent(preparedHunk, diffEditor);

      try {
        await persistRevertedContent(selected, nextContent, result.rootPath);
      } catch (reason) {
        setEditorEpoch((value) => value + 1);
        throw reason;
      }

      setModifiedDraftsByPath((currentDrafts) =>
        markEditableDraftSaved(currentDrafts, selected.path, nextContent),
      );

      if (onSessionDiffFilesChanged) {
        await onSessionDiffFilesChanged({
          paths: [selected.absPath],
          sessionId: result.sessionId,
        });
      }

      setFeedback({
        text: "Hunk reverted, saved to disk, and refreshed.",
        tone: "info",
      });
    } catch (reason) {
      setFeedback({
        text: reason instanceof Error ? reason.message : String(reason),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveSelectedFile() {
    const selected = selectedFileRef.current;
    if (!selected || selected.modifiedContent === null) {
      return;
    }

    const currentDraft = modifiedDraftsRef.current[selected.path];
    if (!currentDraft || currentDraft.content === currentDraft.baseContent) {
      setFeedback({
        text: "No unsaved edits in Target.",
        tone: "info",
      });
      return;
    }

    setBusyAction("save");
    setFeedback(null);

    try {
      await invoke("write_file", {
        content: currentDraft.content,
        filePath: selected.absPath,
        rootPath: result.rootPath,
      });

      setModifiedDraftsByPath((currentDrafts) =>
        markEditableDraftSaved(currentDrafts, selected.path, currentDraft.content),
      );

      if (onSessionDiffFilesChanged) {
        await onSessionDiffFilesChanged({
          paths: [selected.absPath],
          sessionId: result.sessionId,
        });
      }

      setFeedback({
        text: "Target saved to disk and refreshed.",
        tone: "info",
      });
    } catch (reason) {
      setFeedback({
        text: reason instanceof Error ? reason.message : String(reason),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevertSelectedFile() {
    if (!selectedFile) {
      return;
    }

    await handleRevertFiles([selectedFile], "file");
  }

  async function handleRevertAllFiles() {
    await handleRevertFiles(result.files, "all");
  }

  async function handleRevertFiles(files: SessionDiffFile[], scope: "file" | "all") {
    const revertableFiles = files.filter((file) => canRevertSessionDiffFile(file));
    const skippedFiles = files.filter((file) => !canRevertSessionDiffFile(file));

    if (!revertableFiles.length) {
      setFeedback({
        text:
          scope === "file"
            ? getUnsupportedRevertReason(files[0] ?? null) ?? "This file cannot be reverted."
            : "None of the current diff files can be reverted with the stored baseline.",
        tone: "error",
      });
      return;
    }

    setBusyAction(scope);
    setFeedback(null);

    try {
      for (const file of revertableFiles) {
        await revertWholeFile(file, result.rootPath);
      }

      if (onSessionDiffFilesChanged) {
        await onSessionDiffFilesChanged({
          paths: revertableFiles.map((file) => file.absPath),
          sessionId: result.sessionId,
        });
      }

      setFeedback({
        text:
          skippedFiles.length > 0
            ? `Reverted ${revertableFiles.length} file(s), saved to disk, and refreshed. Skipped ${skippedFiles.length} unsupported file(s).`
            : `Reverted ${revertableFiles.length} file(s), saved to disk, and refreshed.`,
        tone: "info",
      });
    } catch (reason) {
      setFeedback({
        text: reason instanceof Error ? reason.message : String(reason),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="diff-viewer">
      <header className="diff-viewer__header">
        <div
          className="diff-viewer__file-strip"
          onScroll={(event) => {
            diffFileListScrollLeftBySessionId.set(result.sessionId, event.currentTarget.scrollLeft);
          }}
          onWheel={handleFileStripWheel}
          ref={fileStripRef}
        >
          <div
            className="diff-viewer__file-list"
          >
            {result.files.map((file) => {
              const fileName = getDisplayFileName(file.path);

              return (
                <button
                  className="diff-viewer__file-card"
                  data-active={file.path === selectedFile?.path}
                  data-status={file.status}
                  key={file.path}
                  onClick={() => setSelectedPath(file.path)}
                  type="button"
                >
                  <div className="diff-viewer__file-card-top">
                    <span className="diff-viewer__file-status" data-status={file.status}>
                      {formatStatusMarker(file.status)}
                    </span>
                    <FileIcon fileName={fileName} size="compact" />
                    <span className="diff-viewer__file-name">{fileName}</span>
                  </div>
                  {file.isBinary ? (
                    <div className="diff-viewer__file-note">Binary</div>
                  ) : file.tooLarge ? (
                    <div className="diff-viewer__file-note">Too large</div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {result.files.length ? (
        <div className="diff-viewer__content">
          <div className="diff-viewer__detail">
            {selectedFile ? (
              <>
                <header className="diff-viewer__detail-header">
                  <div className="diff-viewer__detail-leading">
                    <div className="diff-viewer__nav diff-viewer__nav--inline">
                      <button
                        className="diff-viewer__nav-button"
                        disabled={!canNavigateChanges || isBusy}
                        onClick={() => handleNavigateDiff(-1)}
                        title="Previous change"
                        type="button"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="diff-viewer__nav-button"
                        disabled={!canNavigateChanges || isBusy}
                        onClick={() => handleNavigateDiff(1)}
                        title="Next change"
                        type="button"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <span className="diff-viewer__nav-state">{changePositionLabel}</span>
                      <span className="diff-viewer__detail-path" title={selectedFile.path}>
                        {selectedFile.path}
                      </span>
                      <div className="diff-viewer__nav-actions">
                        <button
                          className="diff-viewer__revert-button diff-viewer__revert-button--ghost"
                          disabled={!canSaveSelectedFile}
                          onClick={() => void handleSaveSelectedFile()}
                          title={selectedFileSaveTitle}
                          type="button"
                        >
                          {busyAction === "save" ? <LoaderCircle size={13} /> : <Save size={13} />}
                          <span>Save</span>
                        </button>
                        <button
                          className="diff-viewer__revert-button"
                          disabled={!canRevertSelectedFile || isBusy}
                          onClick={() => void handleRevertSelectedFile()}
                          title={selectedFileRevertTitle}
                          type="button"
                        >
                          {busyAction === "file" ? <LoaderCircle size={13} /> : <RotateCcw size={13} />}
                          <span>Revert File</span>
                        </button>
                        <button
                          className="diff-viewer__revert-button diff-viewer__revert-button--ghost"
                          disabled={!supportedFiles.length || isBusy}
                          onClick={() => void handleRevertAllFiles()}
                          title={revertAllTitle}
                          type="button"
                        >
                          {busyAction === "all" ? <LoaderCircle size={13} /> : <RotateCcw size={13} />}
                          <span>Revert All</span>
                        </button>
                      </div>
                    </div>
                    <span className="diff-viewer__detail-status" data-status={selectedFile.status}>
                      {formatStatusLabel(selectedFile.status)}
                    </span>
                    {isSelectedFileDirty ? (
                      <span className="diff-viewer__detail-draft">Target edited</span>
                    ) : null}
                  </div>
                </header>

                {feedback ? (
                  <div className="diff-viewer__feedback" data-tone={feedback.tone}>
                    {feedback.text}
                  </div>
                ) : null}

                {hasTextPreview ? (
                  <div className="diff-viewer__editor-scroller">
                    <div className="diff-viewer__editor-shell" ref={editorShellRef}>
                      <div className="diff-viewer__editor-badge diff-viewer__editor-badge--source">
                        Source
                      </div>
                      <div className="diff-viewer__editor-badge diff-viewer__editor-badge--target">
                        Target
                      </div>

                      {hunkOverlays.map((overlay) => (
                        <button
                          className="diff-viewer__hunk-revert"
                          disabled={isBusy}
                          key={overlay.id}
                          onClick={() => void handleRevertHunk(overlay.id)}
                          style={{
                            left: `${overlay.anchorLeft}px`,
                            top: `${overlay.top}px`,
                          }}
                          title="Revert this change block to Source, save it, and refresh."
                          type="button"
                        >
                          {busyAction === `hunk:${overlay.id}` ? (
                            <LoaderCircle size={12} />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          <span>Revert</span>
                        </button>
                      ))}

                      <DiffEditor
                        className="diff-viewer__monaco"
                        height="100%"
                        key={`${selectedFile.path}:${result.generatedAt}:${editorEpoch}`}
                        modified={selectedModifiedContent}
                        modifiedLanguage={selectedFileLanguage}
                        modifiedModelPath={`${selectedFile.absPath}#modified`}
                        onMount={handleDiffEditorMount}
                        options={DIFF_EDITOR_OPTIONS}
                        original={selectedFile.originalContent ?? ""}
                        originalLanguage={selectedFileLanguage}
                        originalModelPath={`${selectedFile.absPath}#original`}
                        theme={MONACO_THEME}
                        width="100%"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="diff-viewer__empty">
                    <div className="diff-viewer__empty-title">Preview unavailable</div>
                    <div className="diff-viewer__empty-copy">
                      {describeUnavailablePreview(selectedFile)}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="diff-viewer__empty">
          <div className="diff-viewer__empty-title">No changes detected</div>
          <div className="diff-viewer__empty-copy">
            This AI session has not changed any tracked files since its baseline snapshot.
          </div>
        </div>
      )}
    </section>
  );
}

async function persistRevertedContent(file: SessionDiffFile, nextContent: string, rootPath: string) {
  if (file.status === "added" && nextContent === (file.originalContent ?? "")) {
    await invoke("delete_file", {
      filePath: file.absPath,
      rootPath,
    });
    return;
  }

  await invoke("upsert_file", {
    content: nextContent,
    filePath: file.absPath,
    rootPath,
  });
}

async function revertWholeFile(file: SessionDiffFile, rootPath: string) {
  if (file.status === "added") {
    await invoke("delete_file", {
      filePath: file.absPath,
      rootPath,
    });
    return;
  }

  const originalContent = file.originalContent;
  if (originalContent === null) {
    throw new Error(getUnsupportedRevertReason(file) ?? "This file cannot be reverted.");
  }

  await invoke("upsert_file", {
    content: originalContent,
    filePath: file.absPath,
    rootPath,
  });
}

function canRevertSessionDiffFile(file: SessionDiffFile) {
  return file.status === "added" || file.originalContent !== null;
}

function getUnsupportedRevertReason(file: SessionDiffFile | null) {
  if (!file) {
    return null;
  }

  if (file.status === "added") {
    return null;
  }

  if (file.isBinary) {
    return "Binary files changed before the baseline cannot be restored because the baseline only keeps text content.";
  }

  if (file.tooLarge) {
    return "Files larger than the current baseline preview limit cannot be restored because the baseline did not store their text.";
  }

  return file.originalContent === null
    ? "The source content for this file is unavailable, so it cannot be reverted."
    : null;
}

function getSelectedFileRevertTitle(file: SessionDiffFile) {
  return (
    getUnsupportedRevertReason(file) ??
    "Revert this file to Source, save it to disk, and refresh the diff."
  );
}

function getPreparedHunks(
  diffEditor: DiffEditorWithInternals,
  originalModel: editor.ITextModel,
  modifiedModel: editor.ITextModel,
) {
  const mappings = getInternalDiffMappings(diffEditor);

  if (mappings.length > 0) {
    return mappings
      .map((mapping, index) => {
        return {
          id: createPreparedHunkId(mapping.lineRangeMapping, index),
          lineMapping: mapping.lineRangeMapping,
        } satisfies PreparedHunk;
      })
      .filter((value): value is PreparedHunk => value !== null);
  }

  return (diffEditor.getLineChanges() ?? []).map((lineChange, index) =>
    createPreparedHunkFromLineChange(lineChange, index, originalModel, modifiedModel),
  );
}

function createPreparedHunkId(lineMapping: MonacoLineRangeMapping, index: number) {
  return [
    "hunk",
    index,
    lineMapping.original.startLineNumber,
    lineMapping.original.endLineNumberExclusive,
    lineMapping.modified.startLineNumber,
    lineMapping.modified.endLineNumberExclusive,
  ].join(":");
}

function getInternalDiffMappings(diffEditor: DiffEditorWithInternals) {
  return diffEditor._diffModel?.get?.()?.diff.get()?.mappings ?? [];
}

function createPreparedHunkFromLineChange(
  lineChange: editor.ILineChange,
  index: number,
  _originalModel: editor.ITextModel,
  _modifiedModel: editor.ITextModel,
): PreparedHunk {
  const lineMapping = createLineRangeMappingFromLineChange(lineChange);

  return {
    buildNextContent: (originalContent, modifiedContent) =>
      buildRevertedLineChangeContent(lineChange, originalContent, modifiedContent),
    id: createPreparedHunkId(lineMapping, index),
    lineMapping,
  };
}

function createLineRangeMappingFromLineChange(
  lineChange: editor.ILineChange,
): MonacoLineRangeMapping {
  return {
    modified: createLineRangeFromDiffBounds(
      lineChange.modifiedStartLineNumber,
      lineChange.modifiedEndLineNumber,
    ),
    original: createLineRangeFromDiffBounds(
      lineChange.originalStartLineNumber,
      lineChange.originalEndLineNumber,
    ),
  };
}

function createLineRangeFromDiffBounds(
  startLineNumber: number,
  endLineNumber: number,
): MonacoLineRange {
  if (hasLineRange(startLineNumber, endLineNumber)) {
    return {
      endLineNumberExclusive: endLineNumber + 1,
      startLineNumber,
    };
  }

  const anchorLineNumber = Math.max(startLineNumber + 1, 1);
  return {
    endLineNumberExclusive: anchorLineNumber,
    startLineNumber: anchorLineNumber,
  };
}

function canApplyPreparedHunkRevert(
  preparedHunk: PreparedHunk,
  diffEditor: DiffEditorWithInternals,
) {
  if (preparedHunk.buildNextContent) {
    return true;
  }

  return canApplyHunkRevert(diffEditor, preparedHunk.lineMapping);
}

function buildPreparedHunkContent(
  preparedHunk: PreparedHunk,
  diffEditor: DiffEditorWithInternals,
) {
  if (preparedHunk.buildNextContent) {
    const originalContent = diffEditor.getOriginalEditor().getModel()?.getValue();
    const modifiedContent = diffEditor.getModifiedEditor().getModel()?.getValue();

    if (typeof originalContent !== "string" || typeof modifiedContent !== "string") {
      throw new Error("The diff models are unavailable for this change.");
    }

    return preparedHunk.buildNextContent(originalContent, modifiedContent);
  }

  return buildRevertedHunkContent(diffEditor, preparedHunk.lineMapping);
}

function buildRevertedHunkContent(
  diffEditor: DiffEditorWithInternals,
  lineMapping: MonacoLineRangeMapping,
) {
  const originalModel = diffEditor.getOriginalEditor().getModel();
  const modifiedModel = diffEditor.getModifiedEditor().getModel();

  if (!originalModel || !modifiedModel) {
    throw new Error("The diff models are unavailable for this change.");
  }

  const revertRangeMapping = getHunkRevertRangeMapping(
    lineMapping,
    originalModel,
    modifiedModel,
  );

  if (!revertRangeMapping) {
    throw new Error("The selected change does not expose a revertable range.");
  }

  return replaceModelRange(
    modifiedModel,
    revertRangeMapping.modifiedRange,
    originalModel.getValueInRange(revertRangeMapping.originalRange),
  );
}

function canApplyHunkRevert(
  diffEditor: DiffEditorWithInternals,
  lineMapping: MonacoLineRangeMapping,
) {
  const originalModel = diffEditor.getOriginalEditor().getModel();
  const modifiedModel = diffEditor.getModifiedEditor().getModel();

  if (!originalModel || !modifiedModel) {
    return false;
  }

  return Boolean(getHunkRevertRangeMapping(lineMapping, originalModel, modifiedModel));
}

function getHunkRevertRangeMapping(
  lineMapping: MonacoLineRangeMapping,
  originalModel: editor.ITextModel | null,
  modifiedModel: editor.ITextModel | null,
) {
  if (!originalModel || !modifiedModel) {
    return null;
  }

  if (lineMapping.original.toExclusiveRange && lineMapping.modified.toExclusiveRange) {
    return {
      originalRange: lineMapping.original.toExclusiveRange(),
      modifiedRange: lineMapping.modified.toExclusiveRange(),
    };
  }

  if (typeof lineMapping.toRangeMapping2 === "function") {
    return lineMapping.toRangeMapping2(
      originalModel.getLinesContent(),
      modifiedModel.getLinesContent(),
    );
  }

  return lineMapping.toRangeMapping?.() ?? null;
}

function replaceModelRange(
  model: editor.ITextModel,
  range: MonacoRangeLike,
  nextText: string,
) {
  const currentText = model.getValue();
  const startOffset = model.getOffsetAt({
    column: range.startColumn,
    lineNumber: range.startLineNumber,
  });
  const endOffset = model.getOffsetAt({
    column: range.endColumn,
    lineNumber: range.endLineNumber,
  });

  return currentText.slice(0, startOffset) + nextText + currentText.slice(endOffset);
}

function getHunkPlacement(lineMapping: MonacoLineRangeMapping) {
  const modifiedEndLineNumber = getPlacementEndLineNumber(lineMapping.modified);
  if (isNonEmptyLineRange(lineMapping.modified)) {
    return {
      endLineNumber: modifiedEndLineNumber,
      side: "modified" as const,
    };
  }

  return {
    endLineNumber: getPlacementEndLineNumber(lineMapping.original),
    side: "original" as const,
  };
}

function getPlacementEndLineNumber(range: MonacoLineRange) {
  if (isNonEmptyLineRange(range)) {
    return range.endLineNumberExclusive - 1;
  }

  return Math.max(range.startLineNumber - 1, 1);
}

function isNonEmptyLineRange(range: MonacoLineRange) {
  return range.endLineNumberExclusive > range.startLineNumber;
}

function buildRevertedLineChangeContent(
  lineChange: editor.ILineChange,
  originalContent: string,
  modifiedContent: string,
) {
  const originalChunks = getLineChunks(originalContent);
  const modifiedChunks = getLineChunks(modifiedContent);
  const originalReplacement = sliceLineChunks(
    originalChunks,
    lineChange.originalStartLineNumber,
    lineChange.originalEndLineNumber,
  );
  const [modifiedStartIndex, modifiedEndIndexExclusive] = resolveLineChunkRange(
    modifiedChunks.length,
    lineChange.modifiedStartLineNumber,
    lineChange.modifiedEndLineNumber,
  );

  return [
    ...modifiedChunks.slice(0, modifiedStartIndex),
    ...originalReplacement,
    ...modifiedChunks.slice(modifiedEndIndexExclusive),
  ].join("");
}

function getLineChunks(content: string) {
  if (content === "") {
    return [""];
  }

  const lines = content.split(/\r\n|\r|\n/);
  const lineEndings = content.match(/\r\n|\r|\n/g) ?? [];

  return lines.map((line, index) => line + (lineEndings[index] ?? ""));
}

function sliceLineChunks(
  chunks: string[],
  startLineNumber: number,
  endLineNumber: number,
) {
  if (!hasLineRange(startLineNumber, endLineNumber)) {
    return [];
  }

  return chunks.slice(startLineNumber - 1, endLineNumber);
}

function resolveLineChunkRange(
  chunkCount: number,
  startLineNumber: number,
  endLineNumber: number,
) {
  if (hasLineRange(startLineNumber, endLineNumber)) {
    return [startLineNumber - 1, endLineNumber] as const;
  }

  const insertionIndex = Math.min(Math.max(startLineNumber, 0), chunkCount);
  return [insertionIndex, insertionIndex] as const;
}

function formatStatusLabel(status: SessionDiffFile["status"]) {
  switch (status) {
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    default:
      return "Modified";
  }
}

function formatStatusMarker(status: SessionDiffFile["status"]) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    default:
      return "M";
  }
}

function describeUnavailablePreview(file: SessionDiffFile) {
  if (file.isBinary) {
    return "Binary files are listed here, but they do not have a text diff preview.";
  }

  if (file.tooLarge) {
    return "This file is larger than the current Phase 1A preview limit.";
  }

  return "A textual diff preview is not available for this file.";
}

function getDisplayFileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function createDiffEditorViewStateKey(sessionId: string, absPath: string) {
  return `${sessionId}:${absPath}`;
}

function getLineCount(content: string) {
  return content === "" ? 1 : content.split(/\r\n|\r|\n/).length;
}

function clampLineNumber(lineNumber: number, lineCount: number) {
  return Math.min(Math.max(lineNumber, 1), Math.max(lineCount, 1));
}

function hasLineRange(startLineNumber: number, endLineNumber: number) {
  return startLineNumber > 0 && endLineNumber > 0 && endLineNumber >= startLineNumber;
}

function hasColumnRange(startColumn: number, endColumn: number) {
  return startColumn > 0 && endColumn > startColumn;
}

function createWholeLineDecoration(
  monaco: typeof import("monaco-editor"),
  startLineNumber: number,
  endLineNumber: number,
  kind: "delete" | "insert",
): editor.IModelDeltaDecoration {
  return {
    options: {
      className: kind === "insert" ? "line-insert" : "line-delete",
      isWholeLine: true,
      lineNumberClassName:
        kind === "insert"
          ? "diff-viewer__line-number diff-viewer__line-number--insert"
          : "diff-viewer__line-number diff-viewer__line-number--delete",
      marginClassName: kind === "insert" ? "gutter-insert" : "gutter-delete",
    },
    range: new monaco.Range(startLineNumber, 1, endLineNumber, 1),
  };
}

function createCharacterDecoration(
  monaco: typeof import("monaco-editor"),
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
  kind: "delete" | "insert",
): editor.IModelDeltaDecoration {
  return {
    options: {
      className: kind === "insert" ? "char-insert" : "char-delete",
    },
    range: new monaco.Range(startLineNumber, startColumn, endLineNumber, endColumn),
  };
}

function syncEditableDrafts(
  currentDrafts: Record<string, EditableDraft>,
  files: SessionDiffFile[],
) {
  let nextDrafts = currentDrafts;
  const seenPaths = new Set<string>();

  for (const file of files) {
    seenPaths.add(file.path);

    if (file.modifiedContent === null) {
      if (file.path in nextDrafts) {
        if (nextDrafts === currentDrafts) {
          nextDrafts = { ...currentDrafts };
        }
        delete nextDrafts[file.path];
      }
      continue;
    }

    const currentDraft = nextDrafts[file.path];
    if (!currentDraft) {
      if (nextDrafts === currentDrafts) {
        nextDrafts = { ...currentDrafts };
      }
      nextDrafts[file.path] = {
        baseContent: file.modifiedContent,
        content: file.modifiedContent,
      };
      continue;
    }

    if (currentDraft.baseContent === file.modifiedContent) {
      continue;
    }

    if (nextDrafts === currentDrafts) {
      nextDrafts = { ...currentDrafts };
    }
    nextDrafts[file.path] =
      currentDraft.content === currentDraft.baseContent
        ? {
            baseContent: file.modifiedContent,
            content: file.modifiedContent,
          }
        : {
            ...currentDraft,
            baseContent: file.modifiedContent,
          };
  }

  for (const path of Object.keys(nextDrafts)) {
    if (seenPaths.has(path)) {
      continue;
    }

    if (nextDrafts === currentDrafts) {
      nextDrafts = { ...currentDrafts };
    }
    delete nextDrafts[path];
  }

  return nextDrafts;
}

function updateEditableDraft(
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

function markEditableDraftSaved(
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
