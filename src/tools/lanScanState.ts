import type { AddressStatus, ScanRow, ScanUpdate } from "../models/lanScan.ts";

export interface ScanView {
  scanId: string;
  sequence: number;
  range: string;
  phase: "idle" | "starting" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  completed: number;
  total: number;
  rows: ScanRow[];
}
export const EMPTY_SCAN: ScanView = { scanId: "", sequence: -1, range: "", phase: "idle", completed: 0, total: 0, rows: [] };
export const ADDRESS_LABELS: Record<AddressStatus, string> = {
  occupied: "检测到占用", unresponsive: "未发现占用", unknown: "无法确认",
  pending: "待扫描", scanning: "扫描中", reserved: "保留地址", unfinished: "未完成",
};
export function applyScanUpdate(current: ScanView, update: ScanUpdate): ScanView {
  if (current.scanId !== update.scanId || current.sequence >= update.sequence) return current;
  const changes = new Map(update.rows.map((row) => [row.ip, row]));
  const rows = current.rows.length ? current.rows.map((row) => changes.get(row.ip) ?? row) : update.rows;
  return { ...update, rows, phase: current.phase === "stopping" && update.phase === "running" ? "stopping" : update.phase };
}
export function failScan(current: ScanView): ScanView {
  return { ...current, phase: "failed", rows: current.rows.map((row) =>
    row.status === "pending" || row.status === "scanning"
      ? { ...row, status: "unfinished", evidence: "任务未完成，请重试" } : row) };
}
