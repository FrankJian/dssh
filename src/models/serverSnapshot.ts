export interface ServerSnapshotTarget {
  source: "transport" | "terminal";
  identity: string;
  label: string;
  ready: boolean;
  reason: string | null;
}

/** camelCase DTO returned by the fixed read-only SSH probe. No credentials. */
export interface ServerSnapshotOutput {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
  exitCode: number | null;
  target?: ServerSnapshotTarget;
}

export interface SnapshotProcess { pid: string; name: string; cpu: number; mem: number }
export interface SnapshotDisk {
  mount: string; filesystem: string; total?: number; used?: number; available?: number; usage?: number;
}
export interface ServerSnapshot {
  collectedAt: string;
  source: "transport" | "terminal";
  targetLabel: string;
  host: string; os: string; kernel: string; arch: string; uptime: string;
  cpuModel: string; cores?: number;
  /** usage, user+nice, system, iowait, idle percentages. */
  cpu?: number[];
  load: (number | undefined)[];
  memory: { total?: number; used?: number; available?: number; cache?: number; estimated: boolean; swap?: number; swapUsed?: number };
  topCpu: SnapshotProcess[]; topMemory: SnapshotProcess[];
  users: { user: string; terminal: string; source: string }[];
  addresses: { interface: string; address: string }[];
  sockets?: number;
  disks: SnapshotDisk[];
  docker: DockerSnapshot;
  partial: boolean;
  alerts: { severity: "warning" | "danger"; message: string }[];
}

export interface SnapshotContainer {
  id: string; name: string; image: string; state: string; status: string; ports: string;
  cpu?: number; memoryUsed?: number; memoryLimit?: number; memoryPercent?: number;
  network: string; block: string; pids?: number;
}
export interface DockerSnapshot {
  state: "running" | "unavailable" | "not_installed" | "not_probed";
  version: string; driver: string;
  total?: number; running?: number; paused?: number; stopped?: number; images?: number;
  containers: SnapshotContainer[];
  warning: string;
}
