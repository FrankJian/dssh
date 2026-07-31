import type { AppHealth } from "../models/app";
import { invokeCommand } from "./tauri";

export function getAppHealth() {
  return invokeCommand<AppHealth>("app_health");
}

/** Lists installed font families for the terminal/editor font selectors. */
export function listSystemFontFamilies() {
  return invokeCommand<string[]>("list_system_font_families");
}
