import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SshProfile, TerminalSession, TerminalSize } from "../models";
import { RETAINED_OUTPUT_CHARS } from "../settings/settings";
import { hasTerminalInstance, pruneTerminals } from "./terminalRegistry";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "../ui/ToastHost";
import {
  cancelZmodemTransfer,
  closeSshSession,
  cancelReconnect as cancelReconnectCommand,
  listSshSessions,
  onTerminalOutput,
  onTerminalStatus,
  onTerminalTransferPrompt,
  onTerminalTransferStatus,
  readSshSessionOutput,
  respondZmodemPrompt,
  resizeSshSession,
  startLocalSession as startLocalSessionCommand,
  startSshSession,
  writeSshSession,
  type TerminalTransferStatusEvent,
} from "../services/sshSessionService";

export type TerminalOutputListener = (data: string) => void;

const initialSize: TerminalSize = {
  cols: 100,
  rows: 30,
};

const RECONNECT_ON_INPUT_STATUSES = new Set<TerminalSession["status"]>([
  "disconnected",
  "failed",
]);

function shouldReconnectOnInput(session: TerminalSession | undefined): boolean {
  return session?.kind === "ssh" && RECONNECT_ON_INPUT_STATUSES.has(session.status);
}

/**
 * Retained output for one session, kept as the chunks we received instead of
 * one growing string. Appending is O(1) and trimming drops whole chunks, so a
 * sustained flood no longer copies the entire backlog on every event.
 */
interface SessionBacklog {
  chunks: string[];
  length: number;
}

function createBacklog(initial?: string): SessionBacklog {
  return initial ? { chunks: [initial], length: initial.length } : { chunks: [], length: 0 };
}

function appendToBacklog(backlog: SessionBacklog, data: string) {
  backlog.chunks.push(data);
  backlog.length += data.length;

  // Drop whole chunks only. Slicing inside one could cut a surrogate pair or an
  // ANSI escape sequence in half, which corrupts the replay when a terminal
  // mounts. Trimming stops while removing the oldest chunk would take the
  // backlog under the retention target, so it stays at or above it.
  while (backlog.chunks.length > 1) {
    const oldest = backlog.chunks[0];
    if (oldest === undefined || backlog.length - oldest.length < RETAINED_OUTPUT_CHARS) {
      break;
    }
    backlog.chunks.shift();
    backlog.length -= oldest.length;
  }
}

/** Collapse to a single string; mounting a terminal is rare next to appending. */
function readBacklog(backlog: SessionBacklog): string {
  if (backlog.chunks.length > 1) {
    backlog.chunks = [backlog.chunks.join("")];
  }
  return backlog.chunks[0] ?? "";
}

export function useTerminalSessions() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSessionsLoaded, setIsSessionsLoaded] = useState(false);
  const [terminalTransfers, setTerminalTransfers] = useState<TerminalTransferStatusEvent[]>([]);
  const pendingZmodemPromptsRef = useRef(new Set<string>());
  const manualReconnectsRef = useRef(new Set<string>());

  // Mirror of `sessions` so async callbacks (e.g. reconnect) can read the
  // latest list without becoming stale or churning their identity.
  const sessionsRef = useRef<TerminalSession[]>([]);
  sessionsRef.current = sessions;

  // Raw output per session is the source of truth. It never flows through
  // render state (which can coalesce/drop chunks); instead we keep an
  // accumulated backlog for tab switches and fan out each chunk to the live
  // terminal exactly once through registered listeners.
  const buffersRef = useRef<Map<string, SessionBacklog>>(new Map());
  const listenersRef = useRef<Map<string, Set<TerminalOutputListener>>>(new Map());

  const pushOutput = useCallback((sessionId: string, data: string) => {
    if (!data) {
      return;
    }

    let backlog = buffersRef.current.get(sessionId);
    if (!backlog) {
      backlog = createBacklog();
      buffersRef.current.set(sessionId, backlog);
    }
    appendToBacklog(backlog, data);

    const listeners = listenersRef.current.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        listener(data);
      }
    }
  }, []);

  const getBacklog = useCallback((sessionId: string) => {
    const backlog = buffersRef.current.get(sessionId);
    return backlog ? readBacklog(backlog) : "";
  }, []);

  // Terminal instances outlive the components that show them, so nothing else
  // tears them down. Closing, reconnecting under a new id and detaching to
  // another window all surface here as a session leaving the list.
  useEffect(() => {
    pruneTerminals(sessions.map((session) => session.id));
  }, [sessions]);

  const subscribeOutput = useCallback(
    (sessionId: string, listener: TerminalOutputListener) => {
      let listeners = listenersRef.current.get(sessionId);
      if (!listeners) {
        listeners = new Set();
        listenersRef.current.set(sessionId, listeners);
      }
      listeners.add(listener);

      return () => {
        const current = listenersRef.current.get(sessionId);
        if (!current) {
          return;
        }
        current.delete(listener);
        if (current.size === 0) {
          listenersRef.current.delete(sessionId);
        }
      };
    },
    [],
  );

  const startLocalSession = useCallback(async () => {
    const session = await startLocalSessionCommand({
      size: initialSize,
    });
    setSessions((currentSessions) => [...currentSessions, session]);
    setActiveSessionId(session.id);
    return session;
  }, []);

  useEffect(() => {
    let mounted = true;

    void listSshSessions()
      .then(async (loadedSessions) => {
        if (!mounted) return;

        // A second window attaches to an existing Rust-side session. Hydrate its
        // renderer from the retained backend scrollback before future global
        // `terminal-output` events fan in.
        const snapshots = await Promise.all(
          loadedSessions.map(async (session) => ({
            sessionId: session.id,
            output: await readSshSessionOutput(session.id).catch(() => ""),
          })),
        );
        if (!mounted) return;
        for (const snapshot of snapshots) {
          if (snapshot.output) {
            buffersRef.current.set(snapshot.sessionId, createBacklog(snapshot.output));
          }
        }

        if (loadedSessions.length > 0) {
          setSessions(loadedSessions);
          setActiveSessionId(loadedSessions[0]?.id ?? null);
          return;
        }
        // Do not create a local terminal automatically at startup. A local shell
        // is created only when the user explicitly asks for one.
        setSessions([]);
        setActiveSessionId(null);
      })
      .catch(() => {
        if (mounted) {
          setSessions([]);
          setActiveSessionId(null);
        }
      })
      .finally(() => {
        if (mounted) setIsSessionsLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const outputPromise = onTerminalOutput((event) => {
      pushOutput(event.sessionId, event.data);
    });
    const statusPromise = onTerminalStatus((event) => {
      setSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.id === event.sessionId ? { ...session, status: event.status } : session,
        ),
      );
      if (event.message) {
        // Reconnect notices read as yellow, connected as green, failures as red.
        const color =
          event.status === "reconnecting" ? "33" : event.status === "connected" ? "32" : "31";
        pushOutput(event.sessionId, `\r\n\x1b[${color}m${event.message}\x1b[0m\r\n`);
      }
      const session = sessionsRef.current.find((item) => item.id === event.sessionId);
      if (session && shouldReconnectOnInput({ ...session, status: event.status })) {
        pushOutput(event.sessionId, "\r\n按任意键重新连接。\r\n");
      }
    });

    return () => {
      void outputPromise.then((unlisten) => unlisten());
      void statusPromise.then((unlisten) => unlisten());
    };
  }, [pushOutput]);

  useEffect(() => {
    const promptPromise = onTerminalTransferPrompt((event) => {
      if (!hasTerminalInstance(event.sessionId) || pendingZmodemPromptsRef.current.has(event.detectionId)) {
        return;
      }
      pendingZmodemPromptsRef.current.add(event.detectionId);
      void (async () => {
        try {
          const picked = await open({ multiple: true, title: "选择要通过 rz 上传的文件" });
          const paths = picked === null ? null : Array.isArray(picked) ? picked : [picked];
          await respondZmodemPrompt(event.sessionId, event.detectionId, paths);
        } catch (error) {
          await respondZmodemPrompt(event.sessionId, event.detectionId, null).catch(() => undefined);
          toast(error instanceof Error ? error.message : "无法打开文件选择器。", "error");
        } finally {
          pendingZmodemPromptsRef.current.delete(event.detectionId);
        }
      })();
    });
    const statusPromise = onTerminalTransferStatus((event) => {
      if (!hasTerminalInstance(event.sessionId)) return;
      setTerminalTransfers((current) => {
        const next = current.filter((item) => item.detectionId !== event.detectionId);
        return [...next, event];
      });
      if (["completed", "cancelled", "failed"].includes(event.state)) {
        window.setTimeout(() => {
          setTerminalTransfers((current) => current.filter((item) => item.detectionId !== event.detectionId));
        }, 5000);
      }
    });
    return () => {
      void promptPromise.then((unlisten) => unlisten());
      void statusPromise.then((unlisten) => unlisten());
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const startSession = useCallback(async (profile: SshProfile) => {
    const session = await startSshSession({
      profileId: profile.id,
      size: initialSize,
    });
    setSessions((currentSessions) => [...currentSessions, session]);
    setActiveSessionId(session.id);
    return session;
  }, []);

  const reconnectSession = useCallback(
    async (sessionId: string) => {
      if (manualReconnectsRef.current.has(sessionId)) {
        return;
      }
      const target = buffersRef.current;
      const existing = sessionsRef.current.find((session) => session.id === sessionId);
      if (!existing) {
        return;
      }

      manualReconnectsRef.current.add(sessionId);
      try {
        const fresh =
          existing.kind === "ssh"
            ? await startSshSession({ profileId: existing.profileId, size: initialSize })
            : await startLocalSessionCommand({ size: initialSize });

        try {
          await closeSshSession(sessionId);
        } catch {
          // Old session may already be gone; ignore.
        }

        target.delete(sessionId);
        listenersRef.current.delete(sessionId);
        sessionsRef.current = sessionsRef.current.map((session) =>
          session.id === sessionId ? fresh : session,
        );
        setSessions((currentSessions) =>
          currentSessions.map((session) => (session.id === sessionId ? fresh : session)),
        );
        setActiveSessionId((currentActiveId) =>
          currentActiveId === sessionId ? fresh.id : currentActiveId,
        );
      } finally {
        manualReconnectsRef.current.delete(sessionId);
      }
    },
    [],
  );

  const cancelReconnect = useCallback((sessionId: string) => {
    void cancelReconnectCommand(sessionId).catch(() => {
      // Session may have already settled; ignore.
    });
  }, []);

  const cancelTerminalTransfer = useCallback((transfer: TerminalTransferStatusEvent) => {
    if (transfer.state === "awaitingSelection") {
      void respondZmodemPrompt(transfer.sessionId, transfer.detectionId, null).catch(() => undefined);
      return;
    }
    void cancelZmodemTransfer(transfer.sessionId, transfer.detectionId).catch((error: unknown) => {
      toast(error instanceof Error ? error.message : "无法取消文件传输。", "error");
    });
  }, []);

  const writeToActiveSession = useCallback(
    async (data: string) => {
      if (!activeSessionId) {
        return;
      }

      await writeSshSession({
        data,
        sessionId: activeSessionId,
      });
    },
    [activeSessionId],
  );

  // Per-session I/O. Terminal surfaces target the session they render rather
  // than the "active" one: in a detached window those differ, because this hook
  // is seeded from the backend's global session list while the window only
  // shows the sessions in its own descriptor.
  const writeToSession = useCallback(async (sessionId: string, data: string) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) {
      // The terminal view can emit one last input event while React swaps the
      // disconnected session for its freshly connected replacement.
      return;
    }
    if (shouldReconnectOnInput(session)) {
      await reconnectSession(sessionId);
      return;
    }
    await writeSshSession({ data, sessionId });
  }, [reconnectSession]);

  const resizeSession = useCallback(async (sessionId: string, size: TerminalSize) => {
    await resizeSshSession({ sessionId, size });
  }, []);

  const closeSession = useCallback(async (sessionId: string) => {
    try {
      await closeSshSession(sessionId);
    } catch {
      // The backend may already have removed failed/disconnected sessions.
    }
    buffersRef.current.delete(sessionId);
    listenersRef.current.delete(sessionId);
    setSessions((currentSessions) => {
      const nextSessions = currentSessions.filter((session) => session.id !== sessionId);
      setActiveSessionId((currentActiveId) =>
        currentActiveId === sessionId ? (nextSessions[0]?.id ?? null) : currentActiveId,
      );
      return nextSessions;
    });
  }, []);

  return {
    activeSession,
    activeSessionId,
    cancelReconnect,
    closeSession,
    getBacklog,
    isSessionsLoaded,
    reconnectSession,
    resizeSession,
    sessions,
    terminalTransfers,
    cancelTerminalTransfer,
    setActiveSessionId,
    startLocalSession,
    startSession,
    subscribeOutput,
    writeToActiveSession,
    writeToSession,
  };
}
