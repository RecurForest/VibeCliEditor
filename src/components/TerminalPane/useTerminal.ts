import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type {
  PathInsertMode,
  ShellKind,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionInfo,
} from "../../types";

interface UseTerminalOptions {
  shellKind: ShellKind;
  workingDir: string | null;
}

type TerminalStatus = "idle" | "starting" | "ready" | "error";

export function useTerminal({ shellKind, workingDir }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) {
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
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.focus();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

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
    resizeObserver.observe(containerRef.current);

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

      terminal.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
      sessionIdRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    let cancelled = false;

    async function startTerminal() {
      if (!workingDir || !terminalRef.current || !fitAddonRef.current) {
        setStatus("idle");
        setSessionId(null);
        setError(null);
        return;
      }

      if (sessionIdRef.current) {
        await invoke("terminal_close", { sessionId: sessionIdRef.current }).catch(() => undefined);
        sessionIdRef.current = null;
        setSessionId(null);
      }

      fitAddonRef.current.fit();
      terminalRef.current.reset();
      terminalRef.current.clear();
      terminalRef.current.writeln("\u001b[1mJterminal\u001b[0m");
      terminalRef.current.writeln(`workspace: ${workingDir}`);
      terminalRef.current.writeln("");
      setStatus("starting");
      setError(null);

      try {
        const session = await invoke<TerminalSessionInfo>("start_terminal", {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
          shellKind,
          workingDir,
        });

        if (cancelled) {
          await invoke("terminal_close", { sessionId: session.sessionId }).catch(() => undefined);
          return;
        }

        sessionIdRef.current = session.sessionId;
        setSessionId(session.sessionId);
        setStatus("ready");
        terminalRef.current.focus();
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        setStatus("error");
        terminalRef.current.writeln(`[terminal start failed] ${message}`);
      }
    }

    void startTerminal();

    return () => {
      cancelled = true;
    };
  }, [shellKind, workingDir]);

  async function insertPaths(paths: string[], projectRoot: string, mode: PathInsertMode) {
    if (!sessionIdRef.current) {
      throw new Error("Terminal session is not ready yet.");
    }

    await invoke("insert_paths", {
      mode,
      paths,
      projectRoot,
      sessionId: sessionIdRef.current,
    });
    terminalRef.current?.focus();
  }

  return {
    containerRef,
    error,
    insertPaths,
    sessionId,
    status,
  };
}
