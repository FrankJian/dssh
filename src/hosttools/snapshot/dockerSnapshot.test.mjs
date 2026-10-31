import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { dockerSize, parseDockerSnapshot } from "./dockerSnapshot.ts";
import { isStorageDisk } from "./diskVisibility.ts";
import { parseSnapshot, sections } from "./formatSnapshot.ts";

const base = {DOCKER_STATUS:"running",DOCKER_INFO:JSON.stringify({version:"27.5.1",total:2,running:1,paused:0,stopped:1,images:4,driver:"overlay2"}),DOCKER_END:""};
test("default mounts keep real/network storage, hide virtual and Docker internal mounts", () => {
  const disk = (mount, filesystem, total=1024) => ({mount,filesystem,total});
  for (const d of [disk("/", "ext4"),disk("/data", "xfs"),disk("/media", "nfs4"),disk("/backup", "cifs"),disk("/", "overlay"),disk("/boot/efi", "vfat"),disk("/storage", "未知"),disk("/var/lib/docker/volumes/database/_data", "nfs4")]) assert.equal(isStorageDisk(d),true,d.mount);
  for (const d of [disk("/run", "tmpfs"),disk("/proc", "proc"),disk("/snap/core", "squashfs"),disk("/var/lib/docker/overlay2/a/merged", "overlay"),disk("/etc/hosts", "ext4"),disk("/empty", "ext4",0),{mount:"/unknown",filesystem:"未知"}]) assert.equal(isStorageDisk(d),false,d.mount);
  const snapshot = parseSnapshot({stdout:"@@DSSH:DISK_TYPED\nFilesystem Type Blocks Used Available Use% Mounted on\nsnap squashfs 1024 1024 0 100% /snap/core\n@@DSSH:END",timedOut:false,outputTruncated:false,exitCode:0});
  assert.equal(snapshot.disks.length,1);
  assert.equal(snapshot.alerts.length,0,"hidden read-only images must not flood the alert summary");
});

test("Docker structured output merges stats by ID, preserves exited containers, normalizes units", () => {
  const d = parseDockerSnapshot({...base,DOCKER_CONTAINERS:[{id:"a",name:"web",image:"nginx:alpine",state:"running",status:"Up 2 days (healthy)",ports:"0.0.0.0:80->80/tcp"},{id:"b",name:"worker",state:"exited",status:"Exited (0)"}].map(JSON.stringify).join("\n"),DOCKER_STATS:JSON.stringify({id:"a",cpu:"123.4%",memory:"512MiB / 2GiB",memoryPercent:"25.0%",network:"2MB / 1MB",block:"0B / 1MB",pids:"12"})});
  assert.equal(d.running,1); assert.equal(d.total,2); assert.equal(d.containers.length,2);
  assert.equal(d.containers[0].cpu,123.4); assert.equal(d.containers[0].memoryUsed,524288); assert.equal(d.containers[0].memoryLimit,2097152);
  assert.equal(d.containers[0].pids,12); assert.equal(d.containers[1].cpu,undefined);
  assert.equal(dockerSize("1GB"),1e9/1024); assert.equal(dockerSize("1GiB"),1048576); assert.equal(dockerSize("broken"),undefined);
  assert.equal(d.warning,"");
});

test("Docker partial/malformed output is isolated and missing data is never fabricated", () => {
  const d = parseDockerSnapshot({...base,DOCKER_END:undefined,DOCKER_CONTAINERS:'{"id":"a","name":"web\\u001b"}\n{"broken":',DOCKER_STATS:'{"id":"a","cpu":"NaN%","memory":"garbage","pids":"--"}',DOCKER_WARNING:"资源统计超时"});
  assert.equal(d.containers[0].name,"web"); assert.equal(d.containers[0].cpu,undefined); assert.equal(d.containers[0].memoryUsed,undefined);
  assert.match(d.warning,/超时/); assert.match(d.warning,/无法解析/);
  assert.equal(parseDockerSnapshot({}).state,"not_probed");
  assert.equal(parseDockerSnapshot({DOCKER_WARNING:"采集失败"}).state,"unavailable");
  assert.equal(parseDockerSnapshot({DOCKER_STATUS:"not_installed"}).state,"not_installed");
  assert.equal(parseDockerSnapshot({DOCKER_STATUS:"unavailable"}).state,"unavailable");
});

test("read-only Docker probe pins local socket, ignores remote context, and degrades safely", async () => {
  const dir = await mkdtemp(join(tmpdir(),"dssh-docker-probe-"));
  const script = fileURLToPath(new URL("../../../src-tauri/src/hosttools/snapshot-docker.sh",import.meta.url));
  const binary = join(dir,"docker");
  try {
    await writeFile(binary,`#!/bin/sh
[ "$1" = --host ] || exit 90
case "$2" in unix://*) ;; *) exit 91 ;; esac
[ -z "$DOCKER_HOST$DOCKER_CONTEXT$DOCKER_TLS_VERIFY$DOCKER_CERT_PATH" ] || exit 92
case "$3" in
info) [ "$MOCK_DOCKER_MODE" = denied ] && exit 1; printf '%s\\n' '{"version":"27.5.1","total":1,"running":1}' ;;
ps) printf '%s\\n' '{"id":"a","name":"web","state":"running"}' ;;
stats) [ "$MOCK_DOCKER_MODE" = stats_denied ] && exit 1; printf '%s\\n' '{"id":"a","cpu":"2.3%"}' ;;
*) exit 93 ;;
esac
`);
    await chmod(binary,0o755);
    const run = mode => sections(execFileSync("/bin/sh",[script],{encoding:"utf8",env:{...process.env,PATH:dir,MOCK_DOCKER_MODE:mode,DOCKER_HOST:"tcp://unrelated.invalid:2375",DOCKER_CONTEXT:"remote",DOCKER_TLS_VERIFY:"1",DOCKER_CERT_PATH:"unused"}}));
    const normal = parseDockerSnapshot(run("normal")); assert.equal(normal.state,"running"); assert.equal(normal.containers[0].cpu,2.3);
    assert.equal(parseDockerSnapshot(run("denied")).state,"unavailable");
    const partial = parseDockerSnapshot(run("stats_denied")); assert.equal(partial.containers.length,1); assert.match(partial.warning,/资源统计不可用/);
    await rm(binary);
    assert.equal(parseDockerSnapshot(run("normal")).state,"not_installed");
  } finally { await rm(dir,{recursive:true,force:true}); }
});
