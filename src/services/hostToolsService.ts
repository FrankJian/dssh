import type { HostTool, HostToolsSnapshot } from "../models/hosttools";
import type { ServerSnapshotOutput, ServerSnapshotTarget } from "../models/serverSnapshot";
import { invokeCommand } from "./tauri";

/** Collect a read-only host-tools snapshot for a saved connection over SSH. */
export function hostToolsSnapshot(profileId: string, tool: HostTool) {
  return invokeCommand<HostToolsSnapshot>("host_tools_snapshot", { profileId, tool });
}

/** Fixed probe on the original transport or the already-selected JumpServer PTY. */
export function serverStatusSnapshot(sessionId: string, expectedTarget?: string) {
  return invokeCommand<ServerSnapshotOutput>("server_status_snapshot", { sessionId, expectedTarget });
}

export function serverStatusSnapshotTarget(sessionId: string) {
  return invokeCommand<ServerSnapshotTarget>("server_status_snapshot_target", { sessionId });
}

export function cancelServerStatusSnapshot(sessionId: string, expectedTarget: string) {
  return invokeCommand<void>("cancel_server_status_snapshot", { sessionId, expectedTarget });
}
