import type { PortForward, StartPortForwardRequest } from "../models";
import { invokeCommand } from "./tauri";

export function startPortForward(request: StartPortForwardRequest) {
  return invokeCommand<PortForward>("start_port_forward", { request });
}

export function stopPortForward(forwardId: string) {
  return invokeCommand<void>("stop_port_forward", { forwardId });
}

export function listPortForwards(sessionId: string) {
  return invokeCommand<PortForward[]>("list_port_forwards", { sessionId });
}
