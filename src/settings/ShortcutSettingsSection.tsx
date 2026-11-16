import { useEffect, useState } from "react";
import {
  bindingFromKeyboardEvent,
  bindingFromWheelEvent,
  findShortcutConflict,
  formatShortcut,
  getShortcutBindings,
  getShortcutDefinitions,
  resetAllShortcutBindings,
  resetShortcutBinding,
  setShortcutBinding,
  shortcutDisplayParts,
  type ShortcutBinding,
  type ShortcutDefinition,
  type ShortcutId,
} from "../app/shortcuts";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

function ShortcutRecorder({
  binding,
  definition,
  recording,
  onChange,
  onStart,
  onStop,
}: {
  binding: ShortcutBinding;
  definition: ShortcutDefinition;
  recording: boolean;
  onChange: (binding: ShortcutBinding) => void;
  onStart: () => void;
  onStop: () => void;
}) {
  useEffect(() => {
    if (!recording) return;

    const record = (next: ShortcutBinding) => {
      onChange(next);
      onStop();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (definition.input !== "key") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = bindingFromKeyboardEvent(event);
      if (next) record(next);
    };
    const handleWheel = (event: WheelEvent) => {
      if (definition.input !== "wheel") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      record(bindingFromWheelEvent(event));
    };

    // Capture at the window boundary. This prevents a command such as ⌘K from
    // opening the command palette while it is being recorded, and works even
    // if the webview does not retain button focus after a click.
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("wheel", handleWheel, true);
    };
  }, [definition.input, onChange, onStop, recording]);

  return (
    <button
      aria-label={`修改快捷键：${definition.label}，当前 ${formatShortcut(binding)}`}
      className={`shortcut-recorder${recording ? " is-recording" : ""}`}
      onClick={onStart}
      title={recording
        ? definition.input === "wheel" ? "按住组合键并滚动鼠标滚轮" : "请按下新的快捷键组合"
        : `当前：${formatShortcut(binding)}，点击修改`}
      type="button"
    >
      {recording
        ? definition.input === "wheel" ? "滚动录入…" : "请按下组合键…"
        : (
          <span className="shortcut-recorder__keys">
            {shortcutDisplayParts(binding).map((key, index) => (
              <kbd className="shortcut-recorder__key" key={`${key}-${index}`}>{key}</kbd>
            ))}
          </span>
        )}
    </button>
  );
}

const categoryColumns = [
  ["全局", "工作区"],
  ["分屏", "终端"],
] as const;

export function ShortcutSettingsSection() {
  const [bindings, setBindings] = useState(getShortcutBindings);
  const [message, setMessage] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const definitions = getShortcutDefinitions();

  function updateBinding(id: ShortcutId, binding: ShortcutBinding) {
    const conflict = findShortcutConflict(id, binding, bindings);
    if (conflict) {
      setMessage(`“${formatShortcut(binding)}” 已用于“${conflict.label}”。`);
      return;
    }
    setShortcutBinding(id, binding);
    setBindings(getShortcutBindings());
    setMessage(null);
  }

  function resetBinding(id: ShortcutId) {
    resetShortcutBinding(id);
    setBindings(getShortcutBindings());
    setRecordingId(null);
    setMessage(null);
  }

  function resetAll() {
    resetAllShortcutBindings();
    setBindings(getShortcutBindings());
    setRecordingId(null);
    setMessage(null);
  }

  return (
    <section className="settings-section" aria-label="快捷键设置">
      <div className="settings-section__head shortcuts-section__head">
        <h3>快捷键</h3>
        <Button onClick={resetAll} title="恢复全部默认快捷键" variant="ghost">
          <Icon name="refresh" height="14" width="14" />
          <span>恢复默认</span>
        </Button>
      </div>
      {message ? <p className="shortcut-settings__message" role="status">{message}</p> : null}

      <div className="shortcuts-section__groups">
        {categoryColumns.map((categories) => (
          <div className="shortcuts-section__column" key={categories[0]}>
            {categories.map((category) => {
              const items = definitions.filter((definition) => definition.category === category);
              return (
                <div className="shortcut-group" key={category}>
                  <h4>{category}</h4>
                  <div>
                    {items.map((definition) => {
                      const binding = bindings[definition.id];
                      return (
                        <div className="shortcut-row" key={definition.id}>
                          <span className="shortcut-row__label" title={definition.description}>{definition.label}</span>
                          <div className="shortcut-row__actions">
                            <ShortcutRecorder
                              binding={binding}
                              definition={definition}
                              recording={recordingId === definition.id}
                              onChange={(next) => updateBinding(definition.id, next)}
                              onStart={() => setRecordingId(definition.id)}
                              onStop={() => setRecordingId(null)}
                            />
                            <button
                              aria-label={`恢复默认快捷键：${definition.label}`}
                              className="shortcut-reset"
                              onClick={() => resetBinding(definition.id)}
                              title="恢复默认快捷键"
                              type="button"
                            >
                              <Icon name="refresh" height="13" width="13" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
