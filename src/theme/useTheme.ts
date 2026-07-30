import { useLayoutEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const storageKey = "dssh.theme";

function getStoredTheme(): ThemeMode {
  const value = localStorage.getItem(storageKey);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function resolveTheme(mode: ThemeMode) {
  if (mode !== "system") {
    return mode;
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");

    function applyTheme() {
      document.documentElement.dataset.theme = resolveTheme(themeMode);
    }

    function syncThemeFromStorage(event: StorageEvent) {
      if (event.key !== storageKey) {
        return;
      }
      const value = event.newValue;
      if (value === "light" || value === "dark" || value === "system") {
        setThemeMode(value);
      }
    }

    localStorage.setItem(storageKey, themeMode);
    applyTheme();
    media.addEventListener("change", applyTheme);
    window.addEventListener("storage", syncThemeFromStorage);

    return () => {
      media.removeEventListener("change", applyTheme);
      window.removeEventListener("storage", syncThemeFromStorage);
    };
  }, [themeMode]);

  return {
    setThemeMode,
    themeMode,
  };
}
