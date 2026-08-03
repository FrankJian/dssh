import { listen } from "@tauri-apps/api/event";
import type {
  DetachedWorkspace,
  OpenDetachedSftpRequest,
  OpenDetachedTerminalRequest,
  OpenDetachedKubernetesRequest,
} from "../models";
import { invokeCommand } from "./tauri";

export function listDetachedWorkspaces() {
  return invokeCommand<DetachedWorkspace[]>("list_detached_workspaces");
}

export function getDetachedWorkspace(label: string) {
  return invokeCommand<DetachedWorkspace | null>("get_detached_workspace", { label });
}

export function openDetachedTerminalWorkspace(request: OpenDetachedTerminalRequest) {
  return invokeCommand<DetachedWorkspace>("open_detached_terminal_workspace", { request });
}

export function openDetachedSftpWorkspace(request: OpenDetachedSftpRequest) {
  return invokeCommand<DetachedWorkspace>("open_detached_sftp_workspace", { request });
}

export function openDetachedKubernetesWorkspace(request: OpenDetachedKubernetesRequest) {
  return invokeCommand<DetachedWorkspace>("open_detached_kubernetes_workspace", { request });
}

export function updateDetachedTerminalWorkspace(
  label: string,
  terminal: OpenDetachedTerminalRequest["terminal"],
) {
  return invokeCommand<void>("update_detached_terminal_workspace", { request: { label, terminal } });
}

export function discardDetachedWorkspace(label: string) {
  return invokeCommand<void>("discard_detached_workspace", { label });
}

export function onDetachedWorkspaceClosed(handler: (workspace: DetachedWorkspace) => void) {
  return listen<DetachedWorkspace>("workspace://detached-window-closed", (event) => handler(event.payload));
}

export function onDetachedWorkspaceUpdated(handler: (workspace: DetachedWorkspace) => void) {
  return listen<DetachedWorkspace>("workspace://detached-window-updated", (event) => handler(event.payload));
}
