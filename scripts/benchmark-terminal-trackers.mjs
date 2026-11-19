// Run: node --experimental-strip-types scripts/benchmark-terminal-trackers.mjs
// Optional comparison: append --baseline <git-ref> (record the ref with results).
// Measures the tracker alone, not xterm, IPC, React rendering or input latency.
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { performance } from "node:perf_hooks";
import { TerminalCommandActivityTracker } from "../src/terminal/commandActivity.ts";
import { TerminalTargetTracker } from "../src/terminal/terminalTarget.ts";

const implementations = [];
const refIndex = process.argv.indexOf("--baseline");
if (refIndex !== -1) {
  const ref = process.argv[refIndex + 1];
  if (!ref || ref.startsWith("-")) throw new Error("Pass a git ref after --baseline");
  const trackers = {};
  for (const [file, name] of [["commandActivity", "TerminalCommandActivityTracker"], ["terminalTarget", "TerminalTargetTracker"]]) {
    const source = execFileSync("git", ["show", `${ref}:src/terminal/${file}.ts`], { encoding:"utf8" });
    const code = stripTypeScriptTypes(source);
    const baseline = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    trackers[name] = baseline[name];
  }
  implementations.push([ref, trackers]);
}
implementations.push(["current", { TerminalCommandActivityTracker, TerminalTargetTracker }]);
for (const [implementation, trackers] of implementations) {
  for (const [trackerName, Tracker] of Object.entries(trackers)) {
    for (const [scenario, data] of [["long lines", "x".repeat(16384)], ["short lines", ("x".repeat(79)+"\n").repeat(204)]]) {
      const repetitions = Math.floor(50_000_000 / data.length);
      const tracker = new Tracker();
      const start = performance.now();
      for (let index = 0; index < repetitions; index++) tracker.observeOutput(data);
      console.log(JSON.stringify({ implementation, trackerName, scenario, bytes:repetitions * data.length,
        ms:Math.round((performance.now()-start)*100)/100 }));
    }
  }
}
