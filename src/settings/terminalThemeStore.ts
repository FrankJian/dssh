import {
  BUILTIN_TERMINAL_SCHEMES,
  DEFAULT_LIGHT_TERMINAL_SCHEME_ID,
  DEFAULT_TERMINAL_SCHEME_ID,
  getBuiltinTerminalScheme,
} from "../terminal/themes/presets.ts";
import type {
  CustomTerminalScheme,
  TerminalColorField,
  TerminalColors,
  TerminalThemeKind,
  TerminalThemePreferencesV1,
  TerminalThemeStoreState,
} from "../terminal/themes/types";
import { hexToRgbTriplet } from "../terminal/themes/resolve.ts";

export const terminalThemeStorageKey = "dssh.terminal.colorSchemes";
export const MAX_CUSTOM_TERMINAL_SCHEMES = 100;
const MAX_STORAGE_BYTES = 256 * 1024;

const colorFields: readonly TerminalColorField[] = [
  "foreground", "background", "cursor", "cursorAccent", "selectionBackground",
  "selectionInactiveBackground", "selectionForeground", "black", "red", "green",
  "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed",
  "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

const defaultPreferences = (): TerminalThemePreferencesV1 => ({
  schemaVersion: 1,
  revision: 0,
  activeSchemeId: DEFAULT_TERMINAL_SCHEME_ID,
  followAppearance: true,
  darkSchemeId: DEFAULT_TERMINAL_SCHEME_ID,
  lightSchemeId: DEFAULT_LIGHT_TERMINAL_SCHEME_ID,
  customSchemes: [],
});

function defaultState(storageError: string | null = null, readOnly = false): TerminalThemeStoreState {
  return { preferences: defaultPreferences(), storageError, readOnly };
}

function normalizeHexColor(value: unknown, allowNull = false): string | null {
  if (allowNull && value === null) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (/^#[\da-fA-F]{3}$/.test(normalized)) {
    return `#${normalized.slice(1).split("").map((character) => character + character).join("").toLowerCase()}`;
  }
  return /^#[\da-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : null;
}

export function normalizeTerminalColorInput(value: string): string | null {
  return normalizeHexColor(value);
}

function parseColors(value: unknown): TerminalColors | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const colors: Record<TerminalColorField, string | null> = {} as Record<TerminalColorField, string | null>;
  for (const field of colorFields) {
    const normalized = normalizeHexColor(source[field], field === "selectionForeground");
    if (normalized === null && !(field === "selectionForeground" && source[field] === null)) return null;
    colors[field] = normalized;
  }
  return colors as TerminalColors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCustomSchemes(value: unknown): CustomTerminalScheme[] | null {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_TERMINAL_SCHEMES) return null;
  const ids = new Set<string>();
  const names = new Set(BUILTIN_TERMINAL_SCHEMES.map((scheme) => scheme.name.toLocaleLowerCase()));
  const schemes: CustomTerminalScheme[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = item.id;
    const name = normalizeSchemeName(item.name);
    const kind = item.kind;
    const sourcePresetId = item.sourcePresetId;
    const baseColors = parseColors(item.baseColors);
    const colors = parseColors(item.colors);
    if (
      typeof id !== "string" || !/^custom:[0-9a-f-]{36}$/i.test(id) || ids.has(id) ||
      !name || names.has(name.toLocaleLowerCase()) ||
      (kind !== "dark" && kind !== "light") || typeof sourcePresetId !== "string" ||
      (!getBuiltinTerminalScheme(sourcePresetId) && !/^custom:[0-9a-f-]{36}$/i.test(sourcePresetId)) ||
      !baseColors || !colors
    ) return null;
    ids.add(id);
    names.add(name.toLocaleLowerCase());
    schemes.push({ id: id as CustomTerminalScheme["id"], name, kind, sourcePresetId, baseColors, colors });
  }
  return schemes;
}

function normalizeSchemeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  const length = [...name].length;
  if (length < 1 || length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

function parsePreferences(raw: string): TerminalThemePreferencesV1 | null {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== 1) return null;
  if (!Number.isSafeInteger(parsed.revision) || (parsed.revision as number) < 0) return null;
  const customSchemes = parseCustomSchemes(parsed.customSchemes);
  if (!customSchemes) return null;
  const activeSchemeId = typeof parsed.activeSchemeId === "string" ? parsed.activeSchemeId : "";
  const activeExists = getBuiltinTerminalScheme(activeSchemeId) || customSchemes.some((scheme) => scheme.id === activeSchemeId);
  const findScheme = (id: string) => getBuiltinTerminalScheme(id) ?? customSchemes.find((scheme) => scheme.id === id);
  const legacyScheme = activeExists ? findScheme(activeSchemeId)! : getBuiltinTerminalScheme(DEFAULT_TERMINAL_SCHEME_ID)!;
  const compatibleId = (value: unknown, kind: TerminalThemeKind, fallback: string) => {
    const scheme = typeof value === "string" ? findScheme(value) : null;
    return scheme?.kind === kind ? scheme.id : fallback;
  };
  return {
    schemaVersion: 1,
    revision: parsed.revision as number,
    activeSchemeId: legacyScheme.id,
    // Existing records become appearance-aware while keeping their compatible
    // legacy choice for its own mode.
    followAppearance: typeof parsed.followAppearance === "boolean" ? parsed.followAppearance : true,
    darkSchemeId: compatibleId(
      parsed.darkSchemeId,
      "dark",
      legacyScheme.kind === "dark" ? legacyScheme.id : DEFAULT_TERMINAL_SCHEME_ID,
    ),
    lightSchemeId: compatibleId(
      parsed.lightSchemeId,
      "light",
      legacyScheme.kind === "light" ? legacyScheme.id : DEFAULT_LIGHT_TERMINAL_SCHEME_ID,
    ),
    customSchemes,
  };
}

function loadState(): TerminalThemeStoreState {
  let raw: string | null;
  try {
    raw = localStorage.getItem(terminalThemeStorageKey);
  } catch {
    return defaultState("无法读取终端配色设置。", true);
  }
  if (raw === null) return defaultState();
  if (new TextEncoder().encode(raw).length > MAX_STORAGE_BYTES) {
    return defaultState("终端配色数据超过允许大小。请确认后重置。", true);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.schemaVersion === "number" && parsed.schemaVersion > 1) {
      return defaultState("终端配色由较新版本写入，当前版本无法安全修改。", true);
    }
    const preferences = parsePreferences(raw);
    return preferences
      ? { preferences, storageError: null, readOnly: false }
      : defaultState("终端配色数据无效。请确认后重置，原数据会保留。", true);
  } catch {
    return defaultState("终端配色数据无法读取。请确认后重置，原数据会保留。", true);
  }
}

let state = loadState();
const listeners = new Set<() => void>();
let appearanceKind: TerminalThemeKind = "dark";

function applyBackgroundColors(colors: TerminalColors) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--terminal-bg", colors.background);
  root.style.setProperty("--terminal-bg-rgb", hexToRgbTriplet(colors.background));
}

function findScheme(preferences: TerminalThemePreferencesV1, id: string) {
  return getBuiltinTerminalScheme(id)
    ?? preferences.customSchemes.find((scheme) => scheme.id === id)
    ?? null;
}

function activeScheme(preferences = state.preferences) {
  const selectedId = preferences.followAppearance
    ? appearanceKind === "light" ? preferences.lightSchemeId : preferences.darkSchemeId
    : preferences.activeSchemeId;
  return findScheme(preferences, selectedId)
    ?? getBuiltinTerminalScheme(DEFAULT_TERMINAL_SCHEME_ID)!;
}

function readAppearanceKind(): TerminalThemeKind {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

appearanceKind = readAppearanceKind();
applyBackgroundColors(activeScheme().colors);

function notify() {
  for (const listener of listeners) listener();
}

function refreshFromStorage() {
  state = loadState();
  applyBackgroundColors(activeScheme().colors);
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === terminalThemeStorageKey) refreshFromStorage();
  });
  new MutationObserver(() => {
    const next = readAppearanceKind();
    if (next === appearanceKind) return;
    appearanceKind = next;
    applyBackgroundColors(activeScheme().colors);
    notify();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

export function getTerminalThemeStoreState() {
  return state;
}

export function subscribeTerminalThemeStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveTerminalColors(preferences = state.preferences): TerminalColors {
  return activeScheme(preferences).colors;
}

export function getActiveTerminalScheme(preferences = state.preferences) {
  return activeScheme(preferences);
}

export function getTerminalAppearanceKind() {
  return appearanceKind;
}

export function getTerminalSchemes(preferences = state.preferences) {
  return [...BUILTIN_TERMINAL_SCHEMES, ...preferences.customSchemes];
}

function persist(next: TerminalThemePreferencesV1) {
  if (state.readOnly || state.storageError) {
    throw new Error(state.storageError ?? "终端配色设置当前不可修改。");
  }
  let raw: string | null;
  try {
    raw = localStorage.getItem(terminalThemeStorageKey);
  } catch {
    throw new Error("无法检查终端配色设置，请检查应用存储权限。");
  }
  if (raw !== null) {
    if (new TextEncoder().encode(raw).length > MAX_STORAGE_BYTES) {
      refreshFromStorage();
      throw new Error("终端配色数据超过允许大小，请重新加载后再保存。");
    }
    const current = parsePreferences(raw);
    if (!current || current.revision !== state.preferences.revision) {
      refreshFromStorage();
      throw new Error("终端配色已在另一个窗口更改，请重新加载后再保存。");
    }
  } else if (state.preferences.revision !== 0 || state.preferences.customSchemes.length > 0) {
    refreshFromStorage();
    throw new Error("终端配色存储已发生变化，请重新加载后再保存。");
  }
  const serialized = JSON.stringify({ ...next, revision: state.preferences.revision + 1 });
  if (new TextEncoder().encode(serialized).length > MAX_STORAGE_BYTES) {
    throw new Error("终端配色数据超过允许大小。");
  }
  const parsed = parsePreferences(serialized);
  if (!parsed) throw new Error("终端配色数据校验失败。");
  try {
    localStorage.setItem(terminalThemeStorageKey, serialized);
  } catch {
    throw new Error("保存终端配色失败，请检查可用存储空间。");
  }
  state = { preferences: parsed, storageError: null, readOnly: false };
  applyBackgroundColors(activeScheme().colors);
  notify();
}

export function selectTerminalScheme(id: string) {
  const scheme = findScheme(state.preferences, id);
  if (!scheme) throw new Error("找不到此配色方案。");
  if (state.preferences.followAppearance && scheme.kind !== appearanceKind) {
    throw new Error("跟随应用外观时只能选择与当前外观相同的配色方案。");
  }
  const next = {
    ...state.preferences,
    activeSchemeId: id,
    darkSchemeId: scheme.kind === "dark" ? id : state.preferences.darkSchemeId,
    lightSchemeId: scheme.kind === "light" ? id : state.preferences.lightSchemeId,
  };
  if (JSON.stringify(next) === JSON.stringify(state.preferences)) return;
  persist(next);
}

export function restoreDefaultTerminalScheme() {
  selectTerminalScheme(appearanceKind === "light" ? DEFAULT_LIGHT_TERMINAL_SCHEME_ID : DEFAULT_TERMINAL_SCHEME_ID);
}

export function setTerminalThemeFollowAppearance(followAppearance: boolean) {
  if (state.preferences.followAppearance === followAppearance) return;
  const active = activeScheme();
  persist({
    ...state.preferences,
    followAppearance,
    activeSchemeId: active.id,
    darkSchemeId: active.kind === "dark" ? active.id : state.preferences.darkSchemeId,
    lightSchemeId: active.kind === "light" ? active.id : state.preferences.lightSchemeId,
  });
}

export function saveCustomTerminalScheme(input: {
  id?: string;
  name: string;
  kind: TerminalThemeKind;
  sourcePresetId: string;
  baseColors: TerminalColors;
  colors: TerminalColors;
}) {
  const name = normalizeSchemeName(input.name);
  if (!name) throw new Error("名称需为 1–40 个字符，且不能包含控制字符。");
  const duplicate = state.preferences.customSchemes.find((scheme) =>
    scheme.id !== input.id && scheme.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  const builtinName = BUILTIN_TERMINAL_SCHEMES.some((scheme) => scheme.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (duplicate || builtinName) throw new Error("已有同名配色方案，请更换名称。");
  const existing = input.id
    ? state.preferences.customSchemes.find((scheme) => scheme.id === input.id)
    : undefined;
  if (input.id && !existing) throw new Error("此自定义配色已不存在，请刷新后重试。");
  if (!existing && state.preferences.customSchemes.length >= MAX_CUSTOM_TERMINAL_SCHEMES) {
    throw new Error(`最多保存 ${MAX_CUSTOM_TERMINAL_SCHEMES} 套自定义配色。`);
  }
  const scheme: CustomTerminalScheme = {
    id: (existing?.id ?? `custom:${crypto.randomUUID()}`) as CustomTerminalScheme["id"],
    name,
    kind: input.kind,
    sourcePresetId: input.sourcePresetId,
    baseColors: cloneColors(input.baseColors),
    colors: cloneColors(input.colors),
  };
  const customSchemes = existing
    ? state.preferences.customSchemes.map((item) => item.id === existing.id ? scheme : item)
    : [...state.preferences.customSchemes, scheme];
  const replacedKind = existing?.kind;
  persist({
    ...state.preferences,
    activeSchemeId: scheme.id,
    darkSchemeId: scheme.kind === "dark" ? scheme.id : (replacedKind === "dark" && state.preferences.darkSchemeId === scheme.id ? DEFAULT_TERMINAL_SCHEME_ID : state.preferences.darkSchemeId),
    lightSchemeId: scheme.kind === "light" ? scheme.id : (replacedKind === "light" && state.preferences.lightSchemeId === scheme.id ? DEFAULT_LIGHT_TERMINAL_SCHEME_ID : state.preferences.lightSchemeId),
    customSchemes,
  });
}

export function renameCustomTerminalScheme(id: string, name: string) {
  const scheme = state.preferences.customSchemes.find((item) => item.id === id);
  if (!scheme) throw new Error("只能重命名自定义配色方案。");
  saveCustomTerminalScheme({ ...scheme, name });
}

export function deleteCustomTerminalScheme(id: string) {
  const scheme = state.preferences.customSchemes.find((item) => item.id === id);
  if (!scheme) throw new Error("只能删除自定义配色方案。");
  const customSchemes = state.preferences.customSchemes.filter((item) => item.id !== id);
  persist({
    ...state.preferences,
    customSchemes,
    activeSchemeId: state.preferences.activeSchemeId === id
      ? scheme.kind === "light" ? DEFAULT_LIGHT_TERMINAL_SCHEME_ID : DEFAULT_TERMINAL_SCHEME_ID
      : state.preferences.activeSchemeId,
    darkSchemeId: state.preferences.darkSchemeId === id ? DEFAULT_TERMINAL_SCHEME_ID : state.preferences.darkSchemeId,
    lightSchemeId: state.preferences.lightSchemeId === id ? DEFAULT_LIGHT_TERMINAL_SCHEME_ID : state.preferences.lightSchemeId,
  });
}

export function resetInvalidTerminalThemeStorage() {
  try {
    const preferences = defaultPreferences();
    localStorage.setItem(terminalThemeStorageKey, JSON.stringify(preferences));
    state = { preferences, storageError: null, readOnly: false };
    applyBackgroundColors(activeScheme().colors);
    notify();
  } catch {
    throw new Error("重置终端配色失败，请检查应用存储权限。");
  }
}

export function cloneColors(colors: TerminalColors): TerminalColors {
  return { ...colors };
}

export function createColorSchemeFromBuiltin(id: string, name?: string) {
  const source = getBuiltinTerminalScheme(id);
  if (!source) throw new Error("找不到内置配色方案。");
  const baseColors = cloneColors(source.colors);
  const requestedName = name ?? `${source.name} 自定义`;
  const existingNames = new Set(state.preferences.customSchemes.map((scheme) => scheme.name.toLocaleLowerCase()));
  let nextName = requestedName;
  let suffix = 2;
  while (existingNames.has(nextName.toLocaleLowerCase())) {
    nextName = `${requestedName} ${suffix++}`;
  }
  return {
    name: nextName,
    kind: source.kind,
    sourcePresetId: source.id,
    baseColors,
    colors: cloneColors(baseColors),
  };
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const rgb = color.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16) / 255) ?? [0, 0, 0];
    const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const first = luminance(foreground);
  const second = luminance(background);
  const [lighter, darker] = first >= second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}
