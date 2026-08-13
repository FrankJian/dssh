import { open, save } from "@tauri-apps/plugin-dialog";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiSettingsSection } from "../ai/AiSettingsSection";
import type { AiConfig } from "../ai/useAiConfig";
import { AboutSection } from "./AboutSection";
import { ConfigPasswordDialog } from "./ConfigPasswordDialog";
import { ShortcutSettingsSection } from "./ShortcutSettingsSection";
import type { EditorSettings } from "./useEditorSettings";
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
  TERMINAL_LINE_HEIGHT_STEP,
  TERMINAL_WORKSPACE_INSET_MAX,
  TERMINAL_WORKSPACE_INSET_MIN,
  type EditorRenderWhitespace,
  type FontFamilyOption,
  type RightClickAction,
  systemFontFamilyValue,
} from "./settings";

export type SettingsCategory = "appearance" | "terminal" | "editor" | "shortcuts" | "s3" | "ai" | "config" | "about";

interface SettingsDialogProps {
  aiConfig: AiConfig;
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

const categories: Array<{
  id: SettingsCategory;
  label: string;
  icon: "sun" | "monitor" | "fileCode" | "command" | "bucket" | "file" | "bot" | "info";
}> = [
  { icon: "sun", id: "appearance", label: "外观" },
  { icon: "monitor", id: "terminal", label: "终端" },
  { icon: "fileCode", id: "editor", label: "文件编辑器" },
  { icon: "command", id: "shortcuts", label: "快捷键" },
  { icon: "bucket", id: "s3", label: "对象存储" },
  { icon: "bot", id: "ai", label: "AI" },
  { icon: "file", id: "config", label: "配置文件" },
  { icon: "info", id: "about", label: "关于" },
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
  aiConfig,
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
  onFontFamilyChange,
  onFontSizeChange,
  onLetterSpacingChange,
  onLineHeightChange,
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
  const visibleCategories = categories.filter(
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
  const fontOptions = useMemo(
    () => buildFontOptions(systemFontFamilies, [fontFamily, editorSettings.fontFamily]),
    [editorSettings.fontFamily, fontFamily, systemFontFamilies],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
            onClick={onClose}
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
                onClick={() => setCategory(item.id)}
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
              <section className="settings-section" aria-label="终端字体">
                <div className="settings-section__head">
                  <h3>字体大小</h3>
                  <p>终端内的字号快捷键和鼠标滚轮组合可在“快捷键”设置中修改。</p>
                </div>
                <div className="settings-stepper">
                  <button
                    aria-label="减小字体"
                    className="settings-stepper__button"
                    disabled={fontSize <= FONT_SIZE_MIN}
                    onClick={() => onFontSizeChange(fontSize - 1)}
                    type="button"
                  >
                    <Icon name="minimize" height="16" width="16" />
                  </button>
                  <span className="settings-stepper__value">{fontSize}px</span>
                  <button
                    aria-label="增大字体"
                    className="settings-stepper__button"
                    disabled={fontSize >= FONT_SIZE_MAX}
                    onClick={() => onFontSizeChange(fontSize + 1)}
                    type="button"
                  >
                    <Icon name="plus" height="16" width="16" />
                  </button>
                  <Button
                    className="settings-stepper__reset"
                    disabled={fontSize === FONT_SIZE_DEFAULT}
                    onClick={onResetFontSize}
                    variant="ghost"
                  >
                    重置
                  </Button>
                </div>

                <div className="settings-section__head">
                  <h3>字体样式</h3>
                  <p>选择终端字体；已安装的系统字体会自动显示，建议使用等宽字体。</p>
                </div>
                <SelectMenu
                  ariaLabel="终端字体"
                  className="settings-select-menu"
                  onChange={onFontFamilyChange}
                  options={fontOptions}
                  searchable
                  searchPlaceholder="搜索字体名称"
                  value={fontFamily}
                />

                <div className="settings-section__head">
                  <h3>字符间距</h3>
                  <p>行高按字号倍数计算，字间距按整像素加到每个字符格上；调大可让紧凑的等宽字体更易读。</p>
                </div>
                <div className="settings-stepper">
                  <span className="settings-stepper__label">行高</span>
                  <button
                    aria-label="减小行高"
                    className="settings-stepper__button"
                    disabled={lineHeight <= TERMINAL_LINE_HEIGHT_MIN}
                    onClick={() => onLineHeightStep(-1)}
                    type="button"
                  >
                    <Icon name="minimize" height="16" width="16" />
                  </button>
                  <span className="settings-stepper__value">{lineHeight.toFixed(2)}</span>
                  <button
                    aria-label="增大行高"
                    className="settings-stepper__button"
                    disabled={lineHeight >= TERMINAL_LINE_HEIGHT_MAX}
                    onClick={() => onLineHeightStep(1)}
                    type="button"
                  >
                    <Icon name="plus" height="16" width="16" />
                  </button>
                  <input
                    aria-label="终端行高"
                    className="settings-range"
                    max={TERMINAL_LINE_HEIGHT_MAX}
                    min={TERMINAL_LINE_HEIGHT_MIN}
                    onChange={(event) => onLineHeightChange(Number(event.currentTarget.value))}
                    step={TERMINAL_LINE_HEIGHT_STEP}
                    type="range"
                    value={lineHeight}
                  />
                  <Button
                    className="settings-stepper__reset"
                    disabled={lineHeight === TERMINAL_LINE_HEIGHT_DEFAULT}
                    onClick={onResetLineHeight}
                    variant="ghost"
                  >
                    重置
                  </Button>
                </div>
                <div className="settings-stepper">
                  <span className="settings-stepper__label">字间距</span>
                  <button
                    aria-label="减小字间距"
                    className="settings-stepper__button"
                    disabled={letterSpacing <= TERMINAL_LETTER_SPACING_MIN}
                    onClick={() => onLetterSpacingChange(letterSpacing - 1)}
                    type="button"
                  >
                    <Icon name="minimize" height="16" width="16" />
                  </button>
                  <span className="settings-stepper__value">{letterSpacing}px</span>
                  <button
                    aria-label="增大字间距"
                    className="settings-stepper__button"
                    disabled={letterSpacing >= TERMINAL_LETTER_SPACING_MAX}
                    onClick={() => onLetterSpacingChange(letterSpacing + 1)}
                    type="button"
                  >
                    <Icon name="plus" height="16" width="16" />
                  </button>
                  <Button
                    className="settings-stepper__reset"
                    disabled={letterSpacing === TERMINAL_LETTER_SPACING_DEFAULT}
                    onClick={onResetLetterSpacing}
                    variant="ghost"
                  >
                    重置
                  </Button>
                </div>

                <div className="settings-section__head">
                  <h3>鼠标</h3>
                  <p>配置终端中的右键行为与选中复制。</p>
                </div>
                <label className="settings-field">
                  <span className="settings-field__label">右键点击</span>
                  <SelectMenu
                    ariaLabel="右键点击"
                    className="settings-select-menu"
                    onChange={(value) => onRightClickChange(value as RightClickAction)}
                    options={RIGHT_CLICK_OPTIONS}
                    value={rightClick}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    checked={copyOnSelect}
                    onChange={(event) => onCopyOnSelectChange(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  选中时复制
                </label>

                <div className="settings-section__head">
                  <h3>渲染</h3>
                  <p>
                    使用 GPU（WebGL）加速终端渲染，大量输出时更流畅。若显卡或环境不支持会自动回退到普通渲染。
                  </p>
                  <p>
                    注意：GPU 渲染会把背景色烘焙进字形纹理，因此<strong>选中的文字</strong>
                    会按选中色重新抗锯齿，字重看起来可能与未选中时略有差异。若对此敏感，关闭本项即可完全一致（代价是大量输出时略慢）。
                  </p>
                </div>
                <label className="checkbox-field">
                  <input
                    checked={gpuAcceleration}
                    onChange={(event) => onGpuAccelerationChange(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  启用 GPU 渲染加速
                </label>


                <div className="settings-section__head">
                  <h3>终端背景</h3>
                  <p>
                    调低不透明度可让终端背景变通透：启用背景图磨砂且系统支持时透出图片，否则透出应用背景。
                    （窗口对桌面的整体透明需要系统级窗口透明，暂未开启。）
                  </p>
                  <p>
                    背景图只以磨砂玻璃形式显示；关闭磨砂开关或当前系统 WebView 不支持背景模糊时，将自动隐藏图片并保留普通终端背景。
                  </p>
                </div>
                <label className="settings-field">
                  <span className="settings-field__label">
                    背景不透明度：{terminalBgOpacity}%
                    {terminalBgOpacity === 100 ? "（不透明）" : ""}
                  </span>
                  <input
                    className="settings-range"
                    max={TERMINAL_BG_OPACITY_MAX}
                    min={TERMINAL_BG_OPACITY_MIN}
                    onChange={(event) => onTerminalBgOpacityChange(Number(event.currentTarget.value))}
                    type="range"
                    value={terminalBgOpacity}
                  />
                </label>
                <div className="settings-bg">
                  <div className="settings-bg__row">
                    <Button onClick={() => void pickBackgroundImage()} variant="ghost">
                      选择图片
                    </Button>
                    <Button
                      disabled={!terminalBgImage}
                      onClick={() => onTerminalBgImageChange("")}
                      variant="ghost"
                    >
                      清除
                    </Button>
                    <span className="settings-bg__path" title={terminalBgImage}>
                      {terminalBgImage || "未设置"}
                    </span>
                  </div>
                  <label className="checkbox-field">
                    <input
                      checked={terminalBgGlassEnabled}
                      onChange={(event) => onTerminalBgGlassEnabledChange(event.currentTarget.checked)}
                      type="checkbox"
                    />
                    启用背景图磨砂玻璃
                  </label>
                  <label className="settings-field">
                    <span className="settings-field__label">
                      磨砂模糊度：{terminalBgGlassBlur}px
                    </span>
                    <input
                      className="settings-range"
                      disabled={!terminalBgImage || !terminalBgGlassEnabled}
                      max={TERMINAL_BG_GLASS_BLUR_MAX}
                      min={TERMINAL_BG_GLASS_BLUR_MIN}
                      onChange={(event) => onTerminalBgGlassBlurChange(Number(event.currentTarget.value))}
                      type="range"
                      value={terminalBgGlassBlur}
                    />
                  </label>
                </div>

                <div className="settings-section__head">
                  <h3>终端边距</h3>
                  <p>控制终端工作区右侧和底部的留白，不影响终端内文字与滚动位置。</p>
                </div>
                <label className="settings-field">
                  <span className="settings-field__label">
                    右侧与底部留白：{terminalWorkspaceInset}px
                  </span>
                  <input
                    className="settings-range"
                    max={TERMINAL_WORKSPACE_INSET_MAX}
                    min={TERMINAL_WORKSPACE_INSET_MIN}
                    onChange={(event) => onTerminalWorkspaceInsetChange(Number(event.currentTarget.value))}
                    type="range"
                    value={terminalWorkspaceInset}
                  />
                </label>

              </section>
            ) : null}

            {category === "editor" ? (
              <section className="settings-section" aria-label="文件编辑器设置">
                <div className="settings-section__head">
                  <h3>文件编辑器</h3>
                  <p>这些设置会立即应用到远程文件列表中的代码编辑器。</p>
                </div>

                <div className="settings-card">
                  <label className="checkbox-field">
                    <input
                      checked={editorSettings.inheritTerminal}
                      onChange={(event) => editorSettings.setInheritTerminal(event.currentTarget.checked)}
                      type="checkbox"
                    />
                    继承终端字体与字号
                  </label>
                  <p className="settings-card__hint">
                    开启后，终端的字体样式和大小变更会同步到文件编辑器。
                  </p>
                </div>

                <div className="form-grid">
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

                <div className="settings-section__head">
                  <h3>显示与编辑</h3>
                  <p>仅影响文件编辑器，不改变终端行为。</p>
                </div>
                <div className="settings-card settings-card--fields">
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
              </section>
            ) : null}

            {category === "shortcuts" ? <ShortcutSettingsSection /> : null}

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
