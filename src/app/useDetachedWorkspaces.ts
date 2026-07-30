import { useCallback, useEffect, useState } from "react";
import type { DetachedWorkspace } from "../models";
import {
  listDetachedWorkspaces,
  onDetachedWorkspaceClosed,
  onDetachedWorkspaceUpdated,
} from "../services/workspaceService";

/** Tracks live child windows from the main workbench, not persisted sessions. */
export function useDetachedWorkspaces() {
  const [workspaces, setWorkspaces] = useState<DetachedWorkspace[]>([]);

  useEffect(() => {
    let mounted = true;
    void listDetachedWorkspaces().then((items) => {
      if (mounted) setWorkspaces(items);
    }).catch(() => {
      // Detached windows are optional; a failure must not block the workspace.
    });
    const closedPromise = onDetachedWorkspaceClosed((workspace) => {
      setWorkspaces((current) => current.filter((item) => item.label !== workspace.label));
    });
    const updatedPromise = onDetachedWorkspaceUpdated((workspace) => {
      setWorkspaces((current) => {
        const index = current.findIndex((item) => item.label === workspace.label);
        if (index < 0) return [...current, workspace];
        const next = [...current];
        next[index] = workspace;
        return next;
      });
    });
    return () => {
      mounted = false;
      void closedPromise.then((unlisten) => unlisten());
      void updatedPromise.then((unlisten) => unlisten());
    };
  }, []);

  const addWorkspace = useCallback((workspace: DetachedWorkspace) => {
    setWorkspaces((current) =>
      current.some((item) => item.label === workspace.label) ? current : [...current, workspace],
    );
  }, []);

  return { workspaces, addWorkspace };
}
