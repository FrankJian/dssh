import { Suspense, useCallback } from "react";
import type { TerminalSession } from "../models";
import type { ConnectionProfile } from "../ssh/connectionTypes";
import type { RightClickAction } from "../settings/settings";
import { EmptyTerminal } from "./EmptyTerminal";
import { LazyTerminalView } from "./LazyTerminalView";
import type { TerminalOutputListener } from "./useTerminalSessions";

interface TerminalWorkspaceProps {
  activeSession: TerminalSession | null;
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
  recentProfiles?: ConnectionProfile[];
  onConnectProfile?: (profile: ConnectionProfile) => void;
  onOpenConnections?: () => void;
  onCreateProfile: () => void;
  onFontSizeChange: (size: number) => void;
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
  subscribeOutput: (sessionId: string, listener: TerminalOutputListener) => () => void;
}

export function TerminalWorkspace({
  activeSession,
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
  recentProfiles,
  onConnectProfile,
  onOpenConnections,
  onCreateProfile,
  onFontSizeChange,
  onResize,
  onStartLocalSession,
  onWrite,
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

  return (
    <section className="terminal-workspace" aria-label="终端会话">
      {activeSession ? (
        <>
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
          recentProfiles={recentProfiles}
          onConnectProfile={onConnectProfile}
          onOpenConnections={onOpenConnections}
          onCreateProfile={onCreateProfile}
          onStartLocalSession={onStartLocalSession}
        />
      )}
    </section>
  );
}
