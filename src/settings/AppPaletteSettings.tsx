import { useEffect, useState } from "react";
import { DEFAULT_APP_PALETTE_COLOR, normalizeAppPaletteColor } from "../theme/appPalette";
import { Button } from "../ui/Button";

interface AppPaletteSettingsProps {
  color: string | null;
  onChange: (color: string | null) => void;
}

export function AppPaletteSettings({ color, onChange }: AppPaletteSettingsProps) {
  const [draft, setDraft] = useState(color ?? DEFAULT_APP_PALETTE_COLOR);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(color ?? DEFAULT_APP_PALETTE_COLOR);
  }, [color]);

  function apply(next: string | null) {
    try {
      onChange(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="app-palette-settings" aria-label="应用整体配色">
      <div className="settings-section__head">
        <h3>整体配色</h3>
      </div>
      <div className="app-palette-settings__controls">
        <input
          aria-label="应用配色色板"
          onChange={(event) => apply(event.currentTarget.value)}
          type="color"
          value={color ?? DEFAULT_APP_PALETTE_COLOR}
        />
        <input
          aria-label="应用配色 HEX 色值"
          aria-invalid={normalizeAppPaletteColor(draft) === null}
          className="settings-number"
          maxLength={7}
          onBlur={() => {
            const normalized = normalizeAppPaletteColor(draft);
            if (normalized) apply(normalized);
            else setDraft(color ?? DEFAULT_APP_PALETTE_COLOR);
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setDraft(next);
            const normalized = normalizeAppPaletteColor(next);
            if (/^#[\da-f]{6}$/i.test(next) && normalized) apply(normalized);
          }}
          spellCheck={false}
          value={draft}
        />
        <Button disabled={!color} onClick={() => apply(null)} variant="ghost">恢复海玻璃绿</Button>
      </div>
      {error ? <p className="app-palette-settings__error" role="alert">{error}</p> : null}
    </section>
  );
}
