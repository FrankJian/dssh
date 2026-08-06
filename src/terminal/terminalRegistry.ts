import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import { isAppShortcut, matchesShortcut, matchesWheelShortcut } from "../app/shortcuts";
import type { TerminalSize, TerminalSnapshot } from "../models";
import {
  clampFontSize,
  COPY_ON_SELECT_DEFAULT,
  DEFAULT_FONT_FAMILY,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_STEP,
  RIGHT_CLICK_DEFAULT,
  clampTerminalLetterSpacing,
  clampTerminalLineHeight,
  TERMINAL_LETTER_SPACING_DEFAULT,
  TERMINAL_LINE_HEIGHT_DEFAULT,
  type RightClickAction,
} from "../settings/settings";
import { isPaneDragging, onPaneDragEnd } from "./paneDrag";
import { terminalTheme } from "./terminalTheme";
import type { TerminalOutputListener } from "./useTerminalSessions";
import "@xterm/xterm/css/xterm.css";

/**
 * Live terminal instances, keyed by session.
 *
 * xterm holds state React cannot rebuild: scroll position, selection, and the
 * alt-screen buffer that vim, htop and less draw into. Tying its lifetime to a
 * component means every tab or surface switch throws that away and replays the
 * backlog to approximate it, which is slow and — for alt-screen programs —
 * simply wrong. So an instance lives here, outliving whichever view shows it;
 * a view only borrows it by adopting its host element.
 *
 * Instances are released when the session goes away, not when a view unmounts.
 * The registry is per window: a DOM node cannot move between windows, so a
 * detached workspace builds its own.
 */

/** Props that may change while an instance stays alive. */
export interface TerminalLiveProps {
  onData?: (data: string) => Promise<void> | void;
  onResize?: (size: TerminalSize) => Promise<void> | void;
  onFontSizeChange?: (size: number) => void;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  copyOnSelect?: boolean;
  rightClick?: RightClickAction;
  gpuAcceleration?: boolean;
}

/** Everything fixed for the lifetime of one instance. */
export interface TerminalSetup {
  sessionId: string | null;
  transparent: boolean;
  isLocalShell: boolean;
  getBacklog?: (sessionId: string) => string;
  subscribeOutput?: (sessionId: string, listener: TerminalOutputListener) => () => void;
}

export interface TerminalHandle {
  readonly terminal: Terminal;
  update(props: TerminalLiveProps): void;
  attach(container: HTMLElement, focus: boolean): void;
  /** No-op unless `container` is still the mount point, so an unmount that
   *  races a remount elsewhere cannot pull the terminal out of its new home. */
  detach(container: HTMLElement): void;
  focus(): void;
  applyTransparentTheme(): void;
  /** Capture the rendered state before moving a workspace to another window. */
  serialize(): TerminalSnapshot | null;
}

/** The session-less welcome terminal shown before anything is connected. */
const WELCOME_KEY = "\u0000welcome";

const welcomeOutput = ["\x1b[1;34mdssh 终端\x1b[0m", "", "请选择左侧 SSH 配置并连接。", ""];

const transparentTerminalTheme: ITheme = {
  ...terminalTheme,
  background: "rgba(20, 20, 28, 0)",
};

/**
 * Windows local shells run behind ConPTY, which rewrites the screen on resize
 * instead of emitting the reflow a Unix PTY would. xterm needs to be told so it
 * applies the matching wrapping heuristics. SSH sessions are excluded on
 * purpose: their PTY is allocated on the remote host, whatever we run on.
 */
const isWindows = navigator.userAgent.includes("Windows");

const windowsPtyOptions = isWindows ? ({ backend: "conpty" } as const) : undefined;

/**
 * Focus reports, sent as *input* once a program enables DECSET 1004.
 *
 * ConPTY turns focus reporting on, but PSReadLine cannot parse the sequence and
 * reads its leading ESC as "revert line", so merely clicking away from a local
 * terminal can wipe what the user was typing. A local Windows shell has no use
 * for these, so they stop here. Remote hosts still get them: there they work,
 * and vim/tmux act on them.
 */
const FOCUS_REPORTS = new Set(["\x1b[I", "\x1b[O"]);

interface RegistryEntry {
  handle: TerminalHandle;
  dispose: () => void;
  transparent: boolean;
}

const instances = new Map<string, RegistryEntry>();

// Detached native windows have a separate JS runtime, so their xterm instance
// cannot return with them. The parent consumes this screen state once rather
// than reparsing historical PTY output at a different terminal width.
const pendingSnapshots = new Map<string, TerminalSnapshot>();

export function restoreTerminalSnapshot(sessionId: string, snapshot: TerminalSnapshot) {
  if (snapshot.data && snapshot.cols > 0 && snapshot.rows > 0) {
    pendingSnapshots.set(sessionId, snapshot);
  }
}

export function serializeTerminal(sessionId: string): TerminalSnapshot | null {
  return instances.get(sessionId)?.handle.serialize() ?? null;
}

export function acquireTerminal(setup: TerminalSetup): TerminalHandle {
  const key = setup.sessionId ?? WELCOME_KEY;
  const existing = instances.get(key);
  // `allowTransparency` decides the renderer at construction time, so a change
  // of transparency is the one case that still has to rebuild the instance.
  if (existing) {
    if (existing.transparent === setup.transparent) {
      return existing.handle;
    }
    existing.dispose();
  }

  const entry = createInstance(key, setup);
  instances.set(key, entry);
  return entry.handle;
}

export function releaseTerminal(sessionId: string) {
  instances.get(sessionId)?.dispose();
  pendingSnapshots.delete(sessionId);
}

/**
 * Release instances whose session no longer exists — closed, reconnected under
 * a new id, or moved to a detached window. Called whenever the session list
 * changes so no path can leave a terminal subscribed to output nobody shows.
 */
export function pruneTerminals(liveSessionIds: Iterable<string>) {
  const live = new Set(liveSessionIds);
  for (const key of [...instances.keys()]) {
    if (key !== WELCOME_KEY && !live.has(key)) {
      instances.get(key)?.dispose();
    }
  }
}

function createInstance(key: string, setup: TerminalSetup): RegistryEntry {
  const { sessionId, transparent, isLocalShell } = setup;
  const restoredSnapshot = sessionId ? pendingSnapshots.get(sessionId) ?? null : null;
  if (sessionId) {
    pendingSnapshots.delete(sessionId);
  }

  let props: TerminalLiveProps = {};
  let container: HTMLElement | null = null;
  let lastSize: TerminalSize | null = null;
  let webgl: WebglAddon | null = null;
  let resizeFrame: number | null = null;
  let fitDeferred = false;
  let opened = false;
  let replaying = false;
  let restoringSnapshot = false;
  let unsubscribeOutput: (() => void) | undefined;

  // xterm renders into this element, which travels with the instance rather
  // than with whichever view is currently showing it.
  const host = document.createElement("div");
  host.className = "terminal-view__surface";

  const terminal = new Terminal({
    allowProposedApi: false,
    // Transparency costs a little render performance, so it is only enabled
    // when the terminal is actually translucent or a wallpaper is behind it.
    allowTransparency: transparent,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: FONT_SIZE_DEFAULT,
    letterSpacing: TERMINAL_LETTER_SPACING_DEFAULT,
    lineHeight: TERMINAL_LINE_HEIGHT_DEFAULT,
    scrollback: 5000,
    tabStopWidth: 4,
    // CSS owns the terminal background layer so wallpaper and opacity work
    // consistently with both the DOM and WebGL renderers. xterm only paints
    // text/cursor/selection over that layer while transparency is enabled.
    theme: transparent ? transparentTerminalTheme : terminalTheme,
    windowsPty: isLocalShell ? windowsPtyOptions : undefined,
  });
  const fitAddon = new FitAddon();
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(new WebLinksAddon());
  // The serializer restores wrapped rows accurately only at the dimensions it
  // captured. Do this before xterm creates its DOM and before the first fit.
  if (restoredSnapshot) {
    terminal.resize(restoredSnapshot.cols, restoredSnapshot.rows);
  }

  function adjustFontSize(delta: number) {
    const current = clampFontSize(props.fontSize ?? FONT_SIZE_DEFAULT);
    const next = clampFontSize(current + delta);
    if (next !== current) {
      props.onFontSizeChange?.(next);
    }
  }

  const suppressFocusReports = isWindows && isLocalShell;

  const dataDisposable = terminal.onData((data) => {
    if (replaying || (suppressFocusReports && FOCUS_REPORTS.has(data))) {
      return;
    }
    // Dropping keystrokes silently is what made this class of bug so hard to
    // see; a failed write must at least leave a trace.
    void Promise.resolve(props.onData?.(data)).catch((error: unknown) => {
      console.error("终端输入写入失败", key, error);
    });
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

    if (matchesShortcut(event, "increaseTerminalFont")) {
      event.preventDefault();
      adjustFontSize(FONT_SIZE_STEP);
      return false;
    }
    if (matchesShortcut(event, "decreaseTerminalFont")) {
      event.preventDefault();
      adjustFontSize(-FONT_SIZE_STEP);
      return false;
    }
    if (matchesShortcut(event, "resetTerminalFont")) {
      event.preventDefault();
      props.onFontSizeChange?.(FONT_SIZE_DEFAULT);
      return false;
    }

    // Copy only when there is a selection; otherwise let the key through so
    // Ctrl+C still sends SIGINT (on Windows/Linux) instead of being swallowed.
    if (matchesShortcut(event, "copyTerminalSelection")) {
      const selection = terminal.getSelection();
      if (selection) {
        void navigator.clipboard?.writeText(selection);
        return false;
      }
    }

    if (matchesShortcut(event, "pasteTerminalClipboard")) {
      // Let the WebView dispatch its native `paste` event. Reading through
      // navigator.clipboard here makes macOS WebKit show a Paste permission
      // affordance; the capture handler below receives the same data without
      // that prompt and writes it exactly once.
      return false;
    }

    return true;
  });

  const selectionDisposable = terminal.onSelectionChange(() => {
    if (!(props.copyOnSelect ?? COPY_ON_SELECT_DEFAULT)) {
      return;
    }
    const selection = terminal.getSelection();
    if (selection) {
      void navigator.clipboard?.writeText(selection).catch(() => {});
    }
  });

  function fit() {
    // A detached or hidden host has no layout box. Fitting against it would
    // derive a nonsense geometry and push it to the PTY, so the remote would
    // redraw at the wrong size the moment the terminal is shown again.
    if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) {
      return;
    }

    fitAddon.fit();

    // FitAddon derives the row count from the cell height xterm reports, which
    // can be a fraction of a pixel shorter than the height the renderer really
    // paints. Once that difference adds up past the container, the last row is
    // sliced in half by `overflow: hidden`. Give the row back instead of
    // showing a partial line of text.
    const element = terminal.element;
    const screen = element?.querySelector<HTMLElement>(".xterm-screen");
    if (element && screen && terminal.rows > 1 && screen.offsetHeight > element.clientHeight) {
      terminal.resize(terminal.cols, terminal.rows - 1);
    }

    const nextSize = { cols: terminal.cols, rows: terminal.rows };
    if (lastSize?.cols === nextSize.cols && lastSize.rows === nextSize.rows) {
      return;
    }

    lastSize = nextSize;
    void Promise.resolve(props.onResize?.(nextSize)).catch(() => {});
  }

  function scheduleFit() {
    if (restoringSnapshot) {
      return;
    }
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      // A divider drag resizes every pane on every frame. Those intermediate
      // sizes are never read, and fitting reflows the whole buffer, so hold off
      // until the drag settles and fit once against the size the user chose.
      if (isPaneDragging()) {
        fitDeferred = true;
        return;
      }
      fit();
    });
  }

  const resizeObserver = new ResizeObserver(scheduleFit);
  resizeObserver.observe(host);
  const unsubscribeDragEnd = onPaneDragEnd(() => {
    if (!fitDeferred) {
      return;
    }
    fitDeferred = false;
    fit();
  });

  // Ctrl + mouse wheel resizes the font. Use a non-passive native listener so
  // we can suppress the browser's default zoom/scroll behaviour.
  function handleWheel(event: WheelEvent) {
    if (!matchesWheelShortcut(event, "adjustTerminalFontWheel")) {
      return;
    }
    event.preventDefault();
    adjustFontSize(event.deltaY < 0 ? FONT_SIZE_STEP : -FONT_SIZE_STEP);
  }
  host.addEventListener("wheel", handleWheel, { passive: false });

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

  // The terminal's hidden textarea also listens for `paste`. Intercept the
  // native event in capture phase so Cmd/Ctrl+V and application-menu Paste
  // share one path and cannot send the clipboard contents twice.
  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = event.clipboardData?.getData("text/plain");
    if (text) {
      terminal.paste(text);
    }
  }
  host.addEventListener("paste", handlePaste, true);

  // Configurable right-click behaviour (paste, copy-or-paste, native menu…).
  function handleContextMenu(event: MouseEvent) {
    const action = props.rightClick ?? RIGHT_CLICK_DEFAULT;
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
  host.addEventListener("contextmenu", handleContextMenu);

  // The GPU renderer holds a WebGL context, and a browser only grants a handful
  // before it starts dropping the oldest. Only visible terminals get one; a
  // detached instance falls back to the DOM renderer until it is shown again.
  function syncRenderer() {
    const wantsGpu = (props.gpuAcceleration ?? true) && container !== null;
    if (wantsGpu === (webgl !== null)) {
      return;
    }
    if (!wantsGpu) {
      webgl?.dispose();
      webgl = null;
      return;
    }
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        if (webgl === addon) {
          webgl = null;
        }
      });
      terminal.loadAddon(addon);
      webgl = addon;
    } catch {
      // WebGL may be unavailable in the webview; the DOM renderer still works.
      webgl = null;
    }
  }

  function update(next: TerminalLiveProps) {
    const previous = props;
    props = next;

    if (next.fontSize != null) {
      const size = clampFontSize(next.fontSize);
      if (terminal.options.fontSize !== size) {
        terminal.options.fontSize = size;
        scheduleFit();
      }
    }
    if (next.fontFamily != null && terminal.options.fontFamily !== next.fontFamily) {
      terminal.options.fontFamily = next.fontFamily;
      scheduleFit();
    }
    if (next.lineHeight != null) {
      const value = clampTerminalLineHeight(next.lineHeight);
      if (terminal.options.lineHeight !== value) {
        terminal.options.lineHeight = value;
        scheduleFit();
      }
    }
    if (next.letterSpacing != null) {
      const value = clampTerminalLetterSpacing(next.letterSpacing);
      if (terminal.options.letterSpacing !== value) {
        terminal.options.letterSpacing = value;
        scheduleFit();
      }
    }
    if (previous.gpuAcceleration !== next.gpuAcceleration) {
      syncRenderer();
    }
  }

  function attach(nextContainer: HTMLElement, focus: boolean) {
    container = nextContainer;
    nextContainer.appendChild(host);

    if (!opened) {
      opened = true;
      // Opening needs a laid-out element: xterm measures the cell size from the
      // DOM, and measuring a detached node yields zero.
      terminal.open(host);

      // Repaint output that arrived before this terminal existed, then stream
      // subsequent chunks. Reading the backlog and subscribing happens
      // synchronously so no chunk is missed or written twice. Because the
      // instance now outlives the view, this runs once per window, not on every
      // tab switch.
      if (sessionId) {
        if (restoredSnapshot) {
          // The serializer records the terminal's state rather than its raw
          // history. Parse it at its source geometry first, then fit it to the
          // returning window. This avoids zsh prompt EOL markers (`%`) becoming
          // visible extra lines when the two windows have different widths.
          restoringSnapshot = true;
          replaying = true;
          terminal.write(restoredSnapshot.data, () => {
            replaying = false;
            restoringSnapshot = false;
            scheduleFit();
          });
        } else {
          const backlog = setup.getBacklog?.(sessionId) ?? "";
          if (backlog) {
            // A backlog is history, not a live conversation. Parsing it replays
            // any query it contains — cursor position, device attributes — and
            // xterm answers those by writing to the PTY, injecting a reply to a
            // question that was already answered when the bytes first arrived.
            // PSReadLine then waits mid-sequence and swallows the next key the
            // user presses, which is how the first character typed into a freshly
            // detached local terminal disappeared.
            replaying = true;
            terminal.write(backlog, () => {
              replaying = false;
            });
          }
        }
        unsubscribeOutput = setup.subscribeOutput?.(sessionId, (data) => {
          terminal.write(data);
        });
      } else {
        terminal.write(welcomeOutput.join("\r\n"));
      }
    }

    syncRenderer();
    if (focus) {
      terminal.focus();
    }
    scheduleFit();
  }

  function detach(previousContainer: HTMLElement) {
    if (container !== previousContainer) {
      return;
    }
    container = null;
    host.remove();
    syncRenderer();
  }

  function dispose() {
    instances.delete(key);
    resizeObserver.disconnect();
    unsubscribeDragEnd();
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
    }
    host.removeEventListener("wheel", handleWheel);
    host.removeEventListener("paste", handlePaste, true);
    host.removeEventListener("contextmenu", handleContextMenu);
    unsubscribeOutput?.();
    selectionDisposable.dispose();
    dataDisposable.dispose();
    webgl?.dispose();
    webgl = null;
    terminal.dispose();
    host.remove();
  }

  return {
    handle: {
      terminal,
      update,
      attach,
      detach,
      focus: () => terminal.focus(),
      applyTransparentTheme: () => {
        terminal.options.theme = transparentTerminalTheme;
      },
      serialize: () => {
        if (!opened) {
          return null;
        }
        try {
          return {
            data: serializeAddon.serialize({ scrollback: terminal.rows * 4 }),
            cols: terminal.cols,
            rows: terminal.rows,
          };
        } catch {
          return null;
        }
      },
    },
    dispose,
    transparent,
  };
}
