import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GitChangeEntry,
  GitChangeGroup,
  GitChangesResult,
  GitCommitResult,
  GitDiffResult,
  GitRepositoryChanges,
} from "../../types";

interface UseGitPanelOptions {
  rootPath: string | null;
}

export function useGitPanel({ rootPath }: UseGitPanelOptions) {
  const [result, setResult] = useState<GitChangesResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRepositoryRoot, setActiveRepositoryRoot] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [checkedPaths, setCheckedPaths] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [isCommitBusy, setIsCommitBusy] = useState(false);
  const [isPushBusy, setIsPushBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitFeedback, setCommitFeedback] = useState<string | null>(null);
  const currentRootPathRef = useRef<string | null>(rootPath);
  const currentRepositoryRootRef = useRef<string | null>(null);

  useEffect(() => {
    currentRootPathRef.current = rootPath;
  }, [rootPath]);

  useEffect(() => {
    currentRepositoryRootRef.current = activeRepositoryRoot;
  }, [activeRepositoryRoot]);

  const repositories = useMemo(
    () => result?.repositories ?? [],
    [result],
  );
  const activeRepository = useMemo(
    () =>
      repositories.find((repository) => repository.rootPath === activeRepositoryRoot)
      ?? repositories[0]
      ?? null,
    [activeRepositoryRoot, repositories],
  );
  const entries = useMemo(
    () => (activeRepository ? [...activeRepository.changes, ...activeRepository.unversioned] : []),
    [activeRepository],
  );
  const activeGitRootPath = activeRepository?.rootPath ?? rootPath;

  const refresh = useCallback(
    async (options?: { retainChecked?: boolean }) => {
      if (!rootPath) {
        setResult(null);
        setError(null);
        setActiveRepositoryRoot(null);
        setActivePath(null);
        setCheckedPaths([]);
        return null;
      }

      setIsLoading(true);
      try {
        const nextResult = await invoke<GitChangesResult>("get_git_changes", { rootPath });
        if (!isSameRootPath(currentRootPathRef.current, rootPath)) {
          return null;
        }

        const nextActiveRepository = resolveNextActiveRepository(
          currentRepositoryRootRef.current,
          nextResult.repositories,
        );
        const nextEntries = nextActiveRepository
          ? [...nextActiveRepository.changes, ...nextActiveRepository.unversioned]
          : [];

        setResult(nextResult);
        setError(null);
        setActiveRepositoryRoot(nextActiveRepository?.rootPath ?? null);
        setActivePath((currentPath) =>
          nextEntries.some((entry) => entry.absPath === currentPath)
            ? currentPath
            : nextEntries[0]?.absPath ?? null,
        );
        setCheckedPaths((currentPaths) =>
          resolveNextCheckedPaths(currentPaths, nextEntries, options?.retainChecked ?? true),
        );

        return nextResult;
      } catch (reason) {
        if (!isSameRootPath(currentRootPathRef.current, rootPath)) {
          return null;
        }

        setResult(null);
        setError(getErrorMessage(reason, "Unable to load Git changes."));
        setActiveRepositoryRoot(null);
        setActivePath(null);
        setCheckedPaths([]);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [rootPath],
  );

  useEffect(() => {
    void refresh({ retainChecked: false });
  }, [refresh]);

  const openDiff = useCallback(
    async (absPath: string) => {
      if (!activeGitRootPath) {
        return null;
      }

      setActivePath(absPath);
      setCommitError(null);
      try {
        return await invoke<GitDiffResult>("get_git_diff", {
          absPath,
          rootPath: activeGitRootPath,
        });
      } catch (reason) {
        throw new Error(getErrorMessage(reason, "Unable to load the selected Git diff."));
      }
    },
    [activeGitRootPath],
  );

  const commitSelected = useCallback(async () => {
    if (!activeGitRootPath) {
      throw new Error("Open a workspace before committing.");
    }

    setIsCommitBusy(true);
    setCommitError(null);
    setCommitFeedback(null);

    try {
      const commitResult = await invoke<GitCommitResult>("commit_git_selection", {
        absPaths: checkedPaths,
        amend,
        message: commitMessage,
        rootPath: activeGitRootPath,
      });

      setCommitMessage("");
      setCommitFeedback(
        commitResult.summary
          ? `Committed ${commitResult.summary}`
          : `Committed ${checkedPaths.length} file(s).`,
      );
      await refresh({ retainChecked: false });

      return commitResult;
    } catch (reason) {
      const message = getErrorMessage(reason, "Unable to commit the selected files.");
      setCommitError(message);
      throw new Error(message);
    } finally {
      setIsCommitBusy(false);
    }
  }, [activeGitRootPath, amend, checkedPaths, commitMessage, refresh]);

  const pushBranch = useCallback(async () => {
    if (!activeGitRootPath) {
      throw new Error("Open a workspace before pushing.");
    }

    setIsPushBusy(true);
    setCommitError(null);
    setCommitFeedback(null);

    try {
      const branch = await invoke<string>("push_git_branch", {
        rootPath: activeGitRootPath,
      });
      setCommitFeedback(branch ? `Pushed ${branch}` : "Push completed.");
      await refresh({ retainChecked: true });
      return branch;
    } catch (reason) {
      const message = getErrorMessage(reason, "Unable to push the current branch.");
      setCommitError(message);
      throw new Error(message);
    } finally {
      setIsPushBusy(false);
    }
  }, [activeGitRootPath, refresh]);

  const stagePaths = useCallback(
    async (absPaths: string[]) => {
      if (!activeGitRootPath) {
        throw new Error("Open a workspace before staging files.");
      }

      await invoke("stage_git_paths", {
        absPaths,
        rootPath: activeGitRootPath,
      });
      await refresh({ retainChecked: true });
    },
    [activeGitRootPath, refresh],
  );

  const rollbackPaths = useCallback(
    async (absPaths: string[]) => {
      if (!activeGitRootPath) {
        throw new Error("Open a workspace before rolling back files.");
      }

      await invoke("rollback_git_paths", {
        absPaths,
        rootPath: activeGitRootPath,
      });
      await refresh({ retainChecked: true });
    },
    [activeGitRootPath, refresh],
  );

  const ignorePaths = useCallback(
    async (absPaths: string[]) => {
      if (!activeGitRootPath) {
        throw new Error("Open a workspace before updating .gitignore.");
      }

      await invoke("ignore_git_paths", {
        absPaths,
        rootPath: activeGitRootPath,
      });
      await refresh({ retainChecked: true });
    },
    [activeGitRootPath, refresh],
  );

  const deletePaths = useCallback(
    async (absPaths: string[]) => {
      if (!activeGitRootPath) {
        throw new Error("Open a workspace before deleting files.");
      }

      await invoke("delete_git_paths", {
        absPaths,
        rootPath: activeGitRootPath,
      });
      await refresh({ retainChecked: true });
    },
    [activeGitRootPath, refresh],
  );

  const toggleCheckedPath = useCallback((absPath: string) => {
    setCheckedPaths((currentPaths) =>
      currentPaths.includes(absPath)
        ? currentPaths.filter((path) => path !== absPath)
        : [...currentPaths, absPath],
    );
  }, []);

  const setGroupChecked = useCallback(
    (group: GitChangeGroup, checked: boolean) => {
      const groupPaths = entries
        .filter((entry) => entry.group === group)
        .map((entry) => entry.absPath);
      const groupPathSet = new Set(groupPaths);

      setCheckedPaths((currentPaths) => {
        if (checked) {
          return Array.from(new Set([...currentPaths, ...groupPaths]));
        }

        return currentPaths.filter((path) => !groupPathSet.has(path));
      });
    },
    [entries],
  );

  const setCommitMessageValue = useCallback((value: string) => {
    setCommitMessage(value);
    setCommitFeedback(null);
    setCommitError(null);
  }, []);

  const selectRepository = useCallback((repositoryRootPath: string) => {
    setActiveRepositoryRoot(repositoryRootPath);
    const nextRepository = result?.repositories.find(
      (repository) => repository.rootPath === repositoryRootPath,
    );
    const nextEntries = nextRepository
      ? [...nextRepository.changes, ...nextRepository.unversioned]
      : [];

    setActivePath(nextEntries[0]?.absPath ?? null);
    setCheckedPaths(nextEntries.map((entry) => entry.absPath));
    setCommitMessage("");
    setAmend(false);
    setCommitError(null);
    setCommitFeedback(null);
  }, [result]);

  return {
    activePath,
    activeRepositoryRoot: activeRepository?.rootPath ?? null,
    amend,
    branch: activeRepository?.branch ?? "",
    changes: activeRepository?.changes ?? [],
    checkedPaths,
    commitError,
    commitFeedback,
    commitMessage,
    commitSelected,
    deletePaths,
    entries,
    error,
    hasRepository: result?.hasRepository ?? false,
    isCommitBusy,
    isLoading,
    isPushBusy,
    ignorePaths,
    openDiff,
    pushBranch,
    refresh,
    repositories,
    rollbackPaths,
    result,
    setActivePath,
    setAmend,
    setCommitMessage: setCommitMessageValue,
    setGroupChecked,
    selectRepository,
    stagePaths,
    toggleCheckedPath,
    unversioned: activeRepository?.unversioned ?? [],
  };
}

function resolveNextActiveRepository(
  currentRepositoryRoot: string | null,
  repositories: GitRepositoryChanges[],
) {
  if (!repositories.length) {
    return null;
  }

  if (currentRepositoryRoot) {
    const currentRepository = repositories.find(
      (repository) => repository.rootPath === currentRepositoryRoot,
    );
    if (currentRepository) {
      return currentRepository;
    }
  }

  return repositories[0];
}

function resolveNextCheckedPaths(
  currentPaths: string[],
  nextEntries: GitChangeEntry[],
  retainChecked: boolean,
) {
  const nextAbsPaths = nextEntries.map((entry) => entry.absPath);
  if (!nextAbsPaths.length) {
    return [];
  }

  if (retainChecked) {
    const currentPathSet = new Set(currentPaths);
    const retainedPaths = nextAbsPaths.filter((path) => currentPathSet.has(path));
    if (retainedPaths.length || currentPaths.length > 0) {
      return retainedPaths;
    }
  }

  return nextAbsPaths;
}

function getErrorMessage(reason: unknown, fallbackMessage: string) {
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message;
  }

  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }

  return fallbackMessage;
}

function isSameRootPath(left: string | null, right: string | null) {
  return normalizePathKey(left) === normalizePathKey(right);
}

function normalizePathKey(path: string | null) {
  if (!path) {
    return "";
  }

  return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}
