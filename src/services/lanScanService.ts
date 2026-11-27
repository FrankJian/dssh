import { Channel } from "@tauri-apps/api/core";
import { invokeCommand } from "./tauri";
import type { ScanInterface, ScanRequest, ScanUpdate } from "../models/lanScan";

export const listScanInterfaces = () => invokeCommand<ScanInterface[]>("list_scan_interfaces");
export const cancelLanScan = (scanId: string) => invokeCommand<boolean>("cancel_lan_ip_scan", { scanId });
export function startLanScan(request: ScanRequest, onUpdate: (update: ScanUpdate) => void): Promise<ScanUpdate> {
  const progress = new Channel<ScanUpdate>();
  progress.onmessage = onUpdate;
  return invokeCommand<ScanUpdate>("start_lan_ip_scan", { request, progress });
}
