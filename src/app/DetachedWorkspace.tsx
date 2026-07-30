import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DetachedWorkspace } from "../models";
import { FileBrowser } from "../sftp/FileBrowser";
import { useProfiles } from "../ssh/useProfiles";
import { useTerminalSettings } from "../settings/useTerminalSettings";
import { PaneGrid } from "../terminal/PaneGrid";
import { TerminalWorkspace } from "../terminal/TerminalWorkspace";
import { paneSessionIds, usePaneLayout, type SplitDir } from "../terminal/usePaneLayout";
import { useTerminalSessions } from "../terminal/useTerminalSessions";
import { useTheme } from "../theme/useTheme";
import { Icon } from "../ui/Icon";
import { toast, ToastHost } from "../ui/ToastHost";
import { WindowControls } from "../ui/WindowControls";
import { isMacOS } from "../platform";
import { discardDetachedWorkspace, updateDetachedTerminalWorkspace } from "../services/workspaceService";

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
    <div className={`titlebar detached-titlebar${isMacOS ? " titlebar--mac" : ""}`}>
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

  function closeSftpWorkspace() {
    void discardDetachedWorkspace(workspace.label)
      .then(() => currentWindow.close())
      .catch((error: unknown) => {
        toast(error instanceof Error ? error.message : "关闭独立 SFTP 窗口失败。", "error");
      });
  }

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
    </div>
  );
}

function DetachedTerminalWindow({ workspace }: DetachedWorkspaceProps) {
  const descriptor = workspace.terminal;
  const currentWindow = getCurrentWindow();
  const profilesState = useProfiles();
  const terminal = useTerminalSessions();
  const panes = usePaneLayout();
  const settings = useTerminalSettings();
  const appliedInitialLayout = useRef(false);

  const visibleSessions = useMemo(() => {
    const ids = new Set(descriptor?.sessionIds ?? []);
    return terminal.sessions.filter((session) => ids.has(session.id));
  }, [descriptor?.sessionIds, terminal.sessions]);
  const layout = descriptor ? panes.findLayoutByTab(descriptor.tabSessionId) : null;
  const activeSession = visibleSessions.find((session) => session.id === terminal.activeSessionId)
    ?? visibleSessions.find((session) => session.id === layout?.focusedPaneId)
    ?? visibleSessions[0]
    ?? null;
  const activeProfile = activeSession?.kind === "ssh"
    ? profilesState.profiles.find((profile) => profile.id === activeSession.profileId) ?? null
    : null;

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
    const latestLayout = panes.findLayoutByTab(descriptor.tabSessionId) ?? null;
    const sessionIds = latestLayout ? paneSessionIds(latestLayout) : visibleSessions.map((item) => item.id);
    void updateDetachedTerminalWorkspace(workspace.label, {
      tabSessionId: latestLayout?.tabSessionId ?? descriptor.tabSessionId,
      sessionIds,
      layout: latestLayout,
    }).catch(() => {
      // A close can race this best-effort sync; the native close event still
      // restores the last registered state safely.
    });
  }, [descriptor, panes.layouts, terminal.isSessionsLoaded, visibleSessions, workspace.label]);

  const handleReturn = useCallback(() => {
    void currentWindow.close();
  }, [currentWindow]);

  const closeTab = useCallback(async () => {
    const ids = layout ? paneSessionIds(layout) : visibleSessions.map((session) => session.id);
    await Promise.all(ids.map((id) => terminal.closeSession(id)));
    await discardDetachedWorkspace(workspace.label).catch(() => {});
    await currentWindow.close();
  }, [currentWindow, layout, terminal.closeSession, visibleSessions, workspace.label]);

  const split = useCallback(async (dir: SplitDir) => {
    if (!activeSession) return;
    const profile = activeSession.kind === "ssh"
      ? profilesState.profiles.find((item) => item.id === activeSession.profileId) ?? null
      : null;
    try {
      const next = profile ? await terminal.startSession(profile) : await terminal.startLocalSession();
      panes.split(dir, activeSession.id, next.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "拆分终端失败。", "error");
    }
  }, [activeSession, panes, profilesState.profiles, terminal]);

  const closePane = useCallback((sessionId: string) => {
    const currentLayout = panes.findLayout(sessionId);
    const remaining = paneSessionIds(currentLayout).filter((id) => id !== sessionId);
    void terminal.closeSession(sessionId);
    if (remaining.length === 0) {
      void discardDetachedWorkspace(workspace.label).finally(() => void currentWindow.close());
      return;
    }
    panes.removePane(sessionId);
    terminal.setActiveSessionId(remaining[0] ?? null);
  }, [currentWindow, panes, terminal, workspace.label]);

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
      getBacklog={terminal.getBacklog}
      gpuAcceleration={settings.gpuAcceleration}
      backgroundAlpha={settings.terminalBgOpacity / 100}
      hasWallpaper={false}
      rightClick={settings.rightClick}
      hasProfiles={profilesState.profiles.length > 0}
      onCancelReconnect={() => { if (activeSession) terminal.cancelReconnect(activeSession.id); }}
      onCreateProfile={() => {}}
      onFontSizeChange={settings.setFontSize}
      onOpenHostTools={() => {}}
      onOpenPortForward={() => {}}
      onReconnect={() => { if (activeSession) void terminal.reconnectSession(activeSession.id); }}
      onResize={terminal.resizeActiveSession}
      onStartLocalSession={() => void terminal.startLocalSession()}
      onWrite={terminal.writeToActiveSession}
      subscribeOutput={terminal.subscribeOutput}
    />
  );

  if (!descriptor) {
    return <DetachedUnavailable message="终端独立窗口数据不完整。" />;
  }

  return (
    <div className="detached-workspace">
      <DetachedTitlebar title={workspace.title} onReturn={handleReturn} />
      <div className="detached-workspace__tabbar">
        <div className="detached-workspace__tab">
          <span className="detached-workspace__tab-title" title={workspace.title}>
            <Icon name="terminalTool" height="15" width="15" />
            <span>{workspace.title}</span>
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
        <button aria-label="左右分屏" className="tab-action" disabled={!panes.canSplit(activeSession?.id ?? null)} onClick={() => void split("h")} title="左右分屏（同一主机）" type="button"><Icon name="splitH" height="15" width="15" /></button>
        <button aria-label="上下分屏" className="tab-action" disabled={!panes.canSplit(activeSession?.id ?? null)} onClick={() => void split("v")} title="上下分屏（同一主机）" type="button"><Icon name="splitV" height="15" width="15" /></button>
      </div>
      <main className="detached-workspace__content">
        {!terminal.isSessionsLoaded ? (
          <div className="terminal-loading">正在连接独立终端…</div>
        ) : layout ? (
          <PaneGrid
            layout={layout}
            focusedPaneId={layout.focusedPaneId}
            sessions={visibleSessions}
            getPaneLabel={(sessionId) => `Pane ${Math.max(0, paneSessionIds(layout).indexOf(sessionId)) + 1}`}
            getBacklog={terminal.getBacklog}
            subscribeOutput={terminal.subscribeOutput}
            onPaneData={(id, data) => void terminal.writeToSession(id, data)}
            onPaneResize={(id, size) => void terminal.resizeSession(id, size)}
            onFocusPane={(id) => { panes.focusPane(id); terminal.setActiveSessionId(id); }}
            onClosePane={closePane}
            onRatios={panes.setRatios}
            fontSize={settings.fontSize}
            fontFamily={settings.fontFamily}
            copyOnSelect={settings.copyOnSelect}
            rightClick={settings.rightClick}
            gpuAcceleration={settings.gpuAcceleration}
            backgroundAlpha={settings.terminalBgOpacity / 100}
            hasWallpaper={false}
            onFontSizeChange={settings.setFontSize}
          />
        ) : terminalSurface}
      </main>
      <ToastHost />
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
