import { open, save } from "@tauri-apps/plugin-dialog";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiSettingsSection } from "../ai/AiSettingsSection";
import type { AiConfig } from "../ai/useAiConfig";
import { AboutSection } from "./AboutSection";
import { ConfigPasswordDialog } from "./ConfigPasswordDialog";
import { ShortcutSettingsSection } from "./ShortcutSettingsSection";
import type { EditorSettings } from "./useEditorSettings";
import { TerminalColorSettings } from "./TerminalColorSettings";
import {
  clampCommandHistoryLimit,
  clearCommandHistory,
  commandHistoryChangedEvent,
  getCommandHistoryCount,
  COMMAND_HISTORY_DEFAULT_LIMIT,
  COMMAND_HISTORY_MAX_LIMIT,
  COMMAND_HISTORY_MIN_LIMIT,
} from "../terminal/commandCompletion";
import { AppLockSettings } from "./AppLockSettings";
import type { AppLockStatus, UpdateAppLockSettingsRequest } from "../services/appLockService";
import {
  exportProfilesEncrypted,
  exportProfilesYaml,
  importProfilesEncrypted,
  importProfilesYaml,
  readTextFile,
  writeTextFile,
} from "../services/configService";
import { listSystemFontFamilies } from "../services/appService";
import type { ThemeMode } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";
import type { NavigationIconId } from "../app/ActivityBar";
import {
  FONT_FAMILY_OPTIONS,
  RECENT_CONNECTIONS_DEFAULT_LIMIT,
  RECENT_CONNECTIONS_MIN_LIMIT,
  RECENT_CONNECTIONS_MAX_LIMIT,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  EDITOR_TAB_SIZE_MAX,
  EDITOR_TAB_SIZE_MIN,
  RIGHT_CLICK_OPTIONS,
  S3_TRANSFER_CONCURRENCY_MAX,
  S3_TRANSFER_CONCURRENCY_MIN,
  TERMINAL_BG_GLASS_BLUR_MAX,
  TERMINAL_BG_GLASS_BLUR_MIN,
  TERMINAL_BG_OPACITY_MAX,
  TERMINAL_BG_OPACITY_MIN,
  TERMINAL_LETTER_SPACING_DEFAULT,
  TERMINAL_LETTER_SPACING_MAX,
  TERMINAL_LETTER_SPACING_MIN,
  TERMINAL_LINE_HEIGHT_DEFAULT,
  TERMINAL_LINE_HEIGHT_MAX,
  TERMINAL_LINE_HEIGHT_MIN,
  TERMINAL_WORKSPACE_INSET_MAX,
  TERMINAL_WORKSPACE_INSET_MIN,
  type EditorRenderWhitespace,
  type FontFamilyOption,
  type RightClickAction,
  systemFontFamilyValue,
} from "./settings";

export type SettingsCategory = "appearance" | "terminal" | "editor" | "shortcuts" | "security" | "s3" | "ai" | "config" | "about";

interface SettingsDialogProps {
  recentConnectionsLimit: number;
  onRecentConnectionsLimitChange: (value: number) => void;
  commandCompletion: boolean;
  onCommandCompletionChange: (value: boolean) => void;
  commandHistoryLimit: number;
  onCommandHistoryLimitChange: (value: number) => void;
  aiConfig: AiConfig;
  appLockStatus: AppLockStatus | null;
  onAppLockSettingsChange: (request: UpdateAppLockSettingsRequest) => Promise<void>;
  initialCategory?: SettingsCategory;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  navigationIcons: readonly NavigationIconId[];
  onNavigationIconsChange: (icons: NavigationIconId[]) => void;
  editorSettings: EditorSettings;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  onResetFontSize: () => void;
  fontFamily: string;
  onFontFamilyChange: (value: string) => void;
  lineHeight: number;
  onLineHeightChange: (value: number) => void;
  onLineHeightStep: (direction: 1 | -1) => void;
  onResetLineHeight: () => void;
  letterSpacing: number;
  onLetterSpacingChange: (value: number) => void;
  onResetLetterSpacing: () => void;
  copyOnSelect: boolean;
  onCopyOnSelectChange: (value: boolean) => void;
  rightClick: RightClickAction;
  onRightClickChange: (value: RightClickAction) => void;
  gpuAcceleration: boolean;
  onGpuAccelerationChange: (value: boolean) => void;
  terminalBgImage: string;
  onTerminalBgImageChange: (value: string) => void;
  terminalBgOpacity: number;
  onTerminalBgOpacityChange: (value: number) => void;
  terminalBgGlassEnabled: boolean;
  onTerminalBgGlassEnabledChange: (value: boolean) => void;
  terminalBgGlassBlur: number;
  onTerminalBgGlassBlurChange: (value: number) => void;
  terminalWorkspaceInset: number;
  onTerminalWorkspaceInsetChange: (value: number) => void;
  s3UploadConcurrency: number;
  onS3UploadConcurrencyChange: (value: number) => void;
  s3DownloadConcurrency: number;
  onS3DownloadConcurrencyChange: (value: number) => void;
  onProfilesImported: () => void | Promise<void>;
  onClose: () => void;
}

export const SETTINGS_CATEGORIES: Array<{
  id: SettingsCategory;
  label: string;
  icon: "sun" | "monitor" | "fileCode" | "command" | "shield" | "bucket" | "file" | "bot" | "info";
  keywords: string;
}> = [
  { icon: "sun", id: "appearance", label: "外观", keywords: "appearance theme 主题 深色 浅色 跟随系统 左侧导航栏 导航图标 会话首页 最近连接 显示数量" },
  { icon: "monitor", id: "terminal", label: "终端", keywords: "terminal 命令补全 历史命令 清空历史 存储上限 字体 字号 行高 字间距 鼠标 右键 选中复制 GPU 渲染 背景图 磨砂 透明度 边距 配色" },
  { icon: "fileCode", id: "editor", label: "文件编辑器", keywords: "editor monaco 字体 字号 显示 编辑 自动换行 行号 小地图 Tab宽度 空白字符 缩进" },
  { icon: "command", id: "shortcuts", label: "快捷键", keywords: "shortcut keybinding hotkey 按键 组合键 自定义 重置" },
  { icon: "shield", id: "security", label: "安全与锁屏", keywords: "security lock 锁定 密码 自动锁屏 超时" },
  { icon: "bucket", id: "s3", label: "对象存储", keywords: "s3 object storage 上传 下载 传输并发" },
  { icon: "bot", id: "ai", label: "AI", keywords: "ai api 模型 助手" },
  { icon: "file", id: "config", label: "配置文件", keywords: "config profile import export 导入 加密导出 备份" },
  { icon: "info", id: "about", label: "关于", keywords: "about version 版本 更新" },
];

const ENCRYPTED_PREFIX = "DSSH-ENCRYPTED-1:";
const EXPORT_FILTERS = [{ extensions: ["dsshenc"], name: "加密配置" }];
const IMPORT_FILTERS = [
  { extensions: ["dsshenc", "yaml", "yml", "txt"], name: "配置文件" },
];

const themeOptions: Array<{
  mode: ThemeMode;
  label: string;
  icon: "system" | "sun" | "moon";
}> = [
  { icon: "system", label: "跟随系统", mode: "system" },
  { icon: "sun", label: "浅色", mode: "light" },
  { icon: "moon", label: "深色", mode: "dark" },
];

const NAVIGATION_ICON_OPTIONS: Array<{
  id: NavigationIconId;
  label: string;
  icon: "sessions" | "connections" | "bucket" | "bot" | "terminalTool";
}> = [
  { id: "sessions", label: "活动会话", icon: "sessions" },
  { id: "connections", label: "连接管理", icon: "connections" },
  { id: "s3", label: "S3 对象浏览器", icon: "bucket" },
  { id: "assistant", label: "AI 助手", icon: "bot" },
  { id: "newLocalTerminal", label: "新建本地终端", icon: "terminalTool" },
];

function buildFontOptions(systemFamilies: readonly string[], currentValues: readonly string[]): FontFamilyOption[] {
  const options = [...FONT_FAMILY_OPTIONS];
  const values = new Set(options.map((option) => option.value));

  for (const family of systemFamilies) {
    const value = systemFontFamilyValue(family);
    if (values.has(value)) {
      continue;
    }
    values.add(value);
    options.push({ id: `system:${family}`, label: family, value });
  }

  // Keep a saved custom font selectable while the system-font request is still
  // loading, or if it was removed from the operating system after being saved.
  for (const value of currentValues) {
    if (values.has(value)) {
      continue;
    }
    values.add(value);
    options.push({ id: `current:${value}`, label: `${value}（当前）`, value });
  }

  return options;
}

export function SettingsDialog({
  recentConnectionsLimit,
  onRecentConnectionsLimitChange,
  commandCompletion,
  onCommandCompletionChange,
  commandHistoryLimit,
  onCommandHistoryLimitChange,
  aiConfig,
  appLockStatus,
  copyOnSelect,
  editorSettings,
  fontFamily,
  fontSize,
  lineHeight,
  letterSpacing,
  gpuAcceleration,
  initialCategory,
  onClose,
  onCopyOnSelectChange,
  onAppLockSettingsChange,
  onFontFamilyChange,
  onFontSizeChange,
  onLetterSpacingChange,
  onLineHeightStep,
  onResetLetterSpacing,
  onResetLineHeight,
  onGpuAccelerationChange,
  onS3DownloadConcurrencyChange,
  onS3UploadConcurrencyChange,
  onProfilesImported,
  onResetFontSize,
  onRightClickChange,
  onTerminalBgImageChange,
  onTerminalBgOpacityChange,
  onTerminalBgGlassEnabledChange,
  onTerminalBgGlassBlurChange,
  onTerminalWorkspaceInsetChange,
  onThemeChange,
  navigationIcons,
  onNavigationIconsChange,
  rightClick,
  s3DownloadConcurrency,
  s3UploadConcurrency,
  terminalBgImage,
  terminalBgOpacity,
  terminalBgGlassEnabled,
  terminalBgGlassBlur,
  terminalWorkspaceInset,
  themeMode,
}: SettingsDialogProps) {
  const s3NavigationEnabled = navigationIcons.includes("s3");
  const aiNavigationEnabled = navigationIcons.includes("assistant");
  const visibleCategories = SETTINGS_CATEGORIES.filter(
    (item) => (item.id !== "s3" || s3NavigationEnabled) && (item.id !== "ai" || aiNavigationEnabled),
  );
  const [category, setCategory] = useState<SettingsCategory>(
    () => (
      (initialCategory === "s3" && !s3NavigationEnabled) ||
      (initialCategory === "ai" && !aiNavigationEnabled)
        ? "appearance"
        : initialCategory ?? "appearance"
    ),
  );
  const [commandHistoryLimitDraft, setCommandHistoryLimitDraft] = useState(String(commandHistoryLimit));
  const [confirmClearCommandHistory, setConfirmClearCommandHistory] = useState(false);
  const [commandHistoryCleared, setCommandHistoryCleared] = useState(false);
  const [commandHistoryCount, setCommandHistoryCount] = useState(getCommandHistoryCount);
  useEffect(() => {
    const refresh = () => {
      const count = getCommandHistoryCount();
      setCommandHistoryCount(count);
      if (count > 0) setCommandHistoryCleared(false);
    };
    window.addEventListener(commandHistoryChangedEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(commandHistoryChangedEvent, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  useEffect(() => setCommandHistoryLimitDraft(String(commandHistoryLimit)), [commandHistoryLimit]);
  const commitCommandHistoryLimit = () => {
    const next = commandHistoryLimitDraft.trim()
      ? clampCommandHistoryLimit(Number(commandHistoryLimitDraft))
      : commandHistoryLimit;
    setCommandHistoryLimitDraft(String(next));
    if (next !== commandHistoryLimit) onCommandHistoryLimitChange(next);
  };
  const [systemFontFamilies, setSystemFontFamilies] = useState<string[]>([]);
  const [yamlText, setYamlText] = useState("");
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [passwordMode, setPasswordMode] = useState<"export" | "import" | null>(null);
  const [pendingImportText, setPendingImportText] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [windowOffset, setWindowOffset] = useState({ x: 0, y: 0 });
  const [isDraggingWindow, setIsDraggingWindow] = useState(false);
  const windowRef = useRef<HTMLElement>(null);
  const terminalDraftGuardRef = useRef<() => boolean>(() => true);
  const requestClose = useCallback(() => {
    if (terminalDraftGuardRef.current()) onClose();
  }, [onClose]);
  const fontOptions = useMemo(
    () => buildFontOptions(systemFontFamilies, [fontFamily, editorSettings.fontFamily]),
    [editorSettings.fontFamily, fontFamily, systemFontFamilies],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  useEffect(() => {
    let cancelled = false;
    void listSystemFontFamilies()
      .then((families) => {
        if (!cancelled) {
          setSystemFontFamilies(families);
        }
      })
      .catch(() => {
        // The preset list remains available if the host cannot enumerate fonts.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      (!s3NavigationEnabled && category === "s3") ||
      (!aiNavigationEnabled && category === "ai")
    ) {
      setCategory("appearance");
    }
  }, [aiNavigationEnabled, category, s3NavigationEnabled]);

  const loadYaml = useCallback(async () => {
    setConfigError(null);
    try {
      setYamlText(await exportProfilesYaml());
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "读取配置失败。");
    }
  }, []);

  useEffect(() => {
    if (category === "config") {
      setConfigMessage(null);
      void loadYaml();
    }
  }, [category, loadYaml]);

  async function pickBackgroundImage() {
    const selected = await open({
      directory: false,
      filters: [{ extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"], name: "图片" }],
      multiple: false,
      title: "选择终端背景图片",
    });
    if (typeof selected === "string") {
      onTerminalBgImageChange(selected);
    }
  }

  function handleExport() {
    setConfigError(null);
    setConfigMessage(null);
    setDialogError(null);
    setPasswordMode("export");
  }

  // Encrypt with the chosen password, then let the user pick where to save.
  async function performEncryptedExport(password: string) {
    setDialogError(null);
    setDialogBusy(true);
    try {
      const blob = await exportProfilesEncrypted(password);
      const path = await save({
        defaultPath: "dssh-profiles.dsshenc",
        filters: EXPORT_FILTERS,
        title: "导出加密配置",
      });
      if (!path) {
        return;
      }
      await writeTextFile(path, blob);
      setPasswordMode(null);
      setConfigMessage(`已加密导出到 ${path}`);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "导出配置失败。");
    } finally {
      setDialogBusy(false);
    }
  }

  async function handleImport() {
    setConfigError(null);
    setConfigMessage(null);
    setDialogError(null);
    try {
      const selected = await open({
        directory: false,
        filters: IMPORT_FILTERS,
        multiple: false,
        title: "导入配置",
      });
      if (typeof selected !== "string") {
        return;
      }
      const text = await readTextFile(selected);
      if (text.trimStart().startsWith(ENCRYPTED_PREFIX)) {
        // Encrypted file: ask for the password before importing.
        setPendingImportText(text);
        setPasswordMode("import");
        return;
      }
      // Plaintext (legacy) YAML import.
      setIsBusy(true);
      const created = await importProfilesYaml(text);
      setConfigMessage(`已导入 ${created.length} 个配置。`);
      await onProfilesImported();
      await loadYaml();
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "导入配置失败。");
    } finally {
      setIsBusy(false);
    }
  }

  async function performEncryptedImport(password: string) {
    if (!pendingImportText) {
      return;
    }
    setDialogError(null);
    setDialogBusy(true);
    try {
      const created = await importProfilesEncrypted(pendingImportText, password);
      setPasswordMode(null);
      setPendingImportText(null);
      setConfigMessage(`已导入 ${created.length} 个配置。`);
      await onProfilesImported();
      await loadYaml();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "解密或导入失败。");
    } finally {
      setDialogBusy(false);
    }
  }

  function closePasswordDialog() {
    setPasswordMode(null);
    setPendingImportText(null);
    setDialogError(null);
  }

  function beginWindowDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select, textarea")) {
      return;
    }
    const windowElement = windowRef.current;
    if (!windowElement) {
      return;
    }
    event.preventDefault();
    const bounds = windowElement.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startOffset = windowOffset;
    const margin = 12;
    setIsDraggingWindow(true);

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaX = Math.min(
        window.innerWidth - margin - bounds.right,
        Math.max(margin - bounds.left, moveEvent.clientX - startX),
      );
      const deltaY = Math.min(
        window.innerHeight - margin - bounds.bottom,
        Math.max(margin - bounds.top, moveEvent.clientY - startY),
      );
      setWindowOffset({ x: startOffset.x + deltaX, y: startOffset.y + deltaY });
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      setIsDraggingWindow(false);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard?.writeText(yamlText);
      setConfigMessage("已复制脱敏配置到剪贴板（不含密码/密钥）。");
    } catch {
      setConfigError("复制失败。");
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section
        aria-label="设置"
        className={`settings-window is-glass-overlay${isDraggingWindow ? " is-dragging" : ""}`}
        ref={windowRef}
        style={{ transform: `translate(${windowOffset.x}px, ${windowOffset.y}px)` }}
      >
        <header className="settings-window__header" onPointerDown={beginWindowDrag} title="拖动以移动窗口">
          <h2>设置</h2>
          <button
            aria-label="关闭设置"
            className="icon-button"
            onClick={requestClose}
            type="button"
          >
            <Icon name="close" height="16" width="16" />
          </button>
        </header>

        <div className="settings-window__body">
          <nav className="settings-nav" aria-label="设置分类">
            {visibleCategories.map((item) => (
              <button
                aria-current={category === item.id}
                className={`settings-nav__item ${category === item.id ? "is-active" : ""}`.trim()}
                key={item.id}
                onClick={() => {
                  if (terminalDraftGuardRef.current()) setCategory(item.id);
                }}
                type="button"
              >
                <Icon name={item.icon} height="16" width="16" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {category === "appearance" ? (
              <section className="settings-section" aria-label="主题">
                <div className="settings-section__head">
                  <h3>主题</h3>
                  <p>选择应用的浅色 / 深色外观。</p>
                </div>
                <div className="settings-theme">
                  {themeOptions.map((option) => (
                    <button
                      aria-pressed={themeMode === option.mode}
                      className={`settings-theme__option ${
                        themeMode === option.mode ? "is-active" : ""
                      }`.trim()}
                      key={option.mode}
                      onClick={() => onThemeChange(option.mode)}
                      type="button"
                    >
                      <Icon name={option.icon} height="18" width="18" />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>

                <label className="settings-field settings-field--short" title={`默认 ${RECENT_CONNECTIONS_DEFAULT_LIMIT} 个，调整后立即生效，不会删除连接记录。`}>
                  <span className="settings-field__label">最近连接显示数量</span>
                  <SelectMenu
                    ariaLabel="最近连接显示数量"
                    value={String(recentConnectionsLimit)}
                    options={Array.from({ length: RECENT_CONNECTIONS_MAX_LIMIT - RECENT_CONNECTIONS_MIN_LIMIT + 1 }, (_, index) => {
                      const count = index + RECENT_CONNECTIONS_MIN_LIMIT;
                      return { value: String(count), label: `${count} 个${count === RECENT_CONNECTIONS_DEFAULT_LIMIT ? "（默认）" : ""}` };
                    })}
                    onChange={(value) => onRecentConnectionsLimitChange(Number(value))}
                  />
                </label>

                <div className="settings-section__head">
                  <h3>左侧导航栏</h3>
                  <p>选择要在左侧活动栏显示的入口。设置始终保留。</p>
                </div>
                <div className="settings-card settings-navigation-icons">
                  {NAVIGATION_ICON_OPTIONS.map((option) => {
                    const checked = navigationIcons.includes(option.id);
                    const visibleActivityCount = navigationIcons.filter(
                      (item) => item !== "assistant" && item !== "newLocalTerminal",
                    ).length;
                    const disableLastActivity =
                      checked &&
                      option.id !== "assistant" &&
                      option.id !== "newLocalTerminal" &&
                      visibleActivityCount === 1;
                    return (
                      <label className="checkbox-field" key={option.id}>
                        <input
                          checked={checked}
                          disabled={disableLastActivity}
                          onChange={(event) => {
                            const next = event.currentTarget.checked
                              ? [...navigationIcons, option.id]
                              : navigationIcons.filter((item) => item !== option.id);
                            onNavigationIconsChange(next);
                          }}
                          type="checkbox"
                        />
                        <Icon name={option.icon} height="15" width="15" />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {category === "terminal" ? (
              <section className="settings-section terminal-settings" aria-label="终端设置">
                <div className="settings-section__head">
                  <h3>终端</h3>
                  <p>修改即时生效</p>
                </div>
                <section className="terminal-settings__group" aria-label="终端字体设置">
                  <h4>字体</h4>
                  <SelectMenu
                    ariaLabel="终端字体"
                    className="settings-select-menu"
                    onChange={onFontFamilyChange}
                    options={fontOptions}
                    searchable
                    searchPlaceholder="搜索字体名称"
                    value={fontFamily}
                  />
                  <div className="terminal-settings__metrics">
                    {[
                      { label: "字号", value: `${fontSize}px`, min: fontSize <= FONT_SIZE_MIN, max: fontSize >= FONT_SIZE_MAX,
                        decrease: () => onFontSizeChange(fontSize - 1), increase: () => onFontSizeChange(fontSize + 1),
                        reset: onResetFontSize, isDefault: fontSize === FONT_SIZE_DEFAULT, hint: "字号快捷键和滚轮组合可在快捷键设置中修改。" },
                      { label: "行高", value: lineHeight.toFixed(2), min: lineHeight <= TERMINAL_LINE_HEIGHT_MIN, max: lineHeight >= TERMINAL_LINE_HEIGHT_MAX,
                        decrease: () => onLineHeightStep(-1), increase: () => onLineHeightStep(1),
                        reset: onResetLineHeight, isDefault: lineHeight === TERMINAL_LINE_HEIGHT_DEFAULT, hint: "行高按字号倍数计算。" },
                      { label: "字间距", value: `${letterSpacing}px`, min: letterSpacing <= TERMINAL_LETTER_SPACING_MIN, max: letterSpacing >= TERMINAL_LETTER_SPACING_MAX,
                        decrease: () => onLetterSpacingChange(letterSpacing - 1), increase: () => onLetterSpacingChange(letterSpacing + 1),
                        reset: onResetLetterSpacing, isDefault: letterSpacing === TERMINAL_LETTER_SPACING_DEFAULT, hint: "按整像素增加每个字符格的宽度。" },
                    ].map((metric) => (
                      <div className="terminal-settings__metric" key={metric.label} role="group" aria-label={metric.label}>
                        <span className="settings-field__label" title={metric.hint}>{metric.label}</span>
                        <div className="settings-stepper">
                          <button aria-label={`减小${metric.label}`} className="settings-stepper__button" disabled={metric.min} onClick={metric.decrease} type="button">
                            <Icon name="minimize" height="14" width="14" />
                          </button>
                          <output className="settings-stepper__value">{metric.value}</output>
                          <button aria-label={`增大${metric.label}`} className="settings-stepper__button" disabled={metric.max} onClick={metric.increase} type="button">
                            <Icon name="plus" height="14" width="14" />
                          </button>
                          <Button className="terminal-settings__reset" aria-label={`重置${metric.label}`} title={`重置${metric.label}`} disabled={metric.isDefault} onClick={metric.reset} variant="ghost">
                            <Icon name="refresh" height="14" width="14" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="terminal-settings__group" aria-label="终端交互设置">
                  <h4>交互与渲染</h4>
                  <div className="terminal-settings__toggles">
                    <label className="checkbox-field">
                      <input checked={copyOnSelect} onChange={(event) => onCopyOnSelectChange(event.currentTarget.checked)} type="checkbox" />选中即复制
                    </label>
                    <label className="checkbox-field" title="使用 WebGL 加速，不支持时自动回退。选中文字的抗锯齿效果可能略有不同，可关闭此项。">
                      <input checked={gpuAcceleration} onChange={(event) => onGpuAccelerationChange(event.currentTarget.checked)} type="checkbox" />GPU 加速
                    </label>
                  </div>
                  <label className="terminal-settings__inline-field">
                    <span className="settings-field__label">右键操作</span>
                    <SelectMenu ariaLabel="右键点击" className="settings-select-menu" onChange={(value) => onRightClickChange(value as RightClickAction)} options={RIGHT_CLICK_OPTIONS} value={rightClick} />
                  </label>
                </section>

                <section className="terminal-settings__group" aria-label="命令补全设置">
                  <h4>命令补全</h4>
                  <label className="checkbox-field" title="回车后自动记录命令，所有终端共享。历史仅保存在本机，敏感信息和多行输入不记录。">
                    <input
                      checked={commandCompletion}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        if (!enabled) {
                          setConfirmClearCommandHistory(false);
                          setCommandHistoryCleared(false);
                        }
                        onCommandCompletionChange(enabled);
                      }}
                      type="checkbox"
                    />
                    启用命令补全
                  </label>
                  {commandCompletion ? (
                    <div className="command-history-settings">
                      <p className="command-history-settings__help">所有终端共享 · <kbd>↑</kbd> <kbd>↓</kbd> 选择，<kbd>Tab</kbd> 填入</p>
                      <div className="command-history-settings__row">
                        <div className="command-history-settings__limit" title={`${COMMAND_HISTORY_MIN_LIMIT}–${COMMAND_HISTORY_MAX_LIMIT} 条，默认 ${COMMAND_HISTORY_DEFAULT_LIMIT} 条。降低上限会删除超出的旧记录。`}>
                          <label htmlFor="command-history-limit">历史上限</label>
                          <input
                            id="command-history-limit"
                            className="settings-number"
                            max={COMMAND_HISTORY_MAX_LIMIT}
                            min={COMMAND_HISTORY_MIN_LIMIT}
                            onBlur={commitCommandHistoryLimit}
                            onChange={(event) => setCommandHistoryLimitDraft(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                            }}
                            step="1"
                            type="number"
                            value={commandHistoryLimitDraft}
                          />
                          <span>条</span>
                        </div>
                        <span className="command-history-settings__help" title="重复命令只保留一条，最近输入的排在前面。">已记录 <output className="command-history-settings__count" aria-live="polite">{commandHistoryCount}</output> 条</span>
                        <Button disabled={commandHistoryCount === 0 || confirmClearCommandHistory} onClick={() => {
                          setCommandHistoryCleared(false);
                          setConfirmClearCommandHistory(true);
                        }} variant="ghost">清空历史</Button>
                      </div>
                      {confirmClearCommandHistory ? (
                        <div className="settings-history-clear__confirm" role="group" aria-label="确认清空历史命令">
                          <span>确定清空所有历史命令？此操作无法撤销。</span>
                          <Button autoFocus onClick={() => {
                            clearCommandHistory();
                            setConfirmClearCommandHistory(false);
                            setCommandHistoryCleared(true);
                          }}>确认清空</Button>
                          <Button onClick={() => setConfirmClearCommandHistory(false)} variant="ghost">取消</Button>
                        </div>
                      ) : null}
                      {commandHistoryCleared ? <p className="command-history-settings__help" role="status">历史已清空，之后输入的命令会继续记录。</p> : null}
                    </div>
                  ) : null}
                </section>

                <TerminalColorSettings
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  onCloseGuardChange={(guard) => { terminalDraftGuardRef.current = guard; }}
                />

                <details className="terminal-settings__background">
                  <summary>背景与留白<span>不透明度 {terminalBgOpacity}% · 留白 {terminalWorkspaceInset}px</span></summary>
                  <div className="terminal-settings__background-body">
                    <div className="terminal-settings__ranges">
                      <label className="settings-field" title="调低后透出应用背景；启用磨砂图片且系统支持时透出图片。">
                        <span className="terminal-settings__range-label">背景不透明度<output>{terminalBgOpacity}%</output></span>
                        <input aria-label="背景不透明度" className="settings-range" max={TERMINAL_BG_OPACITY_MAX} min={TERMINAL_BG_OPACITY_MIN} onChange={(event) => onTerminalBgOpacityChange(Number(event.currentTarget.value))} type="range" value={terminalBgOpacity} />
                      </label>
                      <label className="settings-field" title="工作区右侧与底部的留白，不影响文字和滚动位置。">
                        <span className="terminal-settings__range-label">终端边距<output>{terminalWorkspaceInset}px</output></span>
                        <input aria-label="终端边距" className="settings-range" max={TERMINAL_WORKSPACE_INSET_MAX} min={TERMINAL_WORKSPACE_INSET_MIN} onChange={(event) => onTerminalWorkspaceInsetChange(Number(event.currentTarget.value))} type="range" value={terminalWorkspaceInset} />
                      </label>
                    </div>
                    <div className="settings-bg__row">
                      <Button onClick={() => void pickBackgroundImage()}>选择背景图</Button>
                      <span className="settings-bg__path" title={terminalBgImage}>{terminalBgImage.split(/[\\/]/).pop() || "未设置图片"}</span>
                      <Button disabled={!terminalBgImage} onClick={() => onTerminalBgImageChange("")} variant="ghost">清除</Button>
                    </div>
                    <label className="checkbox-field" title="背景图仅以磨砂形式显示；关闭此项或系统不支持时会隐藏图片。">
                      <input checked={terminalBgGlassEnabled} onChange={(event) => onTerminalBgGlassEnabledChange(event.currentTarget.checked)} type="checkbox" />背景图磨砂
                    </label>
                    <label className="settings-field">
                      <span className="terminal-settings__range-label">模糊度<output>{terminalBgGlassBlur}px</output></span>
                      <input aria-label="背景模糊度" className="settings-range" disabled={!terminalBgImage || !terminalBgGlassEnabled} max={TERMINAL_BG_GLASS_BLUR_MAX} min={TERMINAL_BG_GLASS_BLUR_MIN} onChange={(event) => onTerminalBgGlassBlurChange(Number(event.currentTarget.value))} type="range" value={terminalBgGlassBlur} />
                    </label>
                    <p className="settings-field__hint">背景图仅在支持背景模糊的系统上显示。</p>
                  </div>
                </details>
              </section>
            ) : null}

            {category === "editor" ? (
              <section className="settings-section editor-settings" aria-label="文件编辑器设置">
                <div className="settings-section__head">
                  <h3>文件编辑器</h3>
                  <p>修改即时生效</p>
                </div>

                <div className="editor-settings__font-source">
                  <label className="checkbox-field" title="开启后，编辑器会同步使用终端的字体和字号。">
                    <input
                      checked={editorSettings.inheritTerminal}
                      onChange={(event) => editorSettings.setInheritTerminal(event.currentTarget.checked)}
                      type="checkbox"
                    />
                    字体和字号跟随终端
                  </label>
                </div>

                <div className="editor-settings__font-fields">
                  <label className="settings-field">
                    <span className="settings-field__label">字体</span>
                    <SelectMenu
                      ariaLabel="编辑器字体"
                      className="settings-select-menu"
                      disabled={editorSettings.inheritTerminal}
                      onChange={editorSettings.setFontFamily}
                      options={fontOptions}
                      searchable
                      searchPlaceholder="搜索字体名称"
                      value={editorSettings.fontFamily}
                    />
                  </label>
                  <label className="settings-field">
                    <span className="settings-field__label">字号</span>
                    <input
                      aria-label="编辑器字号"
                      className="settings-number"
                      disabled={editorSettings.inheritTerminal}
                      max={FONT_SIZE_MAX}
                      min={FONT_SIZE_MIN}
                      onChange={(event) => editorSettings.setFontSize(Number(event.currentTarget.value))}
                      type="number"
                      value={editorSettings.fontSize}
                    />
                  </label>
                </div>

                <div className="editor-settings__display">
                  <h4>显示与缩进</h4>
                  <div className="editor-settings__toggles">
                    <label className="checkbox-field">
                      <input
                        checked={editorSettings.wordWrap}
                        onChange={(event) => editorSettings.setWordWrap(event.currentTarget.checked)}
                        type="checkbox"
                      />
                      自动换行
                    </label>
                    <label className="checkbox-field">
                      <input
                        checked={editorSettings.lineNumbers}
                        onChange={(event) => editorSettings.setLineNumbers(event.currentTarget.checked)}
                        type="checkbox"
                      />
                      显示行号
                    </label>
                    <label className="checkbox-field">
                      <input
                        checked={editorSettings.minimap}
                        onChange={(event) => editorSettings.setMinimap(event.currentTarget.checked)}
                        type="checkbox"
                      />
                      显示小地图
                    </label>
                  </div>
                  <div className="editor-settings__editing-fields">
                    <label className="settings-field">
                      <span className="settings-field__label">Tab 宽度</span>
                      <input
                        className="settings-number"
                        max={EDITOR_TAB_SIZE_MAX}
                        min={EDITOR_TAB_SIZE_MIN}
                        onChange={(event) => editorSettings.setTabSize(Number(event.currentTarget.value))}
                        type="number"
                        value={editorSettings.tabSize}
                      />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field__label">显示空白字符</span>
                      <SelectMenu
                        ariaLabel="显示空白字符"
                        className="settings-select-menu"
                        onChange={(value) => editorSettings.setRenderWhitespace(value as EditorRenderWhitespace)}
                        options={[
                          { value: "none", label: "不显示" },
                          { value: "selection", label: "仅选中时显示" },
                          { value: "boundary", label: "仅行尾显示" },
                          { value: "all", label: "始终显示" },
                        ]}
                        value={editorSettings.renderWhitespace}
                      />
                    </label>
                  </div>
                </div>
              </section>
            ) : null}

            {category === "shortcuts" ? <ShortcutSettingsSection /> : null}

            {category === "security" ? (
              <AppLockSettings status={appLockStatus} onSave={onAppLockSettingsChange} />
            ) : null}

            {s3NavigationEnabled && category === "s3" ? (
              <section className="settings-section" aria-label="对象存储传输">
                <div className="settings-section__head">
                  <h3>传输并发</h3>
                  <p>上传和递归下载同时进行的文件数。数值越大速度可能越快，但会占用更多网络和系统资源。</p>
                </div>
                <div className="form-grid">
                  <label className="settings-field">
                    <span className="settings-field__label">并行上传数</span>
                    <input
                      className="settings-number"
                      max={S3_TRANSFER_CONCURRENCY_MAX}
                      min={S3_TRANSFER_CONCURRENCY_MIN}
                      onChange={(event) => onS3UploadConcurrencyChange(Number(event.currentTarget.value))}
                      type="number"
                      value={s3UploadConcurrency}
                    />
                  </label>
                  <label className="settings-field">
                    <span className="settings-field__label">并行下载数</span>
                    <input
                      className="settings-number"
                      max={S3_TRANSFER_CONCURRENCY_MAX}
                      min={S3_TRANSFER_CONCURRENCY_MIN}
                      onChange={(event) => onS3DownloadConcurrencyChange(Number(event.currentTarget.value))}
                      type="number"
                      value={s3DownloadConcurrency}
                    />
                  </label>
                </div>
              </section>
            ) : null}

            {aiNavigationEnabled && category === "ai" ? <AiSettingsSection aiConfig={aiConfig} /> : null}

            {category === "config" ? (
              <section className="settings-section" aria-label="配置文件">
                <div className="settings-section__head">
                  <h3>配置文件</h3>
                  <p>
                    下方为脱敏预览，密码与密钥已隐藏（显示为 ******）。导出会用密码加密为单个文件，
                    导入时需输入同一密码解密。复制的也是脱敏内容。
                  </p>
                </div>
                <div className="settings-config__actions">
                  <Button disabled={isBusy} onClick={handleImport} variant="primary">
                    导入
                  </Button>
                  <Button disabled={isBusy} onClick={handleExport} variant="ghost">
                    加密导出
                  </Button>
                  <Button disabled={isBusy || !yamlText} onClick={handleCopy} variant="ghost">
                    复制
                  </Button>
                  <Button disabled={isBusy} onClick={loadYaml} variant="ghost">
                    刷新
                  </Button>
                </div>
                {configError ? (
                  <div className="settings-config__error" role="alert">
                    {configError}
                  </div>
                ) : null}
                {configMessage ? (
                  <div className="settings-config__message">{configMessage}</div>
                ) : null}
                <textarea
                  aria-label="配置 YAML"
                  className="settings-config__text"
                  readOnly
                  spellCheck={false}
                  value={yamlText}
                />
              </section>
            ) : null}

            {category === "about" ? <AboutSection /> : null}
          </div>
        </div>
      </section>
      {passwordMode ? (
        <ConfigPasswordDialog
          busy={dialogBusy}
          error={dialogError}
          mode={passwordMode}
          onCancel={closePasswordDialog}
          onSubmit={(password) =>
            passwordMode === "export"
              ? void performEncryptedExport(password)
              : void performEncryptedImport(password)
          }
        />
      ) : null}
    </div>
  );
}
