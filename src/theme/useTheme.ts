import { useEffect, useState } from "react";

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

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");

    function applyTheme() {
      document.documentElement.dataset.theme = resolveTheme(themeMode);
    }

    localStorage.setItem(storageKey, themeMode);
    applyTheme();
    media.addEventListener("change", applyTheme);

    return () => {
      media.removeEventListener("change", applyTheme);
    };
  }, [themeMode]);

  return {
    setThemeMode,
    themeMode,
  };
}
