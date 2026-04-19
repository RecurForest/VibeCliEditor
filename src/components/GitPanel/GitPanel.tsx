import { ChevronDown, ChevronRight, GitBranch, Plus, RefreshCw } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { GitChangeEntry, GitChangeGroup, GitRepositoryChanges } from "../../types";
import { useViewportConstrainedMenuPosition } from "../../utils/contextMenu";
import { FileIcon } from "../FileIcon/FileIcon";

interface GitPanelProps {
  activePath: string | null;
  activeRepositoryRoot: string | null;
  amend: boolean;
  branch: string;
  changes: GitChangeEntry[];
  checkedPaths: string[];
  commitError: string | null;
  commitFeedback: string | null;
  commitMessage: string;
  error: string | null;
  hasRepository: boolean;
  isCommitBusy: boolean;
  isLoading: boolean;
  isPushBusy: boolean;
  onActivatePath: (absPath: string) => void;
  onAddToGitignore: (absPaths: string[]) => void;
  onCommit: () => void;
  onDeletePaths: (absPaths: string[]) => void;
  onJumpToSource: (entry: GitChangeEntry) => void;
  onPush: () => void;
  onRefresh: () => void;
  onRollbackPaths: (absPaths: string[]) => void;
  onSelectRepository: (rootPath: string) => void;
  onSetAmend: (value: boolean) => void;
  onSetCommitMessage: (value: string) => void;
  onSetGroupChecked: (group: GitChangeGroup, checked: boolean) => void;
  onStagePaths: (absPaths: string[]) => void;
  onToggleCheckedPath: (absPath: string) => void;
  repositories: GitRepositoryChanges[];
  unversioned: GitChangeEntry[];
}

interface GitContextMenuState {
  entry: GitChangeEntry;
  x: number;
  y: number;
}

export function GitPanel({
  activePath,
  activeRepositoryRoot,
  amend,
  branch,
  changes,
  checkedPaths,
  commitError,
  commitFeedback,
  commitMessage,
  error,
  hasRepository,
  isCommitBusy,
  isLoading,
  isPushBusy,
  onActivatePath,
  onAddToGitignore,
  onCommit,
  onDeletePaths,
  onJumpToSource,
  onPush,
  onRefresh,
  onRollbackPaths,
  onSelectRepository,
  onSetAmend,
  onSetCommitMessage,
  onSetGroupChecked,
  onStagePaths,
  onToggleCheckedPath,
  repositories,
  unversioned,
}: GitPanelProps) {
  const isActionBusy = isCommitBusy || isPushBusy;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<GitChangeGroup, boolean>>({
    changes: false,
    unversioned: false,
  });
  const [contextMenu, setContextMenu] = useState<GitContextMenuState | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const lastSelectedPathRef = useRef<string | null>(null);

  const allEntries = useMemo(() => [...changes, ...unversioned], [changes, unversioned]);
  const entriesByPath = useMemo(
    () => new Map(allEntries.map((entry) => [entry.absPath, entry] as const)),
    [allEntries],
  );
  const checkedPathSet = useMemo(() => new Set(checkedPaths), [checkedPaths]);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedCount = checkedPaths.length;
  const contextEntries = useMemo(() => {
    if (!contextMenu) {
      return [];
    }

    if (!selectedPathSet.has(contextMenu.entry.absPath)) {
      return [contextMenu.entry];
    }

    return selectedPaths
      .map((path) => entriesByPath.get(path))
      .filter((entry): entry is GitChangeEntry => Boolean(entry));
  }, [contextMenu, entriesByPath, selectedPathSet, selectedPaths]);
  const contextPaths = useMemo(
    () => contextEntries.map((entry) => entry.absPath),
    [contextEntries],
  );
  const deletableContextPaths = useMemo(
    () =>
      contextEntries
        .filter((entry) => entry.status !== "deleted")
        .map((entry) => entry.absPath),
    [contextEntries],
  );
  const canAddContextEntriesToGitignore =
    contextEntries.length > 0 && contextEntries.every((entry) => entry.group === "unversioned");
  const checkedUnversionedPaths = useMemo(
    () =>
      unversioned
        .filter((entry) => checkedPathSet.has(entry.absPath))
        .map((entry) => entry.absPath),
    [checkedPathSet, unversioned],
  );
  const contextMenuStyle = useViewportConstrainedMenuPosition(contextMenu, contextMenuRef);

  function toggleGroupCollapsed(group: GitChangeGroup) {
    setCollapsedGroups((currentState) => ({
      ...currentState,
      [group]: !currentState[group],
    }));
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function updateSelectionForInteraction(
    event: Pick<ReactMouseEvent<HTMLButtonElement>, "ctrlKey" | "metaKey" | "shiftKey">,
    entry: GitChangeEntry,
    mode: "activate" | "context",
  ) {
    const nextSelectedPaths = resolveNextSelectedPaths({
      allEntries,
      currentSelectedPaths: selectedPaths,
      entry,
      isRangeSelection: event.shiftKey,
      isToggleSelection: event.ctrlKey || event.metaKey,
      lastSelectedPath: lastSelectedPathRef.current,
      mode,
    });

    lastSelectedPathRef.current = entry.absPath;
    setSelectedPaths(nextSelectedPaths);
    return nextSelectedPaths;
  }

  function openContextMenu(event: ReactMouseEvent<HTMLButtonElement>, entry: GitChangeEntry) {
    event.preventDefault();
    event.stopPropagation();
    updateSelectionForInteraction(event, entry, "context");
    setContextMenu({
      entry,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleRowActivate(event: ReactMouseEvent<HTMLButtonElement>, entry: GitChangeEntry) {
    const nextSelectedPaths = updateSelectionForInteraction(event, entry, "activate");
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (nextSelectedPaths.length === 1 && nextSelectedPaths[0] === entry.absPath) {
      onActivatePath(entry.absPath);
    }
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!contextMenuRef.current?.contains(target)) {
        closeContextMenu();
      }
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeydown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  useEffect(() => {
    const nextPathSet = new Set(allEntries.map((entry) => entry.absPath));
    setSelectedPaths((currentPaths) => currentPaths.filter((path) => nextPathSet.has(path)));

    if (lastSelectedPathRef.current && !nextPathSet.has(lastSelectedPathRef.current)) {
      lastSelectedPathRef.current = null;
    }
  }, [allEntries]);

  return (
    <aside className="git-panel">
      <div className="git-panel__header">
        <div className="git-panel__header-main">
          <div className="git-panel__header-top">
            <div className="git-panel__heading">
              <div className="explorer__eyebrow">Git</div>
              <div className="git-panel__branch">
                <GitBranch size={13} />
                {branch || "No branch"}
              </div>
            </div>

            <button
              className="explorer__icon-button"
              disabled={isLoading}
              onClick={onRefresh}
              title="Refresh Git changes"
              type="button"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {repositories.length > 1 ? (
            <div className="git-panel__repositories">
              {repositories.map((repository) => {
                const totalCount = repository.changes.length + repository.unversioned.length;
                const isActiveRepository = repository.rootPath === activeRepositoryRoot;

                return (
                  <button
                    className="git-panel__repository"
                    data-active={isActiveRepository}
                    key={repository.rootPath}
                    onClick={() => onSelectRepository(repository.rootPath)}
                    title={repository.relativePath === "." ? repository.name : repository.relativePath}
                    type="button"
                  >
                    <span className="git-panel__repository-copy">
                      <span className="git-panel__repository-name">{repository.name}</span>
                      <span className="git-panel__repository-path">
                        {repository.relativePath === "." ? "workspace root" : repository.relativePath}
                      </span>
                    </span>
                    <span className="git-panel__repository-meta">
                      {totalCount > 0 ? `${totalCount}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="git-panel__content">
        {isLoading && !hasRepository ? <div className="explorer__empty">Loading Git changes...</div> : null}

        {!isLoading && error ? (
          <div className="explorer__empty-state">
            <div className="explorer__empty-title">Git unavailable</div>
            <div className="explorer__empty-copy">{error}</div>
          </div>
        ) : null}

        {!isLoading && !error && !hasRepository ? (
          <div className="explorer__empty-state">
            <div className="explorer__empty-title">No Git repository</div>
            <div className="explorer__empty-copy">
              Open a folder that belongs to a Git repository to inspect and commit changes here.
            </div>
          </div>
        ) : null}

        {!isLoading && !error && hasRepository && changes.length === 0 && unversioned.length === 0 ? (
          <div className="explorer__empty-state">
            <div className="explorer__empty-title">Working tree clean</div>
            <div className="explorer__empty-copy">
              No modified or unversioned files are waiting in this workspace.
            </div>
          </div>
        ) : null}

        {!error && hasRepository ? (
          <div className="git-panel__groups">
            <GitChangeGroupSection
              activePath={activePath}
              checkedPathSet={checkedPathSet}
              entries={changes}
              group="changes"
              isCollapsed={collapsedGroups.changes}
              onActivatePath={handleRowActivate}
              onOpenContextMenu={openContextMenu}
              onSetGroupChecked={onSetGroupChecked}
              selectedPathSet={selectedPathSet}
              onToggleCheckedPath={onToggleCheckedPath}
              onToggleCollapsed={toggleGroupCollapsed}
              title="Changes"
            />

            <GitChangeGroupSection
              activePath={activePath}
              actionButton={
                <button
                  aria-label="Add checked unversioned files to VCS"
                  className="git-panel__group-action"
                  disabled={checkedUnversionedPaths.length === 0}
                  onClick={() => onStagePaths(checkedUnversionedPaths)}
                  title="Add checked files to VCS"
                  type="button"
                >
                  <Plus size={12} />
                </button>
              }
              checkedPathSet={checkedPathSet}
              entries={unversioned}
              group="unversioned"
              isCollapsed={collapsedGroups.unversioned}
              onActivatePath={handleRowActivate}
              onOpenContextMenu={openContextMenu}
              onSetGroupChecked={onSetGroupChecked}
              selectedPathSet={selectedPathSet}
              onToggleCheckedPath={onToggleCheckedPath}
              onToggleCollapsed={toggleGroupCollapsed}
              title="Unversioned Files"
            />
          </div>
        ) : null}
      </div>

      <div className="git-panel__commit">
        <label className="git-panel__amend">
          <input
            checked={amend}
            disabled={!hasRepository || isActionBusy}
            onChange={(event) => onSetAmend(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>Amend</span>
        </label>

        <textarea
          className="git-panel__message"
          disabled={!hasRepository || isActionBusy}
          onChange={(event) => onSetCommitMessage(event.currentTarget.value)}
          placeholder="Commit message"
          spellCheck={false}
          value={commitMessage}
        />

        {commitError ? <div className="git-panel__feedback git-panel__feedback--error">{commitError}</div> : null}
        {!commitError && commitFeedback ? (
          <div className="git-panel__feedback git-panel__feedback--info">{commitFeedback}</div>
        ) : null}

        <div className="git-panel__commit-actions">
          <span className="git-panel__selection-count">{selectedCount} selected</span>
          <div className="git-panel__commit-buttons">
            <button
              className="git-panel__commit-button"
              disabled={!hasRepository || isActionBusy || selectedCount === 0}
              onClick={onCommit}
              type="button"
            >
              {isCommitBusy ? "Committing..." : "Commit"}
            </button>
            <button
              className="git-panel__commit-button git-panel__commit-button--secondary"
              disabled={!hasRepository || isActionBusy}
              onClick={onPush}
              type="button"
            >
              {isPushBusy ? "Pushing..." : "Push"}
            </button>
          </div>
        </div>
      </div>

      {contextMenu ? (
        <div
          className="context-menu context-menu--git"
          onClick={(event) => event.stopPropagation()}
          ref={contextMenuRef}
          style={contextMenuStyle}
        >
          <button
            className="context-menu__button"
            onClick={() => {
              closeContextMenu();
              onActivatePath(contextMenu.entry.absPath);
            }}
            type="button"
          >
            Show Diff
          </button>
          <button
            className="context-menu__button"
            disabled={contextMenu.entry.status === "deleted"}
            onClick={() => {
              closeContextMenu();
              onJumpToSource(contextMenu.entry);
            }}
            type="button"
          >
            Jump to Source
          </button>
          <div className="context-menu__separator" />
          <button
            className="context-menu__button context-menu__button--danger"
            onClick={() => {
              closeContextMenu();
              onRollbackPaths(contextPaths);
            }}
            type="button"
          >
            Rollback...
          </button>
          <button
            className="context-menu__button"
            onClick={() => {
              closeContextMenu();
              onStagePaths(contextPaths);
            }}
            type="button"
          >
            Add to VCS
          </button>
          <button
            className="context-menu__button"
            disabled={!canAddContextEntriesToGitignore}
            onClick={() => {
              closeContextMenu();
              onAddToGitignore(contextPaths);
            }}
            type="button"
          >
            Add to .gitignore
          </button>
          <div className="context-menu__separator" />
          <button
            className="context-menu__button"
            onClick={() => {
              closeContextMenu();
              onRefresh();
            }}
            type="button"
          >
            Refresh
          </button>
          <div className="context-menu__separator" />
          <button
            className="context-menu__button context-menu__button--danger"
            disabled={deletableContextPaths.length === 0}
            onClick={() => {
              closeContextMenu();
              onDeletePaths(deletableContextPaths);
            }}
            type="button"
          >
            Delete
          </button>
        </div>
      ) : null}
    </aside>
  );
}

interface GitChangeGroupSectionProps {
  activePath: string | null;
  actionButton?: ReactNode;
  checkedPathSet: Set<string>;
  entries: GitChangeEntry[];
  group: GitChangeGroup;
  isCollapsed: boolean;
  onActivatePath: (event: ReactMouseEvent<HTMLButtonElement>, entry: GitChangeEntry) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, entry: GitChangeEntry) => void;
  onSetGroupChecked: (group: GitChangeGroup, checked: boolean) => void;
  selectedPathSet: Set<string>;
  onToggleCheckedPath: (absPath: string) => void;
  onToggleCollapsed: (group: GitChangeGroup) => void;
  title: string;
}

function GitChangeGroupSection({
  activePath,
  actionButton,
  checkedPathSet,
  entries,
  group,
  isCollapsed,
  onActivatePath,
  onOpenContextMenu,
  onSetGroupChecked,
  selectedPathSet,
  onToggleCheckedPath,
  onToggleCollapsed,
  title,
}: GitChangeGroupSectionProps) {
  if (!entries.length) {
    return null;
  }

  const checkedCount = entries.filter((entry) => checkedPathSet.has(entry.absPath)).length;
  const allChecked = checkedCount === entries.length;
  const partiallyChecked = checkedCount > 0 && checkedCount < entries.length;

  return (
    <section className="git-panel__group">
      <div className="git-panel__group-header">
        <button
          className="git-panel__group-toggle"
          onClick={() => onToggleCollapsed(group)}
          type="button"
        >
          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>

        <label className="git-panel__group-check">
          <input
            checked={allChecked}
            onChange={(event) => onSetGroupChecked(group, event.currentTarget.checked)}
            type="checkbox"
          />
          <span className="git-panel__group-title">{title}</span>
        </label>

        <span className="git-panel__group-count" data-partial={partiallyChecked}>
          {entries.length} files
        </span>

        {actionButton}
      </div>

      {!isCollapsed ? (
        <div className="git-panel__rows">
          {entries.map((entry) => (
            <GitChangeRow
              activePath={activePath}
              checked={checkedPathSet.has(entry.absPath)}
              entry={entry}
              key={entry.absPath}
              onActivatePath={onActivatePath}
              onOpenContextMenu={onOpenContextMenu}
              selected={selectedPathSet.has(entry.absPath)}
              onToggleCheckedPath={onToggleCheckedPath}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface GitChangeRowProps {
  activePath: string | null;
  checked: boolean;
  entry: GitChangeEntry;
  onActivatePath: (event: ReactMouseEvent<HTMLButtonElement>, entry: GitChangeEntry) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, entry: GitChangeEntry) => void;
  selected: boolean;
  onToggleCheckedPath: (absPath: string) => void;
}

function GitChangeRow({
  activePath,
  checked,
  entry,
  onActivatePath,
  onOpenContextMenu,
  selected,
  onToggleCheckedPath,
}: GitChangeRowProps) {
  const segments = entry.path.split(/[\\/]/);
  const fileName = segments.pop() ?? entry.path;
  const parentPath = segments.join("/");
  const inlinePath = parentPath;
  const fullPathTitle = entry.previousPath
    ? `${entry.path}\nfrom ${entry.previousPath}`
    : entry.path;

  return (
    <button
      className="git-panel__row"
      data-active={entry.absPath === activePath}
      data-selected={selected}
      onClick={(event) => onActivatePath(event, entry)}
      onContextMenu={(event) => onOpenContextMenu(event, entry)}
      title={fullPathTitle}
      type="button"
    >
      <input
        checked={checked}
        className="git-panel__row-check"
        onChange={() => onToggleCheckedPath(entry.absPath)}
        onClick={(event) => event.stopPropagation()}
        type="checkbox"
      />

      <FileIcon fileName={fileName} size="compact" />

      <span className="git-panel__row-main">
        <span
          className="git-panel__row-name"
          data-group={entry.group}
          data-status={entry.status}
        >
          {fileName}
        </span>
        {inlinePath ? <span className="git-panel__row-path">{inlinePath}</span> : null}
        {entry.previousPath ? (
          <span className="git-panel__row-rename">from {entry.previousPath}</span>
        ) : null}
      </span>
    </button>
  );
}

interface ResolveNextSelectedPathsOptions {
  allEntries: GitChangeEntry[];
  currentSelectedPaths: string[];
  entry: GitChangeEntry;
  isRangeSelection: boolean;
  isToggleSelection: boolean;
  lastSelectedPath: string | null;
  mode: "activate" | "context";
}

function resolveNextSelectedPaths({
  allEntries,
  currentSelectedPaths,
  entry,
  isRangeSelection,
  isToggleSelection,
  lastSelectedPath,
  mode,
}: ResolveNextSelectedPathsOptions) {
  const currentSelectionSet = new Set(currentSelectedPaths);
  const targetPath = entry.absPath;

  if (mode === "context" && currentSelectionSet.has(targetPath)) {
    return currentSelectedPaths;
  }

  if (isRangeSelection && lastSelectedPath) {
    const rangePaths = resolveSelectionRange(allEntries, lastSelectedPath, targetPath);
    if (rangePaths.length) {
      if (isToggleSelection) {
        return Array.from(new Set([...currentSelectedPaths, ...rangePaths]));
      }

      return rangePaths;
    }
  }

  if (isToggleSelection) {
    if (currentSelectionSet.has(targetPath)) {
      return currentSelectedPaths.filter((path) => path !== targetPath);
    }

    return [...currentSelectedPaths, targetPath];
  }

  return [targetPath];
}

function resolveSelectionRange(
  allEntries: GitChangeEntry[],
  fromPath: string,
  toPath: string,
) {
  const startIndex = allEntries.findIndex((entry) => entry.absPath === fromPath);
  const endIndex = allEntries.findIndex((entry) => entry.absPath === toPath);

  if (startIndex === -1 || endIndex === -1) {
    return [];
  }

  const rangeStart = Math.min(startIndex, endIndex);
  const rangeEnd = Math.max(startIndex, endIndex);

  return allEntries.slice(rangeStart, rangeEnd + 1).map((entry) => entry.absPath);
}
