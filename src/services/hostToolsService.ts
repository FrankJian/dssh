import type { HostTool, HostToolsSnapshot } from "../models/hosttools";
import { invokeCommand } from "./tauri";

/** Collect a read-only host-tools snapshot for a saved connection over SSH. */
export function hostToolsSnapshot(profileId: string, tool: HostTool) {
  return invokeCommand<HostToolsSnapshot>("host_tools_snapshot", { profileId, tool });
}
