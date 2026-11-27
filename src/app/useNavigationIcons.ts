import { useEffect, useState } from "react";
import type { NavigationIconId } from "./ActivityBar";
import { DEFAULT_NAVIGATION_ICONS, parseNavigationIcons } from "./navigationPreferences";

export const NAVIGATION_ICONS_KEY = "dssh.navigation.icons.v3";

function loadNavigationIcons(): NavigationIconId[] {
  try {
    const saved = localStorage.getItem(NAVIGATION_ICONS_KEY);
    if (saved !== null) return parseNavigationIcons(saved);
    return parseNavigationIcons(localStorage.getItem("dssh.navigation.icons.v2") ?? localStorage.getItem("dssh.navigation.icons"), true);
  } catch { return [...DEFAULT_NAVIGATION_ICONS]; }
}

export function useNavigationIcons() {
  const [icons, setIcons] = useState(loadNavigationIcons);
  useEffect(() => { localStorage.setItem(NAVIGATION_ICONS_KEY, JSON.stringify(icons)); }, [icons]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === NAVIGATION_ICONS_KEY || event.key === null)) setIcons(loadNavigationIcons());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return [icons, setIcons] as const;
}
