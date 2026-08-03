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
  getBacklog: (sessionId: string) => string;
  hasProfiles: boolean;
  onCreateProfile: () => void;
  onFontSizeChange: (size: number) => void;
  onOpenHostTools: () => void;
  onOpenPortForward: () => void;
  onReconnect: () => void;
  onCancelReconnect: () => void;
  onResize: (size: { cols: number; rows: number }) => Promise<void> | void;
  onStartLocalSession: () => void;
  onWrite: (data: string) => Promise<void> | void;
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
  subscribeOutput,
}: TerminalWorkspaceProps) {
  const handleData = useCallback((data: string) => onWrite(data), [onWrite]);
  const handleResize = useCallback((size: { cols: number; rows: number }) => onResize(size), [
    onResize,
  ]);

  return (
    <section className="terminal-workspace" aria-label="终端会话">
      {activeSession ? (
        <>
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
          <div className="terminal-stage">
            <Suspense fallback={<div className="terminal-loading">正在加载终端...</div>}>
              <LazyTerminalView
                copyOnSelect={copyOnSelect}
                fontFamily={fontFamily}
                fontSize={fontSize}
                getBacklog={getBacklog}
                gpuAcceleration={gpuAcceleration}
                backgroundAlpha={backgroundAlpha}
                hasWallpaper={hasWallpaper}
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
