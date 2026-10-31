import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseSnapshot, sections } from "./formatSnapshot.ts";
const exec = promisify(execFile);
const script = name => fileURLToPath(new URL(`../../../src-tauri/src/hosttools/${name}`, import.meta.url));
async function binary(dir, name, body) {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
}

test("CPU timer overlaps system probes, ps runs once and both Top5 lists are preserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dssh-parallel-probe-"));
  const trace = join(dir, "trace");
  const ready = join(dir, "timer-ready");
  const env = {...process.env, PATH:`${dir}:/usr/bin:/bin`, DSSH_PROBE_TRACE:trace, DSSH_PROBE_TIMER_READY:ready};
  try {
    await binary(dir, "sleep", `printf 'timer-start\\n' >> "$DSSH_PROBE_TRACE"
: > "$DSSH_PROBE_TIMER_READY"
/bin/sleep "$@"
printf 'timer-end\\n' >> "$DSSH_PROBE_TRACE"`);
    // A serial regression deadlocks here and fails the subprocess timeout.
    await binary(dir, "hostname", `while [ ! -e "$DSSH_PROBE_TIMER_READY" ]; do /bin/sleep 0.01; done
printf 'host-start\\n' >> "$DSSH_PROBE_TRACE"
/bin/sleep 0.2
printf 'host-end\\n' >> "$DSSH_PROBE_TRACE"
printf 'probe-host\\n'`);
    await binary(dir, "head", `case "$*" in
  *'/proc/stat'*) if [ -e "$DSSH_PROBE_TIMER_READY" ]; then printf 'cpu 130 0 20 570 0 0 0 0\\n'; else printf 'cpu 100 0 20 500 0 0 0 0\\n'; fi ;;
  *) exec /usr/bin/head "$@" ;;
esac`);
    await binary(dir, "cat", `case "$1" in
/proc/meminfo) printf 'MemTotal: 1024 kB\\nMemAvailable: 512 kB\\n' ;;
*) exec /bin/cat "$@" ;;
esac`);
    await binary(dir, "ps", `printf 'ps\\n' >> "$DSSH_PROBE_TRACE"
printf '1 90.0 1.0 p1\\n2 70.0 2.0 p2\\n3 50.0 3.0 p3\\n4 20.0 4.0 p4\\n5 0.0 5.0 p5\\n6 0.0 6.0 p6\\n'`);
    await binary(dir, "free", `printf 'free\\n' >> "$DSSH_PROBE_TRACE"`);
    await binary(dir, "who", "exit 0");
    await binary(dir, "ip", "printf '2: eth0 inet 10.0.0.2/24 scope global eth0\\n'");
    await binary(dir, "ss", "exit 0");
    const {stdout} = await exec("/bin/sh", [script("snapshot.sh")], {env, timeout:5000});
    const events = (await readFile(trace,"utf8")).trim().split("\n");
    assert.ok(events.indexOf("timer-start") < events.indexOf("host-end"));
    assert.ok(events.indexOf("host-end") < events.indexOf("timer-end"));
    assert.equal(events.filter(e=>e==="ps").length,1);
    assert.equal(events.includes("free"),false);
    assert.match(stdout, /@@DSSH:SYSTEM_END/);
    const data = parseSnapshot({stdout:stdout+"\n@@DSSH:END\n",timedOut:false,outputTruncated:false,exitCode:0});
    assert.equal(data.host,"probe-host");
    assert.equal(data.cpu[0],30);
    assert.deepEqual(data.topCpu.map(p=>p.pid),["1","2","3","4","5"]);
    assert.deepEqual(data.topMemory.map(p=>p.pid),["6","5","4","3","2"]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("disk probe avoids duplicate GNU df and only falls back when typed output is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dssh-disk-probe-"));
  const trace = join(dir,"trace");
  try {
    await binary(dir,"df",`printf 'df %s\\n' "$*" >> "$DSSH_PROBE_TRACE"
case "$*" in
*'-T'*) [ "$DSSH_PROBE_MODE" = bsd ] && exit 1
printf 'Filesystem Type 1024-blocks Used Available Use%% Mounted on\\n/dev/a ext4 1024 512 512 50%% /\\n'
# GNU df can fail for another mount and still return useful typed rows.
exit 1 ;;
*) printf 'Filesystem 1024-blocks Used Available Use%% Mounted on\\n/dev/disk1 1024 512 512 50%% /Volumes/Data files\\n' ;;
esac`);
    await binary(dir,"mount",`printf 'mount\\n' >> "$DSSH_PROBE_TRACE"
printf '/dev/disk1 on /Volumes/Data files (apfs, local)\\n'`);
    const run = mode => exec("/bin/sh",[script("snapshot-disks.sh")],{env:{...process.env,PATH:dir,DSSH_PROBE_TRACE:trace,DSSH_PROBE_MODE:mode},timeout:3000});
    const typed = sections((await run("linux")).stdout);
    assert.match(typed.DISK_TYPED,/ext4/);
    assert.equal(typed.DISK,undefined);
    assert.deepEqual((await readFile(trace,"utf8")).trim().split("\n"),["df -a -P -k -T"]);
    await writeFile(trace,"");
    const bsd = sections((await run("bsd")).stdout);
    assert.match(bsd.DISK,/Data files/);
    assert.match(bsd.MOUNTS,/apfs/);
    assert.deepEqual((await readFile(trace,"utf8")).trim().split("\n"),["df -a -P -k -T","df -a -P -k","mount"]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("missing probe commands still produce completion markers for graceful field degradation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dssh-empty-probe-"));
  try {
    for (const [name, marker] of [["snapshot.sh","SYSTEM_END"],["snapshot-disks.sh","DISK_END"]]) {
      const {stdout} = await exec("/bin/sh",[script(name)],{env:{...process.env,PATH:dir},timeout:3000});
      assert.ok(marker in sections(stdout));
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});
