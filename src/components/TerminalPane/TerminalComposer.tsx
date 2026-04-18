import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowUp, CornerDownLeft, Plus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  readClipboardPastePayloadFromDataTransfer,
  readClipboardPastePayloadFromNavigatorClipboard,
  type ClipboardImportFile,
  type ClipboardPastePayload,
} from "../../utils/clipboard";
import { resolveProjectRelativePath } from "../../utils/paths";
import { FileIcon, isImageFile } from "../FileIcon/FileIcon";

const TERMINAL_COMPOSER_DRAFT_STORAGE_KEY = "vibeCliEditor.terminalComposer.latestDraft";

interface ComposerAttachment {
  file: ClipboardImportFile | null;
  fileName: string;
  id: string;
  isImage: boolean;
  previewSrc: string | null;
  resolvedPath: string | null;
}

interface TerminalComposerProps {
  canSubmit?: boolean;
  disabled?: boolean;
  externalInsertSequence?: number;
  externalInsertText?: string;
  onSubmit: (text: string) => Promise<void>;
  placeholder?: string;
  workingDir?: string | null;
}

interface ComposerSelection {
  selectionEnd: number;
  selectionStart: number;
}

export function TerminalComposer({
  canSubmit = true,
  disabled = false,
  externalInsertSequence = 0,
  externalInsertText = "",
  onSubmit,
  placeholder,
  workingDir = null,
}: TerminalComposerProps) {
  const helperId = useId();
  const isComposingRef = useRef(false);
  const appliedExternalInsertSequenceRef = useRef(externalInsertSequence);
  const lastSelectionRef = useRef<ComposerSelection | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(() => loadPersistedComposerDraft());
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    name: string;
    src: string;
  } | null>(null);
  const hasDraftContent = Boolean(value.trim() || attachments.length);

  useEffect(() => {
    if (disabled) {
      return;
    }

    textareaRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    persistComposerDraft(value);
  }, [value]);

  useEffect(() => {
    if (externalInsertSequence === appliedExternalInsertSequenceRef.current) {
      return;
    }

    appliedExternalInsertSequenceRef.current = externalInsertSequence;
    if (!externalInsertText) {
      return;
    }

    let nextSelection: ComposerSelection | null = null;
    setValue((currentValue) => {
      const nextDraft = insertComposerDraft(
        currentValue,
        externalInsertText,
        textareaRef.current,
        lastSelectionRef.current,
      );
      nextSelection = {
        selectionEnd: nextDraft.selectionEnd,
        selectionStart: nextDraft.selectionStart,
      };
      lastSelectionRef.current = nextSelection;
      return nextDraft.value;
    });
    setError(null);
    requestAnimationFrame(() => {
      focusComposerInput(
        textareaRef.current,
        nextSelection?.selectionStart,
        nextSelection?.selectionEnd,
      );
      rememberComposerSelection(textareaRef.current, lastSelectionRef);
    });
  }, [externalInsertSequence, externalInsertText]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewImage]);

  async function handleSubmit() {
    if (disabled || isSubmitting) {
      return;
    }

    if (!hasDraftContent) {
      setError("Enter some text or paste an attachment first.");
      return;
    }

    if (!canSubmit) {
      setError("Open a workspace first.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { attachmentPaths, nextAttachments } = await resolveComposerAttachmentPaths(attachments);
      if (nextAttachments !== attachments) {
        setAttachments(nextAttachments);
      }

      await onSubmit(buildComposerSubmissionText(value, attachmentPaths, workingDir));
      setValue("");
      setAttachments([]);
      lastSelectionRef.current = {
        selectionEnd: 0,
        selectionStart: 0,
      };
      focusComposerInput(textareaRef.current, 0, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (
      isComposingRef.current ||
      event.nativeEvent.isComposing ||
      (event.key !== "Enter" && event.code !== "Enter" && event.code !== "NumpadEnter") ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    event.preventDefault();
    void handleSubmit();
  }

  async function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    let payload = await readClipboardPastePayloadFromDataTransfer(event.clipboardData);
    if (!payload.sourcePaths.length && !payload.files.length) {
      payload = await readClipboardPastePayloadFromNavigatorClipboard();
    }

    if (!payload.sourcePaths.length && !payload.files.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      const nextAttachments = await createComposerAttachments(payload);
      setAttachments((currentAttachments) => [...currentAttachments, ...nextAttachments]);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handlePickAttachments() {
    if (disabled || isSubmitting) {
      return;
    }

    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: "Select Attachments",
      });
      const sourcePaths = Array.isArray(selected)
        ? selected.filter((value): value is string => typeof value === "string")
        : typeof selected === "string"
          ? [selected]
          : [];

      if (!sourcePaths.length) {
        restoreComposerSelection(textareaRef.current, lastSelectionRef);
        return;
      }

      const nextAttachments = await createComposerAttachments({
        files: [],
        sourcePaths,
      });
      setAttachments((currentAttachments) => [...currentAttachments, ...nextAttachments]);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      restoreComposerSelection(textareaRef.current, lastSelectionRef);
    }
  }

  function handleRemoveAttachment(attachmentId: string) {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    );
    setError(null);
    restoreComposerSelection(textareaRef.current, lastSelectionRef);
  }

  return (
    <div className="terminal-composer">
      <div className="terminal-composer__card">
        <textarea
          aria-describedby={error ? helperId : undefined}
          className="terminal-composer__input"
          disabled={disabled || isSubmitting}
          onChange={(event) => {
            setValue(event.target.value);
            rememberComposerSelection(event.target, lastSelectionRef);
            if (error) {
              setError(null);
            }
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onFocus={() => {
            requestAnimationFrame(() => {
              rememberComposerSelection(textareaRef.current, lastSelectionRef);
            });
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={() => {
            rememberComposerSelection(textareaRef.current, lastSelectionRef);
          }}
          onMouseUp={() => {
            rememberComposerSelection(textareaRef.current, lastSelectionRef);
          }}
          onPaste={(event) => {
            void handlePaste(event);
          }}
          onSelect={() => {
            rememberComposerSelection(textareaRef.current, lastSelectionRef);
          }}
          placeholder={placeholder}
          ref={textareaRef}
          rows={3}
          spellCheck={false}
          value={value}
        />
        <div className="terminal-composer__footer">
          <div className="terminal-composer__footer-main">
            <div className="terminal-composer__footer-tools">
              <button
                className="terminal-composer__attach-picker"
                disabled={disabled || isSubmitting}
                onClick={() => void handlePickAttachments()}
                title="Add attachment"
                type="button"
              >
                <Plus size={13} />
              </button>
              {error ? (
                <span
                  className="terminal-composer__meta-text terminal-composer__meta-text--error"
                  id={helperId}
                >
                  {error}
                </span>
              ) : null}
            </div>
            {attachments.length ? (
              <div className="terminal-composer__attachments">
                {attachments.map((attachment) => (
                  <div className="terminal-composer__attachment" key={attachment.id}>
                    <div
                      className="terminal-composer__attachment-thumb"
                      title={attachment.resolvedPath ?? attachment.fileName}
                    >
                      {attachment.previewSrc ? (
                        <button
                          className="terminal-composer__attachment-preview"
                          onClick={() =>
                            setPreviewImage({
                              name: attachment.fileName,
                              src: attachment.previewSrc ?? "",
                            })
                          }
                          title={attachment.isImage ? "Preview image" : attachment.fileName}
                          type="button"
                        >
                          <img
                            alt={attachment.fileName}
                            className="terminal-composer__attachment-image"
                            src={attachment.previewSrc}
                          />
                        </button>
                      ) : (
                        <div className="terminal-composer__attachment-icon">
                          <FileIcon fileName={attachment.fileName} />
                        </div>
                      )}
                    </div>
                    <button
                      className="terminal-composer__attachment-remove"
                      disabled={disabled || isSubmitting}
                      onClick={() => handleRemoveAttachment(attachment.id)}
                      title="Remove attachment"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                    <div
                      className="terminal-composer__attachment-name"
                      title={attachment.resolvedPath ?? attachment.fileName}
                    >
                      {attachment.fileName}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="terminal-composer__send"
            disabled={disabled || isSubmitting || !canSubmit || !hasDraftContent}
            onClick={() => void handleSubmit()}
            title="Insert"
            type="button"
          >
            {isSubmitting ? <CornerDownLeft size={14} /> : <ArrowUp size={14} />}
          </button>
        </div>
      </div>
      {previewImage ? (
        <div
          className="terminal-composer__lightbox"
          onClick={() => setPreviewImage(null)}
          role="presentation"
        >
          <div
            className="terminal-composer__lightbox-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="terminal-composer__lightbox-close"
              onClick={() => setPreviewImage(null)}
              title="Close preview"
              type="button"
            >
              <X size={14} />
            </button>
            <img
              alt={previewImage.name}
              className="terminal-composer__lightbox-image"
              src={previewImage.src}
            />
            <div className="terminal-composer__lightbox-caption" title={previewImage.name}>
              {previewImage.name}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildComposerSubmissionText(
  text: string,
  attachmentPaths: string[],
  workingDir: string | null,
) {
  if (!attachmentPaths.length) {
    return text;
  }

  const formattedAttachmentPaths = attachmentPaths
    .map((path) => formatAttachmentPathForInsert(resolveAttachmentPathForInsert(path, workingDir)))
    .join(" ");
  const trimmedText = text.trimEnd();
  if (!trimmedText) {
    return formattedAttachmentPaths;
  }

  return `${trimmedText} ${formattedAttachmentPaths}`;
}

async function resolveComposerAttachmentPaths(attachments: ComposerAttachment[]) {
  if (!attachments.length) {
    return {
      attachmentPaths: [],
      nextAttachments: attachments,
    };
  }

  const unsavedAttachments = attachments.filter(
    (attachment): attachment is ComposerAttachment & { file: ClipboardImportFile } =>
      Boolean(attachment.file) && !attachment.resolvedPath,
  );
  const savedPathByAttachmentId = new Map<string, string>();

  if (unsavedAttachments.length) {
    const savedPaths = await invoke<string[]>("save_clipboard_files_to_temp", {
      files: unsavedAttachments.map((attachment) => attachment.file),
    });

    if (savedPaths.length !== unsavedAttachments.length) {
      throw new Error("Failed to save pasted clipboard files.");
    }

    unsavedAttachments.forEach((attachment, index) => {
      const savedPath = savedPaths[index];
      if (!savedPath) {
        throw new Error("Failed to resolve a temporary attachment path.");
      }

      savedPathByAttachmentId.set(attachment.id, savedPath);
    });
  }

  const nextAttachments = attachments.map((attachment) =>
    attachment.resolvedPath
      ? attachment
      : {
          ...attachment,
          resolvedPath: savedPathByAttachmentId.get(attachment.id) ?? null,
        },
  );
  const attachmentPaths = nextAttachments
    .map((attachment) => attachment.resolvedPath)
    .filter((path): path is string => Boolean(path));

  if (attachmentPaths.length !== nextAttachments.length) {
    throw new Error("Failed to prepare attachment paths for sending.");
  }

  return {
    attachmentPaths,
    nextAttachments,
  };
}

async function createComposerAttachments(
  payload: ClipboardPastePayload,
): Promise<ComposerAttachment[]> {
  const pathAttachments = (
    await Promise.all(
      payload.sourcePaths.map((sourcePath, index) => createLocalPathAttachment(sourcePath, index)),
    )
  )
    .filter((attachment): attachment is ComposerAttachment => Boolean(attachment));
  const fileAttachments = await Promise.all(
    payload.files.map((file, index) =>
      createClipboardFileAttachment(file, pathAttachments.length + index),
    ),
  );

  return [...pathAttachments, ...fileAttachments];
}

async function createLocalPathAttachment(
  sourcePath: string,
  index: number,
): Promise<ComposerAttachment | null> {
  const normalizedPath = sourcePath.trim();
  if (!normalizedPath) {
    return null;
  }
  const fileName = getBaseName(normalizedPath);
  const isImage = isImageFile(fileName);
  const previewSrc = isImage ? await readLocalImageAttachmentPreview(normalizedPath) : null;

  return {
    file: null,
    fileName,
    id: createComposerAttachmentId(index),
    isImage,
    previewSrc,
    resolvedPath: normalizedPath,
  };
}

async function createClipboardFileAttachment(
  file: ClipboardImportFile,
  index: number,
): Promise<ComposerAttachment> {
  const isImage = isImageFile(file.name);
  const previewSrc = isImage
    ? await bytesToDataUrl(file.bytes, inferMimeTypeFromFileName(file.name))
    : null;

  return {
    file,
    fileName: file.name,
    id: createComposerAttachmentId(index),
    isImage,
    previewSrc,
    resolvedPath: null,
  };
}

function inferMimeTypeFromFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function bytesToDataUrl(bytes: number[], mimeType: string) {
  return blobToDataUrl(new Blob([Uint8Array.from(bytes)], { type: mimeType }));
}

async function readLocalImageAttachmentPreview(path: string) {
  try {
    return await invoke<string>("read_media_file_data_url", {
      filePath: path,
      rootPath: getParentDirectoryPath(path),
    });
  } catch (reason) {
    console.warn("[composer] Failed to preview local image attachment.", reason);
    return null;
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read pasted attachment."));
    };
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to preview pasted attachment."));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

function createComposerAttachmentId(index: number) {
  return `composer-attachment-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function getBaseName(path: string) {
  const normalized = path.replace(/[/\\]+$/, "");
  return normalized.split(/[/\\]/).pop() || normalized;
}

function getParentDirectoryPath(path: string) {
  const normalized = path.replace(/[/\\]+$/, "");
  const lastSeparatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSeparatorIndex < 0) {
    return normalized;
  }

  const separator = normalized[lastSeparatorIndex];
  const parentPath = normalized.slice(0, lastSeparatorIndex);
  if (!parentPath) {
    return separator;
  }

  if (/^[A-Za-z]:$/.test(parentPath)) {
    return `${parentPath}${separator}`;
  }

  return parentPath;
}

function formatAttachmentPathForInsert(path: string) {
  if (!/[\s"]/u.test(path)) {
    return path;
  }

  return `"${path.replace(/"/g, '""')}"`;
}

function resolveAttachmentPathForInsert(path: string, workingDir: string | null) {
  if (!workingDir) {
    return path;
  }

  return resolveProjectRelativePath(workingDir, path);
}

function loadPersistedComposerDraft() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(TERMINAL_COMPOSER_DRAFT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function persistComposerDraft(value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value.length) {
      window.localStorage.setItem(TERMINAL_COMPOSER_DRAFT_STORAGE_KEY, value);
      return;
    }

    window.localStorage.removeItem(TERMINAL_COMPOSER_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore persistence failures and continue with an in-memory draft.
  }
}

function appendComposerDraft(currentValue: string, insertedText: string) {
  if (!currentValue) {
    return insertedText;
  }

  if (!insertedText) {
    return currentValue;
  }

  if (/\s$/u.test(currentValue) || /^\s/u.test(insertedText)) {
    return `${currentValue}${insertedText}`;
  }

  return `${currentValue} ${insertedText}`;
}

function insertComposerDraft(
  currentValue: string,
  insertedText: string,
  textarea: HTMLTextAreaElement | null,
  rememberedSelection: ComposerSelection | null,
) {
  if (!insertedText) {
    return {
      selectionEnd: currentValue.length,
      selectionStart: currentValue.length,
      value: currentValue,
    };
  }

  const selection = resolveComposerSelection(textarea, currentValue.length, rememberedSelection);
  if (selection) {
    const selectionStart = selection.selectionStart;
    const selectionEnd = selection.selectionEnd;

    return {
      selectionEnd: selectionStart + insertedText.length,
      selectionStart: selectionStart + insertedText.length,
      value:
        currentValue.slice(0, selectionStart) +
        insertedText +
        currentValue.slice(selectionEnd),
    };
  }

  const nextValue = appendComposerDraft(currentValue, insertedText);
  return {
    selectionEnd: nextValue.length,
    selectionStart: nextValue.length,
    value: nextValue,
  };
}

function resolveComposerSelection(
  textarea: HTMLTextAreaElement | null,
  valueLength: number,
  rememberedSelection: ComposerSelection | null,
) {
  if (textarea && document.activeElement === textarea) {
    return createComposerSelection(textarea.selectionStart, textarea.selectionEnd, valueLength);
  }

  if (!rememberedSelection) {
    return null;
  }

  return createComposerSelection(
    rememberedSelection.selectionStart,
    rememberedSelection.selectionEnd,
    valueLength,
  );
}

function createComposerSelection(selectionStart: number, selectionEnd: number, valueLength: number) {
  const nextSelectionStart = clampComposerSelection(selectionStart, valueLength);
  const nextSelectionEnd = Math.max(nextSelectionStart, clampComposerSelection(selectionEnd, valueLength));

  return {
    selectionEnd: nextSelectionEnd,
    selectionStart: nextSelectionStart,
  };
}

function clampComposerSelection(selection: number, valueLength: number) {
  return Math.max(0, Math.min(valueLength, selection));
}

function focusComposerInput(
  textarea: HTMLTextAreaElement | null,
  selectionStart: number | null = null,
  selectionEnd: number | null = null,
) {
  if (!textarea) {
    return;
  }

  textarea.focus();
  const resolvedSelectionStart = selectionStart ?? textarea.value.length;
  const resolvedSelectionEnd = selectionEnd ?? resolvedSelectionStart;
  textarea.setSelectionRange(resolvedSelectionStart, resolvedSelectionEnd);
}

function restoreComposerSelection(
  textarea: HTMLTextAreaElement | null,
  selectionRef: { current: ComposerSelection | null },
) {
  focusComposerInput(
    textarea,
    selectionRef.current?.selectionStart,
    selectionRef.current?.selectionEnd,
  );
  rememberComposerSelection(textarea, selectionRef);
}

function rememberComposerSelection(
  textarea: HTMLTextAreaElement | null,
  selectionRef: { current: ComposerSelection | null },
) {
  if (!textarea) {
    return;
  }

  selectionRef.current = createComposerSelection(
    textarea.selectionStart,
    textarea.selectionEnd,
    textarea.value.length,
  );
}
