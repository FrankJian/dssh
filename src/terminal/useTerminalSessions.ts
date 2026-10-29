import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SshProfile, TerminalSession, TerminalSize } from "../models";
import { RETAINED_OUTPUT_CHARS } from "../settings/settings";
import { TerminalCommandActivityTracker, type CommandActivity } from "./commandActivity";
import { TerminalTargetTracker } from "./terminalTarget";
import { hasTerminalInstance, pruneTerminals } from "./terminalRegistry";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "../ui/ToastHost";
import {
  cancelZmodemTransfer,
  closeSshSession,
  cancelReconnect as cancelReconnectCommand,
  listSshSessions,
  onTerminalOutput,
  onTerminalInputObserved,
  onTerminalStatus,
  onTerminalTransferPrompt,
  onTerminalTransferConflict,
  onTerminalTransferStatus,
  readSshSessionOutput,
  respondZmodemPrompt,
  respondZmodemConflict,
  resizeSshSession,
  startLocalSession as startLocalSessionCommand,
  startSshSession,
  writeSshSession,
  type TerminalTransferStatusEvent,
  type TerminalTransferConflictEvent,
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
  const [terminalConflicts, setTerminalConflicts] = useState<TerminalTransferConflictEvent[]>([]);
  const [commandActivity, setCommandActivity] = useState<ReadonlySet<string>>(() => new Set());
  const [targetAddresses, setTargetAddresses] = useState<Readonly<Record<string, string | null>>>({});
  const pendingZmodemPromptsRef = useRef(new Set<string>());
  const manualReconnectsRef = useRef(new Set<string>());
  const activityTrackersRef = useRef(new Map<string, TerminalCommandActivityTracker>());
  const targetTrackersRef = useRef(new Map<string, TerminalTargetTracker>());
  // A local PTY can become ready before `start_local_session` resolves in the
  // WebView. Keep that early event so adding the returned session cannot put
  // the sidebar permanently in the "connecting" state.
  const latestSessionStatusesRef = useRef(new Map<string, TerminalSession["status"]>());

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

  const updateCommandActivity = useCallback((sessionId: string, activity: CommandActivity | null) => {
    if (activity === null) {
      return;
    }
    setCommandActivity((current) => {
      const running = activity === "running";
      if (current.has(sessionId) === running) {
        return current;
      }
      const next = new Set(current);
      if (running) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return next;
    });
  }, []);

  const trackerForSession = useCallback((sessionId: string) => {
    let tracker = activityTrackersRef.current.get(sessionId);
    if (!tracker) {
      tracker = new TerminalCommandActivityTracker();
      activityTrackersRef.current.set(sessionId, tracker);
    }
    return tracker;
  }, []);

  const targetTrackerForSession = useCallback((sessionId: string) => {
    let tracker = targetTrackersRef.current.get(sessionId);
    if (!tracker) {
      tracker = new TerminalTargetTracker();
      targetTrackersRef.current.set(sessionId, tracker);
    }
    return tracker;
  }, []);

  const withLatestStatus = useCallback((session: TerminalSession): TerminalSession => {
    const status = latestSessionStatusesRef.current.get(session.id);
    return status ? { ...session, status } : session;
  }, []);

  const pushOutput = useCallback((sessionId: string, data: string) => {
    if (!data) {
      return;
    }
    updateCommandActivity(sessionId, trackerForSession(sessionId).observeOutput(data));
    const address = targetTrackerForSession(sessionId).observeOutput(data);
    if (address !== undefined) {
      setTargetAddresses((current) => current[sessionId] === address
        ? current : { ...current, [sessionId]: address });
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
  }, [targetTrackerForSession, trackerForSession, updateCommandActivity]);

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

  const startLocalSession = useCallback(async (options?: { activate?: boolean }) => {
    const startedSession = await startLocalSessionCommand({
      size: initialSize,
    });
    const session = withLatestStatus(startedSession);
    setSessions((currentSessions) => [...currentSessions, session]);
    if (options?.activate !== false) setActiveSessionId(session.id);
    return session;
  }, [withLatestStatus]);

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
            targetTrackerForSession(snapshot.sessionId).observeOutput(snapshot.output);
          }
        }
        const hydratedAddresses = Object.fromEntries(snapshots.flatMap(({ sessionId }) => {
          const address = targetTrackerForSession(sessionId).address;
          return address === undefined ? [] : [[sessionId, address]];
        }));
        setTargetAddresses((current) => ({ ...hydratedAddresses, ...current }));

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
  }, [targetTrackerForSession]);

  useEffect(() => {
    const inputPromise = onTerminalInputObserved((event) => {
      updateCommandActivity(event.sessionId, trackerForSession(event.sessionId).observeInput(event.data));
      targetTrackerForSession(event.sessionId).observeInput(event.data);
    });
    const outputPromise = onTerminalOutput((event) => {
      pushOutput(event.sessionId, event.data);
    });
    const statusPromise = onTerminalStatus((event) => {
      latestSessionStatusesRef.current.set(event.sessionId, event.status);
      if (event.status === "reconnecting") {
        const address = targetTrackerForSession(event.sessionId).resetConnection();
        setTargetAddresses((current) => {
          const next = { ...current };
          if (address === undefined) delete next[event.sessionId];
          else next[event.sessionId] = address;
          return next;
        });
      }
      setSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.id === event.sessionId ? { ...session, status: event.status } : session,
        ),
      );
      if (event.status !== "connected") {
        updateCommandActivity(event.sessionId, "idle");
        setTerminalConflicts((current) => current.filter((item) => item.sessionId !== event.sessionId));
      }
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
      void inputPromise.then((unlisten) => unlisten());
      void statusPromise.then((unlisten) => unlisten());
    };
  }, [pushOutput, targetTrackerForSession, trackerForSession, updateCommandActivity]);

  useEffect(() => {
    const promptPromise = onTerminalTransferPrompt((event) => {
      if (!hasTerminalInstance(event.sessionId) || pendingZmodemPromptsRef.current.has(event.detectionId)) {
        return;
      }
      pendingZmodemPromptsRef.current.add(event.detectionId);
      void (async () => {
        try {
          const picked = event.direction === "upload"
            ? await open({ multiple: true, title: "选择要通过 rz 上传的文件" })
            : await open({ directory: true, multiple: false, title: "选择通过 sz 保存文件的文件夹" });
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
    const conflictPromise = onTerminalTransferConflict((event) => {
      if (!hasTerminalInstance(event.sessionId)) return;
      setTerminalConflicts((current) => current.some((item) =>
        item.sessionId === event.sessionId && item.detectionId === event.detectionId && item.fileIndex === event.fileIndex,
      ) ? current : [...current, event]);
    });
    const statusPromise = onTerminalTransferStatus((event) => {
      if (!hasTerminalInstance(event.sessionId)) return;
      if (event.state !== "awaitingConflict") {
        setTerminalConflicts((current) => current.filter((item) =>
          item.sessionId !== event.sessionId || item.detectionId !== event.detectionId,
        ));
      }
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
      void conflictPromise.then((unlisten) => unlisten());
      void statusPromise.then((unlisten) => unlisten());
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const startSession = useCallback(async (
    profile: SshProfile,
    size: TerminalSize = initialSize,
    options?: { activate?: boolean },
  ) => {
    const startedSession = await startSshSession({
      profileId: profile.id,
      size,
    });
    const session = withLatestStatus(startedSession);
    setSessions((currentSessions) => [...currentSessions, session]);
    if (options?.activate !== false) setActiveSessionId(session.id);
    return session;
  }, [withLatestStatus]);

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
        const freshSession =
          existing.kind === "ssh"
            ? await startSshSession({ profileId: existing.profileId, size: initialSize })
            : await startLocalSessionCommand({ size: initialSize });
        const fresh = withLatestStatus(freshSession);

        try {
          await closeSshSession(sessionId);
        } catch (error) {
          // Do not hide a failed teardown behind a replacement terminal.
          await closeSshSession(fresh.id).catch(() => undefined);
          throw error;
        }

        target.delete(sessionId);
        listenersRef.current.delete(sessionId);
        activityTrackersRef.current.delete(sessionId);
        targetTrackersRef.current.delete(sessionId);
        setTargetAddresses((current) => {
          if (!(sessionId in current)) return current;
          const next = { ...current };
          delete next[sessionId];
          return next;
        });
        latestSessionStatusesRef.current.delete(sessionId);
        setCommandActivity((current) => {
          if (!current.has(sessionId)) return current;
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
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
    [withLatestStatus],
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

  const resolveTerminalConflict = useCallback(async (conflict: TerminalTransferConflictEvent, overwrite: boolean) => {
    await respondZmodemConflict(conflict.sessionId, conflict.detectionId, overwrite);
    setTerminalConflicts((current) => current.filter((item) => item !== conflict));
  }, []);

  const writeToActiveSession = useCallback(
    async (data: string) => {
      if (!activeSessionId) {
        return;
      }

      updateCommandActivity(activeSessionId, trackerForSession(activeSessionId).observeInput(data));
      targetTrackerForSession(activeSessionId).observeInput(data);
      await writeSshSession({
        data,
        sessionId: activeSessionId,
      });
    },
    [activeSessionId, targetTrackerForSession, trackerForSession, updateCommandActivity],
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
    updateCommandActivity(sessionId, trackerForSession(sessionId).observeInput(data));
    targetTrackerForSession(sessionId).observeInput(data);
    await writeSshSession({ data, sessionId });
  }, [reconnectSession, targetTrackerForSession, trackerForSession, updateCommandActivity]);

  const resizeSession = useCallback(async (sessionId: string, size: TerminalSize) => {
    await resizeSshSession({ sessionId, size });
  }, []);

  const closeSession = useCallback(async (sessionId: string) => {
    await closeSshSession(sessionId);
    buffersRef.current.delete(sessionId);
    listenersRef.current.delete(sessionId);
    activityTrackersRef.current.delete(sessionId);
    targetTrackersRef.current.delete(sessionId);
    setTargetAddresses((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    latestSessionStatusesRef.current.delete(sessionId);
    setTerminalConflicts((current) => current.filter((item) => item.sessionId !== sessionId));
    setCommandActivity((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
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
    terminalConflicts,
    cancelTerminalTransfer,
    resolveTerminalConflict,
    commandActivity,
    targetAddresses,
    setActiveSessionId,
    startLocalSession,
    startSession,
    subscribeOutput,
    writeToActiveSession,
    writeToSession,
  };
}
