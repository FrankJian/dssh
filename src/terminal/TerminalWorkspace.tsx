import { Suspense, useCallback } from "react";
import type { TerminalSession } from "../models";
import type { RightClickAction } from "../settings/settings";
import { Icon } from "../ui/Icon";
import { EmptyTerminal } from "./EmptyTerminal";
import { LazyTerminalView } from "./LazyTerminalView";
import type { TerminalOutputListener } from "./useTerminalSessions";

interface TerminalWorkspaceProps {
  activeSession: TerminalSession | null;
  activeSessionLabel: string;
  canForward: boolean;
  copyOnSelect: boolean;
  rightClick: RightClickAction;
  gpuAcceleration: boolean;
  backgroundAlpha?: number;
  hasWallpaper?: boolean;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  letterSpacing: number;
  getBacklog: (sessionId: string) => string;
  hasProfiles: boolean;
  onCreateProfile: () => void;
  onFontSizeChange: (size: number) => void;
  onOpenHostTools: () => void;
  onOpenPortForward: () => void;
  onReconnect: () => void;
  onCancelReconnect: () => void;
  /**
   * Both take the session explicitly. An earlier signature wrote to whichever
   * session the owner considered "active", which is not always the one rendered
   * here — a detached window shows its own terminal while the session hook,
   * seeded from the backend's global list, still points at another window's.
   * Input and resizes then landed on a terminal in a different window.
   */
  onResize: (sessionId: string, size: { cols: number; rows: number }) => Promise<void> | void;
  onStartLocalSession: () => void;
  onWrite: (sessionId: string, data: string) => Promise<void> | void;
  /** The status strip above the terminal; hidden gives the terminal its rows back. */
  showSessionBar?: boolean;
  subscribeOutput: (sessionId: string, listener: TerminalOutputListener) => () => void;
}

export function TerminalWorkspace({
  activeSession,
  activeSessionLabel,
  canForward,
  copyOnSelect,
  rightClick,
  gpuAcceleration,
  backgroundAlpha,
  hasWallpaper,
  fontSize,
  fontFamily,
  lineHeight,
  letterSpacing,
  getBacklog,
  hasProfiles,
  onCreateProfile,
  onFontSizeChange,
  onOpenHostTools,
  onOpenPortForward,
  onReconnect,
  onCancelReconnect,
  onResize,
  onStartLocalSession,
  onWrite,
  showSessionBar = true,
  subscribeOutput,
}: TerminalWorkspaceProps) {
  const renderedSessionId = activeSession?.id ?? null;
  const handleData = useCallback(
    (data: string) => (renderedSessionId ? onWrite(renderedSessionId, data) : undefined),
    [onWrite, renderedSessionId],
  );
  const handleResize = useCallback(
    (size: { cols: number; rows: number }) =>
      renderedSessionId ? onResize(renderedSessionId, size) : undefined,
    [onResize, renderedSessionId],
  );

  const sessionBar = activeSession && showSessionBar ? (
    <div className="session-bar">
      <span className="session-bar__status" data-status={activeSession.status} />
      <span className="session-bar__label">{activeSessionLabel}</span>
      {activeSession.status === "reconnecting" ? (
        <button
          className="session-bar__reconnecting"
          onClick={onCancelReconnect}
          title="取消重连"
          type="button"
        >
          <Icon name="refresh" height="13" width="13" />
          <span>重连中 · 取消</span>
        </button>
      ) : null}
      <div className="session-bar__spacer" />
      {canForward ? (
        <button
          className="session-bar__action"
          aria-label="主机工具"
          onClick={onOpenHostTools}
          title="主机工具"
          type="button"
        >
          <Icon name="toolbox" height="16" width="16" />
        </button>
      ) : null}
      <button
        className="session-bar__action"
        aria-label="重新连接"
        onClick={onReconnect}
        title="重新连接"
        type="button"
      >
        <Icon name="refresh" height="16" width="16" />
      </button>
      {canForward ? (
        <button
          className="session-bar__action"
          aria-label="端口转发"
          onClick={onOpenPortForward}
          title="端口转发"
          type="button"
        >
          <Icon name="forward" height="16" width="16" />
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <section className="terminal-workspace" aria-label="终端会话">
      {activeSession ? (
        <>
          {sessionBar}
          <div className="terminal-stage">
            <Suspense fallback={<div className="terminal-loading">正在加载终端...</div>}>
              <LazyTerminalView
                copyOnSelect={copyOnSelect}
                fontFamily={fontFamily}
                fontSize={fontSize}
                letterSpacing={letterSpacing}
                lineHeight={lineHeight}
                getBacklog={getBacklog}
                gpuAcceleration={gpuAcceleration}
                backgroundAlpha={backgroundAlpha}
                hasWallpaper={hasWallpaper}
                isLocalShell={activeSession.kind === "local"}
                rightClick={rightClick}
                onData={handleData}
                onFontSizeChange={onFontSizeChange}
                onResize={handleResize}
                sessionId={activeSession.id}
                subscribeOutput={subscribeOutput}
              />
            </Suspense>
          </div>
        </>
      ) : (
        <EmptyTerminal
          mode={hasProfiles ? "terminal" : "home"}
          onCreateProfile={onCreateProfile}
          onStartLocalSession={onStartLocalSession}
        />
      )}
    </section>
  );
}
