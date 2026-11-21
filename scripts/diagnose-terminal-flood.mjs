// Public xterm APIs only. This isolates parser backlog from SSH and WebView UI.
// Run normal and --overflow separately. It is a finite burst, not a soak test.
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const { Terminal } = createRequire(import.meta.url)("@xterm/xterm");
const overflow = process.argv.includes("--overflow");
const terminal = new Terminal({ cols: 100, rows: 30, scrollback: 5000 });
const chunk = ("LOG " + "x".repeat(74) + "\r\n").repeat(200);
const target = overflow ? 52_000_000 : 8_000_000;
let accepted = 0, parsed = 0, error = null, interrupt = null;
let finish;
const drained = new Promise(resolve => { finish = resolve; });
const started = performance.now();
const observer = terminal.onData(data => {
  if (data === "\x03") interrupt = { received: true, pendingCharacters: accepted - parsed };
});

try {
  while (accepted < target) {
    try {
      terminal.write(chunk, () => {
        parsed += chunk.length;
        if (parsed === accepted) finish();
      });
      accepted += chunk.length;
    } catch (cause) {
      error = cause.message;
      break;
    }
  }
  // This bypasses DOM keyboard dispatch deliberately: it proves only whether
  // xterm's onData path waits for its queued output after a handler can run.
  terminal.input("\x03", true);
  console.log(JSON.stringify({ phase: "enqueued", acceptedCharacters: accepted,
    parsedCharacters: parsed, error, interrupt }, null, 2));
  await drained;
  console.log(JSON.stringify({ phase: "drained", parsedCharacters: parsed,
    elapsedMs: Math.round(performance.now() - started), retainedLines: terminal.buffer.normal.length }, null, 2));
} finally {
  observer.dispose();
  terminal.dispose();
}
