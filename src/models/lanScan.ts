export type AddressStatus = "pending" | "scanning" | "occupied" | "unresponsive" | "unknown" | "reserved" | "unfinished";
export interface ScanRow {
  ip: string;
  status: AddressStatus;
  evidence: string;
  mac: string | null;
  responseMs: number | null;
  checkedAt: number | null;
  source: string | null;
}
export interface ScanInterface { name: string; address: string; prefix: number }
export interface ScanRequest {
  scanId: string;
  cidr?: string;
  startIp?: string;
  endIp?: string;
  sourceAddress?: string;
}
export interface ScanUpdate {
  scanId: string;
  sequence: number;
  range: string;
  phase: "running" | "completed" | "cancelled";
  completed: number;
  total: number;
  rows: ScanRow[];
}
