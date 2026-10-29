import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DetachedWorkspace } from "../models";
import { FileBrowser } from "../sftp/FileBrowser";
import { useProfiles } from "../ssh/useProfiles";
import { profileIconName } from "../ssh/profileIcons";
import { loadSessionBarHidden, sessionBarHiddenKey } from "../settings/settings";
import { useTerminalSettings } from "../settings/useTerminalSettings";
import { PaneGrid } from "../terminal/PaneGrid";
import { TerminalWorkspace } from "../terminal/TerminalWorkspace";
import { TerminalTransferConflictDialog } from "../terminal/TerminalTransferConflictDialog";
import { TerminalTransferNotice } from "../terminal/TerminalTransferNotice";
import { focusTerminalSession, serializeTerminal } from "../terminal/terminalRegistry";
import { paneSessionIds, usePaneLayout, type SplitDir } from "../terminal/usePaneLayout";
import { useTerminalSessions } from "../terminal/useTerminalSessions";
import { useTerminalCloseGuard } from "../terminal/useTerminalCloseGuard";
import { defaultSshTerminalTitle } from "../terminal/terminalTitle";
import { useTheme } from "../theme/useTheme";
import { readImageDataUrl } from "../services/configService";
import { supportsTerminalWallpaperGlass } from "../terminal/wallpaperGlass";
import { Icon } from "../ui/Icon";
import { toast, ToastHost } from "../ui/ToastHost";
import { WindowControls } from "../ui/WindowControls";
import { isMacOS } from "../platform";
import { discardDetachedWorkspace, updateDetachedTerminalWorkspace } from "../services/workspaceService";
import { DetachedCloseDialog } from "./DetachedCloseDialog";
import { AppLockScreen } from "./AppLockScreen";
import { useAppLock } from "./useAppLock";
import {
  cycleItem,
  formatShortcut,
  getShortcutBinding,
  isFocusModeExitShortcut,
  isLockAppShortcut,
  isTerminalFullscreenShortcut,
} from "./shortcuts";
import { useActionShortcuts } from "./useActionShortcuts";

interface DetachedWorkspaceProps {
  workspace: DetachedWorkspace;
}

function DetachedTitlebar({
  title,
  onClose,
  onReturn,
}: {
  title: string;
  onClose?: () => void;
  onReturn: () => void;
}) {
  return (
    <div className={`titlebar detached-titlebar is-glass-chrome${isMacOS ? " titlebar--mac" : ""}`}>
      <div className="titlebar__drag" data-tauri-drag-region />
      <div className="detached-titlebar__title" data-tauri-drag-region title={title}>{title}</div>
      <button
        aria-label="合并回主窗口"
        className="detached-titlebar__return"
        onClick={onReturn}
        title="合并回主窗口"
        type="button"
      >
        <Icon name="restore" height="15" width="15" />
        <span>合并回主窗口</span>
      </button>
      {onClose ? (
        <button
          aria-label="关闭独立工作区"
          className="detached-titlebar__close"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <Icon name="close" height="15" width="15" />
        </button>
      ) : null}
      {isMacOS ? null : <WindowControls />}
    </div>
  );
}

function DetachedSftpWindow({ workspace }: DetachedWorkspaceProps) {
  const profileId = workspace.sftp?.profileId ?? null;
  const currentWindow = getCurrentWindow();
  const appLock = useAppLock();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isLockAppShortcut(event) || !appLock.status?.settings.enabled || appLock.status.locked) return;
      event.preventDefault();
      void appLock.lock();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appLock.lock, appLock.status?.locked, appLock.status?.settings.enabled]);

  function closeSftpWorkspace() {
    void discardDetachedWorkspace(workspace.label)
      .then(() => currentWindow.close())
      .catch((error: unknown) => {
        toast(error instanceof Error ? error.message : "关闭独立 SFTP 窗口失败。", "error");
      });
  }

  useActionShortcuts({ closeTab: closeSftpWorkspace }, appLock.status?.locked);

  return (
    <div className="detached-workspace">
      <DetachedTitlebar
        title={workspace.title}
        onClose={closeSftpWorkspace}
        onReturn={() => void currentWindow.close()}
      />
      <main className="detached-workspace__content detached-workspace__content--sftp">
        <FileBrowser disableContextMenu profileId={profileId} />
      </main>
      <ToastHost />
      {appLock.status?.locked ? <AppLockScreen onUnlock={appLock.unlock} /> : null}
    </div>
  );
}

function DetachedTerminalWindow({ workspace }: DetachedWorkspaceProps) {
  const descriptor = workspace.terminal;
  const currentWindow = getCurrentWindow();
  const profilesState = useProfiles();
  const terminal = useTerminalSessions();
  const { confirmClose, closeDialog } = useTerminalCloseGuard(terminal.commandActivity);
  const panes = usePaneLayout();
  const settings = useTerminalSettings();
  const appLock = useAppLock();
  const [terminalBgDataUrl, setTerminalBgDataUrl] = useState<string | null>(null);
  const terminalWallpaperGlassSupported = supportsTerminalWallpaperGlass();
  const hasTerminalWallpaper = Boolean(terminalBgDataUrl)
    && settings.terminalBgGlassEnabled
    && terminalWallpaperGlassSupported;
  const appliedInitialLayout = useRef(false);
  const [terminalFullscreenPaneId, setTerminalFullscreenPaneId] = useState<string | null>(null);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const [sessionBarHidden, setSessionBarHidden] = useState<boolean>(() => loadSessionBarHidden());
  const [ownedSessionIds, setOwnedSessionIds] = useState<string[]>(() => descriptor?.sessionIds ?? []);
  const sessionCountRef = useRef(0);
  const handledShellExitsRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    if (!settings.terminalBgImage) {
      setTerminalBgDataUrl(null);
      return;
    }
    void readImageDataUrl(settings.terminalBgImage)
      .then((url) => {
        if (!cancelled) setTerminalBgDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTerminalBgDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.terminalBgImage]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--terminal-bg-image",
      terminalBgDataUrl ? `url("${terminalBgDataUrl}")` : "none",
    );
    root.style.setProperty(
      "--terminal-surface",
      settings.terminalBgOpacity >= 100
        ? "var(--terminal-bg)"
        : `rgb(var(--terminal-bg-rgb) / ${settings.terminalBgOpacity}%)`,
    );
    root.style.setProperty("--terminal-wallpaper-blur", `${settings.terminalBgGlassBlur}px`);
  }, [settings.terminalBgGlassBlur, settings.terminalBgOpacity, terminalBgDataUrl]);

  useEffect(() => {
    localStorage.setItem(sessionBarHiddenKey, String(sessionBarHidden));
  }, [sessionBarHidden]);

  const layout = descriptor
    ? panes.findLayoutByTab(descriptor.tabSessionId)
      ?? panes.layouts.find((item) => paneSessionIds(item).some((id) => ownedSessionIds.includes(id)))
      ?? null
    : null;
  const visibleSessions = useMemo(() => {
    const ids = new Set([...ownedSessionIds, ...paneSessionIds(layout)]);
    return terminal.sessions.filter((session) => ids.has(session.id));
  }, [layout, ownedSessionIds, terminal.sessions]);
  sessionCountRef.current = terminal.isSessionsLoaded ? visibleSessions.length : descriptor?.sessionIds.length ?? 0;
  const activeSession = visibleSessions.find((session) => session.id === terminal.activeSessionId)
    ?? visibleSessions.find((session) => session.id === layout?.focusedPaneId)
    ?? visibleSessions[0]
    ?? null;
  const activeProfile = activeSession?.kind === "ssh"
    ? profilesState.profiles.find((profile) => profile.id === activeSession.profileId) ?? null
    : null;
  const tabIcon = activeSession?.kind === "ssh" ? profileIconName(activeProfile?.icon) : "terminalTool";
  const isCommandRunning = visibleSessions.some((session) => terminal.commandActivity.has(session.id));
  const displayTitle = descriptor?.autoTitle && activeSession?.kind === "ssh"
    ? terminal.targetAddresses[activeSession.id] === undefined
      // The original window may have learned the asset before detachment;
      // backend scrollback can already have discarded that menu exchange.
      ? workspace.title
      : defaultSshTerminalTitle(activeSession, activeProfile ?? undefined, terminal.targetAddresses[activeSession.id])
    : workspace.title;

  useEffect(() => {
    void currentWindow.setTitle(`${displayTitle} · Duo SSH`);
  }, [currentWindow, displayTitle]);

  // The session hook seeds `activeSessionId` from the backend's full list,
  // which includes terminals owned by the main window. Left alone it points at
  // a session this window does not show, so anything keyed off "active" acts on
  // another window's terminal. Pin it to what is actually rendered here.
  const activeSessionId = activeSession?.id ?? null;
  const { setActiveSessionId } = terminal;
  useEffect(() => {
    if (activeSessionId && terminal.activeSessionId !== activeSessionId) {
      setActiveSessionId(activeSessionId);
    }
  }, [activeSessionId, setActiveSessionId, terminal.activeSessionId]);

  const toggleTerminalFullscreen = useCallback(() => {
    const paneId = layout?.focusedPaneId ?? activeSession?.id;
    if (!paneId) return;
    setTerminalFullscreenPaneId((current) => current === paneId ? null : paneId);
  }, [activeSession?.id, layout?.focusedPaneId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isLockAppShortcut(event) && appLock.status?.settings.enabled && !appLock.status.locked) {
        event.preventDefault();
        void appLock.lock();
      } else if (isTerminalFullscreenShortcut(event)) {
        event.preventDefault();
        toggleTerminalFullscreen();
      } else if (isFocusModeExitShortcut(event) && terminalFullscreenPaneId) {
        event.preventDefault();
        setTerminalFullscreenPaneId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appLock.lock, appLock.status?.locked, appLock.status?.settings.enabled, terminalFullscreenPaneId, toggleTerminalFullscreen]);

  useEffect(() => {
    setTerminalFullscreenPaneId((current) =>
      current && visibleSessions.some((session) => session.id === current) ? current : null,
    );
  }, [visibleSessions]);

  useEffect(() => {
    if (!descriptor || appliedInitialLayout.current) return;
    appliedInitialLayout.current = true;
    if (descriptor.layout) panes.replaceLayout(descriptor.layout);
    terminal.setActiveSessionId(descriptor.layout?.focusedPaneId ?? descriptor.sessionIds[0] ?? null);
  }, [descriptor, panes.replaceLayout, terminal.setActiveSessionId]);

  // The detached window owns only presentation state. The Rust session manager
  // remains process-wide, so output/reconnect events continue to target the
  // same session IDs while this renderer is open.
  useEffect(() => {
    if (!descriptor || !appliedInitialLayout.current || !terminal.isSessionsLoaded) return;
    const latestLayout = layout;
    const sessionIds = latestLayout ? paneSessionIds(latestLayout) : visibleSessions.map((item) => item.id);
    void updateDetachedTerminalWorkspace(workspace.label, {
      autoTitle: descriptor.autoTitle,
      tabSessionId: latestLayout?.tabSessionId ?? descriptor.tabSessionId,
      sessionIds,
      layout: latestLayout,
    }).catch(() => {
      // A close can race this best-effort sync; the native close event still
      // restores the last registered state safely.
    });
  }, [descriptor, layout, terminal.isSessionsLoaded, visibleSessions, workspace.label]);

  // Destroy rather than close: every path below has already decided what
  // happens to the sessions, and `close()` would bounce back through the
  // close-requested handler and ask again.
  const closeWindow = useCallback(async () => {
    await currentWindow.destroy();
  }, [currentWindow]);

  const handleReturn = useCallback(async () => {
    if (descriptor) {
      const latestLayout = layout;
      const sessionIds = latestLayout ? paneSessionIds(latestLayout) : visibleSessions.map((item) => item.id);
      const terminalSnapshots = Object.fromEntries(
        sessionIds.flatMap((sessionId) => {
          const snapshot = serializeTerminal(sessionId);
          return snapshot ? [[sessionId, snapshot]] : [];
        }),
      );
      await updateDetachedTerminalWorkspace(workspace.label, {
        autoTitle: descriptor.autoTitle,
        tabSessionId: latestLayout?.tabSessionId ?? descriptor.tabSessionId,
        sessionIds,
        layout: latestLayout,
        terminalSnapshots,
      }).catch(() => {
        // The raw backend scrollback remains a safe fallback if a snapshot
        // cannot be transferred while the window is closing.
      });
    }
    await closeWindow();
  }, [closeWindow, descriptor, layout, visibleSessions, workspace.label]);

  const closeTab = useCallback(async (confirmed = false) => {
    const ids = layout ? paneSessionIds(layout)
      : terminal.isSessionsLoaded ? visibleSessions.map((session) => session.id) : descriptor?.sessionIds ?? [];
    if (!confirmed && !await confirmClose(ids, workspace.title)) return;
    try {
      await Promise.all(ids.map((id) => terminal.closeSession(id)));
      setTerminalFullscreenPaneId(null);
      await discardDetachedWorkspace(workspace.label);
      await closeWindow();
    } catch (error) {
      toast(error instanceof Error ? error.message : "关闭终端失败，请重试。", "error");
    }
  }, [closeWindow, confirmClose, descriptor?.sessionIds, layout, terminal.closeSession, terminal.isSessionsLoaded, visibleSessions, workspace.label, workspace.title]);

  // Closing the window used to hand the sessions straight back to the main
  // window. That is a reasonable default but it reads as "closed", so the two
  // outcomes are now spelled out instead of one being assumed.
  //
  // Registered once: Tauri routes the close through this listener only while it
  // exists, so re-subscribing on every session change would leave a window in
  // which the native close slips past unasked. The count is read from a ref for
  // the same reason.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void currentWindow
      .onCloseRequested((event) => {
        if (sessionCountRef.current === 0) {
          return;
        }
        event.preventDefault();
        setIsCloseConfirmOpen(true);
      })
      .then((dispose) => {
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [currentWindow]);

  const split = useCallback(async (dir: SplitDir) => {
    if (!activeSession) return;
    const profile = activeSession.kind === "ssh"
      ? profilesState.profiles.find((item) => item.id === activeSession.profileId) ?? null
      : null;
    if (activeSession.kind === "ssh" && !profile) {
      toast("原终端的连接配置已不存在，无法创建分屏。", "error");
      return;
    }
    try {
      const next = activeSession.kind === "ssh"
        ? await terminal.startSession(profile!, undefined, { activate: false })
        : await terminal.startLocalSession({ activate: false });
      setOwnedSessionIds((current) => [...current, next.id]);
      panes.split(dir, activeSession.id, next.id);
      terminal.setActiveSessionId(next.id);
      setTerminalFullscreenPaneId(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "拆分终端失败。", "error");
    }
  }, [activeSession, panes, profilesState.profiles, terminal]);

  const handleShellExited = useCallback(async (sessionId: string) => {
    try {
      await terminal.closeSession(sessionId);
      setOwnedSessionIds((current) => current.filter((id) => id !== sessionId));
    } catch (error) {
      toast(error instanceof Error ? error.message : "关闭终端失败，请重试。", "error");
      return;
    }
    const currentLayout = panes.findLayout(sessionId);
    const remaining = paneSessionIds(currentLayout).filter((id) => id !== sessionId);
    if (terminalFullscreenPaneId === sessionId) {
      setTerminalFullscreenPaneId(null);
    }
    if (remaining.length === 0) {
      void discardDetachedWorkspace(workspace.label).finally(() => void closeWindow());
      return;
    }
    panes.removePane(sessionId);
    terminal.setActiveSessionId(remaining[0] ?? null);
  }, [closeWindow, panes, terminal, terminalFullscreenPaneId, workspace.label]);

  function switchPane(step: number) {
    if (!layout) return;
    const id = cycleItem(paneSessionIds(layout), layout.focusedPaneId, step);
    if (!id) return;
    panes.focusPane(id);
    terminal.setActiveSessionId(id);
    if (terminalFullscreenPaneId) setTerminalFullscreenPaneId(id);
  }
  useActionShortcuts({
    splitHorizontal: activeSession ? () => split("h") : undefined,
    splitVertical: activeSession ? () => split("v") : undefined,
    nextPane: layout ? () => switchPane(1) : undefined,
    previousPane: layout ? () => switchPane(-1) : undefined,
    focusTerminal: activeSession ? () => focusTerminalSession(activeSession.id) : undefined,
    closePane: activeSession ? async () => {
      if (!layout) { await closeTab(); return; }
      if (await confirmClose([activeSession.id], activeSession.title)) await handleShellExited(activeSession.id);
    } : undefined,
    closeTab: () => closeTab(),
  }, appLock.status?.locked || isCloseConfirmOpen);

  useEffect(() => {
    if (!terminal.isSessionsLoaded || !appliedInitialLayout.current) return;
    for (const session of visibleSessions) {
      if (session.status !== "exited" || handledShellExitsRef.current.has(session.id)) continue;
      handledShellExitsRef.current.add(session.id);
      void handleShellExited(session.id);
    }
  }, [handleShellExited, terminal.isSessionsLoaded, visibleSessions]);

  const sessionLabel = activeSession
    ? activeProfile ? `${activeProfile.username}@${activeProfile.host}:${activeProfile.port}` : activeSession.title
    : "";

  const terminalSurface = (
    <TerminalWorkspace
      activeSession={activeSession}
      activeSessionLabel={sessionLabel}
      canForward={false}
      copyOnSelect={settings.copyOnSelect}
      fontFamily={settings.fontFamily}
      fontSize={settings.fontSize}
      letterSpacing={settings.letterSpacing}
      lineHeight={settings.lineHeight}
      getBacklog={terminal.getBacklog}
      gpuAcceleration={settings.gpuAcceleration}
      backgroundAlpha={settings.terminalBgOpacity / 100}
      hasWallpaper={hasTerminalWallpaper}
      rightClick={settings.rightClick}
      hasProfiles={profilesState.profiles.length > 0}
      onCancelReconnect={() => { if (activeSession) terminal.cancelReconnect(activeSession.id); }}
      onCreateProfile={() => {}}
      onFontSizeChange={settings.setFontSize}
      onOpenHostTools={() => {}}
      onOpenPortForward={() => {}}
      onReconnect={() => { if (activeSession) void terminal.reconnectSession(activeSession.id); }}
      onResize={terminal.resizeSession}
      onStartLocalSession={() => void terminal.startLocalSession()}
      onWrite={terminal.writeToSession}
      showSessionBar={!sessionBarHidden}
      subscribeOutput={terminal.subscribeOutput}
    />
  );

  // The session bar belongs to the single-terminal surface; a split replaces
  // that surface with the pane grid, leaving nothing to toggle.
  const hasSessionBar = Boolean(activeSession) && !layout;

  if (!descriptor) {
    return <DetachedUnavailable message="终端独立窗口数据不完整。" />;
  }

  return (
    <div className={`detached-workspace${isMacOS && terminalFullscreenPaneId ? " detached-workspace--mac-chrome-hidden" : ""}`}>
      {terminalFullscreenPaneId ? null : <DetachedTitlebar title={displayTitle} onReturn={handleReturn} />}
      {closeDialog}
      {terminalFullscreenPaneId ? null : <div className="detached-workspace__tabbar is-glass-chrome">
        <div className="detached-workspace__tab">
          <span className="detached-workspace__tab-title" title={displayTitle}>
            <span
              className={`tab__kind-icon${isCommandRunning ? " is-running" : ""}`}
              title={isCommandRunning ? "命令正在运行" : undefined}
            >
              <Icon name={tabIcon} />
            </span>
            <span className="detached-workspace__tab-title-text">{displayTitle}</span>
          </span>
          <button
            aria-label="关闭终端"
            className="detached-workspace__tab-close"
            onClick={() => void closeTab()}
            title="关闭终端"
            type="button"
          >
            <Icon name="close" height="14" width="14" />
          </button>
        </div>
        <span className="detached-workspace__tab-spacer" />
        <button aria-label="左右分屏" className="tab-action" disabled={!panes.canSplit(activeSession?.id ?? null)} onClick={() => void split("h")} title={`左右分屏（同一主机）（${formatShortcut(getShortcutBinding("splitHorizontal"))}）`} type="button"><Icon name="splitH" height="15" width="15" /></button>
        <button aria-label="上下分屏" className="tab-action" disabled={!panes.canSplit(activeSession?.id ?? null)} onClick={() => void split("v")} title={`上下分屏（同一主机）（${formatShortcut(getShortcutBinding("splitVertical"))}）`} type="button"><Icon name="splitV" height="15" width="15" /></button>
        {hasSessionBar ? (
          <button
            aria-label={sessionBarHidden ? "显示会话状态栏" : "隐藏会话状态栏"}
            aria-pressed={sessionBarHidden}
            className={`tab-action${sessionBarHidden ? " is-active" : ""}`}
            onClick={() => setSessionBarHidden((hidden) => !hidden)}
            title={sessionBarHidden ? "显示会话状态栏" : "隐藏会话状态栏"}
            type="button"
          >
            <Icon name="panelTop" height="15" width="15" />
          </button>
        ) : null}
        <button aria-label="终端全屏" className="tab-action" onClick={toggleTerminalFullscreen} title={`终端全屏（${formatShortcut(getShortcutBinding("toggleTerminalFullscreen"))}）`} type="button"><Icon name="maximize" height="15" width="15" /></button>
      </div>}
      <main className="detached-workspace__content">
        {!terminal.isSessionsLoaded ? (
          <div className="terminal-loading">正在连接独立终端…</div>
        ) : layout ? (
          <PaneGrid
            layout={layout}
            focusedPaneId={layout.focusedPaneId}
            zoomedPaneId={terminalFullscreenPaneId}
            sessions={visibleSessions}
            getBacklog={terminal.getBacklog}
            subscribeOutput={terminal.subscribeOutput}
            onPaneData={(id, data) => terminal.writeToSession(id, data)}
            onPaneResize={(id, size) => void terminal.resizeSession(id, size)}
            onFocusPane={(id) => { panes.focusPane(id); terminal.setActiveSessionId(id); }}
            onRatios={panes.setRatios}
            fontSize={settings.fontSize}
            fontFamily={settings.fontFamily}
            letterSpacing={settings.letterSpacing}
            lineHeight={settings.lineHeight}
            copyOnSelect={settings.copyOnSelect}
            rightClick={settings.rightClick}
            gpuAcceleration={settings.gpuAcceleration}
            backgroundAlpha={settings.terminalBgOpacity / 100}
            hasWallpaper={hasTerminalWallpaper}
            onFontSizeChange={settings.setFontSize}
          />
        ) : terminalSurface}
      </main>
      {terminalFullscreenPaneId ? (
        <button
          className="terminal-focus-exit is-glass-overlay"
          onClick={() => setTerminalFullscreenPaneId(null)}
          title={`恢复终端视图（${formatShortcut(getShortcutBinding("toggleTerminalFullscreen"))}）`}
          type="button"
        >
          <Icon name="restore" height="15" width="15" />
          <span>恢复终端视图</span>
        </button>
      ) : null}
      {isCloseConfirmOpen ? (
        <DetachedCloseDialog
          onCancel={() => setIsCloseConfirmOpen(false)}
          onCloseSessions={() => {
            setIsCloseConfirmOpen(false);
            void closeTab(true);
          }}
          onReturn={() => {
            setIsCloseConfirmOpen(false);
            handleReturn();
          }}
          sessionCount={sessionCountRef.current}
        />
      ) : null}
      <ToastHost />
      {!appLock.status?.locked ? (
        <TerminalTransferNotice transfers={terminal.terminalTransfers} onCancel={terminal.cancelTerminalTransfer} />
      ) : null}
      {!appLock.status?.locked && terminal.terminalConflicts[0] ? (
        <TerminalTransferConflictDialog
          conflict={terminal.terminalConflicts[0]}
          key={`${terminal.terminalConflicts[0].sessionId}:${terminal.terminalConflicts[0].detectionId}:${terminal.terminalConflicts[0].fileIndex}`}
          onResolve={terminal.resolveTerminalConflict}
        />
      ) : null}
      {appLock.status?.locked ? <AppLockScreen onUnlock={appLock.unlock} /> : null}
    </div>
  );
}

function DetachedUnavailable({ message }: { message: string }) {
  return <div className="detached-unavailable">{message}</div>;
}

export function DetachedWorkspaceWindow({ workspace }: DetachedWorkspaceProps) {
  useTheme();
  if (workspace.kind === "sftp") return <DetachedSftpWindow workspace={workspace} />;
  return <DetachedTerminalWindow workspace={workspace} />;
}
