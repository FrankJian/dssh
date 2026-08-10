import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Update } from "@tauri-apps/plugin-updater";
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
import { loadSessionBarHidden, sessionBarHiddenKey } from "../settings/settings";
import { SettingsDialog, type SettingsCategory } from "../settings/SettingsDialog";
import { useEditorSettings } from "../settings/useEditorSettings";
import { useTerminalSettings } from "../settings/useTerminalSettings";
import { checkForStartupUpdate } from "../services/appUpdateService";
import { FileBrowser } from "../sftp/FileBrowser";
import { RemoteFileEditor } from "../sftp/RemoteFileEditor";
import { RemoteFileTree } from "../sftp/RemoteFileTree";
import { LocalFileTree } from "../sftp/LocalFileTree";
import { ProfileEditor } from "../ssh/ProfileEditor";
import { DeleteSshProfileDialog } from "../ssh/DeleteSshProfileDialog";
import { SessionManager } from "../ssh/SessionManager";
import { SessionTree, type SessionNode } from "../ssh/SessionTree";
import { HostKeyPrompt } from "../ssh/HostKeyPrompt";
import { useProfiles } from "../ssh/useProfiles";
import { useRecentConnections } from "../ssh/useRecentConnections";
import { PaneGrid } from "../terminal/PaneGrid";
import { PortForwardDialog } from "../terminal/PortForwardDialog";
import { TerminalFileLayout } from "../terminal/TerminalFileLayout";
import { TerminalWorkspace } from "../terminal/TerminalWorkspace";
import { releaseTerminal, restoreTerminalSnapshot } from "../terminal/terminalRegistry";
import { paneSessionIds, usePaneLayout, type SplitDir } from "../terminal/usePaneLayout";
import { useTerminalSessions } from "../terminal/useTerminalSessions";
import { useTheme } from "../theme/useTheme";
import { Icon } from "../ui/Icon";
import { ToastHost, toast } from "../ui/ToastHost";
import { WindowControls } from "../ui/WindowControls";
import { isMacOS } from "../platform";
import {
  ActivityBar,
  type ActivityId,
  type NavigationIconId,
  type RightPanelId,
} from "./ActivityBar";
import { AppLayout } from "./AppLayout";
import { CommandPalette, type PaletteItem } from "./CommandPalette";
import {
  formatShortcut,
  getShortcutBinding,
  isCommandPaletteShortcut,
  isFocusModeExitShortcut,
  isTerminalFullscreenShortcut,
} from "./shortcuts";
import { useWorkspace } from "./useWorkspace";
import { UpdateNotification } from "./UpdateNotification";
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
const NAVIGATION_ICONS_KEY = "dssh.navigation.icons";
const RIGHT_PANEL_WIDTH_KEY = "dssh.ai.panelWidth";
const SESSIONS_PANEL_WIDTH_KEY = "dssh.ssh.panelWidth";
const S3_PANEL_WIDTH_KEY = "dssh.s3.panelWidth";
const RIGHT_PANEL_WIDTH_DEFAULT = 360;
const SIDE_PANEL_WIDTH_DEFAULT = 288;
const DEFAULT_NAVIGATION_ICONS: NavigationIconId[] = ["sessions", "connections", "assistant"];
const AI_SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  "appearance",
  "terminal",
  "editor",
  "shortcuts",
  "s3",
  "ai",
  "config",
  "about",
];

function isAiSettingsCategory(value: unknown): value is SettingsCategory {
  return typeof value === "string" && AI_SETTINGS_CATEGORIES.includes(value as SettingsCategory);
}

function isAiThemeMode(value: unknown): value is "dark" | "light" | "system" {
  return value === "dark" || value === "light" || value === "system";
}

function aiStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function loadPanelWidth(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadRightPanel(): RightPanelId | null {
  const raw = localStorage.getItem(RIGHT_PANEL_KEY);
  return raw === "assistant" || raw === "hosttools" ? raw : null;
}

function loadNavigationIcons(): NavigationIconId[] {
  try {
    const raw = localStorage.getItem(NAVIGATION_ICONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) {
      return DEFAULT_NAVIGATION_ICONS;
    }
    const valid = parsed.filter(
      (item): item is NavigationIconId =>
        item === "sessions" ||
        item === "connections" ||
        item === "s3" ||
        item === "assistant" ||
        item === "newLocalTerminal",
    );
    const unique = [...new Set(valid)];
    return unique.some((item) => item !== "assistant" && item !== "newLocalTerminal")
      ? unique
      : DEFAULT_NAVIGATION_ICONS;
  } catch {
    return DEFAULT_NAVIGATION_ICONS;
  }
}

function MainApp() {
  const [activeActivity, setActiveActivity] = useState<ActivityId>("sessions");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );
  const [sessionBarHidden, setSessionBarHidden] = useState<boolean>(() => loadSessionBarHidden());
  const [rightPanel, setRightPanel] = useState<RightPanelId | null>(() => loadRightPanel());
  const [navigationIcons, setNavigationIcons] = useState<NavigationIconId[]>(() => loadNavigationIcons());
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [s3EditorState, setS3EditorState] = useState<S3EditorState | null>(null);
  const [sshProfileDeleteTarget, setSshProfileDeleteTarget] = useState<SshProfile | null>(null);
  const [s3ProfileDeleteTarget, setS3ProfileDeleteTarget] = useState<S3Profile | null>(null);
  const [s3TabProfileIds, setS3TabProfileIds] = useState<string[]>([]);
  const [activeS3ProfileId, setActiveS3ProfileId] = useState<string | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ForwardTarget | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("appearance");
  const [isAiConfigOpen, setIsAiConfigOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [hostKeyPrompts, setHostKeyPrompts] = useState<HostKeyPromptEvent[]>([]);
  const [startupUpdate, setStartupUpdate] = useState<Update | null>(null);
  const reconnectingProfiles = useRef(new Set<string>());
  const [zenMode, setZenMode] = useState<boolean>(
    () => localStorage.getItem("dssh.zenMode") === "true",
  );
  const [terminalFullscreenPaneId, setTerminalFullscreenPaneId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("dssh.zenMode", String(zenMode));
  }, [zenMode]);

  // Update failures stay silent here: a startup network error should not block
  // SSH work. The About page remains available for a manual check with details.
  useEffect(() => {
    let cancelled = false;
    void checkForStartupUpdate()
      .then((update) => {
        if (!cancelled && update) {
          setStartupUpdate(update);
        }
      })
      .catch(() => {
        // An unavailable update endpoint is non-fatal during application start.
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
    localStorage.setItem(sessionBarHiddenKey, String(sessionBarHidden));
  }, [sessionBarHidden]);
  useEffect(() => {
    if (rightPanel) {
      localStorage.setItem(RIGHT_PANEL_KEY, rightPanel);
    } else {
      localStorage.removeItem(RIGHT_PANEL_KEY);
    }
  }, [rightPanel]);
  useEffect(() => {
    localStorage.setItem(NAVIGATION_ICONS_KEY, JSON.stringify(navigationIcons));
  }, [navigationIcons]);
  useEffect(() => {
    if (!navigationIcons.includes(activeActivity)) {
      const fallback = navigationIcons.find(
        (item): item is ActivityId => item === "sessions" || item === "connections" || item === "s3",
      );
      if (fallback) {
        setActiveActivity(fallback);
        setSidebarCollapsed(false);
      }
    }
  }, [activeActivity, navigationIcons]);

  const { setThemeMode, themeMode } = useTheme();
  const {
    copyOnSelect,
    fontFamily,
    fontSize,
    lineHeight,
    letterSpacing,
    setLineHeight,
    stepLineHeight,
    resetLineHeight,
    setLetterSpacing,
    resetLetterSpacing,
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
    updateSftpTabPaths,
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
        for (const [sessionId, snapshot] of Object.entries(workspace.terminal.terminalSnapshots ?? {})) {
          restoreTerminalSnapshot(sessionId, snapshot);
        }
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

  const activeSessionProfile =
    activeSession && activeSession.kind === "ssh"
      ? (profiles.find((profile) => profile.id === activeSession.profileId) ?? null)
      : null;
  const activeCanSplit = panes.canSplit(activeSessionId);


  useEffect(() => {
    const unlistenPromise = onAiEvent((event) => {
      if (event.kind === "openSshSession") {
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
        return;
      }
      if (event.kind !== "appAction") {
        return;
      }

      const complete = (result: string, isError = false) =>
        aiChat.completeAppAction(event.callId, result, isError);
      const requireActiveSsh = () => {
        if (activeSession?.kind !== "ssh" || !activeSessionProfile) {
          complete("当前没有可用于此操作的 SSH 终端。请先连接服务器并聚焦对应终端。", true);
          return null;
        }
        return { profile: activeSessionProfile, session: activeSession };
      };

      switch (event.action) {
        case "show_sessions":
          setActiveActivity("sessions");
          setSidebarCollapsed(false);
          complete("已打开活动会话。");
          return;
        case "show_connections":
          setActiveActivity("connections");
          complete("已打开连接管理。");
          return;
        case "show_s3":
          setActiveActivity("s3");
          setSidebarCollapsed(false);
          complete("已打开 S3 对象浏览器。");
          return;
        case "show_terminal":
          setActiveRemoteFilePath(null);
          showTerminalSurface();
          complete("已显示终端。");
          return;
        case "open_settings": {
          const category = isAiSettingsCategory(event.args.category) ? event.args.category : "appearance";
          openSettings(category);
          complete(`已打开“${category}”设置。`);
          return;
        }
        case "open_ai_config":
          setRightPanel("assistant");
          setIsAiConfigOpen(true);
          complete("已打开 AI 配置。");
          return;
        case "set_theme": {
          const theme = event.args.theme;
          if (!isAiThemeMode(theme)) {
            complete("主题参数无效。", true);
            return;
          }
          setThemeMode(theme);
          complete(`已切换为${theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}主题。`);
          return;
        }
        case "open_host_tools": {
          if (!requireActiveSsh()) return;
          setRightPanel("hosttools");
          complete("已打开主机工具。");
          return;
        }
        case "open_file_explorer": {
          const target = requireActiveSsh();
          if (!target) return;
          setFileTreeSessionId(target.session.id);
          setActiveRemoteFilePath(null);
          showTerminalSurface();
          complete(`已打开 ${target.profile.name} 的文件列表。`);
          return;
        }
        case "open_port_forward": {
          const target = requireActiveSsh();
          if (!target) return;
          setForwardTarget({ profile: target.profile, sessionId: target.session.id });
          complete("已打开端口转发配置。");
          return;
        }
        case "open_sftp": {
          const profileId = aiStringArg(event.args, "server_id");
          const profile = profileId ? profiles.find((item) => item.id === profileId) : null;
          if (!profile) {
            complete("无法打开 SFTP：目标 SSH 配置不存在。", true);
            return;
          }
          setActiveActivity("sessions");
          handleOpenSftpForProfile(profile);
          complete(`已打开 ${profile.name} 的 SFTP。`);
          return;
        }
        case "new_local_terminal":
          void startLocalSession()
            .then(() => {
              showTerminalSurface();
              complete("已新建本地终端。");
            })
            .catch((error) => complete(
              `新建本地终端失败：${error instanceof Error ? error.message : "未知错误。"}`,
              true,
            ));
          return;
        case "new_ssh_profile":
          setActiveActivity("connections");
          openCreateProfile();
          complete("已打开新建 SSH 连接页面。");
          return;
        case "new_s3_profile":
          setActiveActivity("s3");
          setSidebarCollapsed(false);
          setS3EditorState({ mode: "create", profile: null });
          complete("已打开新建 S3 配置页面。");
          return;
        case "split_horizontal":
        case "split_vertical": {
          if (!activeSession) {
            complete("当前没有可分屏的终端。", true);
            return;
          }
          if (!activeCanSplit) {
            complete("当前终端已达到分屏数量上限。", true);
            return;
          }
          void handleSplit(event.action === "split_horizontal" ? "h" : "v");
          complete(`已请求${event.action === "split_horizontal" ? "左右" : "上下"}分屏。`);
          return;
        }
        case "reconnect_active_session":
          if (!activeSession) {
            complete("当前没有可重连的终端。", true);
            return;
          }
          handleReconnectActiveSession();
          complete("已请求重连当前终端。");
          return;
        case "cancel_reconnect":
          if (!activeSession || activeSession.status !== "reconnecting") {
            complete("当前终端不处于重连中。", true);
            return;
          }
          cancelReconnect(activeSession.id);
          complete("已取消当前终端的重连。");
          return;
        default:
          complete(`不支持的应用操作：${event.action}。`, true);
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    aiChat.completeSshSessionOpen,
    aiChat.completeAppAction,
    activeSession,
    activeSessionProfile,
    activeCanSplit,
    cancelReconnect,
    handleOpenSftpForProfile,
    openCreateProfile,
    openSettings,
    profiles,
    startSession,
    startLocalSession,
    showTerminalSurface,
    recordUse,
    setThemeMode,
  ]);

  // Closing/disconnecting the target session also closes its adjacent tree.
  useEffect(() => {
    setFileTreeSessionId((current) =>
      current && sessions.some((session) => session.id === current) ? current : null,
    );
    panes.pruneSessions(new Set(sessions.map((session) => session.id)));
  }, [panes.pruneSessions, sessions]);

  useEffect(() => {
    setTerminalFullscreenPaneId((current) =>
      current && sessions.some((session) => session.id === current) ? current : null,
    );
  }, [sessions]);

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

  function handleDeleteProfile(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    setSshProfileDeleteTarget(profile);
  }

  async function confirmDeleteSshProfile(profileId: string) {
    try {
      await deleteProfile(profileId);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "删除 SSH 配置失败。");
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
    if (terminalFullscreenPaneId === sessionId) {
      setTerminalFullscreenPaneId(null);
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
      if (terminalFullscreenPaneId === tabSessionId) {
        setTerminalFullscreenPaneId(null);
      }
      void closeSession(tabSessionId);
      return;
    }
    if (paneSessionIds(layout).includes(terminalFullscreenPaneId ?? "")) {
      setTerminalFullscreenPaneId(null);
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
    if (node.kind === "ssh" && !node.profile) {
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

  const toggleSessionBar = useCallback(() => {
    setSessionBarHidden((hidden) => !hidden);
  }, []);

  const toggleRightPanel = useCallback((panel: RightPanelId) => {
    setRightPanel((current) => (current === panel ? null : panel));
  }, []);

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

  function openSettings(category: SettingsCategory) {
    setSettingsCategory(category);
    setIsSettingsOpen(true);
  }

  const dismissStartupUpdate = useCallback(() => {
    if (startupUpdate) {
      void startupUpdate.close().catch(() => {
        // The resource is released automatically when the window closes.
      });
    }
    setStartupUpdate(null);
  }, [startupUpdate]);

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

  const toggleTerminalFullscreen = useCallback(() => {
    const paneId = activePaneLayout?.focusedPaneId ?? activeSessionId;
    if (!paneId) {
      return;
    }
    setTerminalFullscreenPaneId((current) => current === paneId ? null : paneId);
    if (terminalFullscreenPaneId !== paneId) {
      // A focused terminal should never be hidden by its file editor. The tree
      // itself remains open, so restoring fullscreen returns to the same view.
      setActiveRemoteFilePath(null);
      focusTerminal();
      setActiveActivity("sessions");
      setZenMode(false);
    }
  }, [activePaneLayout, activeSessionId, focusTerminal, terminalFullscreenPaneId]);

  // ⌘K / Ctrl+K toggles the command palette; ⌘⇧↵ / Ctrl+Shift+Enter focuses
  // the current terminal pane. Escape restores that pane first, then zen mode.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isCommandPaletteShortcut(event)) {
        event.preventDefault();
        setIsPaletteOpen((open) => !open);
      } else if (isTerminalFullscreenShortcut(event)) {
        event.preventDefault();
        toggleTerminalFullscreen();
      } else if (isFocusModeExitShortcut(event) && terminalFullscreenPaneId) {
        event.preventDefault();
        setTerminalFullscreenPaneId(null);
      } else if (isFocusModeExitShortcut(event) && zenMode) {
        setZenMode(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [terminalFullscreenPaneId, toggleTerminalFullscreen, zenMode]);

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
      // The detached window builds its own terminals for these sessions. The
      // sessions stay alive on the backend, so nothing else would tell this
      // window to let go of the instances it is no longer showing.
      for (const id of sessionIds) {
        releaseTerminal(id);
      }
      if (sessionIds.includes(terminalFullscreenPaneId ?? "")) {
        setTerminalFullscreenPaneId(null);
      }
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
        onClose={() => setRightPanel(null)}
        onOpenConfig={() => setIsAiConfigOpen(true)}
      />
    ) : rightPanel === "hosttools" ? (
      <HostToolsPanel
        profileId={activeSession?.kind === "ssh" ? activeSession.profileId : null}
        targetLabel={activeSession ? activeSessionLabel || activeSession.title : null}
        onClose={() => setRightPanel(null)}
      />
    ) : null;

  const fileTreeSession =
    fileTreeSessionId && fileTreeSessionId === activeSessionId
      ? activeSession
      : null;
  const fileTreeProfile =
    fileTreeSessionId && fileTreeSessionId === activeSessionId && activeSession?.kind === "ssh"
      ? (profiles.find((profile) => profile.id === activeSession.profileId) ?? null)
      : null;
  const isLocalFileTree = fileTreeSession?.kind === "local";

  const terminalSurface = (
    <TerminalWorkspace
      activeSession={activeSession}
      activeSessionLabel={activeSessionLabel}
      canForward={canForward}
      copyOnSelect={copyOnSelect}
      fontFamily={fontFamily}
      fontSize={fontSize}
      letterSpacing={letterSpacing}
      lineHeight={lineHeight}
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
      onResize={resizeSession}
      onStartLocalSession={handleStartLocalSession}
      onWrite={writeToSession}
      showSessionBar={!sessionBarHidden}
      subscribeOutput={subscribeOutput}
    />
  );

  // The session bar lives inside `terminalSurface`, so the toggle is only
  // offered on the surfaces that actually show one — a split replaces it with
  // the pane grid, and an open file editor takes its place.
  let hasSessionBar = false;
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
          initialLocalPath={activeSftpTab.localPath}
          initialRemotePath={activeSftpTab.remotePath}
          onTabPathsChange={updateSftpTabPaths}
          profileId={activeSftpTab.profileId}
          tabId={activeSftpTab.id}
          onOpenInTerminal={(dir) => {
            const quoted = `'${dir.replace(/'/g, "'\\''")}'`;
            // Surface the terminal so the cd is visible, then send it.
            focusTerminal();
            void writeToActiveSession(`cd ${quoted}\r`);
          }}
        />
      </div>
    );
  } else if (!terminalFullscreenPaneId && (fileTreeProfile || isLocalFileTree)) {
    hasSessionBar = Boolean(activeSession) && !activeRemoteFilePath;
    mainSurface = (
      <TerminalFileLayout
        fileTree={
          fileTreeProfile ? (
            <RemoteFileTree
              activeFilePath={activeRemoteFilePath}
              onClose={() => setFileTreeSessionId(null)}
              onFileRemoved={handleCloseRemoteFile}
              onFileRenamed={handleRenameRemoteFile}
              onOpenFile={(entry) => handleOpenRemoteFile(entry.path)}
              profileId={fileTreeProfile.id}
            />
          ) : (
            <LocalFileTree
              activeFilePath={activeRemoteFilePath}
              onClose={() => setFileTreeSessionId(null)}
              onFileRemoved={handleCloseRemoteFile}
              onFileRenamed={handleRenameRemoteFile}
              onOpenFile={(entry) => handleOpenRemoteFile(entry.path)}
            />
          )
        }
        terminal={
          activeRemoteFilePath ? (
            <RemoteFileEditor
              activePath={activeRemoteFilePath}
              editorOptions={editorSettings.options}
              filePaths={openRemoteFilePaths}
              fileSystem={isLocalFileTree ? "local" : "remote"}
              key={`${isLocalFileTree ? "local" : "remote"}:${fileTreeSessionId ?? ""}`}
              onCloseFile={handleCloseRemoteFile}
              onSelectFile={setActiveRemoteFilePath}
              onShowTerminal={() => setActiveRemoteFilePath(null)}
              profileId={fileTreeProfile?.id ?? "local"}
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
        zoomedPaneId={terminalFullscreenPaneId}
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
        letterSpacing={letterSpacing}
        lineHeight={lineHeight}
        copyOnSelect={copyOnSelect}
        rightClick={rightClick}
        gpuAcceleration={gpuAcceleration}
        backgroundAlpha={terminalBgOpacity / 100}
        hasWallpaper={Boolean(terminalBgDataUrl)}
        onFontSizeChange={setFontSize}
      />
    );
  } else {
    hasSessionBar = Boolean(activeSession);
    mainSurface = terminalSurface;
  }

  function buildPaletteItems(): PaletteItem[] {
    const items: PaletteItem[] = [
      { id: "act:new-local", label: "新建本地终端", hint: "终端", icon: "terminalTool", keywords: "local shell", run: () => void handleStartLocalSession() },
      { id: "act:new-ssh", label: "新建 SSH 连接", hint: "连接", icon: "ssh", keywords: "profile server", run: openCreateProfile },
      { id: "act:connections", label: "打开连接管理", hint: "导航", icon: "connections", keywords: "connections profiles", run: () => setActiveActivity("connections") },
      { id: "act:sessions", label: "打开活动会话", hint: "导航", icon: "sessions", keywords: "sessions terminal", run: () => { setActiveActivity("sessions"); setSidebarCollapsed(false); } },
      { id: "act:s3", label: "打开 S3 对象浏览器", hint: "导航", icon: "bucket", keywords: "object storage", run: () => { setActiveActivity("s3"); setSidebarCollapsed(false); } },
      { id: "act:new-s3", label: "新建 S3 配置", hint: "对象存储", icon: "bucket", keywords: "object storage profile", run: () => { setActiveActivity("s3"); setSidebarCollapsed(false); setS3EditorState({ mode: "create", profile: null }); } },
      { id: "act:terminal-surface", label: "显示终端", hint: "导航", icon: "terminalTool", keywords: "terminal shell", run: () => { setActiveRemoteFilePath(null); showTerminalSurface(); } },
      { id: "act:assistant", label: rightPanel === "assistant" ? "关闭 AI 助手" : "打开 AI 助手", hint: "面板", icon: "bot", keywords: "ai assistant", run: () => toggleRightPanel("assistant") },
      { id: "act:ai-config", label: "配置 AI 助手", hint: "设置", icon: "bot", keywords: "ai api model", run: () => setIsAiConfigOpen(true) },
      { id: "act:settings-appearance", label: "设置：外观", hint: "设置", icon: "sun", keywords: "appearance theme", run: () => openSettings("appearance") },
      { id: "act:settings-terminal", label: "设置：终端", hint: "设置", icon: "terminalTool", keywords: "terminal font background", run: () => openSettings("terminal") },
      { id: "act:settings-editor", label: "设置：文件编辑器", hint: "设置", icon: "fileCode", keywords: "editor monaco font", run: () => openSettings("editor") },
      { id: "act:settings-shortcuts", label: "设置：快捷键", hint: "设置", icon: "command", keywords: "shortcut keybinding hotkey", run: () => openSettings("shortcuts") },
      { id: "act:settings-s3", label: "设置：对象存储", hint: "设置", icon: "bucket", keywords: "s3 transfer", run: () => openSettings("s3") },
      { id: "act:settings-ai", label: "设置：AI", hint: "设置", icon: "bot", keywords: "ai api", run: () => openSettings("ai") },
      { id: "act:settings-config", label: "设置：配置文件", hint: "设置", icon: "file", keywords: "import export", run: () => openSettings("config") },
      { id: "act:settings-about", label: "设置：关于", hint: "设置", icon: "info", keywords: "about version", run: () => openSettings("about") },
      { id: "act:sidebar", label: sidebarCollapsed ? "展开侧栏" : "折叠侧栏", hint: "布局", icon: "panelLeft", keywords: "sidebar", run: toggleSidebar },
      { id: "act:zen", label: zenMode ? "退出禅模式" : "进入禅模式", hint: "布局", icon: "panelLeft", keywords: "zen focus", run: () => setZenMode((value) => !value) },
      { id: "act:theme-dark", label: "主题：深色", hint: "外观", icon: "moon", keywords: "theme dark", run: () => setThemeMode("dark") },
      { id: "act:theme-light", label: "主题：浅色", hint: "外观", icon: "sun", keywords: "theme light", run: () => setThemeMode("light") },
      { id: "act:theme-system", label: "主题：跟随系统", hint: "外观", icon: "system", keywords: "theme system", run: () => setThemeMode("system") },
    ];
    if (activeSession) {
      items.push({
        id: "act:focus-active-terminal",
        label: "聚焦当前终端",
        hint: "终端",
        icon: "terminalTool",
        keywords: "focus terminal",
        run: () => { setActiveRemoteFilePath(null); showTerminalSurface(); },
      });
      if (hasSessionBar) {
        items.push({
          id: "act:session-bar",
          label: sessionBarHidden ? "显示会话状态栏" : "隐藏会话状态栏",
          hint: "布局",
          icon: "panelTop",
          keywords: "session bar status 状态栏",
          run: toggleSessionBar,
        });
      }
      items.push({
        id: "act:terminal-fullscreen",
        label: terminalFullscreenPaneId ? "恢复终端视图" : "终端全屏",
        hint: "终端",
        icon: terminalFullscreenPaneId ? "restore" : "maximize",
        keywords: "fullscreen focus pane 最大化 全屏 聚焦",
        run: toggleTerminalFullscreen,
      });
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
      if (activeSession.status === "reconnecting") {
        items.push({
          id: "act:cancel-reconnect",
          label: "取消当前终端重连",
          hint: "终端",
          icon: "stop",
          keywords: "cancel reconnect",
          run: () => cancelReconnect(activeSession.id),
        });
      }
      items.push({
        id: "act:close-session",
        label: "关闭当前终端",
        hint: "终端",
        icon: "close",
        keywords: "close 关闭",
        run: () => void closeSession(activeSession.id),
      });
      items.push({
        id: "act:file-list-current",
        label: fileTreeSessionId === activeSession.id ? "关闭当前文件列表" : "打开当前文件列表",
        hint: "文件",
        icon: "tree",
        keywords: "explorer files local remote",
        run: () => {
          if (fileTreeSessionId === activeSession.id) {
            setFileTreeSessionId(null);
            setActiveRemoteFilePath(null);
          } else {
            setFileTreeSessionId(activeSession.id);
            showTerminalSurface();
          }
        },
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
        items.push({
          id: "act:hosttools-current",
          label: rightPanel === "hosttools" ? "关闭主机工具" : "打开主机工具",
          hint: "终端",
          icon: "toolbox",
          keywords: "host tools monitor logs",
          run: () => toggleRightPanel("hosttools"),
        });
      }
    }
    for (const session of visibleSessions) {
      items.push({
        id: `term:${session.id}`,
        label: `切换终端：${terminalName(session)}`,
        hint: "终端",
        icon: session.kind === "ssh" ? "ssh" : "terminalTool",
        keywords: `${session.title} ${session.status} terminal pane`,
        run: () => handleFocusTerminal(session.id),
      });
    }
    for (const tab of sftpTabs) {
      items.push({
        id: `sftpx:${tab.id}`,
        label: `切换 SFTP：${tab.title}`,
        hint: "SFTP",
        icon: "folder",
        keywords: "sftp file transfer",
        run: () => { setActiveActivity("sessions"); focusSftpTab(tab.id); },
      });
      items.push({
        id: `sftpx-close:${tab.id}`,
        label: `关闭 SFTP：${tab.title}`,
        hint: "SFTP",
        icon: "close",
        keywords: "sftp close",
        run: () => closeSftpTab(tab.id),
      });
    }
    for (const tab of workspaceTabs) {
      items.push({
        id: `workspace:detach:${tab.id}`,
        label: `移至独立窗口：${tab.title}`,
        hint: tab.kind === "sftp" ? "SFTP" : "终端",
        icon: "externalWindow",
        keywords: "detach external window 新窗口",
        run: () => void handleDetachTab(tab),
      });
      if (tab.kind !== "sftp") {
        items.push({
          id: `workspace:close:${tab.id}`,
          label: `关闭终端标签：${tab.title}`,
          hint: "终端",
          icon: "close",
          keywords: "close terminal tab",
          run: () => handleCloseTab(tab),
        });
      }
    }
    for (const path of openRemoteFilePaths) {
      const name = path.replace(/\/+$/, "").split("/").pop() || path;
      items.push({
        id: `file:${path}`,
        label: `切换文件：${name}`,
        hint: "文件编辑器",
        icon: "fileCode",
        keywords: `${path} editor remote file`,
        run: () => {
          setActiveRemoteFilePath(path);
          showTerminalSurface();
        },
      });
    }
    for (const profile of profiles) {
      items.push({
        id: `conn:${profile.id}`,
        label: `连接 SSH：${profile.name}`,
        hint: `${profile.username}@${profile.host}:${profile.port}`,
        icon: "ssh",
        keywords: `${profile.host} ${profile.tags.join(" ")} connect 连接`,
        run: () => void handleConnectProfile(profile),
      });
      items.push({
        id: `conn:sftp:${profile.id}`,
        label: `打开 SFTP：${profile.name}`,
        hint: "SSH 配置",
        icon: "folder",
        keywords: `${profile.host} ${profile.tags.join(" ")} sftp files`,
        run: () => { setActiveActivity("sessions"); handleOpenSftpForProfile(profile); },
      });
      items.push({
        id: `conn:edit:${profile.id}`,
        label: `编辑 SSH 配置：${profile.name}`,
        hint: "SSH 配置",
        icon: "edit",
        keywords: `${profile.host} ${profile.tags.join(" ")} edit`,
        run: () => openEditProfile(profile),
      });
      items.push({
        id: `conn:favorite:${profile.id}`,
        label: `${profile.favorite ? "取消收藏" : "收藏"} SSH：${profile.name}`,
        hint: "SSH 配置",
        icon: "star",
        keywords: `${profile.host} favorite 收藏`,
        run: () => void handleToggleFavorite(profile.id),
      });
    }
    for (const profile of s3Profiles.profiles) {
      items.push({
        id: `s3:${profile.id}`,
        label: `打开 S3：${profile.name}`,
        hint: `${profile.host}:${profile.port}`,
        icon: "bucket",
        keywords: `${profile.host} ${profile.tags.join(" ")} object storage`,
        run: () => { setActiveActivity("s3"); setSidebarCollapsed(false); openS3Profile(profile); },
      });
      items.push({
        id: `s3:edit:${profile.id}`,
        label: `编辑 S3 配置：${profile.name}`,
        hint: "S3 配置",
        icon: "edit",
        keywords: `${profile.host} ${profile.tags.join(" ")} edit`,
        run: () => setS3EditorState({ mode: "edit", profile }),
      });
      items.push({
        id: `s3:favorite:${profile.id}`,
        label: `${profile.favorite ? "取消收藏" : "收藏"} S3：${profile.name}`,
        hint: "S3 配置",
        icon: "star",
        keywords: `${profile.host} favorite 收藏`,
        run: () => void s3Profiles.toggleFavorite(profile.id),
      });
    }
    return items;
  }

  return (
    <div className="app-root" onContextMenu={handleContextMenu}>
      <AppLayout
        sidebar={zenMode || terminalFullscreenPaneId ? null : sidebarContent}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        rightPanel={zenMode || terminalFullscreenPaneId ? null : rightPanelContent}
        rightPanelWidth={rightPanelWidth}
        onRightPanelWidthChange={setRightPanelWidth}
        titleBar={zenMode || terminalFullscreenPaneId ? null : (
          <div className={`titlebar${isMacOS ? " titlebar--mac" : ""}`}>
            {isMacOS ? null : <img alt="" className="titlebar__app-icon" data-tauri-drag-region src="/icon.png" />}
            <div className="titlebar__drag" data-tauri-drag-region />
            {/* macOS shows the native traffic-light controls, so we only render
                our own minimize/maximize/close buttons on Windows and Linux. */}
            {isMacOS ? null : <WindowControls />}
          </div>
        )}
        activityBar={
          zenMode || terminalFullscreenPaneId ? null : (
            <ActivityBar
              activeActivity={activeActivity}
              visibleNavigationIcons={navigationIcons}
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
          zenMode || terminalFullscreenPaneId || isS3 || isConnections ? null : (
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
                  {hasSessionBar ? (
                    <button
                      aria-label={sessionBarHidden ? "显示会话状态栏" : "隐藏会话状态栏"}
                      aria-pressed={sessionBarHidden}
                      className={`tab-action${sessionBarHidden ? " is-active" : ""}`}
                      onClick={toggleSessionBar}
                      title={sessionBarHidden ? "显示会话状态栏" : "隐藏会话状态栏"}
                      type="button"
                    >
                      <Icon name="panelTop" height="15" width="15" />
                    </button>
                  ) : null}
                  <button
                    aria-label={terminalFullscreenPaneId ? "恢复终端视图" : "终端全屏"}
                    className="tab-action"
                    onClick={toggleTerminalFullscreen}
                    title={`${terminalFullscreenPaneId ? "恢复终端视图" : "终端全屏"}（${formatShortcut(getShortcutBinding("toggleTerminalFullscreen"))}）`}
                    type="button"
                  >
                    <Icon name={terminalFullscreenPaneId ? "restore" : "maximize"} height="15" width="15" />
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
      {sshProfileDeleteTarget ? (
        <DeleteSshProfileDialog
          onClose={() => setSshProfileDeleteTarget(null)}
          onConfirm={() => confirmDeleteSshProfile(sshProfileDeleteTarget.id)}
          profile={sshProfileDeleteTarget}
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
          letterSpacing={letterSpacing}
          lineHeight={lineHeight}
          gpuAcceleration={gpuAcceleration}
          onClose={() => setIsSettingsOpen(false)}
          onCopyOnSelectChange={setCopyOnSelect}
          onFontFamilyChange={setFontFamily}
          onFontSizeChange={setFontSize}
          onLetterSpacingChange={setLetterSpacing}
          onLineHeightChange={setLineHeight}
          onLineHeightStep={stepLineHeight}
          onResetLetterSpacing={resetLetterSpacing}
          onResetLineHeight={resetLineHeight}
          onGpuAccelerationChange={setGpuAcceleration}
          navigationIcons={navigationIcons}
          onNavigationIconsChange={setNavigationIcons}
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
      {startupUpdate ? (
        <UpdateNotification update={startupUpdate} onDismiss={dismissStartupUpdate} />
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
          title={`退出禅模式（${formatShortcut(getShortcutBinding("exitFocusMode"))}）`}
          type="button"
        >
          <Icon name="panelRight" height="15" width="15" />
          <span>退出禅模式</span>
        </button>
      ) : null}
      {terminalFullscreenPaneId ? (
        <button
          className="terminal-focus-exit"
          onClick={() => setTerminalFullscreenPaneId(null)}
          title={`恢复终端视图（${formatShortcut(getShortcutBinding("toggleTerminalFullscreen"))}）`}
          type="button"
        >
          <Icon name="restore" height="15" width="15" />
          <span>恢复终端视图</span>
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
