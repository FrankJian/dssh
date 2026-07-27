export type HostTool = "monitor" | "processes" | "services" | "logs" | "ports";

export interface MetricItem {
  label: string;
  value: string;
}

export interface ProcessRow {
  pid: string;
  user: string;
  cpu: string;
  mem: string;
  command: string;
}

export interface ServiceRow {
  name: string;
  active: string;
  sub: string;
  description: string;
}

export interface PortRow {
  proto: string;
  local: string;
  process: string;
}

export interface HostToolsSnapshot {
  tool: string;
  raw: string;
  error: string | null;
  monitor: MetricItem[] | null;
  processes: ProcessRow[] | null;
  services: ServiceRow[] | null;
  logs: string[] | null;
  ports: PortRow[] | null;
}
