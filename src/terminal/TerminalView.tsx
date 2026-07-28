import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import type { TerminalSize } from "../models";
import { hasPrimaryModifier, isAppShortcut } from "../app/shortcuts";
import {
  clampFontSize,
  COPY_ON_SELECT_DEFAULT,
  DEFAULT_FONT_FAMILY,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_STEP,
  RIGHT_CLICK_DEFAULT,
  type RightClickAction,
} from "../settings/settings";
import type { TerminalOutputListener } from "./useTerminalSessions";
import { terminalTheme } from "./terminalTheme";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  getBacklog?: (sessionId: string) => string;
  subscribeOutput?: (sessionId: string, listener: TerminalOutputListener) => () => void;
  onData?: (data: string) => Promise<void> | void;
  onResize?: (size: TerminalSize) => Promise<void> | void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
  fontFamily?: string;
  copyOnSelect?: boolean;
  rightClick?: RightClickAction;
  gpuAcceleration?: boolean;
  /** Terminal background alpha (0–1). Below 1 the surface behind shows through. */
  backgroundAlpha?: number;
  /** True when a wallpaper image is configured behind the terminal. */
  hasWallpaper?: boolean;
  sessionId?: string | null;
}

const welcomeOutput = [
  "\x1b[1;34mdssh 终端\x1b[0m",
  "",
  "请选择左侧 SSH 配置并连接。",
  "",
];

const transparentTerminalTheme: ITheme = {
  ...terminalTheme,
  background: "rgba(20, 20, 28, 0)",
};

export function TerminalView({
  getBacklog,
  subscribeOutput,
  onData,
  onResize,
  fontSize,
  onFontSizeChange,
  fontFamily,
  copyOnSelect,
  rightClick,
  gpuAcceleration = true,
  backgroundAlpha = 1,
  hasWallpaper = false,
  sessionId,
}: TerminalViewProps) {
  // A wallpaper needs the terminal canvas to let the CSS-rendered image and
  // overlay through, and any alpha < 1 needs to reveal the app beneath it.
  // In both cases xterm must use its transparent-canvas rendering path.
  const transparent = hasWallpaper || backgroundAlpha < 1;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const getBacklogRef = useRef(getBacklog);
  const subscribeOutputRef = useRef(subscribeOutput);
  const fontSizeRef = useRef(fontSize);
  const onFontSizeChangeRef = useRef(onFontSizeChange);
  const fontFamilyRef = useRef(fontFamily);
  const copyOnSelectRef = useRef(copyOnSelect);
  const rightClickRef = useRef(rightClick);
  const lastSizeRef = useRef<TerminalSize | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
    getBacklogRef.current = getBacklog;
    subscribeOutputRef.current = subscribeOutput;
    fontSizeRef.current = fontSize;
    onFontSizeChangeRef.current = onFontSizeChange;
    fontFamilyRef.current = fontFamily;
    copyOnSelectRef.current = copyOnSelect;
    rightClickRef.current = rightClick;
  }, [
    onData,
    onResize,
    getBacklog,
    subscribeOutput,
    fontSize,
    onFontSizeChange,
    fontFamily,
    copyOnSelect,
    rightClick,
  ]);

  // Compute the next font size from the current value and hand it back to the
  // owner so the change is persisted and flows down through the `fontSize` prop.
  function adjustFontSize(delta: number) {
    const current = clampFontSize(fontSizeRef.current ?? FONT_SIZE_DEFAULT);
    const next = clampFontSize(current + delta);
    if (next !== current) {
      onFontSizeChangeRef.current?.(next);
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      // Transparency costs a little render performance, so it is only enabled
      // when the terminal is actually translucent or a wallpaper is behind it.
      allowTransparency: transparent,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: fontFamilyRef.current ?? DEFAULT_FONT_FAMILY,
      fontSize: clampFontSize(fontSizeRef.current ?? FONT_SIZE_DEFAULT),
      letterSpacing: 0,
      lineHeight: 1.18,
      scrollback: 5000,
      tabStopWidth: 4,
      // CSS owns the terminal background layer so wallpaper and opacity work
      // consistently with both the DOM and WebGL renderers. xterm only paints
      // text/cursor/selection over that layer while transparency is enabled.
      theme: transparent ? transparentTerminalTheme : terminalTheme,
    });
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);
    terminal.focus();

    // Repaint any output that arrived before this terminal mounted (e.g. when
    // switching back to a tab), then stream subsequent chunks live. Reading the
    // backlog and subscribing happens synchronously so no chunk is missed or
    // written twice.
    let unsubscribeOutput: (() => void) | undefined;
    if (sessionId) {
      const backlog = getBacklogRef.current?.(sessionId) ?? "";
      if (backlog) {
        terminal.write(backlog);
      }
      unsubscribeOutput = subscribeOutputRef.current?.(sessionId, (data) => {
        terminal.write(data);
      });
    } else {
      terminal.write(welcomeOutput.join("\r\n"));
    }

    const dataDisposable = terminal.onData((data) => {
      void Promise.resolve(onDataRef.current?.(data)).catch(() => {});
      if (!sessionId) {
        terminal.write(data === "\r" ? "\r\n$ " : data);
      }
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }

      // Shortcuts owned by the app window (e.g. the ⌘K/Ctrl+K palette) must not
      // be consumed here: xterm would call stopPropagation() and the global
      // listener would never fire. Returning false makes xterm skip the key.
      if (isAppShortcut(event)) {
        return false;
      }

      // App-level shortcuts use the platform's primary modifier: Cmd on macOS,
      // Ctrl elsewhere. This keeps Ctrl free for the shell on macOS (e.g. Ctrl+C
      // must interrupt, not copy), while preserving familiar bindings on Windows.
      const primaryMod = hasPrimaryModifier(event);

      if (primaryMod) {
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          adjustFontSize(FONT_SIZE_STEP);
          return false;
        }
        if (event.key === "-" || event.key === "_") {
          event.preventDefault();
          adjustFontSize(-FONT_SIZE_STEP);
          return false;
        }
        if (event.key === "0") {
          event.preventDefault();
          onFontSizeChangeRef.current?.(FONT_SIZE_DEFAULT);
          return false;
        }
      }

      // Copy only when there is a selection; otherwise let the key through so
      // Ctrl+C still sends SIGINT (on Windows/Linux) instead of being swallowed.
      if (primaryMod && event.key.toLowerCase() === "c") {
        const selection = terminal.getSelection();
        if (selection) {
          void navigator.clipboard?.writeText(selection);
          return false;
        }
      }

      if (primaryMod && event.key.toLowerCase() === "v") {
        void navigator.clipboard?.readText().then((text) => {
          if (text) {
            terminal.paste(text);
          }
        });
        return false;
      }

      return true;
    });

    function fit() {
      fitAddon.fit();
      const nextSize = {
        cols: terminal.cols,
        rows: terminal.rows,
      };
      const lastSize = lastSizeRef.current;
      if (lastSize?.cols === nextSize.cols && lastSize.rows === nextSize.rows) {
        return;
      }

      lastSizeRef.current = nextSize;
      void Promise.resolve(onResizeRef.current?.(nextSize)).catch(() => {});
    }
    fitRef.current = fit;

    // Ctrl + mouse wheel resizes the font. Use a non-passive native listener so
    // we can suppress the browser's default zoom/scroll behaviour.
    function handleWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      adjustFontSize(event.deltaY < 0 ? FONT_SIZE_STEP : -FONT_SIZE_STEP);
    }
    container.addEventListener("wheel", handleWheel, { passive: false });

    // Copy the current selection to the clipboard as soon as it is made.
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (!(copyOnSelectRef.current ?? COPY_ON_SELECT_DEFAULT)) {
        return;
      }
      const selection = terminal.getSelection();
      if (selection) {
        void navigator.clipboard?.writeText(selection).catch(() => {});
      }
    });

    function pasteFromClipboard() {
      void navigator.clipboard
        ?.readText()
        .then((text) => {
          if (text) {
            terminal.paste(text);
          }
        })
        .catch(() => {});
    }

    // Configurable right-click behaviour (paste, copy-or-paste, native menu…).
    function handleContextMenu(event: MouseEvent) {
      const action = rightClickRef.current ?? RIGHT_CLICK_DEFAULT;
      if (action === "menu") {
        return;
      }
      event.preventDefault();
      if (action === "none") {
        return;
      }
      if (action === "paste") {
        pasteFromClipboard();
        return;
      }
      const selection = terminal.getSelection();
      if (selection) {
        void navigator.clipboard?.writeText(selection).catch(() => {});
        terminal.clearSelection();
      } else {
        pasteFromClipboard();
      }
    }
    container.addEventListener("contextmenu", handleContextMenu);

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        fit();
      });
    });
    resizeObserver.observe(container);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      fit();
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("contextmenu", handleContextMenu);
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      selectionDisposable.dispose();
      unsubscribeOutput?.();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      fitRef.current = null;
      lastSizeRef.current = null;
      resizeFrameRef.current = null;
    };
  }, [sessionId, transparent]);

  // Opacity is drawn by the CSS surface, but xterm's WebGL canvas retains its
  // prior theme across Fast Refresh. Reapply the transparent theme whenever the
  // slider changes so the text area and its padded edge always share one layer.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (transparent && terminal) {
      terminal.options.theme = transparentTerminalTheme;
    }
  }, [backgroundAlpha, transparent]);

  // Toggle GPU (WebGL) rendering on the live terminal. Loading the WebGL addon
  // switches xterm's renderer to the GPU; disposing it (or losing the WebGL
  // context) falls back to the DOM renderer. Any construction failure (e.g.
  // WebGL unavailable in the webview) is swallowed so the terminal still works.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !gpuAcceleration) {
      return;
    }
    let addon: WebglAddon | null = null;
    try {
      addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon?.dispose();
        addon = null;
      });
      terminal.loadAddon(addon);
    } catch {
      addon?.dispose();
      addon = null;
    }
    return () => {
      addon?.dispose();
      addon = null;
    };
  }, [sessionId, gpuAcceleration]);

  // Apply font-size changes without recreating the terminal, then refit so the
  // reported rows/cols (and backend PTY size) stay in sync.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || fontSize == null) {
      return;
    }
    const nextSize = clampFontSize(fontSize);
    if (terminal.options.fontSize === nextSize) {
      return;
    }
    terminal.options.fontSize = nextSize;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [fontSize]);

  // Apply font-family changes without recreating the terminal, then refit.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || fontFamily == null) {
      return;
    }
    if (terminal.options.fontFamily === fontFamily) {
      return;
    }
    terminal.options.fontFamily = fontFamily;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [fontFamily]);

  return (
    <div
      className="terminal-view"
      data-wallpaper={hasWallpaper ? "true" : "false"}
      onMouseDown={() => {
        terminalRef.current?.focus();
      }}
      ref={containerRef}
    />
  );
}
