import { useEffect, useRef } from "react";
import type { TerminalSize } from "../models";
import { type RightClickAction } from "../settings/settings";
import {
  acquireTerminal,
  type TerminalHandle,
  type TerminalLiveProps,
} from "./terminalRegistry";
import type { TerminalOutputListener } from "./useTerminalSessions";

interface TerminalViewProps {
  getBacklog?: (sessionId: string) => string;
  subscribeOutput?: (sessionId: string, listener: TerminalOutputListener) => () => void;
  onData?: (data: string) => Promise<void> | void;
  onResize?: (size: TerminalSize) => Promise<void> | void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  copyOnSelect?: boolean;
  rightClick?: RightClickAction;
  gpuAcceleration?: boolean;
  /** Terminal background alpha (0–1). Below 1 the surface behind shows through. */
  backgroundAlpha?: number;
  /** True when a supported frosted wallpaper can be shown behind the terminal. */
  hasWallpaper?: boolean;
  /** True for a local shell; SSH sessions always talk to a remote Unix PTY. */
  isLocalShell?: boolean;
  /**
   * Take keyboard focus when mounted. Split panes must pass this per pane:
   * otherwise every pane grabs focus as it attaches and the last one in tree
   * order wins, rather than the pane the user is working in.
   */
  autoFocus?: boolean;
  sessionId?: string | null;
}

/**
 * Mount point for a terminal. The xterm instance itself belongs to
 * `terminalRegistry` and survives this component, so switching tabs or surfaces
 * keeps the scroll position, the selection and any alt-screen program intact.
 */
export function TerminalView({
  getBacklog,
  subscribeOutput,
  onData,
  onResize,
  fontSize,
  onFontSizeChange,
  fontFamily,
  lineHeight,
  letterSpacing,
  copyOnSelect,
  rightClick,
  gpuAcceleration = true,
  backgroundAlpha = 1,
  hasWallpaper = false,
  isLocalShell = false,
  autoFocus = true,
  sessionId,
}: TerminalViewProps) {
  // A supported wallpaper needs the terminal canvas to let the CSS-rendered
  // image and frosted overlay through, and any alpha < 1 needs to reveal the
  // app beneath it.
  // In both cases xterm must use its transparent-canvas rendering path.
  const transparent = hasWallpaper || backgroundAlpha < 1;
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Tagged with the session it belongs to. This component is reused across
  // sessions (the tab strip renders one view for whichever tab is active), and
  // the effect below runs before the one that swaps the handle — without the
  // tag it would write the incoming session's callbacks into the outgoing
  // session's instance, which now outlives the switch and would keep sending
  // its input to the wrong terminal.
  const handleRef = useRef<{ sessionId: string | null; handle: TerminalHandle } | null>(null);
  const livePropsRef = useRef<TerminalLiveProps>({});
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;
  const getBacklogRef = useRef(getBacklog);
  const subscribeOutputRef = useRef(subscribeOutput);

  // Declared before the mount effect so the instance is never attached with
  // stale callbacks: the very first fit already reports its size through
  // `onResize`, and that must reach the backend PTY.
  const currentSessionId = sessionId ?? null;
  useEffect(() => {
    getBacklogRef.current = getBacklog;
    subscribeOutputRef.current = subscribeOutput;
    livePropsRef.current = {
      onData,
      onResize,
      onFontSizeChange,
      fontSize,
      fontFamily,
      lineHeight,
      letterSpacing,
      copyOnSelect,
      rightClick,
      gpuAcceleration,
    };
    const held = handleRef.current;
    if (held?.sessionId === currentSessionId) {
      held.handle.update(livePropsRef.current);
    }
  }, [
    currentSessionId,
    getBacklog,
    subscribeOutput,
    onData,
    onResize,
    onFontSizeChange,
    fontSize,
    fontFamily,
    lineHeight,
    letterSpacing,
    copyOnSelect,
    rightClick,
    gpuAcceleration,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handle = acquireTerminal({
      sessionId: currentSessionId,
      transparent,
      isLocalShell,
      getBacklog: getBacklogRef.current,
      subscribeOutput: subscribeOutputRef.current,
    });
    handleRef.current = { sessionId: currentSessionId, handle };
    handle.update(livePropsRef.current);
    // Read through the ref: focus is only meaningful at attach time, and making
    // it a dependency would tear the terminal off its mount point every time
    // the focused pane changes.
    handle.attach(container, autoFocusRef.current);

    return () => {
      handle.detach(container);
      handleRef.current = null;
    };
  }, [currentSessionId, isLocalShell, transparent]);

  // Opacity is drawn by the CSS surface, but xterm's WebGL canvas retains its
  // prior theme across Fast Refresh. Reapply the transparent theme whenever the
  // slider changes so the text area and its padded edge always share one layer.
  useEffect(() => {
    if (transparent) {
      handleRef.current?.handle.applyTransparentTheme();
    }
  }, [backgroundAlpha, transparent]);

  return (
    <div
      className="terminal-view"
      data-wallpaper={hasWallpaper ? "true" : "false"}
      onMouseDown={() => {
        handleRef.current?.handle.focus();
      }}
      ref={containerRef}
    />
  );
}
