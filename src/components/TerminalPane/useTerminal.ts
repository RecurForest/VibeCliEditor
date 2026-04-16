import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CodexDiffSessionState,
  PathInsertMode,
  SessionDiffResult,
  SessionDiffViewButtonState,
  ShellKind,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionInfo,
  TerminalSessionMode,
  TerminalSessionRecord,
} from "../../types";

interface UseTerminalOptions {
  launchDir: string | null;
  ownsSessionDiffLifecycle?: boolean;
  onSessionComplete?: () => void;
  shellKind: ShellKind;
  workingDir: string | null;
}

interface StartSessionOptions {
  initialCommand?: string | null;
  mode: TerminalSessionMode;
  title: string;
}

export function useTerminal({
  launchDir,
  ownsSessionDiffLifecycle = true,
  onSessionComplete,
  shellKind,
  workingDir,
}: UseTerminalOptions) {
  const terminalBackground = "#252526";
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isSessionDiffEnabled, setIsSessionDiffEnabled] = useState(false);
  const [codexDiffStates, setCodexDiffStates] = useState<Record<string, CodexDiffSessionState>>({});
  const [error, setError] = useState<string | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);

  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isSessionDiffEnabledRef = useRef(false);
  const lastWorkingDirRef = useRef<string | null>(null);
  const sessionsRef = useRef<TerminalSessionRecord[]>([]);
  const selectedSessionIdRef = useRef<string | null>(null);
  const codexDiffStatesRef = useRef<Record<string, CodexDiffSessionState>>({});
  const sessionDiffCaptureVersionRef = useRef<Record<string, number>>({});
  const sessionTitleInputRef = useRef<Record<string, string>>({});
  const sessionHasCustomTitleRef = useRef<Record<string, boolean>>({});

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerElement(node);
  }, []);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const selectedSessionDiffState = useMemo(
    () => (selectedSession ? codexDiffStates[selectedSession.id] ?? null : null),
    [codexDiffStates, selectedSession],
  );
  const supportsSelectedSessionDiff = supportsSessionDiff(selectedSession?.mode);

  useEffect(() => {
    isSessionDiffEnabledRef.current = isSessionDiffEnabled;
  }, [isSessionDiffEnabled]);

  const pasteTextIntoTerminal = useCallback(async () => {
    if (!terminalRef.current || !navigator.clipboard?.readText) {
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }

      const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
      if (!activeSession || activeSession.status !== "active") {
        return;
      }

      terminalRef.current.paste(text);
      terminalRef.current.focus();
      setError(null);
    } catch (reason) {
      console.error("[terminal] Failed to read clipboard text.", reason);
    }
  }, []);

  const copyTerminalSelection = useCallback(async () => {
    const terminal = terminalRef.current;
    const selectedText = terminal?.hasSelection() ? terminal.getSelection() : "";

    if (!selectedText) {
      return false;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selectedText);
      }

      return true;
    } catch (reason) {
      console.error("[terminal] Failed to copy selected text.", reason);
      return false;
    }
  }, []);

  const applySessions = useCallback((updater: (current: TerminalSessionRecord[]) => TerminalSessionRecord[]) => {
    const nextSessions = updater(sessionsRef.current);
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);

    const activeSessionIds = new Set(nextSessions.map((session) => session.id));
    for (const sessionId of Object.keys(sessionTitleInputRef.current)) {
      if (!activeSessionIds.has(sessionId)) {
        delete sessionTitleInputRef.current[sessionId];
      }
    }

    for (const sessionId of Object.keys(sessionHasCustomTitleRef.current)) {
      if (!activeSessionIds.has(sessionId)) {
        delete sessionHasCustomTitleRef.current[sessionId];
      }
    }

    return nextSessions;
  }, []);

  const applyCodexDiffStates = useCallback(
    (
      updater: (
        current: Record<string, CodexDiffSessionState>,
      ) => Record<string, CodexDiffSessionState>,
    ) => {
      const nextStates = updater(codexDiffStatesRef.current);
      codexDiffStatesRef.current = nextStates;
      setCodexDiffStates(nextStates);
      return nextStates;
    },
    [],
  );

  const disposeSessionDiffBaselines = useCallback(
    (keepSessionId: string | null = null) => {
      if (!ownsSessionDiffLifecycle) {
        return;
      }

      void invoke("dispose_session_diff_baselines", { keepSessionId }).catch(() => undefined);
    },
    [ownsSessionDiffLifecycle],
  );

  const disposeSessionDiffBaseline = useCallback(
    (sessionId: string) => {
      if (!sessionId || !ownsSessionDiffLifecycle) {
        return;
      }

      void invoke("dispose_session_diff_baseline", { sessionId }).catch(() => undefined);
    },
    [ownsSessionDiffLifecycle],
  );

  const removeCodexDiffState = useCallback(
    (sessionId: string) => {
      delete sessionDiffCaptureVersionRef.current[sessionId];
      applyCodexDiffStates((current) => {
        if (!(sessionId in current)) {
          return current;
        }

        const nextStates = { ...current };
        delete nextStates[sessionId];
        return nextStates;
      });
    },
    [applyCodexDiffStates],
  );

  const clearCodexDiffStates = useCallback(
    () => {
      sessionDiffCaptureVersionRef.current = {};
      applyCodexDiffStates(() => ({}));
    },
    [applyCodexDiffStates],
  );

  const disposeSessionResources = useCallback(
    (session: TerminalSessionRecord) => {
      if (!supportsSessionDiff(session.mode)) {
        return;
      }

      removeCodexDiffState(session.id);
      disposeSessionDiffBaseline(session.id);
    },
    [disposeSessionDiffBaseline, removeCodexDiffState],
  );

  const disposeSessionResourcesForList = useCallback(
    (sessionsToDispose: TerminalSessionRecord[]) => {
      for (const session of sessionsToDispose) {
        disposeSessionResources(session);
      }
    },
    [disposeSessionResources],
  );

  const captureSessionDiffBaseline = useCallback(
    async (sessionId: string) => {
      if (!ownsSessionDiffLifecycle) {
        throw new Error("Session diff is not enabled for this terminal.");
      }

      if (!workingDir) {
        throw new Error("Open a workspace folder first.");
      }

      const captureVersion = (sessionDiffCaptureVersionRef.current[sessionId] ?? 0) + 1;
      sessionDiffCaptureVersionRef.current[sessionId] = captureVersion;
      applyCodexDiffStates((current) => ({
        ...current,
        [sessionId]: {
          sessionId,
          baselineStatus: "preparing",
          isDiffLoading: false,
          error: null,
        },
      }));

      try {
        await invoke("create_session_diff_baseline", {
          rootPath: workingDir,
          sessionId,
        });

        if (
          !isSessionDiffEnabledRef.current ||
          sessionDiffCaptureVersionRef.current[sessionId] !== captureVersion ||
          !getSessionById(sessionsRef.current, sessionId)
        ) {
          return;
        }

        applyCodexDiffStates((current) => ({
          ...current,
          [sessionId]: {
            sessionId,
            baselineStatus: "ready",
            isDiffLoading: false,
            error: null,
          },
        }));
      } catch (reason) {
        if (
          !isSessionDiffEnabledRef.current ||
          sessionDiffCaptureVersionRef.current[sessionId] !== captureVersion ||
          !getSessionById(sessionsRef.current, sessionId)
        ) {
          return;
        }

        const message = reason instanceof Error ? reason.message : String(reason);
        applyCodexDiffStates((current) => ({
          ...current,
          [sessionId]: {
            sessionId,
            baselineStatus: "error",
            isDiffLoading: false,
            error: message,
          },
        }));
      }
    },
    [applyCodexDiffStates, ownsSessionDiffLifecycle, workingDir],
  );

  const applyFirstInputTitle = useCallback(
    (sessionId: string, input: string) => {
      if (sessionHasCustomTitleRef.current[sessionId]) {
        return;
      }

      const nextTitle = formatSessionTitle(input);
      if (!nextTitle) {
        return;
      }

      sessionHasCustomTitleRef.current[sessionId] = true;
      applySessions((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, title: nextTitle } : session,
        ),
      );
    },
    [applySessions],
  );

  const captureSessionTitleInput = useCallback(
    (sessionId: string, data: string) => {
      if (sessionHasCustomTitleRef.current[sessionId]) {
        return;
      }

      let buffer = sessionTitleInputRef.current[sessionId] ?? "";
      const normalizedInput = stripTerminalControlInput(data);

      for (const character of normalizedInput) {
        if (character === "\r" || character === "\n") {
          applyFirstInputTitle(sessionId, buffer);
          buffer = "";
          continue;
        }

        if (character === "\b" || character === "\u007f") {
          buffer = buffer.slice(0, -1);
          continue;
        }

        if (character === "\t") {
          buffer += " ";
          continue;
        }

        if (isPrintableInputCharacter(character)) {
          buffer += character;
        }
      }

      sessionTitleInputRef.current[sessionId] = buffer.slice(-240);
    },
    [applyFirstInputTitle],
  );

  const renderSessionOutput = useCallback((output: string) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.reset();
    terminal.clear();

    if (output) {
      terminal.write(output);
    }
  }, []);

  const selectSession = useCallback(
    (sessionId: string) => {
      const nextSession = getSessionById(sessionsRef.current, sessionId);
      if (!nextSession) {
        return;
      }

      selectedSessionIdRef.current = sessionId;
      setSelectedSessionId(sessionId);
      renderSessionOutput(nextSession.output);
      if (nextSession.status === "active" && terminalRef.current) {
        void invoke("terminal_resize", {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
          sessionId: nextSession.id,
        }).catch(() => undefined);
      }
      terminalRef.current?.focus();
      setError(null);
    },
    [renderSessionOutput],
  );

  useEffect(() => {
    if (!containerElement || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 1,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: terminalBackground,
        black: terminalBackground,
        blue: "#569cd6",
        brightBlack: "#636369",
        brightBlue: "#9cdcfe",
        brightCyan: "#4ec9b0",
        brightGreen: "#b5cea8",
        brightMagenta: "#c586c0",
        brightRed: "#f48771",
        brightWhite: "#ffffff",
        brightYellow: "#dcdcaa",
        cyan: "#4ec9b0",
        foreground: "#d4d4d4",
        green: "#6a9955",
        magenta: "#c586c0",
        red: "#f48771",
        white: "#d4d4d4",
        yellow: "#dcdcaa",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerElement);
    fitAddon.fit();
    terminal.focus();
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }

      const isCopyShortcut =
        (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "c";
      const isPasteShortcut =
        ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") ||
        (event.shiftKey && event.key === "Insert");

      if (isCopyShortcut && terminal.hasSelection()) {
        void copyTerminalSelection();
        event.preventDefault();
        return false;
      }

      if (!isPasteShortcut) {
        return true;
      }

      void pasteTextIntoTerminal();
      event.preventDefault();
      return false;
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setTerminalReady(true);

    const resizeObserver = new ResizeObserver(() => {
      if (!terminalRef.current || !fitAddonRef.current) {
        return;
      }

      fitAddonRef.current.fit();

      const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
      if (activeSession?.status === "active") {
        void invoke("terminal_resize", {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
          sessionId: activeSession.id,
        }).catch(() => undefined);
      }
    });
    resizeObserver.observe(containerElement);

    const disposable = terminal.onData((data) => {
      const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
      if (!activeSession || activeSession.status !== "active") {
        return;
      }

      captureSessionTitleInput(activeSession.id, data);
      void invoke("terminal_write", {
        data,
        sessionId: activeSession.id,
      }).catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    });

    const handlePaste = (event: ClipboardEvent) => {
      const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
      if (!activeSession || activeSession.status !== "active" || !terminalRef.current) {
        return;
      }

      const text = event.clipboardData?.getData("text/plain");
      if (!text) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      terminalRef.current.paste(text);
      terminalRef.current.focus();
      setError(null);
    };
    containerElement.addEventListener("paste", handlePaste, true);

    return () => {
      resizeObserver.disconnect();
      disposable.dispose();
      containerElement.removeEventListener("paste", handlePaste, true);

      for (const session of sessionsRef.current) {
        if (session.status === "active") {
          void invoke("terminal_close", { sessionId: session.id }).catch(() => undefined);
        }
      }

      if (ownsSessionDiffLifecycle) {
        disposeSessionResourcesForList(sessionsRef.current);
      }
      setTerminalReady(false);
      terminal.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
      selectedSessionIdRef.current = null;
    };
  }, [
    containerElement,
    copyTerminalSelection,
    disposeSessionResourcesForList,
    ownsSessionDiffLifecycle,
    pasteTextIntoTerminal,
  ]);

  useEffect(() => {
    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    void listen<TerminalOutputEvent>("terminal-output", (event) => {
      const targetSession = getSessionById(sessionsRef.current, event.payload.sessionId);
      if (!targetSession) {
        return;
      }

      applySessions((current) =>
        current.map((session) =>
          session.id === event.payload.sessionId
            ? { ...session, output: `${session.output}${event.payload.data}` }
            : session,
        ),
      );

      if (selectedSessionIdRef.current === event.payload.sessionId) {
        terminalRef.current?.write(event.payload.data);
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlistenOutput = dispose;
      }
    });

    void listen<TerminalExitEvent>("terminal-exit", (event) => {
      const targetSession = getSessionById(sessionsRef.current, event.payload.sessionId);
      if (!targetSession) {
        return;
      }

      applySessions((current) =>
        current.map((session) =>
          session.id === event.payload.sessionId
            ? {
                ...session,
                exitCode: event.payload.exitCode ?? null,
                finishedAt: Date.now(),
                status: "completed",
              }
            : session,
        ),
      );

      onSessionComplete?.();
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlistenExit = dispose;
      }
    });

    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, [applySessions, onSessionComplete]);

  const startSession = useCallback(
    async ({ initialCommand, mode, title }: StartSessionOptions) => {
      const targetDir = launchDir ?? workingDir;

      if (!targetDir) {
        throw new Error("Open a workspace folder first.");
      }

      if (!terminalReady || !terminalRef.current || !fitAddonRef.current) {
        throw new Error("Terminal view is not ready yet.");
      }

      fitAddonRef.current.fit();
      setError(null);

      try {
        const session = await invoke<TerminalSessionInfo>("start_terminal", {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
          shellKind,
          startupCommand: initialCommand?.trim() ? initialCommand.trim() : null,
          workingDir: targetDir,
        });

        const nextSession: TerminalSessionRecord = {
          id: session.sessionId,
          mode,
          output: createSessionBanner(title, session.workingDir),
          shellKind: session.shellKind,
          startedAt: Date.now(),
          status: "active",
          title,
          workingDir: session.workingDir,
        };

        sessionTitleInputRef.current[nextSession.id] = "";
        sessionHasCustomTitleRef.current[nextSession.id] = false;
        applySessions((current) => [...current, nextSession]);
        selectedSessionIdRef.current = nextSession.id;
        setSelectedSessionId(nextSession.id);
        renderSessionOutput(nextSession.output);
        terminalRef.current.focus();

        if (isSessionDiffEnabledRef.current && supportsSessionDiff(mode)) {
          void captureSessionDiffBaseline(nextSession.id).catch(() => undefined);
        }

        return nextSession.id;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        throw reason;
      }
    },
    [applySessions, captureSessionDiffBaseline, launchDir, renderSessionOutput, shellKind, terminalReady, workingDir],
  );

  useEffect(() => {
    const previousWorkingDir = lastWorkingDirRef.current;
    lastWorkingDirRef.current = workingDir;

    if (!terminalReady) {
      return;
    }

    if (!workingDir) {
      if (ownsSessionDiffLifecycle) {
        disposeSessionResourcesForList(sessionsRef.current);
        disposeSessionDiffBaselines(null);
        clearCodexDiffStates();
      }
      for (const session of sessionsRef.current) {
        if (session.status === "active") {
          void invoke("terminal_close", { sessionId: session.id }).catch(() => undefined);
        }
      }

      applySessions(() => []);
      sessionTitleInputRef.current = {};
      sessionHasCustomTitleRef.current = {};
      selectedSessionIdRef.current = null;
      setSelectedSessionId(null);
      renderSessionOutput("");
      return;
    }

    if (previousWorkingDir && previousWorkingDir !== workingDir) {
      if (ownsSessionDiffLifecycle) {
        disposeSessionResourcesForList(sessionsRef.current);
        disposeSessionDiffBaselines(null);
        clearCodexDiffStates();
      }
      for (const session of sessionsRef.current) {
        if (session.status === "active") {
          void invoke("terminal_close", { sessionId: session.id }).catch(() => undefined);
        }
      }

      applySessions(() => []);
      sessionTitleInputRef.current = {};
      sessionHasCustomTitleRef.current = {};
      selectedSessionIdRef.current = null;
      setSelectedSessionId(null);
      renderSessionOutput("");
      return;
    }

    if (!selectedSessionIdRef.current) {
      renderSessionOutput("");
    }
  }, [
    applySessions,
    clearCodexDiffStates,
    disposeSessionDiffBaselines,
    disposeSessionResourcesForList,
    ownsSessionDiffLifecycle,
    renderSessionOutput,
    terminalReady,
    workingDir,
  ]);

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const openShell = useCallback(() => {
    void startSession({
      mode: "shell",
      title: shellKind === "powershell" ? "PowerShell" : "CMD",
    }).catch(() => undefined);
  }, [shellKind, startSession]);

  const launchCodex = useCallback(() => {
    void startSession({
      initialCommand: "codex --yolo",
      mode: "codex",
      title: "Codex",
    }).catch(() => undefined);
  }, [startSession]);

  const launchClaude = useCallback(() => {
    void startSession({
      initialCommand: "claude",
      mode: "claude",
      title: "Claude",
    }).catch(() => undefined);
  }, [startSession]);

  const clearTerminal = useCallback(() => {
    const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
    if (!activeSession) {
      return;
    }

    applySessions((current) =>
      current.map((session) =>
        session.id === activeSession.id ? { ...session, output: "" } : session,
      ),
    );
    renderSessionOutput("");
    terminalRef.current?.focus();
  }, [applySessions, renderSessionOutput]);

  const closeTerminal = useCallback(() => {
    const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
    if (!activeSession) {
      return;
    }

    if (activeSession.status === "active") {
      void invoke("terminal_close", { sessionId: activeSession.id }).catch(() => undefined);
    }

    disposeSessionResources(activeSession);

    const currentSessions = sessionsRef.current;
    const sessionIndex = currentSessions.findIndex((session) => session.id === activeSession.id);
    const nextSessions = currentSessions.filter((session) => session.id !== activeSession.id);
    const fallbackSession =
      nextSessions[sessionIndex] ??
      nextSessions[sessionIndex - 1] ??
      nextSessions[nextSessions.length - 1] ??
      null;

    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    selectedSessionIdRef.current = fallbackSession?.id ?? null;
    setSelectedSessionId(fallbackSession?.id ?? null);
    renderSessionOutput(fallbackSession?.output ?? "");
    setError(null);
  }, [disposeSessionResources, renderSessionOutput]);

  const toggleSessionDiff = useCallback(() => {
    const nextEnabled = !isSessionDiffEnabledRef.current;
    setIsSessionDiffEnabled(nextEnabled);
    setError(null);

    if (!nextEnabled) {
      clearCodexDiffStates();
      disposeSessionDiffBaselines(null);
      return;
    }

    const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
    if (!activeSession || !supportsSessionDiff(activeSession.mode)) {
      return;
    }

    void captureSessionDiffBaseline(activeSession.id).catch(() => undefined);
  }, [captureSessionDiffBaseline, clearCodexDiffStates, disposeSessionDiffBaselines]);

  const rebuildSelectedSessionDiffBaseline = useCallback(async () => {
    if (!isSessionDiffEnabledRef.current) {
      throw new Error("Turn on Diff first.");
    }

    const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
    if (!activeSession || !supportsSessionDiff(activeSession.mode)) {
      throw new Error("Select a Codex or Claude session first.");
    }

    await captureSessionDiffBaseline(activeSession.id);
  }, [captureSessionDiffBaseline]);

  const loadSessionDiff = useCallback(
    async (sessionId: string) => {
      if (!isSessionDiffEnabledRef.current) {
        throw new Error("Turn on Diff first.");
      }

      const targetSession = getSessionById(sessionsRef.current, sessionId);
      if (!targetSession || !supportsSessionDiff(targetSession.mode)) {
        throw new Error("Select a Codex or Claude session first.");
      }

      if (!workingDir) {
        throw new Error("Open a workspace folder first.");
      }

      const diffState = codexDiffStatesRef.current[sessionId];
      if (!diffState || diffState.baselineStatus !== "ready") {
        throw new Error(diffState?.error ?? "Capture a baseline first.");
      }

      applyCodexDiffStates((current) => {
        const nextState = current[sessionId];
        if (!nextState) {
          return current;
        }

        return {
          ...current,
          [sessionId]: {
            ...nextState,
            isDiffLoading: true,
            error: null,
          },
        };
      });

      try {
        const result = await invoke<SessionDiffResult>("get_session_diff", {
          rootPath: workingDir,
          sessionId,
        });

        applyCodexDiffStates((current) => {
          const nextState = current[sessionId];
          if (!nextState) {
            return current;
          }

          return {
            ...current,
            [sessionId]: {
              ...nextState,
              isDiffLoading: false,
              error: null,
            },
          };
        });

        return result;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        applyCodexDiffStates((current) => {
          const nextState = current[sessionId];
          if (!nextState) {
            return current;
          }

          return {
            ...current,
            [sessionId]: {
              ...nextState,
              isDiffLoading: false,
              error: message,
            },
          };
        });

        throw reason;
      }
    },
    [applyCodexDiffStates, workingDir],
  );

  const viewSelectedSessionDiff = useCallback(async () => {
    if (!isSessionDiffEnabledRef.current) {
      throw new Error("Turn on Diff first.");
    }

    const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
    if (!activeSession || !supportsSessionDiff(activeSession.mode)) {
      throw new Error("Select a Codex or Claude session first.");
    }

    return loadSessionDiff(activeSession.id);
  }, [loadSessionDiff]);

  const selectedSessionDiffViewButtonState: SessionDiffViewButtonState =
    !isSessionDiffEnabled || !supportsSelectedSessionDiff
      ? "idle"
      : selectedSessionDiffState?.isDiffLoading
        ? "loading"
        : selectedSessionDiffState?.baselineStatus === "preparing"
          ? "preparing"
          : selectedSessionDiffState?.baselineStatus === "ready"
            ? "ready"
            : "idle";
  const canViewSelectedSessionDiff =
    isSessionDiffEnabled &&
    supportsSelectedSessionDiff &&
    selectedSessionDiffState?.baselineStatus === "ready" &&
    !selectedSessionDiffState.isDiffLoading;
  const canRebuildSelectedSessionDiffBaseline =
    isSessionDiffEnabled &&
    supportsSelectedSessionDiff &&
    Boolean(selectedSession) &&
    Boolean(workingDir) &&
    selectedSessionDiffViewButtonState !== "loading" &&
    selectedSessionDiffViewButtonState !== "preparing";
  const selectedSessionDiffViewButtonLabel =
    selectedSessionDiffViewButtonState === "loading"
      ? "Loading"
      : selectedSessionDiffViewButtonState === "preparing"
        ? "Preparing"
        : "Diff";
  const selectedSessionDiffViewButtonTitle =
    !isSessionDiffEnabled
      ? "Turn on Diff tracking first."
      : !supportsSelectedSessionDiff
        ? "Diff is available for Codex and Claude sessions only."
        : !selectedSession
          ? "Select a Codex or Claude session first."
          : selectedSessionDiffViewButtonState === "loading"
            ? "Loading diff results for the current baseline."
            : selectedSessionDiffViewButtonState === "preparing"
              ? "Building a baseline snapshot for this AI session."
              : selectedSessionDiffState?.error
                ? selectedSessionDiffState.error
                : selectedSessionDiffState?.baselineStatus !== "ready"
                  ? "Capture a baseline first."
                  : "Open the session diff view.";
  const selectedSessionDiffBaselineButtonLabel =
    selectedSessionDiffViewButtonState === "preparing" ? "Building" : "Baseline";
  const selectedSessionDiffBaselineButtonTitle =
    !isSessionDiffEnabled
      ? "Turn on Diff tracking first."
      : !supportsSelectedSessionDiff
        ? "Baseline is available for Codex and Claude sessions only."
        : !selectedSession
          ? "Select a Codex or Claude session first."
        : selectedSessionDiffViewButtonState === "loading"
            ? "Wait until the current diff request finishes."
            : selectedSessionDiffViewButtonState === "preparing"
              ? "Building a baseline snapshot for this AI session."
              : selectedSessionDiffState?.error
                ? `Previous capture failed: ${selectedSessionDiffState.error}`
                : "Capture a new baseline now and replace the previous snapshot.";
  const sessionDiffToggleLabel = isSessionDiffEnabled ? "Diff On" : "Diff Off";
  const sessionDiffToggleTitle = isSessionDiffEnabled
    ? "Disable diff tracking and clear cached baselines."
    : "Enable diff tracking. Baselines will only be created while this is on.";

  async function insertPaths(paths: string[], projectRoot: string, mode: PathInsertMode) {
    const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);
    const targetSessionId =
      activeSession?.status === "active"
        ? activeSession.id
        : await startSession({
            mode: "shell",
            title: shellKind === "powershell" ? "PowerShell" : "CMD",
          });

    await invoke("insert_paths", {
      mode,
      paths,
      projectRoot,
      sessionId: targetSessionId,
    });
    terminalRef.current?.focus();
  }

  return {
    activeShellKind: selectedSession?.shellKind ?? null,
    canLaunch: Boolean(workingDir) && terminalReady,
    canRebuildSelectedSessionDiffBaseline,
    canViewSelectedSessionDiff,
    clearTerminal,
    closeTerminal,
    copySelection: copyTerminalSelection,
    containerRef,
    error,
    getSelectionText: () => terminalRef.current?.getSelection() ?? "",
    hasSessions: sessions.length > 0,
    isSessionActive: selectedSession?.status === "active",
    isSessionDiffEnabled,
    launchDir: launchDir ?? workingDir,
    focusTerminal,
    insertPaths,
    launchClaude,
    launchCodex,
    loadSessionDiff,
    openShell,
    pasteFromClipboard: pasteTextIntoTerminal,
    rebuildSelectedSessionDiffBaseline,
    selectSession,
    selectedSessionDiffBaselineButtonLabel,
    selectedSessionDiffBaselineButtonTitle,
    selectedSessionDiffState,
    selectedSessionDiffViewButtonLabel,
    selectedSessionDiffViewButtonTitle,
    selectedSession,
    selectedSessionId,
    sessionDiffToggleLabel,
    sessionDiffToggleTitle,
    sessions,
    toggleSessionDiff,
    viewSelectedSessionDiff,
  };
}

function createSessionBanner(title: string, workingDir: string) {
  return `\u001b[1m${title}\u001b[0m\r\nworkspace: ${workingDir}\r\n\r\n`;
}

function getSessionById(sessions: TerminalSessionRecord[], sessionId: string | null) {
  if (!sessionId) {
    return null;
  }

  return sessions.find((session) => session.id === sessionId) ?? null;
}

function formatSessionTitle(input: string) {
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }

  return collapsed.length > 48 ? `${collapsed.slice(0, 48).trimEnd()}...` : collapsed;
}

function stripTerminalControlInput(input: string) {
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001bO./g, "")
    .replace(/\u001b./g, "");
}

function isPrintableInputCharacter(character: string) {
  return character >= " " && character !== "\u007f";
}

function supportsSessionDiff(mode: TerminalSessionMode | null | undefined) {
  return mode === "codex" || mode === "claude";
}
