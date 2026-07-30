export const terminalFontSizeKey = "dssh.terminal.fontSize";
export const terminalFontFamilyKey = "dssh.terminal.fontFamily";

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
export const FONT_SIZE_DEFAULT = 13;
export const FONT_SIZE_STEP = 1;

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return FONT_SIZE_DEFAULT;
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

export interface FontFamilyOption {
  id: string;
  label: string;
  value: string;
}

export const DEFAULT_FONT_FAMILY =
  '"Cascadia Mono", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

export const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
  { id: "default", label: "系统默认", value: DEFAULT_FONT_FAMILY },
  { id: "cascadia", label: "Cascadia Mono", value: '"Cascadia Mono", monospace' },
  { id: "jetbrains", label: "JetBrains Mono", value: '"JetBrains Mono", monospace' },
  { id: "consolas", label: "Consolas", value: "Consolas, monospace" },
  { id: "menlo", label: "Menlo / Monaco", value: "Menlo, Monaco, monospace" },
  { id: "source", label: "Source Code Pro", value: '"Source Code Pro", monospace' },
  { id: "ubuntu", label: "Ubuntu Mono", value: '"Ubuntu Mono", monospace' },
  { id: "fira", label: "Fira Code", value: '"Fira Code", monospace' },
];

export function normalizeFontFamily(value: string | null): string {
  if (!value) {
    return DEFAULT_FONT_FAMILY;
  }
  return FONT_FAMILY_OPTIONS.some((option) => option.value === value)
    ? value
    : DEFAULT_FONT_FAMILY;
}

export const editorInheritTerminalKey = "dssh.editor.inheritTerminal";
export const editorFontFamilyKey = "dssh.editor.fontFamily";
export const editorFontSizeKey = "dssh.editor.fontSize";
export const editorWordWrapKey = "dssh.editor.wordWrap";
export const editorMinimapKey = "dssh.editor.minimap";
export const editorLineNumbersKey = "dssh.editor.lineNumbers";
export const editorTabSizeKey = "dssh.editor.tabSize";
export const editorRenderWhitespaceKey = "dssh.editor.renderWhitespace";

export const EDITOR_INHERIT_TERMINAL_DEFAULT = true;
export const EDITOR_WORD_WRAP_DEFAULT = true;
export const EDITOR_MINIMAP_DEFAULT = false;
export const EDITOR_LINE_NUMBERS_DEFAULT = true;
export const EDITOR_TAB_SIZE_DEFAULT = 2;
export const EDITOR_TAB_SIZE_MIN = 1;
export const EDITOR_TAB_SIZE_MAX = 8;

export type EditorRenderWhitespace = "all" | "boundary" | "none" | "selection";

export interface EditorOptions {
  fontFamily: string;
  fontSize: number;
  lineNumbers: "off" | "on";
  minimap: boolean;
  renderWhitespace: EditorRenderWhitespace;
  tabSize: number;
  wordWrap: "off" | "on";
}

export function clampEditorTabSize(value: number): number {
  if (!Number.isFinite(value)) {
    return EDITOR_TAB_SIZE_DEFAULT;
  }
  return Math.min(EDITOR_TAB_SIZE_MAX, Math.max(EDITOR_TAB_SIZE_MIN, Math.round(value)));
}

export function normalizeEditorRenderWhitespace(value: string | null): EditorRenderWhitespace {
  return value === "all" || value === "boundary" || value === "selection" || value === "none"
    ? value
    : "selection";
}

export const terminalCopyOnSelectKey = "dssh.terminal.copyOnSelect";
export const terminalRightClickKey = "dssh.terminal.rightClick";
export const terminalGpuKey = "dssh.terminal.gpuAcceleration";
export const terminalBgImageKey = "dssh.terminal.bgImage";
export const terminalBgOpacityKey = "dssh.terminal.bgOpacity";
export const terminalWorkspaceInsetKey = "dssh.terminal.workspaceInset";
export const s3UploadConcurrencyKey = "dssh.s3.uploadConcurrency";
export const s3DownloadConcurrencyKey = "dssh.s3.downloadConcurrency";

export const S3_TRANSFER_CONCURRENCY_DEFAULT = 3;
export const S3_TRANSFER_CONCURRENCY_MIN = 1;
export const S3_TRANSFER_CONCURRENCY_MAX = 8;

export function clampS3TransferConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return S3_TRANSFER_CONCURRENCY_DEFAULT;
  }
  return Math.min(
    S3_TRANSFER_CONCURRENCY_MAX,
    Math.max(S3_TRANSFER_CONCURRENCY_MIN, Math.round(value)),
  );
}

export const COPY_ON_SELECT_DEFAULT = true;

/** GPU (WebGL) rendering is enabled by default; falls back to DOM rendering
 * automatically when WebGL is unavailable or the context is lost. */
export const GPU_ACCELERATION_DEFAULT = true;
/**
 * Opacity of the terminal's own background (percent). Below 100 the terminal
 * surface becomes translucent: whatever sits behind it shows through — the
 * wallpaper when one is set, otherwise the app background.
 */
export const TERMINAL_BG_OPACITY_DEFAULT = 100;
export const TERMINAL_BG_OPACITY_MIN = 20;
export const TERMINAL_BG_OPACITY_MAX = 100;

export function clampBgOpacity(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_BG_OPACITY_DEFAULT;
  return Math.min(TERMINAL_BG_OPACITY_MAX, Math.max(TERMINAL_BG_OPACITY_MIN, Math.round(value)));
}

/** Shared right/bottom breathing room around terminal workspaces, in pixels. */
export const TERMINAL_WORKSPACE_INSET_DEFAULT = 4;
export const TERMINAL_WORKSPACE_INSET_MIN = 0;
export const TERMINAL_WORKSPACE_INSET_MAX = 24;

export function clampTerminalWorkspaceInset(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_WORKSPACE_INSET_DEFAULT;
  return Math.min(
    TERMINAL_WORKSPACE_INSET_MAX,
    Math.max(TERMINAL_WORKSPACE_INSET_MIN, Math.round(value)),
  );
}

export type RightClickAction = "none" | "menu" | "paste" | "pasteOrCopy";

export const RIGHT_CLICK_DEFAULT: RightClickAction = "paste";

export const RIGHT_CLICK_OPTIONS: Array<{ value: RightClickAction; label: string }> = [
  { label: "关闭", value: "none" },
  { label: "右键菜单", value: "menu" },
  { label: "粘贴", value: "paste" },
  { label: "未选择内容时粘贴，否则复制", value: "pasteOrCopy" },
];

export function normalizeRightClick(value: string | null): RightClickAction {
  return RIGHT_CLICK_OPTIONS.some((option) => option.value === value)
    ? (value as RightClickAction)
    : RIGHT_CLICK_DEFAULT;
}

export function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}
