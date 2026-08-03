import { isMacOS } from "../platform";

/**
 * Application shortcuts are intentionally defined in one place. The same
 * definitions drive the settings UI, the global window handler and xterm's
 * custom key handler, so changing a binding never leaves a stale shortcut in
 * the terminal.
 */
export type ShortcutId =
  | "commandPalette"
  | "toggleTerminalFullscreen"
  | "exitFocusMode"
  | "increaseTerminalFont"
  | "decreaseTerminalFont"
  | "resetTerminalFont"
  | "copyTerminalSelection"
  | "pasteTerminalClipboard"
  | "adjustTerminalFontWheel";

export type ShortcutCategory = "全局" | "终端";
export type ShortcutInput = "key" | "wheel";

export interface ShortcutBinding {
  /** `primary` maps to Cmd on macOS and Ctrl on Windows/Linux. */
  primary: boolean;
  shift: boolean;
  alt: boolean;
  /** A normalized KeyboardEvent.key, or `Wheel` for mouse-wheel gestures. */
  key: string;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  category: ShortcutCategory;
  label: string;
  description: string;
  input: ShortcutInput;
  defaultBinding: ShortcutBinding;
}

const SHORTCUT_STORAGE_KEY = "dssh.shortcuts.v1";

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    id: "commandPalette",
    category: "全局",
    label: "打开命令面板",
    description: "快速搜索和执行应用操作。",
    input: "key",
    defaultBinding: { alt: false, key: "k", primary: true, shift: false },
  },
  {
    id: "toggleTerminalFullscreen",
    category: "终端",
    label: "终端全屏 / 恢复",
    description: "聚焦当前 pane；分屏布局会在恢复时保持不变。",
    input: "key",
    defaultBinding: { alt: false, key: "Enter", primary: true, shift: true },
  },
  {
    id: "exitFocusMode",
    category: "终端",
    label: "退出终端全屏 / 禅模式",
    description: "优先恢复终端全屏，其次退出禅模式。",
    input: "key",
    defaultBinding: { alt: false, key: "Escape", primary: false, shift: false },
  },
  {
    id: "increaseTerminalFont",
    category: "终端",
    label: "增大终端字号",
    description: "仅在终端获得焦点时生效。",
    input: "key",
    defaultBinding: { alt: false, key: "=", primary: true, shift: false },
  },
  {
    id: "decreaseTerminalFont",
    category: "终端",
    label: "减小终端字号",
    description: "仅在终端获得焦点时生效。",
    input: "key",
    defaultBinding: { alt: false, key: "-", primary: true, shift: false },
  },
  {
    id: "resetTerminalFont",
    category: "终端",
    label: "重置终端字号",
    description: "恢复为默认字号。",
    input: "key",
    defaultBinding: { alt: false, key: "0", primary: true, shift: false },
  },
  {
    id: "copyTerminalSelection",
    category: "终端",
    label: "复制终端选中内容",
    description: "没有选中内容时会原样发送给 shell。",
    input: "key",
    defaultBinding: { alt: false, key: "c", primary: true, shift: false },
  },
  {
    id: "pasteTerminalClipboard",
    category: "终端",
    label: "粘贴到终端",
    description: "从系统剪贴板粘贴一次内容。",
    input: "key",
    defaultBinding: { alt: false, key: "v", primary: true, shift: false },
  },
  {
    id: "adjustTerminalFontWheel",
    category: "终端",
    label: "滚轮调整终端字号",
    description: "按住组合键并滚动鼠标滚轮。",
    input: "wheel",
    defaultBinding: { alt: false, key: "Wheel", primary: true, shift: false },
  },
];

const definitionById = new Map(SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition]));

function normalizeKey(value: string): string {
  if (value === " ") return "Space";
  if (value === "Esc") return "Escape";
  // On many layouts Shift+= produces `+`; the original font shortcut accepted
  // both, so keep that compatibility while displaying one compact binding.
  if (value === "+") return "=";
  return value.length === 1 ? value.toLowerCase() : value;
}

function isBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ShortcutBinding>;
  return typeof candidate.key === "string" &&
    typeof candidate.primary === "boolean" &&
    typeof candidate.shift === "boolean" &&
    typeof candidate.alt === "boolean";
}

function readOverrides(): Partial<Record<ShortcutId, ShortcutBinding>> {
  try {
    const raw = localStorage.getItem(SHORTCUT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const overrides: Partial<Record<ShortcutId, ShortcutBinding>> = {};
    for (const definition of SHORTCUT_DEFINITIONS) {
      const value = (parsed as Record<string, unknown>)[definition.id];
      if (isBinding(value) && (definition.input === "wheel" ? value.key === "Wheel" : value.key !== "Wheel")) {
        overrides[definition.id] = { ...value, key: normalizeKey(value.key) };
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Partial<Record<ShortcutId, ShortcutBinding>>) {
  localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(overrides));
}

export function getShortcutDefinitions(): readonly ShortcutDefinition[] {
  return SHORTCUT_DEFINITIONS;
}

export function getShortcutBinding(id: ShortcutId): ShortcutBinding {
  return readOverrides()[id] ?? definitionById.get(id)!.defaultBinding;
}

export function getShortcutBindings(): Record<ShortcutId, ShortcutBinding> {
  const overrides = readOverrides();
  return Object.fromEntries(SHORTCUT_DEFINITIONS.map((definition) => [
    definition.id,
    overrides[definition.id] ?? definition.defaultBinding,
  ])) as Record<ShortcutId, ShortcutBinding>;
}

export function setShortcutBinding(id: ShortcutId, binding: ShortcutBinding) {
  const definition = definitionById.get(id);
  if (!definition) return;
  const normalized = { ...binding, key: normalizeKey(binding.key) };
  if (definition.input === "wheel" ? normalized.key !== "Wheel" : normalized.key === "Wheel") {
    return;
  }
  writeOverrides({ ...readOverrides(), [id]: normalized });
}

export function resetShortcutBinding(id: ShortcutId) {
  const overrides = readOverrides();
  delete overrides[id];
  writeOverrides(overrides);
}

export function resetAllShortcutBindings() {
  localStorage.removeItem(SHORTCUT_STORAGE_KEY);
}

export function findShortcutConflict(
  id: ShortcutId,
  binding: ShortcutBinding,
  bindings = getShortcutBindings(),
): ShortcutDefinition | null {
  const definition = definitionById.get(id);
  if (!definition) return null;
  return SHORTCUT_DEFINITIONS.find((candidate) => {
    if (candidate.id === id || candidate.input !== definition.input) return false;
    const current = bindings[candidate.id];
    return current.key === binding.key &&
      current.primary === binding.primary &&
      current.shift === binding.shift &&
      current.alt === binding.alt;
  }) ?? null;
}

/** The platform's primary modifier: Cmd on macOS, Ctrl elsewhere. */
export function hasPrimaryModifier(event: Pick<KeyboardEvent | WheelEvent, "ctrlKey" | "metaKey">): boolean {
  return isMacOS ? event.metaKey : event.ctrlKey;
}

function matchesModifiers(event: Pick<KeyboardEvent | WheelEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">, binding: ShortcutBinding): boolean {
  if (hasPrimaryModifier(event) !== binding.primary || event.altKey !== binding.alt) return false;
  // Do not let the non-primary command modifier turn a binding into another
  // platform's shortcut (Ctrl+Cmd on macOS, Ctrl+Meta elsewhere).
  if (binding.primary ? (isMacOS ? event.ctrlKey : event.metaKey) : event.ctrlKey || event.metaKey) {
    return false;
  }
  return event.shiftKey === binding.shift || (binding.key === "=" && !binding.shift && event.shiftKey);
}

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  const definition = definitionById.get(id);
  if (!definition || definition.input !== "key") return false;
  const binding = getShortcutBinding(id);
  return matchesModifiers(event, binding) && normalizeKey(event.key) === binding.key;
}

export function matchesWheelShortcut(event: WheelEvent, id: ShortcutId): boolean {
  const definition = definitionById.get(id);
  if (!definition || definition.input !== "wheel") return false;
  return matchesModifiers(event, getShortcutBinding(id));
}

export function bindingFromKeyboardEvent(event: KeyboardEvent): ShortcutBinding | null {
  const key = normalizeKey(event.key);
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return null;
  // Bindings intentionally expose one portable primary modifier rather than
  // separate Ctrl/Cmd variants. Do not save an unreachable Ctrl-on-macOS or
  // Meta-on-Windows combination.
  if ((event.ctrlKey || event.metaKey) && !hasPrimaryModifier(event)) return null;
  return {
    alt: event.altKey,
    key,
    primary: hasPrimaryModifier(event),
    shift: event.shiftKey,
  };
}

export function bindingFromWheelEvent(event: WheelEvent): ShortcutBinding {
  return {
    alt: event.altKey,
    key: "Wheel",
    primary: hasPrimaryModifier(event),
    shift: event.shiftKey,
  };
}

function displayKey(key: string): string {
  if (key === "Enter") return isMacOS ? "↵" : "Enter";
  if (key === "Escape") return isMacOS ? "Esc" : "Esc";
  if (key === "Space") return "Space";
  if (key === "Wheel") return "滚轮";
  return key.length === 1 ? key.toUpperCase() : key;
}

export function shortcutDisplayParts(binding: ShortcutBinding): string[] {
  const modifiers = [
    binding.primary ? (isMacOS ? "⌘" : "Ctrl") : "",
    binding.shift ? (isMacOS ? "⇧" : "Shift") : "",
    binding.alt ? (isMacOS ? "⌥" : "Alt") : "",
  ].filter(Boolean);
  return [...modifiers, displayKey(binding.key)];
}

export function formatShortcut(binding: ShortcutBinding): string {
  const parts = shortcutDisplayParts(binding);
  return isMacOS ? parts.join(" ") : parts.join(" + ");
}

/** Toggles the command palette (⌘K / Ctrl+K by default). */
export function isCommandPaletteShortcut(event: KeyboardEvent): boolean {
  return matchesShortcut(event, "commandPalette");
}

/** Focuses the current terminal pane (⌘⇧↵ / Ctrl+Shift+Enter by default). */
export function isTerminalFullscreenShortcut(event: KeyboardEvent): boolean {
  return matchesShortcut(event, "toggleTerminalFullscreen");
}

export function isFocusModeExitShortcut(event: KeyboardEvent): boolean {
  return matchesShortcut(event, "exitFocusMode");
}

/**
 * True when the key is an app-level shortcut that the terminal must not consume.
 * xterm's custom key handler should return `false` for these so they bubble up.
 */
export function isAppShortcut(event: KeyboardEvent): boolean {
  return isCommandPaletteShortcut(event) ||
    isTerminalFullscreenShortcut(event) ||
    isFocusModeExitShortcut(event);
}
