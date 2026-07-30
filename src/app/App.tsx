import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AiChat } from "../ai/AiChat";
import { AiConfigModal } from "../ai/AiConfigModal";
import { useAiChat } from "../ai/useAiChat";
import { useAiConfig } from "../ai/useAiConfig";
import { onAiEvent } from "../services/aiService";
import { readImageDataUrl } from "../services/configService";
import {
  onHostKeyChanged,
  onHostKeyPrompt,
  onSshTransportStatus,
  respondHostKeyPrompt,
  type HostKeyPromptEvent,
} from "../services/sshSessionService";
import { HostToolsPanel } from "../hosttools/HostToolsPanel";
import type { S3Profile, SshProfile, TerminalSession } from "../models";
import { DeleteS3ProfileDialog } from "../s3/DeleteS3ProfileDialog";
import { S3ProfileEditor } from "../s3/S3ProfileEditor";
import { S3ProfileSidebar } from "../s3/S3ProfileSidebar";
import { S3Workspace } from "../s3/S3Workspace";
import type { S3ProfileDraft, S3ProfileEditorMode } from "../s3/profileTypes";
import { useS3Profiles } from "../s3/useS3Profiles";
import { SettingsDialog } from "../settings/SettingsDialog";
import { useEditorSettings } from "../settings/useEditorSettings";
import { useTerminalSettings } from "../settings/useTerminalSettings";
import { FileBrowser } from "../sftp/FileBrowser";
import { RemoteFileEditor } from "../sftp/RemoteFileEditor";
import { RemoteFileTree } from "../sftp/RemoteFileTree";
import { ProfileEditor } from "../ssh/ProfileEditor";
import { SessionManager } from "../ssh/SessionManager";
import { SessionTree, type SessionNode } from "../ssh/SessionTree";
import { HostKeyPrompt } from "../ssh/HostKeyPrompt";
import { useProfiles } from "../ssh/useProfiles";
import { useRecentConnections } from "../ssh/useRecentConnections";
import { PaneGrid } from "../terminal/PaneGrid";
import { PortForwardDialog } from "../terminal/PortForwardDialog";
import { TerminalFileLayout } from "../terminal/TerminalFileLayout";
import { TerminalWorkspace } from "../terminal/TerminalWorkspace";
import { paneSessionIds, usePaneLayout, type SplitDir } from "../terminal/usePaneLayout";
import { useTerminalSessions } from "../terminal/useTerminalSessions";
import { useTheme } from "../theme/useTheme";
import { Icon } from "../ui/Icon";
import { ToastHost, toast } from "../ui/ToastHost";
import { WindowControls } from "../ui/WindowControls";
import { isMacOS } from "../platform";
import { ActivityBar, type ActivityId, type RightPanelId } from "./ActivityBar";
import { AppLayout } from "./AppLayout";
import { CommandPalette, type PaletteItem } from "./CommandPalette";
import { isCommandPaletteShortcut } from "./shortcuts";
import { useWorkspace } from "./useWorkspace";
import { useDetachedWorkspaces } from "./useDetachedWorkspaces";
import { DetachedWorkspaceWindow } from "./DetachedWorkspace";
import { WorkspaceTabStrip, type WorkspaceTabItem } from "./WorkspaceTabStrip";
import type { ProfileDraft, ProfileEditorMode } from "../ssh/profileTypes";
import type { DetachedWorkspace } from "../models";
import {
  getDetachedWorkspace,
  onDetachedWorkspaceClosed,
  openDetachedSftpWorkspace,
  openDetachedTerminalWorkspace,
} from "../services/workspaceService";

interface EditorState {
  mode: ProfileEditorMode;
  profile: SshProfile | null;
}

interface S3EditorState {
  mode: S3ProfileEditorMode;
  profile: S3Profile | null;
}

interface ForwardTarget {
  sessionId: string;
  profile: SshProfile;
}

const SIDEBAR_COLLAPSED_KEY = "dssh.sidebar.collapsed";
const RIGHT_PANEL_KEY = "dssh.rightPanel";
const RIGHT_PANEL_WIDTH_KEY = "dssh.ai.panelWidth";
const SESSIONS_PANEL_WIDTH_KEY = "dssh.ssh.panelWidth";
const S3_PANEL_WIDTH_KEY = "dssh.s3.panelWidth";
const RIGHT_PANEL_WIDTH_DEFAULT = 360;
const SIDE_PANEL_WIDTH_DEFAULT = 288;

function loadPanelWidth(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadRightPanel(): RightPanelId | null {
  const raw = localStorage.getItem(RIGHT_PANEL_KEY);
  return raw === "assistant" || raw === "hosttools" ? raw : null;
}

function MainApp() {
  const [activeActivity, setActiveActivity] = useState<ActivityId>("sessions");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );
  const [rightPanel, setRightPanel] = useState<RightPanelId | null>(() => loadRightPanel());
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [s3EditorState, setS3EditorState] = useState<S3EditorState | null>(null);
  const [s3ProfileDeleteTarget, setS3ProfileDeleteTarget] = useState<S3Profile | null>(null);
  const [s3TabProfileIds, setS3TabProfileIds] = useState<string[]>([]);
  const [activeS3ProfileId, setActiveS3ProfileId] = useState<string | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ForwardTarget | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<"appearance" | "ai" | "config">(
    "appearance",
  );
  const [isAiConfigOpen, setIsAiConfigOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [hostKeyPrompts, setHostKeyPrompts] = useState<HostKeyPromptEvent[]>([]);
  const reconnectingProfiles = useRef(new Set<string>());
  const [zenMode, setZenMode] = useState<boolean>(
    () => localStorage.getItem("dssh.zenMode") === "true",
  );

  useEffect(() => {
    localStorage.setItem("dssh.zenMode", String(zenMode));
  }, [zenMode]);
  const aiConfig = useAiConfig();
  const aiChat = useAiChat();
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() =>
    loadPanelWidth(RIGHT_PANEL_WIDTH_KEY, RIGHT_PANEL_WIDTH_DEFAULT),
  );
  const [sessionsPanelWidth, setSessionsPanelWidth] = useState<number>(() =>
    loadPanelWidth(SESSIONS_PANEL_WIDTH_KEY, SIDE_PANEL_WIDTH_DEFAULT),
  );
  const [s3PanelWidth, setS3PanelWidth] = useState<number>(() =>
    loadPanelWidth(S3_PANEL_WIDTH_KEY, SIDE_PANEL_WIDTH_DEFAULT),
  );

  useEffect(() => {
    localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(rightPanelWidth));
  }, [rightPanelWidth]);
  useEffect(() => {
    localStorage.setItem(SESSIONS_PANEL_WIDTH_KEY, String(sessionsPanelWidth));
  }, [sessionsPanelWidth]);
  useEffect(() => {
    localStorage.setItem(S3_PANEL_WIDTH_KEY, String(s3PanelWidth));
  }, [s3PanelWidth]);
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (rightPanel) {
      localStorage.setItem(RIGHT_PANEL_KEY, rightPanel);
    } else {
      localStorage.removeItem(RIGHT_PANEL_KEY);
    }
  }, [rightPanel]);

  const { setThemeMode, themeMode } = useTheme();
  const {
    copyOnSelect,
    fontFamily,
    fontSize,
    gpuAcceleration,
    resetFontSize,
    rightClick,
    setCopyOnSelect,
    setFontFamily,
    setFontSize,
    setGpuAcceleration,
    terminalBgImage,
    setTerminalBgImage,
    terminalBgOpacity,
    setTerminalBgOpacity,
    terminalWorkspaceInset,
    setTerminalWorkspaceInset,
    s3DownloadConcurrency,
    s3UploadConcurrency,
    setS3DownloadConcurrency,
    setS3UploadConcurrency,
    setRightClick,
  } = useTerminalSettings();
  const editorSettings = useEditorSettings(fontFamily, fontSize);
  const {
    allTags,
    createProfile,
    deleteProfile,
    errorMessage,
    isLoading,
    profiles,
    reloadProfiles,
    setSelectedProfileId,
    toggleFavorite,
    updateProfile,
  } = useProfiles();
  const s3Profiles = useS3Profiles();
  const {
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
  } = useTerminalSessions();
  const {
    sftpTabs,
    activeSftpId,
    openSftpTab,
    closeSftpTab,
    closeSftpTabsForProfile,
    focusSftpTab,
    focusTerminal,
    tabOrder,
    reorderTab,
  } = useWorkspace();
  const { recentIds, recordUse } = useRecentConnections();
  const panes = usePaneLayout();
  const { workspaces: detachedWorkspaces, addWorkspace } = useDetachedWorkspaces();
  // A compact remote tree can be docked alongside one SSH terminal. It is a
  // workspace presentation state, not a separate tab or an additional shell.
  const [fileTreeSessionId, setFileTreeSessionId] = useState<string | null>(null);
  const [openRemoteFilePaths, setOpenRemoteFilePaths] = useState<string[]>([]);
  const [activeRemoteFilePath, setActiveRemoteFilePath] = useState<string | null>(null);
  const [terminalNames, setTerminalNames] = useState<Record<string, string>>({});
  const [paneNames, setPaneNames] = useState<Record<string, string>>({});

  const detachedTerminalSessionIds = new Set(
    detachedWorkspaces.flatMap((workspace) => workspace.terminal?.sessionIds ?? []),
  );
  const detachedSftpProfileIds = new Set(
    detachedWorkspaces.flatMap((workspace) => workspace.sftp?.profileId ?? []),
  );
  const visibleSessions = sessions.filter((session) => !detachedTerminalSessionIds.has(session.id));

  // A detached renderer may have changed the focused pane or divider ratios.
  // Keep the hidden main-window tree in sync so it is restored exactly as the
  // user left it when the child window closes.
  useEffect(() => {
    const closedPromise = onDetachedWorkspaceClosed((workspace) => {
      if (workspace.terminal) {
        const restoredSessionId =
          workspace.terminal.layout?.focusedPaneId
          ?? workspace.terminal.sessionIds[0]
          ?? workspace.terminal.tabSessionId;
        if (workspace.terminal.layout) {
          panes.replaceLayout(workspace.terminal.layout);
          panes.focusPane(restoredSessionId);
        }
        setActiveSessionId(restoredSessionId);
        focusTerminal();
        setActiveActivity("sessions");
      }
      if (workspace.sftp) {
        openSftpTab(workspace.sftp.profileId, workspace.title.replace(/^SFTP · /, ""));
        setActiveActivity("sessions");
      }
    });
    return () => { void closedPromise.then((unlisten) => unlisten()); };
  }, [
    focusTerminal,
    openSftpTab,
    panes.focusPane,
    panes.replaceLayout,
    setActiveSessionId,
  ]);

  useEffect(() => {
    if (!activeSessionId || !detachedTerminalSessionIds.has(activeSessionId)) return;
    setActiveSessionId(visibleSessions[0]?.id ?? null);
  }, [activeSessionId, detachedWorkspaces, setActiveSessionId, visibleSessions]);

  useEffect(() => {
    const activeIds = new Set(sessions.map((session) => session.id));
    setTerminalNames((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setPaneNames((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [sessions]);

  function defaultTerminalName(session: TerminalSession) {
    const terminalWindowId = panes.findLayout(session.id)?.tabSessionId ?? session.id;
    const siblings = sessions.filter((candidate) => {
      if (candidate.kind !== session.kind || candidate.profileId !== session.profileId) return false;
      const layout = panes.findLayout(candidate.id);
      return !layout || layout.tabSessionId === candidate.id;
    });
    return `终端 ${Math.max(0, siblings.findIndex((candidate) => candidate.id === terminalWindowId)) + 1}`;
  }

  function terminalName(session: TerminalSession) {
    return terminalNames[session.id] ?? defaultTerminalName(session);
  }

  function defaultPaneName(sessionId: string) {
    const layout = panes.findLayout(sessionId);
    const index = layout ? paneSessionIds(layout).indexOf(sessionId) : -1;
    return `Pane ${Math.max(0, index) + 1}`;
  }

  function paneName(sessionId: string) {
    return paneNames[sessionId] ?? defaultPaneName(sessionId);
  }

  function terminalTabTitle(session: TerminalSession) {
    const hostName = session.kind === "ssh"
      ? profiles.find((profile) => profile.id === session.profileId)?.name ?? session.title
      : "本地";
    return `${terminalName(session)}（${hostName}）`;
  }

  function handleRenameTerminal(sessionId: string, name: string) {
    setTerminalNames((current) => {
      if (name) {
        return { ...current, [sessionId]: name };
      }
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }

  function handleRenamePane(sessionId: string, name: string) {
    setPaneNames((current) => {
      if (name) return { ...current, [sessionId]: name };
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }

  // Terminal wallpaper: the chosen file is read once into a data URL and handed
  // to CSS. An unreadable/removed file silently falls back to no background.
  const [terminalBgDataUrl, setTerminalBgDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!terminalBgImage) {
      setTerminalBgDataUrl(null);
      return;
    }
    void readImageDataUrl(terminalBgImage)
      .then((url) => {
        if (!cancelled) setTerminalBgDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTerminalBgDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [terminalBgImage]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--terminal-bg-image",
      terminalBgDataUrl ? `url("${terminalBgDataUrl}")` : "none",
    );
    // Below 100% the terminal surface is translucent so the wallpaper (or the
    // app background) shows through; at 100% it stays the flat terminal colour.
    root.style.setProperty(
      "--terminal-surface",
      terminalBgOpacity >= 100 ? "var(--terminal-bg)" : `rgba(20, 20, 28, ${terminalBgOpacity / 100})`,
    );
  }, [terminalBgDataUrl, terminalBgOpacity]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--terminal-workspace-inset",
      `${terminalWorkspaceInset}px`,
    );
  }, [terminalWorkspaceInset]);

  const isS3 = activeActivity === "s3";
  const isConnections = activeActivity === "connections";
  const isSftpActive = activeSftpId != null && sftpTabs.some((tab) => tab.id === activeSftpId);
  const activeSftpTab = sftpTabs.find((tab) => tab.id === activeSftpId) ?? null;

  // Bring the active terminal surface to the front: clear any SFTP selection and
  // switch to the Sessions activity (S3 / Connections otherwise fill the column).
  const showTerminalSurface = useCallback(() => {
    focusTerminal();
    setActiveActivity("sessions");
  }, [focusTerminal]);


  useEffect(() => {
    const unlistenPromise = onAiEvent((event) => {
      if (event.kind !== "openSshSession") {
        return;
      }
      const profile = profiles.find((item) => item.id === event.profileId);
      if (!profile) {
        aiChat.completeSshSessionOpen(
          event.callId,
          "无法打开 SSH 连接：保存的服务器配置已不存在。",
          true,
        );
        return;
      }
      void startSession(profile)
        .then(() => {
          recordUse(profile.id);
          showTerminalSurface();
          aiChat.completeSshSessionOpen(
            event.callId,
            `已打开 SSH 终端：${profile.username}@${profile.host}:${profile.port}。`,
            false,
          );
        })
        .catch((error) => {
          aiChat.completeSshSessionOpen(
            event.callId,
            `无法打开 SSH 连接：${error instanceof Error ? error.message : "连接失败。"}`,
            true,
          );
        });
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    aiChat.completeSshSessionOpen,
    profiles,
    startSession,
    showTerminalSurface,
    recordUse,
  ]);

  // ⌘K / Ctrl+K toggles the command palette; Escape leaves zen mode.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isCommandPaletteShortcut(event)) {
        event.preventDefault();
        setIsPaletteOpen((open) => !open);
      } else if (event.key === "Escape" && zenMode) {
        setZenMode(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zenMode]);

  // Closing/disconnecting the target session also closes its adjacent tree.
  useEffect(() => {
    setFileTreeSessionId((current) =>
      current && sessions.some((session) => session.id === current) ? current : null,
    );
    panes.pruneSessions(new Set(sessions.map((session) => session.id)));
  }, [panes.pruneSessions, sessions]);

  useEffect(() => {
    setOpenRemoteFilePaths([]);
    setActiveRemoteFilePath(null);
  }, [fileTreeSessionId]);

  // Host-key trust (TOFU): queue first-use prompts; warn loudly on a changed key.
  useEffect(() => {
    const promptPromise = onHostKeyPrompt((event) => {
      setHostKeyPrompts((current) =>
        current.some((item) => item.promptId === event.promptId) ? current : [...current, event],
      );
    });
    const changedPromise = onHostKeyChanged((event) => {
      window.alert(
        `⚠️ 主机密钥已变更：${event.host}:${event.port}\n\n` +
          `已记录指纹：${event.storedFingerprint}\n` +
          `本次指纹：${event.presentedFingerprint}\n\n` +
          `连接已被拒绝。如果这是预期的变更（例如服务器重装），请在 known_hosts 中移除旧记录后重试。`,
      );
    });
    return () => {
      void promptPromise.then((unlisten) => unlisten());
      void changedPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Surface transport-level recovery once per profile without spamming a toast
  // for every backoff attempt. Individual terminal panes continue to show their
  // own detailed reconnect status.
  useEffect(() => {
    const statusPromise = onSshTransportStatus((event) => {
      if (event.state === "reconnecting") {
        if (!reconnectingProfiles.current.has(event.profileId)) {
          reconnectingProfiles.current.add(event.profileId);
          toast(event.message ?? "共享 SSH 连接已断开，正在恢复…", "warning");
        }
        return;
      }
      if (event.state === "ready" && reconnectingProfiles.current.delete(event.profileId)) {
        toast("共享 SSH 连接已恢复。", "success");
        return;
      }
      if (event.state === "failed" && reconnectingProfiles.current.delete(event.profileId)) {
        toast(event.message ?? "共享 SSH 连接恢复失败，请重试操作。", "error");
      }
    });
    return () => {
      void statusPromise.then((unlisten) => unlisten());
    };
  }, []);

  function resolveHostKeyPrompt(promptId: string, accept: boolean) {
    void respondHostKeyPrompt(promptId, accept);
    setHostKeyPrompts((current) => current.filter((item) => item.promptId !== promptId));
  }

  function openCreateProfile() {
    setEditorState({ mode: "create", profile: null });
  }

  function openEditProfile(profile: SshProfile) {
    setEditorState({ mode: "edit", profile });
  }

  function closeEditor() {
    setEditorState(null);
  }

  async function handleDeleteProfile(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    if (window.confirm(`确定删除 SSH 配置“${profile.name}”吗？`)) {
      try {
        await deleteProfile(profileId);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "删除 SSH 配置失败。");
      }
    }
  }

  async function handleSubmitProfile(draft: ProfileDraft) {
    if (editorState?.mode === "edit" && editorState.profile) {
      await updateProfile(editorState.profile.id, draft);
    } else {
      await createProfile(draft);
    }

    closeEditor();
  }

  async function handleToggleFavorite(profileId: string) {
    try {
      await toggleFavorite(profileId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "更新收藏状态失败。");
    }
  }

  async function handleSubmitS3Profile(draft: S3ProfileDraft) {
    if (s3EditorState?.mode === "edit" && s3EditorState.profile) {
      await s3Profiles.updateProfile(s3EditorState.profile.id, draft);
    } else {
      await s3Profiles.createProfile(draft);
    }
    setS3EditorState(null);
  }

  async function confirmDeleteS3Profile(profile: S3Profile) {
    try {
      await s3Profiles.deleteProfile(profile.id);
      closeS3Tab(profile.id);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "删除 S3 配置失败。");
    }
  }

  function openS3Profile(profile: S3Profile) {
    s3Profiles.setSelectedProfileId(profile.id);
    setS3TabProfileIds((current) =>
      current.includes(profile.id) ? current : [...current, profile.id],
    );
    setActiveS3ProfileId(profile.id);
  }

  function closeS3Tab(profileId: string) {
    const index = s3TabProfileIds.indexOf(profileId);
    const next = s3TabProfileIds.filter((id) => id !== profileId);
    setS3TabProfileIds(next);
    if (activeS3ProfileId === profileId) {
      const nextActive = next[index] ?? next[index - 1] ?? null;
      setActiveS3ProfileId(nextActive);
      s3Profiles.setSelectedProfileId(nextActive);
    }
  }

  async function handleConnectProfile(profile: SshProfile) {
    setSelectedProfileId(profile.id);
    try {
      await startSession(profile);
      recordUse(profile.id);
      showTerminalSurface();
    } catch (error) {
      toast(error instanceof Error ? error.message : "启动 SSH 会话失败。", "error");
    }
  }

  async function handleStartLocalSession() {
    try {
      await startLocalSession();
      showTerminalSurface();
    } catch (error) {
      toast(error instanceof Error ? error.message : "启动本地终端失败。", "error");
    }
  }

  // --- Split panes ----------------------------------------------------------
  async function handleSplit(dir: SplitDir) {
    if (!activeSessionId) {
      return;
    }
    const currentId = activeSessionId;
    // The new pane mirrors the one it was split from: splitting an SSH pane
    // opens another session to the same host, so you get a second shell on the
    // server you're actually working on. Only a local pane spawns a local shell.
    const source = sessions.find((session) => session.id === currentId);
    const sourceProfile =
      source?.kind === "ssh"
        ? (profiles.find((profile) => profile.id === source.profileId) ?? null)
        : null;
    try {
      const session = sourceProfile
        ? await startSession(sourceProfile)
        : await startLocalSession();
      panes.split(dir, currentId, session.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "拆分终端失败。", "error");
    }
  }

  function handleClosePane(sessionId: string) {
    const remaining = paneSessionIds(panes.findLayout(sessionId)).filter((id) => id !== sessionId);
    void closeSession(sessionId);
    if (fileTreeSessionId === sessionId) {
      setFileTreeSessionId(null);
    }
    panes.removePane(sessionId);
    const next = remaining[0];
    if (next) {
      setActiveSessionId(next);
      panes.focusPane(next);
    }
  }

  function handleCloseTerminalWindow(tabSessionId: string) {
    const layout = panes.findLayoutByTab(tabSessionId);
    if (!layout) {
      void closeSession(tabSessionId);
      return;
    }
    panes.removeLayout(tabSessionId);
    for (const sessionId of paneSessionIds(layout)) {
      void closeSession(sessionId);
    }
  }

  // --- Session-tree node actions -------------------------------------------
  function handleFocusTerminal(sessionId: string) {
    setFileTreeSessionId(null);
    panes.focusPane(sessionId);
    setActiveSessionId(sessionId);
    focusTerminal();
  }

  async function handleNewTerminalForNode(node: SessionNode) {
    if (node.kind === "ssh" && node.profile) {
      await handleConnectProfile(node.profile);
    } else {
      await handleStartLocalSession();
    }
  }

  function handleOpenSftpForProfile(profile: SshProfile) {
    openSftpTab(profile.id, profile.name);
  }

  function handleOpenForwardForNode(node: SessionNode) {
    const session = node.sessions[0];
    if (node.profile && session) {
      setForwardTarget({ sessionId: session.id, profile: node.profile });
    }
  }

  function handleOpenFileListForNode(node: SessionNode) {
    if (node.kind !== "ssh" || !node.profile) {
      return;
    }
    // Prefer the terminal already focused for this host; otherwise use its
    // first terminal. The file tree is intentionally paired with one shell.
    const session =
      node.sessions.find((item) => item.id === activeSessionId) ?? node.sessions[0];
    if (!session) {
      return;
    }
    setActiveSessionId(session.id);
    setFileTreeSessionId(session.id);
    showTerminalSurface();
  }

  function handleOpenRemoteFile(path: string) {
    setOpenRemoteFilePaths((current) => (current.includes(path) ? current : [...current, path]));
    setActiveRemoteFilePath(path);
  }

  function handleCloseRemoteFile(path: string) {
    setOpenRemoteFilePaths((current) => {
      const next = current.filter((item) => item !== path);
      setActiveRemoteFilePath((active) => {
        if (active !== path) {
          return active;
        }
        return next[next.length - 1] ?? null;
      });
      return next;
    });
  }

  function handleRenameRemoteFile(oldPath: string, newPath: string) {
    setOpenRemoteFilePaths((current) =>
      current.map((path) => (path === oldPath ? newPath : path)),
    );
    setActiveRemoteFilePath((current) => (current === oldPath ? newPath : current));
  }

  async function handleDisconnectNode(node: SessionNode) {
    if (node.sessions.some((session) => session.id === fileTreeSessionId)) {
      setFileTreeSessionId(null);
    }
    for (const session of node.sessions) {
      await closeSession(session.id);
    }
    if (node.kind === "ssh" && node.profile) {
      closeSftpTabsForProfile(node.profile.id);
    }
  }

  function handleReconnectActiveSession() {
    if (activeSession) {
      void reconnectSession(activeSession.id);
    }
  }

  function handleOpenPortForward() {
    if (activeSession?.kind === "ssh" && activeSessionProfile) {
      setForwardTarget({ sessionId: activeSession.id, profile: activeSessionProfile });
    }
  }

  function handleSelectActivity(next: ActivityId) {
    if (next === activeActivity) {
      setSidebarCollapsed((collapsed) => !collapsed);
      return;
    }
    setActiveActivity(next);
    setSidebarCollapsed(false);
  }

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  const toggleRightPanel = useCallback((panel: RightPanelId) => {
    setRightPanel((current) => (current === panel ? null : panel));
  }, []);

  const activeSessionProfile =
    activeSession && activeSession.kind === "ssh"
      ? (profiles.find((profile) => profile.id === activeSession.profileId) ?? null)
      : null;
  const activeSessionLabel = activeSession
    ? activeSessionProfile
      ? `${activeSessionProfile.username}@${activeSessionProfile.host}:${activeSessionProfile.port}`
      : activeSession.title
    : "";
  const canForward = activeSession?.kind === "ssh" && activeSessionProfile != null;

  // An active terminal is optional AI context. Without one, the assistant can
  // still inspect saved profiles and ask to open a new SSH connection.
  const aiCurrentServer = activeSession
    ? {
        id: activeSession.kind === "ssh" ? activeSession.profileId : "local",
        label: activeSessionLabel || activeSession.title,
        sessionId: activeSession.id,
        kind: activeSession.kind,
      }
    : null;

  function openSettings(category: "appearance" | "ai" | "config") {
    setSettingsCategory(category);
    setIsSettingsOpen(true);
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented) {
      return;
    }
    const target = event.target;
    if (rightClick === "menu" && target instanceof Element && target.closest(".terminal-view")) {
      return;
    }
    event.preventDefault();
  }

  const sidebarWidth = isS3 ? s3PanelWidth : sessionsPanelWidth;
  const setSidebarWidth = isS3 ? setS3PanelWidth : setSessionsPanelWidth;
  const paneTabBySession = new Map<string, string>();
  for (const layout of panes.layouts) {
    for (const sessionId of paneSessionIds(layout)) {
      paneTabBySession.set(sessionId, layout.tabSessionId);
    }
  }
  const activePaneLayout = panes.findLayout(activeSessionId);
  const activeCanSplit = panes.canSplit(activeSessionId);

  // Every pane tree has one terminal-window tab. Child panes never appear as
  // independent tabs, even while another terminal window is active.
  const workspaceTabs: WorkspaceTabItem[] = [
    ...sessions
      .filter((session) => !detachedTerminalSessionIds.has(session.id))
      .filter((session) => {
        const tabSessionId = paneTabBySession.get(session.id);
        return !tabSessionId || tabSessionId === session.id;
      })
      .map((session) => ({
        id: session.id,
        kind: session.kind === "ssh" ? ("ssh" as const) : ("local" as const),
        title: terminalTabTitle(session),
        active: !isSftpActive && (session.id === activeSessionId || session.id === paneTabBySession.get(activeSessionId ?? "")),
      })),
    ...sftpTabs.filter((tab) => !detachedSftpProfileIds.has(tab.profileId)).map((tab) => ({
      id: tab.id,
      kind: "sftp" as const,
      title: `SFTP · ${tab.title}`,
      active: isSftpActive && tab.id === activeSftpId,
    })),
  ];

  // Apply the user's drag-reordering: explicitly ordered tabs first (in that
  // order), then any new tabs in their natural order.
  if (tabOrder.length > 0) {
    const rank = new Map(tabOrder.map((id, index) => [id, index]));
    workspaceTabs.sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }

  function handleSelectTab(tab: WorkspaceTabItem) {
    if (tab.kind === "sftp") {
      setFileTreeSessionId(null);
      focusSftpTab(tab.id);
      return;
    }
    if (tab.id !== fileTreeSessionId) {
      setFileTreeSessionId(null);
    }
    focusTerminal();
    const layout = panes.findLayoutByTab(tab.id);
    if (layout) {
      const sessionId = paneSessionIds(layout).includes(layout.focusedPaneId)
        ? layout.focusedPaneId
        : paneSessionIds(layout)[0];
      if (sessionId) {
        panes.focusPane(sessionId);
        setActiveSessionId(sessionId);
      }
    } else {
      setActiveSessionId(tab.id);
    }
  }

  function handleCloseTab(tab: WorkspaceTabItem) {
    if (tab.kind === "sftp") {
      closeSftpTab(tab.id);
    } else if (panes.findLayoutByTab(tab.id)) {
      const layout = panes.findLayoutByTab(tab.id)!;
      const sessionIds = paneSessionIds(layout);
      if (sessionIds.includes(fileTreeSessionId ?? "")) {
        setFileTreeSessionId(null);
      }
      panes.removeLayout(tab.id);
      for (const sessionId of sessionIds) {
        void closeSession(sessionId);
      }
    } else {
      if (tab.id === fileTreeSessionId) {
        setFileTreeSessionId(null);
      }
      void closeSession(tab.id);
    }
  }

  async function handleDetachTab(tab: WorkspaceTabItem) {
    try {
      const parentLabel = getCurrentWindow().label;
      if (tab.kind === "sftp") {
        const sftpTab = sftpTabs.find((item) => item.id === tab.id);
        if (!sftpTab) return;
        const workspace = await openDetachedSftpWorkspace({
          parentLabel,
          profileId: sftpTab.profileId,
          title: tab.title,
        });
        addWorkspace(workspace);
        closeSftpTab(tab.id);
        return;
      }

      const layout = panes.findLayoutByTab(tab.id);
      const sessionIds = layout ? paneSessionIds(layout) : [tab.id];
      const workspace = await openDetachedTerminalWorkspace({
        parentLabel,
        title: tab.title,
        terminal: {
          tabSessionId: tab.id,
          sessionIds,
          layout,
        },
      });
      addWorkspace(workspace);
      if (sessionIds.includes(fileTreeSessionId ?? "")) {
        setFileTreeSessionId(null);
      }
      if (sessionIds.includes(activeSessionId ?? "")) {
        const next = visibleSessions.find((session) => !sessionIds.includes(session.id));
        setActiveSessionId(next?.id ?? null);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "无法移至新窗口。", "error");
    }
  }

  const sidebarContent =
    sidebarCollapsed || isConnections ? null : isS3 ? (
        <S3ProfileSidebar
          errorMessage={s3Profiles.errorMessage}
          isLoading={s3Profiles.isLoading}
          onCreate={() => setS3EditorState({ mode: "create", profile: null })}
          onDelete={setS3ProfileDeleteTarget}
          onEdit={(profile) => setS3EditorState({ mode: "edit", profile })}
          onOpen={openS3Profile}
          onQueryChange={s3Profiles.setQuery}
          onSelect={(id) => {
            const profile = s3Profiles.profiles.find((item) => item.id === id);
            if (profile) openS3Profile(profile);
          }}
          onToggleFavorite={(id) => void s3Profiles.toggleFavorite(id)}
          profiles={s3Profiles.filteredProfiles}
          query={s3Profiles.query}
          selectedProfileId={activeS3ProfileId}
          totalCount={s3Profiles.profiles.length}
        />
      ) : (
        <SessionTree
          sessions={visibleSessions}
          terminalNames={terminalNames}
          paneNames={paneNames}
          paneLayouts={panes.layouts}
          activeSessionId={activeSessionId}
          isSftpActive={isSftpActive}
          profiles={profiles}
          onFocusTerminal={handleFocusTerminal}
          onNewTerminal={handleNewTerminalForNode}
          onOpenSftp={handleOpenSftpForProfile}
          onOpenForward={handleOpenForwardForNode}
          onOpenFileList={handleOpenFileListForNode}
          onCloseSession={handleClosePane}
          onCloseTerminalWindow={handleCloseTerminalWindow}
          onRenameTerminal={handleRenameTerminal}
          onRenamePane={handleRenamePane}
          onDisconnectNode={handleDisconnectNode}
          onConnectProfile={handleConnectProfile}
          onCreateProfile={openCreateProfile}
          onOpenConnections={() => setActiveActivity("connections")}
        />
      );

  const rightPanelContent =
    rightPanel === "assistant" ? (
      <AiChat
        chat={aiChat}
        config={aiConfig}
        currentServer={aiCurrentServer}
        layout="panel"
        onOpenConfig={() => setIsAiConfigOpen(true)}
      />
    ) : rightPanel === "hosttools" ? (
      <HostToolsPanel
        profileId={activeSession?.kind === "ssh" ? activeSession.profileId : null}
        targetLabel={activeSession ? activeSessionLabel || activeSession.title : null}
        onClose={() => setRightPanel(null)}
      />
    ) : null;

  const fileTreeProfile =
    fileTreeSessionId && fileTreeSessionId === activeSessionId && activeSession?.kind === "ssh"
      ? (profiles.find((profile) => profile.id === activeSession.profileId) ?? null)
      : null;

  const terminalSurface = (
    <TerminalWorkspace
      activeSession={activeSession}
      activeSessionLabel={activeSessionLabel}
      canForward={canForward}
      copyOnSelect={copyOnSelect}
      fontFamily={fontFamily}
      fontSize={fontSize}
      getBacklog={getBacklog}
      gpuAcceleration={gpuAcceleration}
      backgroundAlpha={terminalBgOpacity / 100}
      hasWallpaper={Boolean(terminalBgDataUrl)}
      rightClick={rightClick}
      hasProfiles={profiles.length > 0}
      onCreateProfile={openCreateProfile}
      onFontSizeChange={setFontSize}
      onOpenHostTools={() => toggleRightPanel("hosttools")}
      onOpenPortForward={handleOpenPortForward}
      onReconnect={handleReconnectActiveSession}
      onCancelReconnect={() => {
        if (activeSession) {
          cancelReconnect(activeSession.id);
        }
      }}
      onResize={resizeActiveSession}
      onStartLocalSession={handleStartLocalSession}
      onWrite={writeToActiveSession}
      subscribeOutput={subscribeOutput}
    />
  );

  let mainSurface: ReactNode;
  if (isConnections) {
    mainSurface = (
      <SessionManager
        profiles={profiles}
        recentIds={recentIds}
        activeSessionCount={visibleSessions.length}
        isLoading={isLoading}
        errorMessage={errorMessage}
        onConnect={handleConnectProfile}
        onCreate={openCreateProfile}
        onEdit={openEditProfile}
        onDelete={handleDeleteProfile}
        onToggleFavorite={handleToggleFavorite}
        onImportExport={() => openSettings("config")}
      />
    );
  } else if (isS3) {
    mainSurface = (
      <S3Workspace
        activeProfileId={activeS3ProfileId}
        onActivate={(profileId) => {
          setActiveS3ProfileId(profileId);
          s3Profiles.setSelectedProfileId(profileId);
        }}
        onClose={closeS3Tab}
        downloadConcurrency={s3DownloadConcurrency}
        profiles={s3Profiles.profiles}
        tabProfileIds={s3TabProfileIds}
        uploadConcurrency={s3UploadConcurrency}
      />
    );
  } else if (isSftpActive && activeSftpTab) {
    mainSurface = (
      <div className="sftp-tab">
        <FileBrowser
          profileId={activeSftpTab.profileId}
          onOpenInTerminal={(dir) => {
            const quoted = `'${dir.replace(/'/g, "'\\''")}'`;
            // Surface the terminal so the cd is visible, then send it.
            focusTerminal();
            void writeToActiveSession(`cd ${quoted}\r`);
          }}
        />
      </div>
    );
  } else if (fileTreeProfile) {
    mainSurface = (
      <TerminalFileLayout
        fileTree={
          <RemoteFileTree
            activeFilePath={activeRemoteFilePath}
            onClose={() => setFileTreeSessionId(null)}
            onFileRemoved={handleCloseRemoteFile}
            onFileRenamed={handleRenameRemoteFile}
            onOpenFile={(entry) => handleOpenRemoteFile(entry.path)}
            profileId={fileTreeProfile.id}
          />
        }
        terminal={
          activeRemoteFilePath ? (
            <RemoteFileEditor
              activePath={activeRemoteFilePath}
              editorOptions={editorSettings.options}
              filePaths={openRemoteFilePaths}
              key={fileTreeProfile.id}
              onCloseFile={handleCloseRemoteFile}
              onSelectFile={setActiveRemoteFilePath}
              onShowTerminal={() => setActiveRemoteFilePath(null)}
              profileId={fileTreeProfile.id}
            />
          ) : (
            terminalSurface
          )
        }
      />
    );
  } else if (activePaneLayout) {
    mainSurface = (
      <PaneGrid
        layout={activePaneLayout}
        focusedPaneId={activePaneLayout.focusedPaneId}
        sessions={sessions}
        getPaneLabel={paneName}
        getBacklog={getBacklog}
        subscribeOutput={subscribeOutput}
        onPaneData={(id, data) => void writeToSession(id, data)}
        onPaneResize={(id, size) => void resizeSession(id, size)}
        onFocusPane={(sessionId) => {
          panes.focusPane(sessionId);
          setActiveSessionId(sessionId);
        }}
        onClosePane={handleClosePane}
        onRatios={panes.setRatios}
        fontSize={fontSize}
        fontFamily={fontFamily}
        copyOnSelect={copyOnSelect}
        rightClick={rightClick}
        gpuAcceleration={gpuAcceleration}
        backgroundAlpha={terminalBgOpacity / 100}
        hasWallpaper={Boolean(terminalBgDataUrl)}
        onFontSizeChange={setFontSize}
      />
    );
  } else {
    mainSurface = terminalSurface;
  }

  function buildPaletteItems(): PaletteItem[] {
    const items: PaletteItem[] = [
      { id: "act:new-local", label: "新建本地终端", hint: "动作", icon: "terminalTool", run: () => void handleStartLocalSession() },
      { id: "act:connections", label: "连接管理", hint: "动作", icon: "connections", run: () => setActiveActivity("connections") },
      { id: "act:sessions", label: "会话", hint: "动作", icon: "sessions", run: () => setActiveActivity("sessions") },
      { id: "act:s3", label: "S3 对象浏览器", hint: "动作", icon: "bucket", run: () => setActiveActivity("s3") },
      { id: "act:assistant", label: "切换 AI 助手面板", hint: "动作", icon: "bot", run: () => toggleRightPanel("assistant") },
      { id: "act:hosttools", label: "切换主机工具面板", hint: "动作", icon: "toolbox", run: () => toggleRightPanel("hosttools") },
      { id: "act:settings", label: "设置", hint: "动作", icon: "settings", run: () => openSettings("appearance") },
      { id: "act:sidebar", label: sidebarCollapsed ? "展开侧栏" : "折叠侧栏", hint: "动作", icon: "panelLeft", run: toggleSidebar },
      { id: "act:zen", label: zenMode ? "退出禅模式" : "禅模式（隐藏侧栏/标签）", hint: "动作", icon: "panelLeft", run: () => setZenMode((value) => !value) },
      { id: "act:theme-dark", label: "主题：深色", hint: "动作", icon: "moon", run: () => setThemeMode("dark") },
      { id: "act:theme-light", label: "主题：浅色", hint: "动作", icon: "sun", run: () => setThemeMode("light") },
      { id: "act:theme-system", label: "主题：跟随系统", hint: "动作", icon: "system", run: () => setThemeMode("system") },
    ];
    if (activeSession) {
      if (activeCanSplit) {
        items.push({
          id: "act:split-h",
          label: "左右分屏（同一主机）",
          hint: "终端",
          icon: "splitH",
          keywords: "split vertical 分屏 拆分",
          run: () => void handleSplit("h"),
        });
        items.push({
          id: "act:split-v",
          label: "上下分屏（同一主机）",
          hint: "终端",
          icon: "splitV",
          keywords: "split horizontal 分屏 拆分",
          run: () => void handleSplit("v"),
        });
      }
      items.push({
        id: "act:reconnect",
        label: "重连当前会话",
        hint: "终端",
        icon: "refresh",
        keywords: "reconnect 重连",
        run: handleReconnectActiveSession,
      });
      items.push({
        id: "act:close-session",
        label: "关闭当前终端",
        hint: "终端",
        icon: "close",
        keywords: "close 关闭",
        run: () => void closeSession(activeSession.id),
      });
      if (activeSessionProfile) {
        items.push({
          id: "act:sftp-current",
          label: `打开 SFTP · ${activeSessionProfile.name}`,
          hint: "终端",
          icon: "folder",
          keywords: "sftp 文件",
          run: () => handleOpenSftpForProfile(activeSessionProfile),
        });
        items.push({
          id: "act:forward-current",
          label: `端口转发 · ${activeSessionProfile.name}`,
          hint: "终端",
          icon: "forward",
          keywords: "forward tunnel 转发 隧道",
          run: () =>
            setForwardTarget({ sessionId: activeSession.id, profile: activeSessionProfile }),
        });
      }
    }
    for (const session of sessions) {
      items.push({
        id: `term:${session.id}`,
        label: session.title,
        hint: "终端",
        icon: session.kind === "ssh" ? "ssh" : "terminalTool",
        keywords: "terminal",
        run: () => handleFocusTerminal(session.id),
      });
    }
    for (const tab of sftpTabs) {
      items.push({
        id: `sftpx:${tab.id}`,
        label: `SFTP · ${tab.title}`,
        hint: "SFTP",
        icon: "folder",
        run: () => focusSftpTab(tab.id),
      });
    }
    for (const profile of profiles) {
      items.push({
        id: `conn:${profile.id}`,
        label: profile.name,
        hint: `${profile.username}@${profile.host}`,
        icon: "ssh",
        keywords: `${profile.host} ${profile.tags.join(" ")} connect 连接`,
        run: () => void handleConnectProfile(profile),
      });
    }
    return items;
  }

  return (
    <div className="app-root" onContextMenu={handleContextMenu}>
      <AppLayout
        sidebar={zenMode ? null : sidebarContent}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        rightPanel={zenMode ? null : rightPanelContent}
        rightPanelWidth={rightPanelWidth}
        onRightPanelWidthChange={setRightPanelWidth}
        titleBar={
          <div className={`titlebar${isMacOS ? " titlebar--mac" : ""}`}>
            {isMacOS ? null : <img alt="" className="titlebar__app-icon" data-tauri-drag-region src="/icon.png" />}
            <div className="titlebar__drag" data-tauri-drag-region />
            {/* macOS shows the native traffic-light controls, so we only render
                our own minimize/maximize/close buttons on Windows and Linux. */}
            {isMacOS ? null : <WindowControls />}
          </div>
        }
        activityBar={
          zenMode ? null : (
            <ActivityBar
              activeActivity={activeActivity}
              onSelectActivity={handleSelectActivity}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={toggleSidebar}
              rightPanel={rightPanel}
              onToggleRightPanel={toggleRightPanel}
              onNewLocalTerminal={handleStartLocalSession}
              onOpenSettings={() => openSettings("appearance")}
            />
          )
        }
        tabStrip={
          zenMode || isS3 || isConnections ? null : (
            <>
              <WorkspaceTabStrip
                tabs={workspaceTabs}
                onSelect={handleSelectTab}
                onClose={handleCloseTab}
                onDetach={(tab) => void handleDetachTab(tab)}
                onReorder={(draggedId, targetId) =>
                  reorderTab(
                    draggedId,
                    targetId,
                    workspaceTabs.map((tab) => tab.id),
                  )
                }
              />
              <button
                className="tab-add"
                onClick={handleStartLocalSession}
                title="新建本地终端"
                aria-label="新建本地终端"
                type="button"
              >
                <Icon name="plus" height="16" width="16" />
              </button>
              {activeSession ? (
                <div className="tab-actions">
                  <button
                    className="tab-action"
                    disabled={!activeCanSplit}
                    onClick={() => void handleSplit("h")}
                    title={activeCanSplit ? "左右分屏（同一主机）" : "已达分屏上限"}
                    aria-label="左右分屏"
                    type="button"
                  >
                    <Icon name="splitH" height="15" width="15" />
                  </button>
                  <button
                    className="tab-action"
                    disabled={!activeCanSplit}
                    onClick={() => void handleSplit("v")}
                    title={activeCanSplit ? "上下分屏（同一主机）" : "已达分屏上限"}
                    aria-label="上下分屏"
                    type="button"
                  >
                    <Icon name="splitV" height="15" width="15" />
                  </button>
                </div>
              ) : null}
            </>
          )
        }
        main={mainSurface}
      />
      {editorState ? (
        <ProfileEditor
          allTags={allTags}
          mode={editorState.mode}
          onClose={closeEditor}
          onSubmit={handleSubmitProfile}
          profile={editorState.profile}
        />
      ) : null}
      {s3EditorState ? (
        <S3ProfileEditor
          mode={s3EditorState.mode}
          onClose={() => setS3EditorState(null)}
          onSubmit={handleSubmitS3Profile}
          profile={s3EditorState.profile}
        />
      ) : null}
      {s3ProfileDeleteTarget ? (
        <DeleteS3ProfileDialog
          onClose={() => setS3ProfileDeleteTarget(null)}
          onConfirm={() => confirmDeleteS3Profile(s3ProfileDeleteTarget)}
          profile={s3ProfileDeleteTarget}
        />
      ) : null}
      {forwardTarget ? (
        <PortForwardDialog
          defaultRemoteHost={forwardTarget.profile.host}
          onClose={() => setForwardTarget(null)}
          profileId={forwardTarget.profile.id}
          sessionId={forwardTarget.sessionId}
        />
      ) : null}
      {isSettingsOpen ? (
        <SettingsDialog
          aiConfig={aiConfig}
          editorSettings={editorSettings}
          initialCategory={settingsCategory}
          copyOnSelect={copyOnSelect}
          fontFamily={fontFamily}
          fontSize={fontSize}
          gpuAcceleration={gpuAcceleration}
          onClose={() => setIsSettingsOpen(false)}
          onCopyOnSelectChange={setCopyOnSelect}
          onFontFamilyChange={setFontFamily}
          onFontSizeChange={setFontSize}
          onGpuAccelerationChange={setGpuAcceleration}
          onS3DownloadConcurrencyChange={setS3DownloadConcurrency}
          onS3UploadConcurrencyChange={setS3UploadConcurrency}
          onProfilesImported={async () => {
            await Promise.all([reloadProfiles(), s3Profiles.reloadProfiles()]);
          }}
          onResetFontSize={resetFontSize}
          onRightClickChange={setRightClick}
          terminalBgImage={terminalBgImage}
          onTerminalBgImageChange={setTerminalBgImage}
          terminalBgOpacity={terminalBgOpacity}
          onTerminalBgOpacityChange={setTerminalBgOpacity}
          terminalWorkspaceInset={terminalWorkspaceInset}
          onTerminalWorkspaceInsetChange={setTerminalWorkspaceInset}
          onThemeChange={setThemeMode}
          rightClick={rightClick}
          s3DownloadConcurrency={s3DownloadConcurrency}
          s3UploadConcurrency={s3UploadConcurrency}
          themeMode={themeMode}
        />
      ) : null}
      {isAiConfigOpen ? (
        <AiConfigModal aiConfig={aiConfig} onClose={() => setIsAiConfigOpen(false)} />
      ) : null}
      {isPaletteOpen ? (
        <CommandPalette items={buildPaletteItems()} onClose={() => setIsPaletteOpen(false)} />
      ) : null}
      {hostKeyPrompts.length > 0 ? (
        <HostKeyPrompt
          prompt={hostKeyPrompts[0]}
          onAccept={() => resolveHostKeyPrompt(hostKeyPrompts[0].promptId, true)}
          onReject={() => resolveHostKeyPrompt(hostKeyPrompts[0].promptId, false)}
        />
      ) : null}
      {zenMode ? (
        <button
          className="zen-exit"
          onClick={() => setZenMode(false)}
          title="退出禅模式 (Esc)"
          type="button"
        >
          <Icon name="panelRight" height="15" width="15" />
          <span>退出禅模式</span>
        </button>
      ) : null}
      <ToastHost />
    </div>
  );
}

function App() {
  const [isCheckingWindow, setIsCheckingWindow] = useState(true);
  const [detachedWorkspace, setDetachedWorkspace] = useState<DetachedWorkspace | null>(null);

  useEffect(() => {
    let mounted = true;
    const label = getCurrentWindow().label;
    if (!label.startsWith("detached-")) {
      setIsCheckingWindow(false);
      return;
    }
    void getDetachedWorkspace(label)
      .then((workspace) => {
        if (mounted) setDetachedWorkspace(workspace);
      })
      .catch(() => {
        if (mounted) setDetachedWorkspace(null);
      })
      .finally(() => {
        if (mounted) setIsCheckingWindow(false);
      });
    return () => { mounted = false; };
  }, []);

  if (isCheckingWindow) {
    return <div className="detached-unavailable">正在打开独立窗口…</div>;
  }
  return detachedWorkspace ? <DetachedWorkspaceWindow workspace={detachedWorkspace} /> : <MainApp />;
}

export default App;
