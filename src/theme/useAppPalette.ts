import { useCallback, useLayoutEffect, useState } from "react";
import {
  appPaletteStorageKey,
  appPaletteTokens,
  normalizeAppPaletteColor,
  type AppAppearance,
} from "./appPalette";

function storedPaletteColor() {
  try {
    return normalizeAppPaletteColor(localStorage.getItem(appPaletteStorageKey));
  } catch {
    return null;
  }
}

const tokenNames = Object.keys(appPaletteTokens("#84c6ae", "dark"));

export function useAppPalette() {
  const [paletteColor, setPaletteColorState] = useState<string | null>(storedPaletteColor);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (!paletteColor) {
        for (const name of tokenNames) root.style.removeProperty(name);
        return;
      }
      const appearance: AppAppearance = root.dataset.theme === "light" ? "light" : "dark";
      for (const [name, value] of Object.entries(appPaletteTokens(paletteColor, appearance))) {
        root.style.setProperty(name, value);
      }
    };
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    apply();
    const sync = (event: StorageEvent) => {
      if (event.key === appPaletteStorageKey) setPaletteColorState(normalizeAppPaletteColor(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", sync);
    };
  }, [paletteColor]);

  const setPaletteColor = useCallback((color: string | null) => {
    const normalized = color === null ? null : normalizeAppPaletteColor(color);
    if (color !== null && !normalized) throw new Error("请输入 #RGB 或 #RRGGBB 色值。");
    try {
      if (normalized) localStorage.setItem(appPaletteStorageKey, normalized);
      else localStorage.removeItem(appPaletteStorageKey);
    } catch {
      throw new Error("保存应用配色失败，请检查本机存储权限。");
    }
    setPaletteColorState(normalized);
  }, []);

  return { paletteColor, setPaletteColor };
}
