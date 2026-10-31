/** Pure parsing/formatting. Remote output is untrusted text, never terminal code. */
import type { ServerSnapshotOutput, ServerSnapshot, SnapshotDisk } from "../../models/serverSnapshot";
import { isStorageDisk } from "./diskVisibility.ts";
import { parseDockerSnapshot } from "./dockerSnapshot.ts";
export type ProbeOutput = Pick<ServerSnapshotOutput, "stdout" | "timedOut" | "outputTruncated" | "exitCode" | "target">;
const NA = "不可用";
const clean = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
const num = (s: string | undefined): number | undefined => {
  if (!s || !/^\d+(?:\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const pct = (n: number | undefined) => n === undefined ? NA : `${n.toFixed(1)}%`;
export function size(kb: number | undefined): string {
  if (kb === undefined) return NA;
  return Math.abs(kb) >= 1048576 ? `${(kb / 1048576).toFixed(1)}G` : `${(kb / 1024).toFixed(1)}M`;
}
// CJK characters occupy two monospace cells. Keep combining marks at zero width.
function width(s: string): number {
  return [...s].reduce((n, c) => n + (/\p{Mark}/u.test(c) ? 0 : /[^\u0000-\u00ff]/u.test(c) ? 2 : 1), 0);
}
function pad(s: string, n: number, right = false): string {
  const spaces = " ".repeat(Math.max(0, n - width(s)));
  return right ? spaces + s : s + spaces;
}
function table(rows: string[][], numeric: number[] = []): string[] {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => width(r[i] ?? ""))));
  return rows.map(r => r.map((c, i) => pad(c, widths[i], numeric.includes(i))).join("  ").trimEnd());
}
export function sections(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = "";
  for (const line of clean(raw).split(/\r?\n/)) {
    const match = /^@@DSSH:([A-Z_]+)$/.exec(line);
    if (match) { key = match[1]; out[key] = ""; }
    else if (key) out[key] += line + "\n";
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.trim()]));
}
export function cpuUsage(a: string, b: string): number[] | undefined {
  const read = (s: string) => /^cpu\s/.test(s) ? s.trim().split(/\s+/).slice(1, 9).map(num) : [];
  const x = read(a), y = read(b);
  if (x.length < 4 || x.length !== y.length || [...x, ...y].some(v => v === undefined)) return;
  const d = y.map((v, i) => v! - x[i]!);
  const total = d.reduce((s, v) => s + v, 0);
  if (total <= 0 || d.some(v => v < 0)) return;
  const p = (v: number) => v / total * 100;
  // usage includes iowait, irq, softirq, steal; us includes nice.
  return [p(total - d[3]), p(d[0] + d[1]), p(d[2]), p(d[4] ?? 0), p(d[3])];
}
export function parseSnapshot(probe: ProbeOutput, collectedAt = new Date().toLocaleString()): ServerSnapshot {
  const s = sections(probe.stdout);
  const first = (key: string) => s[key]?.split("\n")[0] || NA;
  const cores = num(first("CORES"));
  const seconds = num(s.UPTIME?.split(/\s+/)[0]);
  const uptime = seconds === undefined ? (s.UP_TEXT?.match(/\sup\s(.+?)(?:,\s*\d+ users?|,?\s*load averages?:)/)?.[1] ?? NA)
    : `${Math.floor(seconds / 86400)}天 ${Math.floor(seconds % 86400 / 3600)}时 ${Math.floor(seconds % 3600 / 60)}分`;
  const cpu = cpuUsage(s.CPU_A || "", s.CPU_B || "");
  let load = s.LOAD?.replace(/[{}]/g, "").trim().split(/\s+/).slice(0, 3).map(num) ?? [];
  if (load.length !== 3 || load.some(v => v === undefined)) {
    load = (s.UP_TEXT?.match(/load averages?:\s*(.+)/)?.[1] ?? "").split(/[,\s]+/).slice(0, 3).map(num);
  }
  const mem: Record<string, number | undefined> = {};
  for (const line of (s.MEM || "").split("\n")) {
    const m = /^(\w+):\s+(\d+)\s+kB$/.exec(line);
    if (m) mem[m[1]] = num(m[2]);
  }
  let total = mem.MemTotal, available = mem.MemAvailable;
  let cache = mem.Cached === undefined ? undefined : Math.max(0, (mem.Buffers ?? 0) + mem.Cached + (mem.SReclaimable ?? 0) - (mem.Shmem ?? 0));
  let estimated = false;
  if (available === undefined && mem.MemFree !== undefined && cache !== undefined) {
    available = Math.min(total ?? Infinity, mem.MemFree + cache); estimated = true;
  }
  let swap = mem.SwapTotal, swapUsed = swap !== undefined && mem.SwapFree !== undefined ? swap - mem.SwapFree : undefined;
  if (total === undefined) {
    const f = s.FREE?.split("\n").find(l => /^Mem:/.test(l))?.trim().split(/\s+/);
    if (f && f.length >= 7) { total = num(f[1])!; cache = num(f[5])!; available = num(f[6])!; }
    const sw = s.FREE?.split("\n").find(l => /^Swap:/.test(l))?.trim().split(/\s+/);
    if (sw) { swap = num(sw[1])!; swapUsed = num(sw[2]); }
  }
  const used = total !== undefined && available !== undefined ? Math.max(0, total - available) : undefined;
  const low = total !== undefined && total > 0 && available !== undefined && available / total < .1;
  const processes = (s.PROCESSES || "").split("\n").flatMap(line => {
    const m = /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/.exec(line);
    return m && num(m[2]) !== undefined && num(m[3]) !== undefined ? [{ pid: m[1], cpu: Number(m[2]), mem: Number(m[3]), name: m[4].split("/").pop()! }] : [];
  });
  const uniqueProcesses = [...new Map(processes.map(p => [p.pid, p])).values()];
  const top = (key: "cpu" | "mem") => [...uniqueProcesses].sort((a, b) => b[key] - a[key]).slice(0, 5);
  const users = (s.USERS || "").split("\n").filter(Boolean).map(line => {
    const p = line.trim().split(/\s+/); return { user: p[0], terminal: p[1] ?? "—", source: line.match(/\((.*)\)/)?.[1] ?? "本地/来源未知" };
  });
  const ips: ServerSnapshot["addresses"] = [];
  let iface = "";
  for (const line of (s.IP || "").split("\n")) {
    const ip = /^\d+:\s+(\S+)\s+inet6?\s+(\S+)/.exec(line);
    if (ip) { ips.push({ interface: ip[1], address: ip[2] }); continue; }
    const dev = /^(\S+):\s/.exec(line); if (dev) iface = dev[1];
    const addr = /^\s+inet6?\s+(?:addr:)?([^\s]+)/.exec(line);
    if (addr) ips.push({ interface: iface || "未知", address: addr[1] });
  }
  if (!ips.length && s.IP && /^[\da-fA-F:.%/\s]+$/.test(s.IP)) ips.push(...s.IP.split(/\s+/).map(address => ({ interface: "未知", address })));
  const disks: SnapshotDisk[] = [];
  const diskNumber = (value: string) => /^-?\d+$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : undefined;
  const typed = /^Filesystem\s/.test(s.DISK_TYPED || "") && (s.DISK_TYPED || "").split("\n").length > 1;
  for (const line of (typed ? s.DISK_TYPED : s.DISK || "").split("\n").slice(1)) {
    // Capture the mountpoint as the remainder, retaining spaces.
    const m = (typed ? /^(\S+)\s+(\S+)\s+(-?\d+|-)\s+(-?\d+|-)\s+(-?\d+|-)\s+([\d-]+)%?\s+(.+)$/ : /^(\S+)\s+(-?\d+|-)\s+(-?\d+|-)\s+(-?\d+|-)\s+([\d-]+)%?\s+(.+)$/).exec(line.trim());
    if (!m) continue;
    const j = typed ? 1 : 0, mount = m[6 + j].replace(/\\040/g, " ").replace(/\\011/g, " ");
    const mountInfo = (s.MOUNTS || "").split("\n").find(l => l.startsWith(`${m[1]} on ${mount} (`) || l.startsWith(`${m[1]} on ${mount} type `));
    const fs = typed ? m[2] : mountInfo?.match(/ type (\S+) \(/)?.[1] ?? mountInfo?.match(/\(([^, )]+)/)?.[1] ?? "未知";
    const usage = num(m[5 + j]);
    disks.push({ mount, filesystem: fs, total: diskNumber(m[2 + j]), used: diskNumber(m[3 + j]), available: diskNumber(m[4 + j]), usage });
  }
  const partial = probe.timedOut || probe.outputTruncated || !Object.prototype.hasOwnProperty.call(s, "END") || probe.exitCode !== 0;
  const alerts: ServerSnapshot["alerts"] = [];
  if (partial) alerts.push({ severity: "warning", message: "采集超时、截断或未完整结束；部分字段/挂载可能缺失。" });
  for (const disk of disks.filter(isStorageDisk)) {
    if (disk.usage !== undefined && disk.usage >= 80) alerts.push({ severity: disk.usage >= 90 ? "danger" : "warning", message: `${disk.mount} 使用率 ${disk.usage}%（≥${disk.usage >= 90 ? 90 : 80}%）` });
  }
  if (cores && load.some(v => v !== undefined && v > cores)) alerts.push({ severity: "warning", message: "负载超过逻辑核数" });
  if (low) alerts.push({ severity: "warning", message: "内存可用不足10%" });
  if (swap !== undefined && swap > 0 && swapUsed !== undefined && swapUsed / swap >= .5) alerts.push({ severity: "warning", message: "Swap≥50%" });
  return {
    source: probe.target?.source ?? "transport", targetLabel: probe.target?.label ?? "",
    collectedAt: clean(collectedAt), host: first("HOST"), os: (s.OS || NA).replace(/^['"]|['"]$/g, "").replace(/\n/g, " "),
    kernel: first("KERNEL"), arch: first("ARCH"), uptime, cpuModel: first("MODEL"), cores, cpu, load,
    memory: { total, used, available, cache, estimated, swap, swapUsed },
    topCpu: top("cpu"), topMemory: top("mem"), users, addresses: ips, sockets: num(s.SOCKETS), disks, docker: parseDockerSnapshot(s), partial, alerts,
  };
}

/** Text export shares the structured parser used by the visual report. */
export function formatSnapshot(probe: ProbeOutput, collectedAt?: string): string {
  const d = parseSnapshot(probe, collectedAt), m = d.memory;
  const lines = [`服务器状态快照 · ${d.collectedAt}`, "单位 G/M = GiB/MiB；不可用/— 表示无数据。只读采集。"];
  if (d.source === "terminal") lines.push(`采集来源：当前交互终端 · ${d.targetLabel}（JumpServer 已选资产）`);
  const add = (title: string, ...rows: string[]) => lines.push(`── ${title} ${"─".repeat(Math.max(1, 48 - width(title)))}`, ...rows);
  const warning = (text: string) => d.alerts.some(a => a.message.includes(text)) ? `  ⚠ ${text}` : "";
  add("系统", `主机 ${d.host}   系统 ${d.os}`, `内核 ${d.kernel}   架构 ${d.arch}   运行 ${d.uptime}`);
  add("CPU / 负载", `型号 ${d.cpuModel}   逻辑核 ${d.cores ?? NA}`,
    `采样≥1s   使用 ${pct(d.cpu?.[0])}  us ${pct(d.cpu?.[1])}  sy ${pct(d.cpu?.[2])}  wa ${pct(d.cpu?.[3])}  idle ${pct(d.cpu?.[4])}`,
    `负载 1/5/15m  ${[0, 1, 2].map(i => d.load[i]?.toFixed(2) ?? NA).join(" / ")}  · ${d.cores ?? NA}核${warning("负载超过逻辑核数")}`);
  add("内存 / Swap", `内存 总量 ${size(m.total)}  已用 ${size(m.used)}  available ${size(m.available)}${m.estimated ? "（估算）" : ""}${warning("可用不足10%")}`,
    `     buff/cache ${size(m.cache)}   Swap ${size(m.swapUsed)} / ${size(m.swap)}${warning("Swap≥50%")}`);
  const top = (rows: ServerSnapshot["topCpu"], key: "cpu" | "mem") => rows.map(p => `${p.name}(${p.pid}) ${pct(p[key])}`).join(" · ") || NA;
  add("进程 Top5（ps 为进程生命周期平均值；CPU可超过100%）", `CPU ${top(d.topCpu, "cpu")}`, `MEM ${top(d.topMemory, "mem")}`);
  add("登录会话", ...(d.users.length ? d.users.map(u => `${u.user}  ${u.terminal}  ${u.source}`) : ["无会话或 who 不可用"]));
  add("网络", d.addresses.map(ip => `${ip.interface === "未知" ? "" : ip.interface + " "}${ip.address}`).join(" · ") || NA, `TCP/UDP 监听套接字 ${d.sockets ?? NA}`);
  add(`磁盘（全部 ${d.disks.length} 个可读取挂载；含虚拟文件系统）`, ...(d.disks.length ? table([["挂载点", "类型", "总量", "已用", "可用", "使用率", "提示"], ...d.disks.map(disk => [disk.mount, disk.filesystem, size(disk.total), size(disk.used), size(disk.available), disk.usage === undefined ? "—" : `${disk.usage}%`, disk.usage !== undefined && disk.usage >= 80 ? `⚠ ≥${disk.usage >= 90 ? 90 : 80}%` : ""])], [2, 3, 4, 5]) : [NA]));
  if (d.docker.state !== "not_probed") {
    const docker = d.docker;
    if (docker.state === "running") {
      add("Docker", `版本 ${docker.version || NA}  容器 ${docker.total ?? NA}  运行 ${docker.running ?? NA}  暂停 ${docker.paused ?? NA}  停止 ${docker.stopped ?? NA}  镜像 ${docker.images ?? NA}`,
        ...table([["容器", "镜像", "状态", "CPU", "内存 / 限额", "端口"], ...docker.containers.map(c => [c.name, c.image, c.status || c.state, pct(c.cpu), `${size(c.memoryUsed)} / ${size(c.memoryLimit)}`, c.ports || "—"])], [3]));
    } else add("Docker", docker.state === "not_installed" ? "未检测到 Docker 客户端" : "本机 Docker 服务未启动、不可达或当前用户无访问权限。");
    if (docker.warning) lines.push(`⚠ ${docker.warning}`);
  }
  if (d.partial) lines.push("⚠ 采集超时、截断或未完整结束；部分字段/挂载可能缺失。");
  lines.push("注：已用=总量−available；负载含I/O等待，超过核数不等同CPU过载。缺失字段不可用。");
  return lines.join("\n");
}
