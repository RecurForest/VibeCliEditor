import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentProvider,
  AgentSessionMeta,
  AgentSessionProfile,
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
import {
  buildAgentTerminalProcess,
  cloneAgentProfile,
  createDefaultAgentProfile,
  getAgentProviderLabel,
  getRuntimeModelSwitchStrategy,
  patchAgentProfile,
  type AgentTerminalProcess,
} from "./agentSessionProfiles";
import type { TerminalComposerSendStrategy } from "./terminalComposerSendStrategy";

interface UseTerminalOptions {
  launchDir: string | null;
  ownsSessionDiffLifecycle?: boolean;
  onSessionComplete?: () => void;
  persistSessions?: boolean;
  shellKind: ShellKind;
  workingDir: string | null;
}

interface StartSessionOptions {
  agent?: AgentSessionMeta | null;
  initialCommand?: string | null;
  mode: TerminalSessionMode;
  spawnProcess?: AgentTerminalProcess | null;
  startupInput?: string | null;
  title: string;
}

interface SendTextOptions {
  appendNewline?: boolean;
  sendStrategy?: TerminalComposerSendStrategy;
  trackTitleInput?: boolean;
}

interface StartAgentSessionOptions {
  continueFromLast?: boolean;
  continueFromSessionId?: string | null;
  prompt?: string | null;
}

export function useTerminal({
  launchDir,
  ownsSessionDiffLifecycle = true,
  onSessionComplete,
  persistSessions = true,
  shellKind,
  workingDir,
}: UseTerminalOptions) {
  const terminalBackground = "#252526";
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isSessionDiffEnabled, setIsSessionDiffEnabled] = useState(false);
  const [codexDiffStates, setCodexDiffStates] = useState<Record<string, CodexDiffSessionState>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [preferredAgentProvider, setPreferredAgentProvider] = useState<AgentProvider>("codex");
  const [pendingAgentProfiles, setPendingAgentProfiles] = useState<
    Record<AgentProvider, AgentSessionProfile>
  >(() => ({
    claude: createDefaultAgentProfile("claude"),
    codex: createDefaultAgentProfile("codex"),
  }));
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
  const suspendedTitleTrackingUntilRef = useRef<Record<string, number>>({});
  const pendingAgentProfilesRef = useRef<Record<AgentProvider, AgentSessionProfile>>(
    pendingAgentProfiles,
  );
  const restoredStorageKeyRef = useRef<string | null>(null);
  const hydratedStorageKeyRef = useRef<string | null>(null);

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
  const persistedSessionStorageKey = useMemo(
    () => (persistSessions && workingDir ? createPersistedSessionsStorageKey(workingDir) : null),
    [persistSessions, workingDir],
  );

  useEffect(() => {
    isSessionDiffEnabledRef.current = isSessionDiffEnabled;
  }, [isSessionDiffEnabled]);

  useEffect(() => {
    pendingAgentProfilesRef.current = pendingAgentProfiles;
  }, [pendingAgentProfiles]);

  const applySessions = useCallback(
    (updater: (current: TerminalSessionRecord[]) => TerminalSessionRecord[]) => {
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

      for (const sessionId of Object.keys(suspendedTitleTrackingUntilRef.current)) {
        if (!activeSessionIds.has(sessionId)) {
          delete suspendedTitleTrackingUntilRef.current[sessionId];
        }
      }

      return nextSessions;
    },
    [],
  );

  const applyPendingAgentProfiles = useCallback(
    (
      updater: (
        current: Record<AgentProvider, AgentSessionProfile>,
      ) => Record<AgentProvider, AgentSessionProfile>,
    ) => {
      const nextProfiles = updater(pendingAgentProfilesRef.current);
      pendingAgentProfilesRef.current = nextProfiles;
      setPendingAgentProfiles(nextProfiles);
      return nextProfiles;
    },
    [],
  );

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

  const shouldTrackSessionTitleInput = useCallback((sessionId: string) => {
    const suspendedUntil = suspendedTitleTrackingUntilRef.current[sessionId];
    if (!suspendedUntil) {
      return true;
    }

    if (Date.now() >= suspendedUntil) {
      delete suspendedTitleTrackingUntilRef.current[sessionId];
      return true;
    }

    return false;
  }, []);

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

  const clearCodexDiffStates = useCallback(() => {
    sessionDiffCaptureVersionRef.current = {};
    applyCodexDiffStates(() => ({}));
  }, [applyCodexDiffStates]);

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
          baselineStatus: "preparing",
          error: null,
          isDiffLoading: false,
          sessionId,
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
            baselineStatus: "ready",
            error: null,
            isDiffLoading: false,
            sessionId,
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
            baselineStatus: "error",
            error: message,
            isDiffLoading: false,
            sessionId,
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

  useEffect(() => {
    if (!terminalReady || !persistedSessionStorageKey) {
      if (!persistedSessionStorageKey) {
        restoredStorageKeyRef.current = null;
        hydratedStorageKeyRef.current = null;
      }
      return;
    }

    if (restoredStorageKeyRef.current === persistedSessionStorageKey) {
      return;
    }

    restoredStorageKeyRef.current = persistedSessionStorageKey;
    hydratedStorageKeyRef.current = null;

    const persistedState = loadPersistedTerminalState(persistedSessionStorageKey);
    const restoredSessions = persistedState.sessions.map(restorePersistedTerminalSession);

    sessionsRef.current = restoredSessions;
    setSessions(restoredSessions);

    const nextSelectedSession =
      getSessionById(restoredSessions, persistedState.selectedSessionId) ??
      restoredSessions[restoredSessions.length - 1] ??
      null;

    selectedSessionIdRef.current = nextSelectedSession?.id ?? null;
    setSelectedSessionId(nextSelectedSession?.id ?? null);

    if (nextSelectedSession?.agent?.provider) {
      setPreferredAgentProvider(nextSelectedSession.agent.provider);
    }

    renderSessionOutput(nextSelectedSession?.output ?? "");
    hydratedStorageKeyRef.current = persistedSessionStorageKey;
  }, [persistedSessionStorageKey, renderSessionOutput, terminalReady]);

  useEffect(() => {
    if (!terminalReady || !persistedSessionStorageKey) {
      return;
    }

    if (hydratedStorageKeyRef.current !== persistedSessionStorageKey) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      persistTerminalState(persistedSessionStorageKey, sessions, selectedSessionId);
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [persistedSessionStorageKey, selectedSessionId, sessions, terminalReady]);

  const selectSession = useCallback(
    (sessionId: string) => {
      const nextSession = getSessionById(sessionsRef.current, sessionId);
      if (!nextSession) {
        return;
      }

      selectedSessionIdRef.current = sessionId;
      setSelectedSessionId(sessionId);
      if (nextSession.agent?.provider) {
        setPreferredAgentProvider(nextSession.agent.provider);
      }
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
      scrollback: 50000,
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

      if (shouldTrackSessionTitleInput(activeSession.id)) {
        captureSessionTitleInput(activeSession.id, data);
      }
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
    captureSessionTitleInput,
    containerElement,
    copyTerminalSelection,
    disposeSessionResourcesForList,
    ownsSessionDiffLifecycle,
    pasteTextIntoTerminal,
    shouldTrackSessionTitleInput,
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
    async ({
      agent = null,
      initialCommand,
      mode,
      spawnProcess = null,
      startupInput = null,
      title,
    }: StartSessionOptions) => {
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
          spawnProcess,
          startupInput,
          startupCommand: initialCommand?.trim() ? initialCommand.trim() : null,
          workingDir: targetDir,
        });

        const nextSession: TerminalSessionRecord = {
          agent,
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
        if (agent?.provider) {
          setPreferredAgentProvider(agent.provider);
        }
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
    [
      applySessions,
      captureSessionDiffBaseline,
      launchDir,
      renderSessionOutput,
      shellKind,
      terminalReady,
      workingDir,
    ],
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

  const updatePendingAgentProfile = useCallback(
    (provider: AgentProvider, patch: Partial<AgentSessionProfile>) => {
      setPreferredAgentProvider(provider);
      applyPendingAgentProfiles((current) => ({
        ...current,
        [provider]: patchAgentProfile(current[provider], patch),
      }));
    },
    [applyPendingAgentProfiles],
  );

  const patchSessionAgentProfile = useCallback(
    (sessionId: string, patch: Partial<AgentSessionProfile>) => {
      applySessions((current) =>
        current.map((session) => {
          if (session.id !== sessionId || !session.agent) {
            return session;
          }

          return {
            ...session,
            agent: {
              ...session.agent,
              requestedProfile: patchAgentProfile(session.agent.requestedProfile, patch),
            },
          };
        }),
      );
    },
    [applySessions],
  );

  const setSessionRuntimeSessionId = useCallback(
    (sessionId: string, runtimeSessionId: string) => {
      applySessions((current) =>
        current.map((session) => {
          if (session.id !== sessionId || !session.agent) {
            return session;
          }

          return {
            ...session,
            agent: {
              ...session.agent,
              runtimeSessionId,
            },
          };
        }),
      );
    },
    [applySessions],
  );

  const resolveCodexRuntimeSessionId = useCallback(async (targetWorkingDir: string, startedAt: number) => {
    return invoke<string | null>("resolve_codex_session_id", {
      startedAtMs: Math.max(0, Math.floor(startedAt)),
      timeoutMs: 5000,
      workingDir: targetWorkingDir,
    });
  }, []);

  const ensureCodexRuntimeSessionId = useCallback(
    async (sessionId: string) => {
      const session = getSessionById(sessionsRef.current, sessionId);
      if (!session || session.mode !== "codex" || !session.agent) {
        return null;
      }

      const existingRuntimeSessionId = session.agent.runtimeSessionId?.trim();
      if (existingRuntimeSessionId) {
        return existingRuntimeSessionId;
      }

      const resolvedRuntimeSessionId = await resolveCodexRuntimeSessionId(
        session.workingDir,
        session.startedAt,
      );
      if (resolvedRuntimeSessionId) {
        setSessionRuntimeSessionId(sessionId, resolvedRuntimeSessionId);
      }

      return resolvedRuntimeSessionId;
    },
    [resolveCodexRuntimeSessionId, setSessionRuntimeSessionId],
  );

  const startShellSession = useCallback(async () => {
    return startSession({
      mode: "shell",
      title: shellKind === "powershell" ? "PowerShell" : "CMD",
    });
  }, [shellKind, startSession]);

  const startAgentSession = useCallback(
    async (
      profile: AgentSessionProfile,
      {
        continueFromLast = false,
        continueFromSessionId = null,
        prompt = null,
      }: StartAgentSessionOptions = {},
    ) => {
      const normalizedProfile = cloneAgentProfile(profile);
      updatePendingAgentProfile(normalizedProfile.provider, normalizedProfile);
      const targetDir = launchDir ?? workingDir;
      const codexLaunchStartedAt =
        normalizedProfile.provider === "codex" && !continueFromLast ? Date.now() : null;
      let runtimeSessionId: string | null = null;

      if (normalizedProfile.provider === "codex" && continueFromLast) {
        if (!continueFromSessionId) {
          throw new Error("Select an active Codex session first.");
        }

        runtimeSessionId = await ensureCodexRuntimeSessionId(continueFromSessionId);
        if (!runtimeSessionId) {
          throw new Error(
            "Unable to resolve the active Codex session ID. Start a new Codex session and try again.",
          );
        }
      }

      const shouldSendPromptViaStartupInput =
        normalizedProfile.provider === "codex" && continueFromLast && Boolean(prompt?.trim());

      const nextSessionId = await startSession({
        agent: {
          provider: normalizedProfile.provider,
          requestedProfile: normalizedProfile,
          runtimeSessionId,
          runtimeModelSwitchStrategy: getRuntimeModelSwitchStrategy(normalizedProfile.provider),
        },
        mode: normalizedProfile.provider,
        spawnProcess: buildAgentTerminalProcess(normalizedProfile, {
          continueFromLast,
          prompt: shouldSendPromptViaStartupInput ? null : prompt,
          runtimeSessionId,
        }),
        startupInput: shouldSendPromptViaStartupInput
          ? `${prepareTerminalInputForPaste(prompt ?? "", false)}\r`
          : null,
        title: getAgentProviderLabel(normalizedProfile.provider),
      });

      if (normalizedProfile.provider === "codex" && !runtimeSessionId && targetDir) {
        void resolveCodexRuntimeSessionId(targetDir, codexLaunchStartedAt ?? Date.now())
          .then((resolvedRuntimeSessionId) => {
            if (resolvedRuntimeSessionId) {
              setSessionRuntimeSessionId(nextSessionId, resolvedRuntimeSessionId);
            }
          })
          .catch(() => undefined);
      }

      return nextSessionId;
    },
    [
      ensureCodexRuntimeSessionId,
      launchDir,
      resolveCodexRuntimeSessionId,
      setSessionRuntimeSessionId,
      startSession,
      updatePendingAgentProfile,
      workingDir,
    ],
  );

  const sendRawText = useCallback(
    async (
      sessionId: string,
      text: string,
      {
        appendNewline = true,
        sendStrategy = "auto",
        trackTitleInput = true,
      }: SendTextOptions = {},
    ) => {
      const session = getSessionById(sessionsRef.current, sessionId);
      if (!session || session.status !== "active") {
        throw new Error("Select an active terminal session first.");
      }

      const terminal = terminalRef.current;
      const canUseVisibleTerminalInput =
        sessionId === selectedSessionIdRef.current && Boolean(terminal?.textarea);
      const resolvedSendStrategy = resolveComposerSendStrategy(
        sendStrategy,
        canUseVisibleTerminalInput,
      );

      if (!text && !appendNewline) {
        return;
      }

      const pastePayload = prepareTerminalInputForPaste(text, false);
      const submitPayload = getComposerStrategySubmitPayload(
        resolvedSendStrategy,
        appendNewline,
      );

      if (isVisibleComposerSendStrategy(resolvedSendStrategy) && terminal?.textarea) {
        if (!trackTitleInput) {
          suspendedTitleTrackingUntilRef.current[sessionId] = Date.now() + 250;
        }

        await sendVisibleTerminalText({
          appendNewline,
          pastePayload,
          rawText: text,
          strategy: resolvedSendStrategy,
          terminal,
          textarea: terminal.textarea,
        });

        setError(null);
        return;
      }

      if (trackTitleInput) {
        captureSessionTitleInput(sessionId, `${pastePayload}${submitPayload}`);
      }

      if (pastePayload) {
        await invoke("terminal_write", {
          data: pastePayload,
          sessionId,
        });
      }

      if (submitPayload) {
        await invoke("terminal_write", {
          data: submitPayload,
          sessionId,
        });
      }

      terminalRef.current?.focus();
      setError(null);
    },
    [captureSessionTitleInput],
  );

  const sendToSelectedSession = useCallback(
    async (
      text: string,
      {
        appendNewline = true,
        sendStrategy = "auto",
        startShellIfMissing = false,
        trackTitleInput = true,
      }: SendTextOptions & { startShellIfMissing?: boolean } = {},
    ) => {
      const activeSession = getSessionById(sessionsRef.current, selectedSessionIdRef.current);

      if (activeSession?.status === "active") {
        await sendRawText(activeSession.id, text, {
          appendNewline,
          sendStrategy,
          trackTitleInput,
        });
        return activeSession.id;
      }

      if (!startShellIfMissing) {
        throw new Error("Start a shell, Codex, or Claude session first.");
      }

      const sessionId = await startShellSession();
      await sendRawText(sessionId, text, {
        appendNewline,
        sendStrategy,
        trackTitleInput,
      });
      return sessionId;
    },
    [sendRawText, startShellSession],
  );

  const openShell = useCallback(() => {
    void startShellSession().catch(() => undefined);
  }, [startShellSession]);

  const launchCodex = useCallback(() => {
    setPreferredAgentProvider("codex");
    void startAgentSession(pendingAgentProfilesRef.current.codex).catch(() => undefined);
  }, [startAgentSession]);

  const launchClaude = useCallback(() => {
    setPreferredAgentProvider("claude");
    void startAgentSession(pendingAgentProfilesRef.current.claude).catch(() => undefined);
  }, [startAgentSession]);

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

  const endSession = useCallback(async (sessionId: string) => {
    const session = getSessionById(sessionsRef.current, sessionId);
    if (!session || session.status !== "active") {
      return;
    }

    await invoke("terminal_close", { sessionId });
  }, []);

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
    if (fallbackSession?.agent?.provider) {
      setPreferredAgentProvider(fallbackSession.agent.provider);
    }
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
            error: null,
            isDiffLoading: true,
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
              error: null,
              isDiffLoading: false,
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
              error: message,
              isDiffLoading: false,
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
      activeSession?.status === "active" ? activeSession.id : await startShellSession();

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
    endSession,
    error,
    focusTerminal,
    getSelectionText: () => terminalRef.current?.getSelection() ?? "",
    hasSessions: sessions.length > 0,
    insertPaths,
    isSessionActive: selectedSession?.status === "active",
    isSessionDiffEnabled,
    launchClaude,
    launchCodex,
    launchDir: launchDir ?? workingDir,
    loadSessionDiff,
    openShell,
    pasteFromClipboard: pasteTextIntoTerminal,
    patchSessionAgentProfile,
    pendingAgentProfiles,
    preferredAgentProvider,
    rebuildSelectedSessionDiffBaseline,
    selectSession,
    selectedSession,
    selectedSessionDiffBaselineButtonLabel,
    selectedSessionDiffBaselineButtonTitle,
    selectedSessionDiffState,
    selectedSessionDiffViewButtonLabel,
    selectedSessionDiffViewButtonTitle,
    selectedSessionId,
    sendRawText,
    sendToSelectedSession,
    sessionDiffToggleLabel,
    sessionDiffToggleTitle,
    sessions,
    startAgentSession,
    startShellSession,
    toggleSessionDiff,
    updatePendingAgentProfile,
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

function prepareTerminalInputForPaste(
  value: string,
  bracketedPasteMode: boolean,
) {
  const normalized = normalizeTerminalPasteText(value);
  if (!normalized) {
    return "";
  }

  return prepareTerminalPasteText(normalized, bracketedPasteMode);
}

function normalizeTerminalPasteText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

type ResolvedTerminalComposerSendStrategy = Exclude<TerminalComposerSendStrategy, "auto">;

function resolveComposerSendStrategy(
  strategy: TerminalComposerSendStrategy,
  canUseVisibleTerminalInput: boolean,
): ResolvedTerminalComposerSendStrategy {
  if (strategy === "auto") {
    return canUseVisibleTerminalInput ? "xterm-paste-enter" : "pty-cr";
  }

  if (!canUseVisibleTerminalInput && isVisibleComposerSendStrategy(strategy)) {
    return "pty-cr";
  }

  return strategy;
}

function isVisibleComposerSendStrategy(
  strategy: ResolvedTerminalComposerSendStrategy,
): strategy is
  | "xterm-paste-enter"
  | "xterm-paste-enter-delay"
  | "xterm-input-cr"
  | "xterm-char-by-char-cr"
  | "textarea-input-enter"
  | "textarea-paste-enter" {
  return strategy.startsWith("xterm") || strategy.startsWith("textarea");
}

function getComposerStrategySubmitPayload(
  strategy: ResolvedTerminalComposerSendStrategy,
  appendNewline: boolean,
) {
  if (!appendNewline) {
    return "";
  }

  return strategy === "pty-crlf" ? "\r\n" : "\r";
}

function prepareTerminalPasteText(value: string, bracketedPasteMode: boolean) {
  if (!value) {
    return "";
  }

  const preparedValue = value.replace(/\n/g, "\r");
  if (!bracketedPasteMode) {
    return preparedValue;
  }

  return `\u001b[200~${preparedValue}\u001b[201~`;
}

async function sendVisibleTerminalText({
  appendNewline,
  pastePayload,
  rawText,
  strategy,
  terminal,
  textarea,
}: {
  appendNewline: boolean;
  pastePayload: string;
  rawText: string;
  strategy:
    | "xterm-paste-enter"
    | "xterm-paste-enter-delay"
    | "xterm-input-cr"
    | "xterm-char-by-char-cr"
    | "textarea-input-enter"
    | "textarea-paste-enter";
  terminal: Terminal;
  textarea: HTMLTextAreaElement;
}) {
  terminal.focus();

  switch (strategy) {
    case "xterm-paste-enter":
      if (rawText) {
        terminal.paste(rawText);
      }
      if (appendNewline) {
        dispatchTerminalEnterKey(textarea);
      }
      return;

    case "xterm-paste-enter-delay":
      if (rawText) {
        terminal.paste(rawText);
      }
      if (appendNewline) {
        await pauseComposerSubmit(24);
        dispatchTerminalEnterKey(textarea);
      }
      return;

    case "xterm-input-cr":
      if (pastePayload) {
        terminal.input(pastePayload, true);
      }
      if (appendNewline) {
        terminal.input("\r", true);
      }
      return;

    case "xterm-char-by-char-cr":
      for (const character of pastePayload) {
        terminal.input(character, true);
      }
      if (appendNewline) {
        terminal.input("\r", true);
      }
      return;

    case "textarea-input-enter":
      if (pastePayload) {
        dispatchTerminalTextInput(textarea, pastePayload);
      }
      if (appendNewline) {
        dispatchTerminalEnterKey(textarea);
      }
      return;

    case "textarea-paste-enter":
      if (rawText) {
        const didDispatchPasteEvent = dispatchTerminalPasteEvent(textarea, rawText);
        if (!didDispatchPasteEvent) {
          terminal.paste(rawText);
        }
      }
      if (appendNewline) {
        dispatchTerminalEnterKey(textarea);
      }
      return;
  }
}

function dispatchTerminalEnterKey(textarea: HTMLTextAreaElement) {
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    const event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      code: "Enter",
      key: "Enter",
    });

    defineKeyboardEventCode(event, "charCode", 13);
    defineKeyboardEventCode(event, "keyCode", 13);
    defineKeyboardEventCode(event, "which", 13);
    textarea.dispatchEvent(event);
  }
}

function dispatchTerminalTextInput(textarea: HTMLTextAreaElement, text: string) {
  textarea.value = text;

  if (typeof InputEvent === "function") {
    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: "insertText",
      }),
    );
  } else {
    const event = new Event("input", {
      bubbles: true,
      cancelable: true,
    });
    defineEventProperty(event, "data", text);
    defineEventProperty(event, "inputType", "insertText");
    textarea.dispatchEvent(event);
  }

  textarea.value = "";
}

function dispatchTerminalPasteEvent(textarea: HTMLTextAreaElement, text: string) {
  if (typeof ClipboardEvent !== "function" || typeof DataTransfer !== "function") {
    return false;
  }

  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  const event = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });

  textarea.dispatchEvent(event);
  return true;
}

function defineKeyboardEventCode(
  event: KeyboardEvent,
  property: "charCode" | "keyCode" | "which",
  value: number,
) {
  Object.defineProperty(event, property, {
    configurable: true,
    get: () => value,
  });
}

function defineEventProperty(event: Event, property: string, value: string) {
  Object.defineProperty(event, property, {
    configurable: true,
    get: () => value,
  });
}

function pauseComposerSubmit(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function createPersistedSessionsStorageKey(workingDir: string) {
  return `vibeCliEditor.terminal.sessions.v1:${encodeURIComponent(workingDir)}`;
}

function loadPersistedTerminalState(storageKey: string) {
  if (typeof window === "undefined") {
    return {
      selectedSessionId: null as string | null,
      sessions: [] as TerminalSessionRecord[],
    };
  }

  try {
    const rawValue =
      window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(storageKey.replace("vibeCliEditor.", "jterminal."));
    if (!rawValue) {
      return {
        selectedSessionId: null as string | null,
        sessions: [] as TerminalSessionRecord[],
      };
    }

    const parsedValue = JSON.parse(rawValue) as {
      selectedSessionId?: unknown;
      sessions?: unknown;
    };

    return {
      selectedSessionId:
        typeof parsedValue.selectedSessionId === "string" ? parsedValue.selectedSessionId : null,
      sessions: Array.isArray(parsedValue.sessions)
        ? parsedValue.sessions.filter(isPersistedTerminalSessionRecord)
        : [],
    };
  } catch {
    return {
      selectedSessionId: null as string | null,
      sessions: [] as TerminalSessionRecord[],
    };
  }
}

function persistTerminalState(
  storageKey: string,
  sessions: TerminalSessionRecord[],
  selectedSessionId: string | null,
) {
  if (typeof window === "undefined") {
    return;
  }

  if (!sessions.length) {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
    return;
  }

  const snapshot = {
    selectedSessionId,
    sessions,
  };

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    return;
  } catch {
    // Fall through to a smaller snapshot to stay within storage limits.
  }

  try {
    const fallbackSnapshot = {
      selectedSessionId,
      sessions: sessions.slice(-12).map((session) => ({
        ...session,
        output: truncatePersistedOutput(session.output, 120_000),
      })),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(fallbackSnapshot));
  } catch {
    // Ignore persistence failures and continue without saved history.
  }
}

function restorePersistedTerminalSession(session: TerminalSessionRecord): TerminalSessionRecord {
  if (session.status !== "active") {
    return session;
  }

  return {
    ...session,
    finishedAt: session.finishedAt ?? Date.now(),
    status: "completed",
  };
}

function truncatePersistedOutput(output: string, maxChars: number) {
  if (output.length <= maxChars) {
    return output;
  }

  const head = output.slice(0, Math.floor(maxChars / 2));
  const tail = output.slice(-Math.floor(maxChars / 2));
  return `${head}\r\n\r\n[output truncated for persistence]\r\n\r\n${tail}`;
}

function isPersistedTerminalSessionRecord(value: unknown): value is TerminalSessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<TerminalSessionRecord>;
  return (
    typeof session.id === "string" &&
    typeof session.mode === "string" &&
    typeof session.output === "string" &&
    typeof session.shellKind === "string" &&
    typeof session.startedAt === "number" &&
    typeof session.status === "string" &&
    typeof session.title === "string" &&
    typeof session.workingDir === "string"
  );
}
