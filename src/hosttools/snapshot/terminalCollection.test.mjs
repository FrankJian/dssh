import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSnapshot } from "./formatSnapshot.ts";
const exec=promisify(execFile);
const runner=fileURLToPath(new URL("../../../src-tauri/src/hosttools/snapshot-terminal.py",import.meta.url));
const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
async function run(configs){
  try {return {...await exec("python3",["-I",runner,Buffer.from(JSON.stringify(configs)).toString("base64")],{timeout:5000,maxBuffer:1024*1024}),code:0};}
  catch(e){if(typeof e.code!=="number")throw e;return {stdout:e.stdout,stderr:e.stderr,code:e.code};}
}

test("selected-PTY controller starts three probes concurrently and serializes complete sections",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"dssh-terminal-controller-"));
  try {
    const files=[0,1,2].map(i=>join(dir,String(i)));
    const configs=files.map((f,i)=>[`printf x > ${quote(f)}; while [ ! -f ${quote(files[0])} ] || [ ! -f ${quote(files[1])} ] || [ ! -f ${quote(files[2])} ]; do sleep 0.01; done; printf '\\n@@DSSH:PART_${i}\\nvalue-${i}\\n'`,1,1024]);
    const result=await run(configs);
    assert.equal(result.code,0,result.stderr);
    assert.match(result.stdout,/PART_0\nvalue-0\n\n\n@@DSSH:PART_1\nvalue-1\n\n\n@@DSSH:PART_2\nvalue-2/);
    assert.match(result.stdout,/@@DSSH:END/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("PTY probe timeout and output caps preserve independent disk and Docker results",async()=>{
  const result=await run([
    ["printf '@@DSSH:HOST\\npartial-host\\n'; sleep 2",0.08,64],
    ["printf '@@DSSH:DISK_END\\n'",1,64],
    ["printf '@@DSSH:DOCKER_STATUS\\nrunning\\n'; sleep 2",0.08,64],
  ]);
  assert.equal(result.code,1);
  assert.match(result.stdout,/partial-host/);
  assert.match(result.stdout,/DISK_END/);
  assert.match(result.stdout,/DOCKER_WARNING/);
  const capped=await run([[`printf '${"x".repeat(512)}'`,1,32],["printf '@@DSSH:DISK_END\\n'",1,64],["printf '@@DSSH:DOCKER_STATUS\\nnot_installed\\n'",1,64]]);
  assert.equal(capped.code,1);
  assert.ok(capped.stdout.length<256);
  assert.match(capped.stdout,/DISK_END/);
});

test("report explicitly identifies the selected terminal asset in its metadata",()=>{
  const target={source:"terminal",identity:"s:4:10.0.0.2",label:"10.0.0.2",ready:true,reason:null};
  const data=parseSnapshot({stdout:"@@DSSH:HOST\nselected-host\n@@DSSH:END",exitCode:0,timedOut:false,outputTruncated:false,target});
  assert.equal(data.source,"terminal");assert.equal(data.targetLabel,"10.0.0.2");assert.equal(data.host,"selected-host");
});
