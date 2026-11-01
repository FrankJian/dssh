import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { JumpServerProfile } from "../models/jumpserver";
import { listJumpServerProfiles } from "../services/jumpserverService";

export function useJumpServerProfiles(locked = false) {
  const [profiles, setProfiles] = useState<JumpServerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const reload = useCallback(async () => {
    const request = ++revision.current;
    if (locked) { setProfiles([]); setLoading(false); return; }
    setLoading(true);
    try {
      const next = await listJumpServerProfiles();
      if (request === revision.current) { setProfiles(next); setError(null); }
    } catch (e) { if (request === revision.current) setError(e instanceof Error ? e.message : "加载 JumpServer 连接失败。"); }
    finally { if (request === revision.current) setLoading(false); }
  }, [locked]);
  useEffect(() => {
    void reload();
    const listener = listen("jumpserver://profiles-changed", () => { void reload(); });
    return () => { revision.current++; void listener.then((unlisten) => unlisten()); };
  }, [reload]);
  return { profiles, loading, error, reload };
}
