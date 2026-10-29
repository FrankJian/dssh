import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TERMINAL_SCHEME_ID } from "../terminal/themes/presets";
import { toXtermTheme } from "../terminal/themes/resolve";
import type { CustomTerminalScheme, TerminalColorField, TerminalColors, TerminalThemeKind } from "../terminal/themes/types";
import { Button } from "../ui/Button";
import { SelectMenu, type SelectMenuOption } from "../ui/SelectMenu";
import {
  cloneColors,
  contrastRatio,
  deleteCustomTerminalScheme,
  getActiveTerminalScheme,
  getTerminalAppearanceKind,
  getTerminalSchemes,
  normalizeTerminalColorInput,
  resetInvalidTerminalThemeStorage,
  restoreDefaultTerminalScheme,
  saveCustomTerminalScheme,
  selectTerminalScheme,
  setTerminalThemeFollowAppearance,
} from "./terminalThemeStore";
import { useTerminalTheme } from "./useTerminalTheme";
import "@xterm/xterm/css/xterm.css";

interface TerminalColorSettingsProps {
  fontFamily: string;
  fontSize: number;
  onCloseGuardChange?: (guard: () => boolean) => void;
}

interface SchemeDraft {
  id?: string;
  name: string;
  kind: TerminalThemeKind;
  sourcePresetId: string;
  baseColors: TerminalColors;
  colors: TerminalColors;
  initialName: string;
  initialKind: TerminalThemeKind;
  initialColors: TerminalColors;
}

const basicFields: Array<{ field: TerminalColorField; label: string }> = [
  { field: "foreground", label: "默认文字" },
  { field: "background", label: "背景" },
  { field: "cursor", label: "光标" },
  { field: "cursorAccent", label: "块光标文字" },
  { field: "selectionBackground", label: "选区背景" },
  { field: "selectionInactiveBackground", label: "非活动选区" },
  { field: "selectionForeground", label: "选中文字" },
];

const ansiFields: Array<{ field: TerminalColorField; label: string }> = [
  { field: "black", label: "黑" }, { field: "red", label: "红" },
  { field: "green", label: "绿" }, { field: "yellow", label: "黄" },
  { field: "blue", label: "蓝" }, { field: "magenta", label: "品红" },
  { field: "cyan", label: "青" }, { field: "white", label: "白" },
  { field: "brightBlack", label: "亮黑" }, { field: "brightRed", label: "亮红" },
  { field: "brightGreen", label: "亮绿" }, { field: "brightYellow", label: "亮黄" },
  { field: "brightBlue", label: "亮蓝" }, { field: "brightMagenta", label: "亮品红" },
  { field: "brightCyan", label: "亮青" }, { field: "brightWhite", label: "亮白" },
];

function isDirty(draft: SchemeDraft) {
  return draft.name !== draft.initialName || draft.kind !== draft.initialKind || JSON.stringify(draft.colors) !== JSON.stringify(draft.initialColors);
}

function confirmDiscard(draft: SchemeDraft | null) {
  return !draft || !isDirty(draft) || window.confirm("放弃未保存的配色修改？");
}

export function TerminalColorSettings({ fontFamily, fontSize, onCloseGuardChange }: TerminalColorSettingsProps) {
  const store = useTerminalTheme();
  const schemes = getTerminalSchemes(store.preferences);
  const appearanceKind = getTerminalAppearanceKind();
  const active = getActiveTerminalScheme(store.preferences);
  const [draft, setDraft] = useState<SchemeDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(() => new Set());
  const [editorError, setEditorError] = useState<string | null>(null);
  const previewColors = draft?.colors ?? active.colors;
  const schemeOptions = useMemo<SelectMenuOption[]>(() => {
    const visible = store.preferences.followAppearance
      ? schemes.filter((scheme) => scheme.kind === appearanceKind)
      : schemes;
    return [
      ...visible.filter((scheme) => "id" in scheme && scheme.id.startsWith("builtin:")).map((scheme) => ({ value: scheme.id, label: `内置 · ${scheme.name} · ${scheme.kind === "dark" ? "深色" : "浅色"}` })),
      ...visible.filter((scheme) => "sourcePresetId" in scheme).map((scheme) => ({ value: scheme.id, label: `自定义 · ${scheme.name} · ${scheme.kind === "dark" ? "深色" : "浅色"}` })),
    ];
  }, [appearanceKind, schemes, store.preferences.followAppearance]);

  useEffect(() => {
    onCloseGuardChange?.(() => confirmDiscard(draft));
    return () => onCloseGuardChange?.(() => true);
  }, [draft, onCloseGuardChange]);

  function startDraft(schemeId: string, copy: boolean) {
    const source = schemes.find((scheme) => scheme.id === schemeId);
    if (!source) return;
    if (!confirmDiscard(draft)) return;
    const colors = cloneColors(source.colors);
    const custom = !copy && "sourcePresetId" in source ? source as CustomTerminalScheme : null;
    const requestedName = `${source.name} 自定义`;
    const existingNames = new Set(store.preferences.customSchemes.map((scheme) => scheme.name.toLocaleLowerCase()));
    let copyName = requestedName;
    let suffix = 2;
    while (copy && existingNames.has(copyName.toLocaleLowerCase())) copyName = `${requestedName} ${suffix++}`;
    setDraft({
      ...(custom ? { id: custom.id } : {}),
      name: copy ? copyName : source.name,
      kind: source.kind,
      sourcePresetId: custom?.sourcePresetId ?? source.id,
      baseColors: custom ? cloneColors(custom.baseColors) : cloneColors(colors),
      colors,
      initialName: copy ? copyName : source.name,
      initialKind: source.kind,
      initialColors: cloneColors(colors),
    });
    setDraftError(null);
    setInvalidFields(new Set());
  }

  function handleSelectScheme(id: string) {
    if (!confirmDiscard(draft)) return;
    setDraft(null);
    setDraftError(null);
    setInvalidFields(new Set());
    try {
      selectTerminalScheme(id);
      setEditorError(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    }
  }

  function cancelDraft() {
    if (!confirmDiscard(draft)) return;
    setDraft(null);
    setDraftError(null);
    setInvalidFields(new Set());
  }

  function saveDraft() {
    if (!draft || invalidFields.size > 0) return;
    try {
      saveCustomTerminalScheme({
        id: draft.id,
        name: draft.name,
        kind: draft.kind,
        sourcePresetId: draft.sourcePresetId,
        baseColors: draft.baseColors,
        colors: draft.colors,
      });
      setDraft(null);
      setDraftError(null);
      setInvalidFields(new Set());
      setEditorError(null);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    }
  }

  function deleteActiveScheme() {
    if (!("sourcePresetId" in active)) return;
    if (!window.confirm(`删除自定义配色“${active.name}”？此操作无法撤销。`)) return;
    try {
      deleteCustomTerminalScheme(active.id);
      setEditorError(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    }
  }

  function resetColorsToBase() {
    if (!draft) return;
    setDraft({ ...draft, colors: cloneColors(draft.baseColors) });
    setInvalidFields(new Set());
  }

  function updateColor(field: TerminalColorField, value: string | null) {
    setDraft((current) => current ? { ...current, colors: { ...current.colors, [field]: value } } : null);
  }

  return (
    <section aria-label="终端配色方案" className="settings-section terminal-color-settings">
      <div className="settings-section__head">
        <h3>配色方案</h3>
      </div>
      <label className="checkbox-field terminal-color-settings__follow" title="开启后仅显示与应用深浅外观一致的方案，关闭后可固定使用任意配色。">
        <input
          checked={store.preferences.followAppearance}
          onChange={(event) => {
            try {
              setTerminalThemeFollowAppearance(event.currentTarget.checked);
              setEditorError(null);
            } catch (error) {
              setEditorError(error instanceof Error ? error.message : String(error));
            }
          }}
          type="checkbox"
        />
        跟随应用外观
      </label>
      <div className="terminal-color-settings__selector">
        <div className="terminal-color-settings__swatches" aria-hidden="true">
          {[active.colors.background, active.colors.foreground, active.colors.red, active.colors.green, active.colors.blue].map((color, index) => (
            <span key={`${color}-${index}`} style={{ backgroundColor: color }} />
          ))}
        </div>
        <SelectMenu
          ariaLabel="终端配色方案"
          className="settings-select-menu"
          onChange={handleSelectScheme}
          options={schemeOptions}
          value={active.id}
        />
      </div>
      <div className="terminal-color-settings__actions">
        <Button
          disabled={active.id === (appearanceKind === "light" ? "builtin:graphite-light" : DEFAULT_TERMINAL_SCHEME_ID)}
          onClick={() => {
            if (!confirmDiscard(draft)) return;
            setDraft(null);
            try {
              restoreDefaultTerminalScheme();
              setEditorError(null);
            } catch (error) {
              setEditorError(error instanceof Error ? error.message : String(error));
            }
          }}
          variant="ghost"
        >
          恢复默认
        </Button>
        {"sourcePresetId" in active ? (
          <>
            <Button onClick={() => startDraft(active.id, false)} variant="secondary">编辑</Button>
            <Button onClick={() => startDraft(active.id, true)} variant="ghost">复制并编辑</Button>
            <Button onClick={deleteActiveScheme} variant="ghost">删除</Button>
          </>
        ) : (
          <Button onClick={() => startDraft(active.id, true)} variant="secondary">复制并编辑</Button>
        )}
      </div>

      {store.storageError ? (
        <div className="terminal-color-settings__error" role="alert">
          <span>{store.storageError}</span>
          <Button
            onClick={() => {
              if (!window.confirm("重置后将删除无法读取的配色记录，恢复 Graphite Dark。是否继续？")) return;
              try {
                resetInvalidTerminalThemeStorage();
                setEditorError(null);
              } catch (error) {
                setEditorError(error instanceof Error ? error.message : String(error));
              }
            }}
            variant="ghost"
          >
            重置存储
          </Button>
        </div>
      ) : null}
      {editorError ? <div className="terminal-color-settings__error" role="alert">{editorError}</div> : null}

      <details className="terminal-color-settings__preview" open={draft ? true : undefined}>
        <summary>配色预览</summary>
        <div
        aria-label="终端配色预览"
        className="terminal-color-preview"
        style={{ height: `${Math.max(142, fontSize * 12 + 12)}px` }}
      >
        <TerminalColorPreview colors={previewColors} fontFamily={fontFamily} fontSize={fontSize} />
        </div>
        <p className="settings-field__hint" title="默认文字色不覆盖程序指定的 ANSI 色或真彩色。背景透明度与壁纸由背景设置控制。">预览使用不透明背景，不影响程序自定义颜色。</p>
      </details>

      {draft ? (
        <div className="terminal-color-editor">
          <div className="settings-section__head">
            <h3>{draft.id ? "编辑自定义配色" : "新建自定义配色"}</h3>
            <p>修改仅在预览中生效，保存后应用到现有终端。</p>
          </div>
          <label className="settings-field">
            <span className="settings-field__label">方案名称</span>
            <input
              className="settings-number"
              maxLength={40}
              onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              value={draft.name}
            />
          </label>
          <label className="settings-field">
            <span className="settings-field__label">方案类型</span>
            <select
              className="settings-number"
              onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value as TerminalThemeKind })}
              value={draft.kind}
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <div className="terminal-color-editor__fields">
            {basicFields.map(({ field, label }) => (
              <ColorField
                field={field}
                key={field}
                label={label}
                onChange={updateColor}
                onValidityChange={(invalid) => setInvalidFields((current) => {
                  const next = new Set(current);
                  if (invalid) next.add(field);
                  else next.delete(field);
                  return next;
                })}
                value={draft.colors[field]}
                fallbackColor={draft.colors.foreground}
                defaultValue={draft.baseColors[field]}
                onReset={() => updateColor(field, draft.baseColors[field])}
              />
            ))}
          </div>
          <details className="terminal-color-editor__ansi">
            <summary>ANSI 16 色</summary>
            <div className="terminal-color-editor__fields">
              {ansiFields.map(({ field, label }) => (
                <ColorField
                  field={field}
                  key={field}
                  label={label}
                  onChange={updateColor}
                  onValidityChange={(invalid) => setInvalidFields((current) => {
                    const next = new Set(current);
                    if (invalid) next.add(field);
                    else next.delete(field);
                    return next;
                  })}
                  value={draft.colors[field]}
                  defaultValue={draft.baseColors[field]}
                  onReset={() => updateColor(field, draft.baseColors[field])}
                />
              ))}
            </div>
          </details>
          {contrastRatio(draft.colors.foreground, draft.colors.background) < 4.5 ? (
            <p className="terminal-color-settings__warning" role="status">
              默认文字与不透明背景的对比度低于 4.5:1；透明背景或壁纸下实际对比度还会变化。
            </p>
          ) : null}
          <p className="settings-field__hint">选区颜色会影响 WebGL 下所选文字的抗锯齿观感，请同时检查 GPU 开关两种状态。</p>
          {draftError ? <div className="terminal-color-settings__error" role="alert">{draftError}</div> : null}
          <div className="terminal-color-settings__actions">
            <Button onClick={resetColorsToBase} variant="ghost">恢复副本初始颜色</Button>
            <span className="terminal-color-settings__spacer" />
            <Button onClick={cancelDraft} variant="secondary">取消</Button>
            <Button disabled={invalidFields.size > 0} onClick={saveDraft} variant="primary">保存并应用</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ColorField({
  field,
  label,
  value,
  fallbackColor,
  defaultValue,
  onChange,
  onReset,
  onValidityChange,
}: {
  field: TerminalColorField;
  label: string;
  value: string | null;
  fallbackColor?: string;
  defaultValue: string | null;
  onChange: (field: TerminalColorField, value: string | null) => void;
  onReset: () => void;
  onValidityChange: (invalid: boolean) => void;
}) {
  const nullable = field === "selectionForeground";
  const [text, setText] = useState(value ?? "");
  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  function updateText(next: string) {
    setText(next);
    const normalized = normalizeTerminalColorInput(next);
    onValidityChange(normalized === null);
    if (normalized) onChange(field, normalized);
  }

  return (
    <div className="terminal-color-field">
      <span className="terminal-color-field__label">{label}</span>
      {nullable ? (
        <label className="terminal-color-field__inherit">
          <input
            checked={value === null}
            onChange={(event) => {
              onValidityChange(false);
              onChange(field, event.currentTarget.checked ? null : fallbackColor ?? "#ffffff");
            }}
            type="checkbox"
          />
          保留原色
        </label>
      ) : null}
      <div className="terminal-color-field__inputs">
        <input
          aria-label={`${label}颜色选择器`}
          disabled={nullable && value === null}
          onChange={(event) => {
            setText(event.currentTarget.value);
            onValidityChange(false);
            onChange(field, event.currentTarget.value);
          }}
          type="color"
          value={value ?? fallbackColor ?? "#ffffff"}
        />
        <input
          aria-label={`${label} HEX 色值`}
          aria-invalid={!(nullable && value === null) && normalizeTerminalColorInput(text) === null}
          className="settings-number"
          disabled={nullable && value === null}
          maxLength={7}
          onBlur={() => {
            const normalized = normalizeTerminalColorInput(text);
            if (normalized) setText(normalized);
            else setText(value ?? "");
            onValidityChange(false);
          }}
          onChange={(event) => updateText(event.currentTarget.value)}
          placeholder="#RRGGBB"
          spellCheck={false}
          value={text}
        />
      </div>
      <button
        className="terminal-color-field__reset"
        disabled={value === defaultValue}
        onClick={onReset}
        type="button"
      >
        恢复副本初始值
      </button>
      {!(nullable && value === null) && normalizeTerminalColorInput(text) === null ? <span className="terminal-color-field__error">请输入 #RGB 或 #RRGGBB</span> : null}
    </div>
  );
}

function TerminalColorPreview({
  colors,
  fontFamily,
  fontSize,
}: {
  colors: TerminalColors;
  fontFamily: string;
  fontSize: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      allowTransparency: false,
      cursorBlink: false,
      cursorStyle: "block",
      disableStdin: true,
      fontFamily,
      fontSize,
      rows: 10,
      scrollback: 0,
      theme: toXtermTheme(colors, false),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    const standardForeground = Array.from({ length: 8 }, (_, index) =>
      `\x1b[${30 + index}m ${index.toString(16)} \x1b[0m`,
    ).join("");
    const brightForeground = Array.from({ length: 8 }, (_, index) =>
      `\x1b[${90 + index}m ${(index + 8).toString(16)} \x1b[0m`,
    ).join("");
    const standardBackground = Array.from({ length: 8 }, (_, index) =>
      `\x1b[${40 + index}m  \x1b[0m`,
    ).join("");
    const brightBackground = Array.from({ length: 8 }, (_, index) =>
      `\x1b[${100 + index}m  \x1b[0m`,
    ).join("");
    terminal.write(
      "\x1b[1mTerminal preview\x1b[0m\r\n" +
      "普通文本 0123456789  \x1b[1m粗体 Bold\x1b[0m\r\n" +
      `ANSI 前景 0–7  ${standardForeground}\r\n` +
      `ANSI 前景 8–15 ${brightForeground}\r\n` +
      `ANSI 背景 0–7  ${standardBackground}\r\n` +
      `ANSI 背景 8–15 ${brightBackground}\r\n` +
      "\x1b[7m选区示例 Selected text\x1b[27m\r\n" +
      "灰阶 \x1b[38;5;244m████\x1b[0m  真彩色 \x1b[38;2;100;180;230mRGB sample\x1b[0m\r\n" +
      "光标位于此处 ▌",
      () => terminal.select(0, 6, 8),
    );
    terminalRef.current = terminal;
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(container);
    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
  };
  }, [fontFamily, fontSize]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = toXtermTheme(colors, false);
  }, [colors]);

  return <div className="terminal-color-preview__surface" ref={containerRef} />;
}
