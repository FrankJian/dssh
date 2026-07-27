import type { AppHealth } from "../models/app";
import { invokeCommand } from "./tauri";

export function getAppHealth() {
  return invokeCommand<AppHealth>("app_health");
}
