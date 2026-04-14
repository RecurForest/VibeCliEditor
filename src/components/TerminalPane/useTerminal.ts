import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PathInsertMode,
  ShellKind,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionInfo,
} from "../../types";

interface UseTerminalOptions {
  launchDir: string | null;
  shellKind: ShellKind;
  workingDir: string | null;
}

type TerminalStatus = "idle" | "starting" | "ready" | "error";

export function useTerminal({ launchDir, shellKind, workingDir }: UseTerminalOptions) {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastWorkingDirRef = useRef<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeShellKind, setActiveShellKind] = useState<ShellKind | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerElement(node);
  }, []);

  useEffect(() => {
    if (!containerElement || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: "#181818",
        black: "#181818",
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

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setTerminalReady(true);

    const resizeObserver = new ResizeObserver(() => {
      if (!terminalRef.current || !fitAddonRef.current) {
        return;
      }

      fitAddonRef.current.fit();
      if (sessionIdRef.current) {
        void invoke("terminal_resize", {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
          sessionId: sessionIdRef.current,
        }).catch(() => undefined);
      }
    });
    resizeObserver.observe(containerElement);

    const disposable = terminal.onData((data) => {
      if (!sessionIdRef.current) {
        return;
      }

      void invoke("terminal_write", {
        data,
        sessionId: sessionIdRef.current,
      }).catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("error");
      });
    });

    return () => {
      resizeObserver.disconnect();
      disposable.dispose();

      if (sessionIdRef.current) {
        void invoke("terminal_close", { sessionId: sessionIdRef.current }).catch(() => undefined);
      }

      setTerminalReady(false);
      terminal.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
      sessionIdRef.current = null;
    };
  }, [containerElement]);

  useEffect(() => {
    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    void listen<TerminalOutputEvent>("terminal-output", (event) => {
      if (event.payload.sessionId === sessionIdRef.current) {
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
      if (event.payload.sessionId === sessionIdRef.current) {
        sessionIdRef.current = null;
        setSessionId(null);
        setActiveShellKind(null);
        setStatus("idle");
      }
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
  }, []);

  const resetViewport = useCallback(
    (nextWorkingDir: string | null) => {
      const terminal = terminalRef.current;

      if (!terminal) {
        return;
      }

      terminal.reset();
      terminal.clear();

      if (nextWorkingDir) {
        terminal.writeln("\u001b[1mJterminal\u001b[0m");
        terminal.writeln(`workspace: ${nextWorkingDir}`);
        terminal.writeln("");
      }
    },
    [],
  );

  const closeSession = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;

    if (currentSessionId) {
      await invoke("terminal_close", { sessionId: currentSessionId }).catch(() => undefined);
      sessionIdRef.current = null;
    }

    setSessionId(null);
    setActiveShellKind(null);
    setStatus("idle");
    setError(null);
    resetViewport(workingDir);
  }, [resetViewport, workingDir]);

  const startSession = useCallback(
    async (initialCommand?: string | null) => {
      const targetDir = launchDir ?? workingDir;

      if (!targetDir) {
        throw new Error("Open a workspace folder first.");
      }

      if (!terminalReady || !terminalRef.current || !fitAddonRef.current) {
        throw new Error("Terminal view is not ready yet.");
      }

      if (sessionIdRef.current) {
        await closeSession();
      }

      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      fitAddon.fit();
      resetViewport(targetDir);
      setStatus("starting");
      setError(null);

      try {
        const session = await invoke<TerminalSessionInfo>("start_terminal", {
          cols: terminal.cols,
          rows: terminal.rows,
          shellKind,
          startupCommand: initialCommand?.trim() ? initialCommand.trim() : null,
          workingDir: targetDir,
        });

        sessionIdRef.current = session.sessionId;
        setSessionId(session.sessionId);
        setActiveShellKind(session.shellKind);
        setStatus("ready");
        terminal.focus();

        return session.sessionId;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        setStatus("error");
        terminal.writeln(`[terminal start failed] ${message}`);
        throw reason;
      }
    },
    [closeSession, launchDir, resetViewport, shellKind, terminalReady, workingDir],
  );

  useEffect(() => {
    const previousWorkingDir = lastWorkingDirRef.current;
    lastWorkingDirRef.current = workingDir;

    if (!terminalReady) {
      return;
    }

    if (!workingDir) {
      void closeSession();
      return;
    }

    if (previousWorkingDir && previousWorkingDir !== workingDir && sessionIdRef.current) {
      void closeSession();
      return;
    }

    if (!sessionIdRef.current) {
      resetViewport(workingDir);
    }
  }, [closeSession, resetViewport, terminalReady, workingDir]);

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const openShell = useCallback(() => {
    void startSession().catch(() => undefined);
  }, [startSession]);

  const launchCodex = useCallback(() => {
    void startSession("codex --yolo").catch(() => undefined);
  }, [startSession]);

  const launchClaude = useCallback(() => {
    void startSession("claude").catch(() => undefined);
  }, [startSession]);

  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, []);

  const closeTerminal = useCallback(() => {
    void closeSession();
  }, [closeSession]);

  async function insertPaths(paths: string[], projectRoot: string, mode: PathInsertMode) {
    const readySessionId = sessionIdRef.current ?? (await startSession());

    await invoke("insert_paths", {
      mode,
      paths,
      projectRoot,
      sessionId: readySessionId,
    });
    terminalRef.current?.focus();
  }

  return {
    activeShellKind,
    canLaunch: Boolean(workingDir) && terminalReady,
    clearTerminal,
    closeTerminal,
    containerRef,
    error,
    launchDir: launchDir ?? workingDir,
    focusTerminal,
    insertPaths,
    isSessionActive: Boolean(sessionId),
    launchClaude,
    launchCodex,
    openShell,
    sessionId,
    status,
  };
}
