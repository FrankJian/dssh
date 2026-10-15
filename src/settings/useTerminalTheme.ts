import { useSyncExternalStore } from "react";
import {
  getTerminalThemeStoreState,
  subscribeTerminalThemeStore,
} from "./terminalThemeStore";

export function useTerminalTheme() {
  return useSyncExternalStore(
    subscribeTerminalThemeStore,
    getTerminalThemeStoreState,
    getTerminalThemeStoreState,
  );
}
