interface FileIconProps {
  fileName: string;
  size?: "compact" | "regular";
}

interface FileIconConfig {
  label: string;
  tone: string;
}

const FILE_ICON_CONFIGS: Record<string, FileIconConfig> = {
  cjs: { label: "JS", tone: "javascript" },
  css: { label: "CS", tone: "css" },
  htm: { label: "HT", tone: "html" },
  html: { label: "HT", tone: "html" },
  java: { label: "JV", tone: "java" },
  js: { label: "JS", tone: "javascript" },
  json: { label: "JN", tone: "json" },
  jsonc: { label: "JN", tone: "json" },
  jsx: { label: "JX", tone: "react" },
  less: { label: "CS", tone: "css" },
  markdown: { label: "MD", tone: "markdown" },
  md: { label: "MD", tone: "markdown" },
  mjs: { label: "JS", tone: "javascript" },
  py: { label: "PY", tone: "python" },
  rs: { label: "RS", tone: "rust" },
  sass: { label: "CS", tone: "css" },
  scss: { label: "CS", tone: "css" },
  sh: { label: "SH", tone: "shell" },
  sql: { label: "DB", tone: "database" },
  ts: { label: "TS", tone: "typescript" },
  tsx: { label: "TX", tone: "react" },
  txt: { label: "TX", tone: "text" },
  vue: { label: "VU", tone: "vue" },
  xml: { label: "XM", tone: "xml" },
  yaml: { label: "YA", tone: "yaml" },
  yml: { label: "YA", tone: "yaml" },
};

export function FileIcon({ fileName, size = "regular" }: FileIconProps) {
  const { label, tone } = getFileIconConfig(fileName);

  return (
    <span
      aria-hidden="true"
      className={`file-icon file-icon--${size} file-icon--${tone}`}
      title={fileName}
    >
      {label}
    </span>
  );
}

export function isMarkdownFile(fileName?: string) {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  return extension === "md" || extension === "markdown";
}

function getFileIconConfig(fileName: string): FileIconConfig {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension) {
    return {
      label: "FI",
      tone: "text",
    };
  }

  return FILE_ICON_CONFIGS[extension] ?? { label: extension.slice(0, 2).toUpperCase(), tone: "text" };
}
