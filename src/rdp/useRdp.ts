import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RdpConnectionProfile, RdpEngineStatus, RdpSession } from "../models/rdp";
import { listRdpProfiles, listRdpSessions, onRdpSession, rdpEngineStatus } from "../services/rdpService";

import { dismissRdpSession, mergeRdpSession, reconcileRdpSnapshot, visibleRdpSessions } from "./sessionState";
export function useRdp(locked: boolean) {
  const [profiles, setProfiles] = useState<RdpConnectionProfile[]>([]);
  const [sessions, setSessions] = useState<RdpSession[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [engine, setEngine] = useState<RdpEngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const eventCount = useRef(0);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const reload = useCallback(async () => {
    if (locked) return;
    const request = ++generation.current;
    const before = eventCount.current;
    try {
      const [nextProfiles, nextSessions, status] = await Promise.all([listRdpProfiles(), listRdpSessions(), rdpEngineStatus()]);
      if (lockedRef.current || request !== generation.current) return;
      setProfiles(nextProfiles); setSessions((current) => reconcileRdpSnapshot(current, nextSessions, before !== eventCount.current));
      setEngine(status); setError(null);
    } catch (e) { if (!lockedRef.current && request === generation.current) setError(e instanceof Error ? e.message : "加载远程桌面失败。"); }
  }, [locked]);
  useEffect(() => {
    if (locked) { generation.current++; setSessions([]); return; }
    let cancelled = false;
    const listener = onRdpSession((session) => { if (!cancelled && !lockedRef.current) { eventCount.current++; setSessions((current) => mergeRdpSession(current, session)); } });
    void listener.then(() => { if (!cancelled) void reload(); }).catch(() => undefined);
    const focus = () => { void reload(); };
    window.addEventListener("focus", focus);
    return () => { cancelled = true; window.removeEventListener("focus", focus); void listener.then((dispose) => dispose()).catch(() => undefined); };
  }, [locked, reload]);
  const dismissSession = useCallback((id: string) => {
    setDismissed((current) => dismissRdpSession(sessions, current, id));
  }, [sessions]);
  const visibleSessions = useMemo(() => visibleRdpSessions(sessions, dismissed), [sessions, dismissed]);
  return { profiles, sessions: visibleSessions, engine, error, reload, dismissSession };
}
