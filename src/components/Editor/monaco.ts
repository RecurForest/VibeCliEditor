import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

export const MONACO_THEME = "jterminal-dark";

const globalScope = self as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_workerId: string, label: string) => Worker;
  };
};

let configured = false;

export function configureMonaco() {
  if (configured) {
    return monaco;
  }

  globalScope.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case "json":
          return new jsonWorker();
        case "css":
        case "scss":
        case "less":
          return new cssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker();
        case "typescript":
        case "javascript":
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };

  loader.config({ monaco });

  monaco.editor.defineTheme(MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A9955" },
      { token: "keyword", foreground: "C586C0" },
      { token: "number", foreground: "B5CEA8" },
      { token: "string", foreground: "CE9178" },
      { token: "type.identifier", foreground: "4EC9B0" },
    ],
    colors: {
      "editor.background": "#181818",
      "editor.foreground": "#CCCCCC",
      "editor.lineHighlightBackground": "#1F1F1F",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#094771",
      "editor.selectionHighlightBackground": "#264F78",
      "editorCursor.foreground": "#FFFFFF",
      "editorWhitespace.foreground": "#2A2A2A",
      "editorIndentGuide.background1": "#2A2A2A",
      "editorIndentGuide.activeBackground1": "#3C3C3C",
      "editorLineNumber.foreground": "#858585",
      "editorLineNumber.activeForeground": "#CCCCCC",
      "editorGutter.background": "#181818",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#424242AA",
      "scrollbarSlider.hoverBackground": "#4F4F4FCC",
      "scrollbarSlider.activeBackground": "#5A5A5ACC",
      "minimap.background": "#181818",
    },
  });

  configured = true;
  return monaco;
}

export function resolveEditorLanguage(fileName?: string) {
  const extension = fileName?.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "java":
      return "java";
    case "xml":
    case "svg":
    case "xsd":
    case "wsdl":
    case "plist":
    case "pom":
    case "csproj":
      return "xml";
    case "html":
    case "htm":
    case "xhtml":
      return "html";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "json":
    case "jsonc":
      return "json";
    case "md":
      return "markdown";
    case "rs":
      return "rust";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
      return "shell";
    default:
      return "plaintext";
  }
}

configureMonaco();
