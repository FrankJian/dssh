import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SshProfile, TerminalSession, TerminalSize } from "../models";
import {
  closeSshSession,
  cancelReconnect as cancelReconnectCommand,
  listSshSessions,
  onTerminalOutput,
  onTerminalStatus,
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

const maxBufferedCharsPerSession = 200_000;

function clipBuffer(value: string) {
  if (value.length <= maxBufferedCharsPerSession) {
    return value;
  }

  return value.slice(value.length - maxBufferedCharsPerSession);
}

export function useTerminalSessions() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Mirror of `sessions` so async callbacks (e.g. reconnect) can read the
  // latest list without becoming stale or churning their identity.
  const sessionsRef = useRef<TerminalSession[]>([]);
  sessionsRef.current = sessions;

  // Raw output per session is the source of truth. It never flows through
  // render state (which can coalesce/drop chunks); instead we keep an
  // accumulated backlog for tab switches and fan out each chunk to the live
  // terminal exactly once through registered listeners.
  const buffersRef = useRef<Map<string, string>>(new Map());
  const listenersRef = useRef<Map<string, Set<TerminalOutputListener>>>(new Map());

  const pushOutput = useCallback((sessionId: string, data: string) => {
    if (!data) {
      return;
    }

    const previous = buffersRef.current.get(sessionId) ?? "";
    buffersRef.current.set(sessionId, clipBuffer(previous + data));

    const listeners = listenersRef.current.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        listener(data);
      }
    }
  }, []);

  const getBacklog = useCallback((sessionId: string) => buffersRef.current.get(sessionId) ?? "", []);

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

    listSshSessions().then(async (loadedSessions) => {
      if (!mounted) {
        return;
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

  const resizeActiveSession = useCallback(
    async (size: TerminalSize) => {
      if (!activeSessionId) {
        return;
      }

      await resizeSshSession({
        sessionId: activeSessionId,
        size,
      });
    },
    [activeSessionId],
  );

  // Per-session I/O (used by split panes, where each pane targets its own session
  // rather than the single active one).
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
    reconnectSession,
    resizeActiveSession,
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
