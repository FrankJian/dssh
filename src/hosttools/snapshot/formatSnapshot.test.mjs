import assert from "node:assert/strict";
import { test } from "node:test";
import { cpuUsage, formatSnapshot, parseSnapshot } from "./formatSnapshot.ts";

const raw = values => Object.entries({ HOST: "db-prod-01", ...values, END: "" }).map(([k, v]) => `@@DSSH:${k}\n${v}`).join("\n");
const render = values => formatSnapshot({ stdout: raw(values), timedOut: false, outputTruncated: false, exitCode: 0 }, "2026-10-31 14:08:32");

test("CPU delta excludes guest double counting, includes nice, handles reset/zero/malformed", () => {
  const a = "cpu 100 10 20 500 30 5 5 0 10 0";
  const b = "cpu 130 15 30 540 35 10 10 0 20 0";
  assert.deepEqual(cpuUsage(a, b), [60, 35, 10, 5, 40]);
  assert.equal(cpuUsage(b, a), undefined);
  assert.equal(cpuUsage(a, a), undefined);
  assert.equal(cpuUsage("cpu broken", b), undefined);
});

test("Linux memory accounting, all mounts including spaces/virtual, warning thresholds", () => {
  const text = render({
    CORES: "4", LOAD: "4.01 2.00 1.00 1/42 99", UPTIME: "90061 12",
    MEM: "MemTotal: 1048576 kB\nMemAvailable: 65536 kB\nBuffers: 100 kB\nCached: 200 kB\nSReclaimable: 50 kB\nShmem: 20 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB",
    DISK_TYPED: "Filesystem Type 1024-blocks Used Available Capacity Mounted on\n/dev/sda ext4 1048576 943718 104858 90% /\ntmpfs tmpfs 1024 0 1024 0% /run\n/dev/sdb xfs 1048576 838861 209715 80% /data files\nproc proc 0 0 0 - /proc",
  });
  assert.match(text, /可用不足10%/);
  assert.match(text, /Swap≥50%/);
  assert.match(text, /已用 960.0M/);
  assert.match(text, /负载超过逻辑核数/);
  assert.match(text, /1天 1时 1分/);
  assert.match(text, /全部 4 个/);
  assert.match(text, /\/data files/);
  assert.match(text, /⚠ ≥90%/);
  assert.match(text, /⚠ ≥80%/);
  assert.match(text, /\/proc/);
  assert.doesNotMatch(text, /未完整结束|NaN|Infinity/);
});

test("old Linux estimated available and modern free fallback", () => {
  assert.match(render({ MEM: "MemTotal: 1024 kB\nMemFree: 100 kB\nCached: 200 kB\nBuffers: 20 kB\nShmem: 10 kB" }), /available 0.3M（估算）/);
  assert.match(render({ FREE: "Mem: 1048576 500000 200000 0 300000 548576\nSwap: 1048576 524288 524288" }), /available 535.7M/);
});

test("BSD disk types from mount, load from uptime, portable process ranking/deduplication", () => {
  const text = render({ CORES: "8", UP_TEXT: "14:08 up 2 days, 1:00, 1 user, load averages: 2.5 1.5 1.0",
    DISK: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 1048576 524288 524288 50% /Volumes/Data files",
    MOUNTS: "/dev/disk1 on /Volumes/Data files (apfs, local)",
    PROCESSES: " 12 200.1 1.0 /usr/bin/worker\n 13 1.0 40.0 postgres\n 12 200.1 1.0 /usr/bin/worker",
  });
  assert.match(text, /apfs/);
  assert.match(text, /2.50 \/ 1.50 \/ 1.00/);
  assert.match(text, /CPU worker\(12\) 200.1% · postgres/);
  assert.match(text, /MEM postgres\(13\) 40.0% · worker/);
  assert.equal((text.match(/worker\(12\)/g) || []).length, 2);
});

test("unknown/malformed data never raises false resource warnings; partial output visible", () => {
  const text = render({ CORES: "broken", MEM: "MemTotal: nonsense", LOAD: "bad" });
  assert.doesNotMatch(text, /NaN|Infinity|负载超过|可用不足|Swap≥/);
  assert.match(text, /不可用/);
  const partial = formatSnapshot({ stdout: "@@DSSH:HOST\n\x1b[31mevil\x07", timedOut: true, outputTruncated: true, exitCode: null }, "now");
  assert.match(partial, /部分字段\/挂载可能缺失/);
  assert.doesNotMatch(partial, /[\x1b\x07]/);
});


test("fallback disks retain unknown sizes, negative available space and Linux mount types", () => {
  const text = render({ DISK: "Filesystem 1024-blocks Used Available Use% Mounted on\n/dev/a 1048576 1048576 -1048576 100% /data\nnone - - - - /unreadable", MOUNTS: "/dev/a on /data type ext4 (rw)", SOCKETS: "0" });
  assert.match(text, /全部 2 个/);
  assert.match(text, /ext4/);
  assert.match(text, /-1.0G/);
  assert.match(text, /\/unreadable/);
  assert.match(text, /监听套接字 0/);
});


test("structured report retains numeric values and warning severities for visual rendering", () => {
  const d = parseSnapshot({stdout:raw({CORES:"4",LOAD:"5 3 2",MEM:"MemTotal: 1024 kB\nMemAvailable: 64 kB\nSwapTotal: 512 kB\nSwapFree: 256 kB",DISK_TYPED:"Filesystem Type Blocks Used Available Use% Mounted on\n/dev/a ext4 1000 900 100 90% /data\n/dev/b xfs 1000 800 200 80% /backup", IP:"2: eth0 inet 10.0.0.2/24 scope global eth0",USERS:"alice pts/1 today (10.0.0.1)"}),timedOut:false,outputTruncated:false,exitCode:0}, "time");
  assert.equal(d.memory.used, 960);
  assert.deepEqual(d.load, [5,3,2]);
  assert.deepEqual(d.addresses, [{interface:"eth0",address:"10.0.0.2/24"}]);
  assert.deepEqual(d.users, [{user:"alice",terminal:"pts/1",source:"10.0.0.1"}]);
  assert.equal(d.disks.length, 2);
  assert.equal(d.alerts.filter(a=>a.severity==="danger").length, 1);
  assert.equal(d.alerts.length, 5);
  assert.equal(d.collectedAt, "time");
});

test("missing structured data remains unknown, never fabricated as zero or healthy", () => {
  const d = parseSnapshot({stdout:raw({MEM:`MemTotal: ${"9".repeat(400)} kB`}),timedOut:false,outputTruncated:false,exitCode:0});
  assert.equal(d.memory.total, undefined);
  assert.equal(d.cpu, undefined);
  assert.equal(d.cores, undefined);
  assert.deepEqual(d.disks, []);
  assert.deepEqual(d.alerts, []);
  const partial = parseSnapshot({stdout:"@@DSSH:HOST\nminimal",timedOut:true,outputTruncated:false,exitCode:null});
  assert.equal(partial.partial, true);
  assert.equal(partial.alerts[0].severity, "warning");
});

test("CPU and memory lists each retain five distinct processes in their own rank order", () => {
  const values = { PROCESSES: "1 80.0 1.0 p1\n2 60.0 2.0 p2\n3 40.0 3.0 p3\n4 20.0 4.0 p4\n5 10.0 5.0 p5\n6 1.0 6.0 p6\n1 80.0 1.0 p1\nmalformed" };
  const d = parseSnapshot({stdout:raw(values),timedOut:false,outputTruncated:false,exitCode:0});
  assert.deepEqual(d.topCpu.map(p => p.pid), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(d.topMemory.map(p => p.pid), ["6", "5", "4", "3", "2"]);
  const text = render(values);
  assert.match(text, /进程 Top5/);
  assert.match(text, /CPU .*p5\(5\) 10.0%/);
  assert.match(text, /MEM .*p2\(2\) 2.0%/);
});
