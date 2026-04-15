import { invoke } from "@tauri-apps/api/core";
import { FileSearch, LoaderCircle } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { FileSearchResult } from "../../types";

const SEARCH_DEBOUNCE_MS = 320;
const MIN_SEARCH_LENGTH = 2;

interface WorkspaceFileSearchProps {
  rootPath: string | null;
  onOpenResult: (result: FileSearchResult) => Promise<void> | void;
}

export function WorkspaceFileSearch({ rootPath, onOpenResult }: WorkspaceFileSearchProps) {
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const trimmedQuery = query.trim();
  const hasResults = results.length > 0;
  const canSearch = Boolean(rootPath);
  const shouldShowPanel = isOpen && canSearch && trimmedQuery.length > 0;
  const emptyMessage =
    trimmedQuery.length < MIN_SEARCH_LENGTH
      ? `Type at least ${MIN_SEARCH_LENGTH} characters`
      : isLoading
        ? "Searching files..."
        : "No matching files";

  const highlightedResult = useMemo(
    () => results[highlightedIndex] ?? results[0] ?? null,
    [highlightedIndex, results],
  );

  useEffect(() => {
    if (!rootPath) {
      requestIdRef.current += 1;
      setQuery("");
      setResults([]);
      setHighlightedIndex(0);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    if (trimmedQuery.length < MIN_SEARCH_LENGTH) {
      requestIdRef.current += 1;
      setResults([]);
      setHighlightedIndex(0);
      setIsLoading(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);

      try {
        const nextResults = await invoke<FileSearchResult[]>("search_files", {
          query: trimmedQuery,
          rootPath,
        });

        if (requestIdRef.current === currentRequestId) {
          setResults(nextResults);
          setHighlightedIndex(0);
          setIsOpen(true);
        }
      } catch {
        if (requestIdRef.current === currentRequestId) {
          setResults([]);
          setHighlightedIndex(0);
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
  }, [rootPath, trimmedQuery]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!containerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  async function handleResultOpen(result: FileSearchResult) {
    await onOpenResult(result);
    setQuery("");
    setResults([]);
    setHighlightedIndex(0);
    setIsLoading(false);
    setIsOpen(false);
  }

  async function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!results.length) {
        return;
      }

      setIsOpen(true);
      setHighlightedIndex((value) => (value + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!results.length) {
        return;
      }

      setIsOpen(true);
      setHighlightedIndex((value) => (value - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter") {
      if (!highlightedResult) {
        return;
      }

      event.preventDefault();
      await handleResultOpen(highlightedResult);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className="workspace-search" data-no-drag="true" ref={containerRef}>
      <label className="workspace-search__field" htmlFor={inputId}>
        <FileSearch className="workspace-search__icon" size={14} />
        <input
          autoComplete="off"
          className="workspace-search__input"
          disabled={!canSearch}
          id={inputId}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (trimmedQuery) {
              setIsOpen(true);
            }
          }}
          onKeyDown={(event) => void handleInputKeyDown(event)}
          placeholder={canSearch ? "Search files in workspace" : "Open a workspace to search"}
          type="text"
          value={query}
        />
        {isLoading ? <LoaderCircle className="workspace-search__spinner" size={13} /> : null}
      </label>

      {shouldShowPanel ? (
        <div className="workspace-search__panel">
          {hasResults ? (
            results.map((result, index) => (
              <button
                className="workspace-search__result"
                data-highlighted={index === highlightedIndex}
                key={result.absPath}
                onClick={() => void handleResultOpen(result)}
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
      ) : null}
    </div>
  );
}
