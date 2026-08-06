import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SshProfile, TerminalSession, TerminalSize } from "../models";
import { RETAINED_OUTPUT_CHARS } from "../settings/settings";
import { pruneTerminals } from "./terminalRegistry";
import {
  closeSshSession,
  cancelReconnect as cancelReconnectCommand,
  listSshSessions,
  onTerminalOutput,
  onTerminalStatus,
  readSshSessionOutput,
  resizeSshSession,
  startLocalSession as startLocalSessionCommand,
  startSshSession,
  writeSshSession,
} from "../services/sshSessionService";

export type TerminalOutputListener = (data: string) => void;

const initialSize: TerminalSize = {
  cols: 100,
  rows: 30,
};

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
    });

    return () => {
      void outputPromise.then((unlisten) => unlisten());
      void statusPromise.then((unlisten) => unlisten());
    };
  }, [pushOutput]);

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
      const target = buffersRef.current;
      const existing = sessionsRef.current.find((session) => session.id === sessionId);
      if (!existing) {
        return;
      }

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
      setSessions((currentSessions) =>
        currentSessions.map((session) => (session.id === sessionId ? fresh : session)),
      );
      setActiveSessionId((currentActiveId) =>
        currentActiveId === sessionId ? fresh.id : currentActiveId,
      );
    },
    [],
  );

  const cancelReconnect = useCallback((sessionId: string) => {
    void cancelReconnectCommand(sessionId).catch(() => {
      // Session may have already settled; ignore.
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
    await writeSshSession({ data, sessionId });
  }, []);

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
    setActiveSessionId,
    startLocalSession,
    startSession,
    subscribeOutput,
    writeToActiveSession,
    writeToSession,
  };
}
