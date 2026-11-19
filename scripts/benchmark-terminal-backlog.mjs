// Run: node --experimental-strip-types scripts/benchmark-terminal-backlog.mjs
// Synthetic small-packet stress; not a measure of xterm/IPC/SSH throughput.
import { performance } from "node:perf_hooks";
import { createBacklog, appendToBacklog } from "../src/terminal/sessionBacklog.ts";
import { RETAINED_OUTPUT_CHARS as limit } from "../src/settings/settings.ts";
const count = 1_000_000;
for (const baseline of [true, false]) {
  const backlog = createBacklog();
  const start = performance.now();
  for (let index = 0; index < count; index++) {
    if (!baseline) appendToBacklog(backlog, "x");
    else {
      backlog.chunks.push("x");
      backlog.length++;
      while (backlog.chunks.length > 1 && backlog.length - backlog.chunks[0].length >= limit) {
        backlog.length -= backlog.chunks.shift().length;
      }
    }
  }
  console.log(JSON.stringify({ implementation: baseline ? "previous shift" : "head index", chunks: count,
    retained: backlog.length, ms: Math.round(performance.now() - start) }));
}
