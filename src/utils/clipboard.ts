export interface ClipboardImportFile {
  bytes: number[];
  name: string;
}

export interface ClipboardPastePayload {
  files: ClipboardImportFile[];
  sourcePaths: string[];
}

export async function readClipboardPastePayloadFromDataTransfer(
  dataTransfer: DataTransfer | null,
): Promise<ClipboardPastePayload> {
  if (!dataTransfer) {
    return {
      files: [],
      sourcePaths: [],
    };
  }

  const sourcePaths = extractClipboardFilePaths([
    dataTransfer.getData("text/uri-list"),
    dataTransfer.getData("text/plain"),
  ]);

  if (sourcePaths.length) {
    return {
      files: [],
      sourcePaths,
    };
  }

  const files = await Promise.all(
    Array.from(dataTransfer.files).map((file, index) =>
      blobToClipboardImportFile(file, index, file.name),
    ),
  );

  return {
    files: files.filter((file): file is ClipboardImportFile => Boolean(file)),
    sourcePaths: [],
  };
}

export async function readClipboardPastePayloadFromNavigatorClipboard(): Promise<ClipboardPastePayload> {
  const clipboard = navigator.clipboard;
  const rawTexts: string[] = [];
  const files: ClipboardImportFile[] = [];

  if (clipboard?.read) {
    try {
      const items = await clipboard.read();

      for (const [itemIndex, item] of items.entries()) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type === "text/plain" || type === "text/uri-list") {
            rawTexts.push(await blob.text());
            continue;
          }

          const file = await blobToClipboardImportFile(blob, itemIndex, null);
          if (file) {
            files.push(file);
          }
        }
      }
    } catch (reason) {
      console.warn("[clipboard] Failed to read clipboard items.", reason);
    }
  }

  if (clipboard?.readText) {
    try {
      rawTexts.push(await clipboard.readText());
    } catch (reason) {
      console.warn("[clipboard] Failed to read clipboard text.", reason);
    }
  }

  const sourcePaths = extractClipboardFilePaths(rawTexts);
  if (sourcePaths.length) {
    return {
      files: [],
      sourcePaths,
    };
  }

  return {
    files,
    sourcePaths: [],
  };
}

export async function blobToClipboardImportFile(
  blob: Blob,
  index: number,
  preferredName: string | null,
): Promise<ClipboardImportFile | null> {
  const name = resolveClipboardFileName(blob, index, preferredName);
  if (!name) {
    return null;
  }

  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  return {
    bytes,
    name,
  };
}

export function resolveClipboardFileName(
  blob: Blob,
  index: number,
  preferredName: string | null,
) {
  const sanitizedPreferredName = sanitizeClipboardFileName(preferredName);
  if (sanitizedPreferredName) {
    return sanitizedPreferredName;
  }

  const extension = inferExtensionFromMimeType(blob.type);
  return `clipboard-${Date.now()}-${index + 1}${extension}`;
}

export function sanitizeClipboardFileName(value: string | null) {
  if (!value) {
    return null;
  }

  const fileName = value
    .trim()
    .split(/[/\\]+/)
    .pop()
    ?.trim();

  return fileName ? fileName : null;
}

export function inferExtensionFromMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/bmp":
      return ".bmp";
    case "image/x-icon":
      return ".ico";
    case "image/avif":
      return ".avif";
    case "image/svg+xml":
      return ".svg";
    case "text/plain":
      return ".txt";
    case "application/json":
      return ".json";
    default:
      return "";
  }
}

export function extractClipboardFilePaths(rawTexts: string[]) {
  const paths = new Set<string>();

  for (const rawText of rawTexts) {
    for (const line of rawText.split(/\r?\n/)) {
      const trimmedLine = stripWrappingQuotes(line.trim());
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      if (trimmedLine.toLowerCase().startsWith("file://")) {
        const pathFromUri = decodeFileUri(trimmedLine);
        if (pathFromUri) {
          paths.add(pathFromUri);
        }
        continue;
      }

      if (looksLikeAbsolutePath(trimmedLine)) {
        paths.add(trimmedLine);
      }
    }
  }

  return Array.from(paths);
}

export function shouldIgnoreClipboardPasteTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(target.closest("input, textarea, [contenteditable='true']"))
    : false;
}

function stripWrappingQuotes(value: string) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function decodeFileUri(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") {
      return null;
    }

    const decodedPath = decodeURIComponent(url.pathname);
    if (url.host) {
      return `\\\\${url.host}${decodedPath.replace(/\//g, "\\")}`;
    }

    if (/^\/[A-Za-z]:/.test(decodedPath)) {
      return decodedPath.slice(1).replace(/\//g, "\\");
    }

    return decodedPath;
  } catch {
    return null;
  }
}

function looksLikeAbsolutePath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/");
}
