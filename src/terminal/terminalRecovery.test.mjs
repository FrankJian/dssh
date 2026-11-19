import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { OFFLINE_TERMINAL_MODES, RESTORE_CURSOR } from "./terminalRecovery.ts";
const { Terminal } = createRequire(import.meta.url)("@xterm/xterm");
const write = (terminal, data) => new Promise((resolve) => terminal.write(data, resolve));

async function cursorVisible(terminal) {
  let response = "";
  const listener = terminal.onData((data) => { response += data; });
  await write(terminal, "\x1b[?25$p");
  listener.dispose();
  return response === "\x1b[?25;1$y";
}

test("reconnect leaves the old TUI, restores cursor and clears stale reporting", async () => {
  const terminal = new Terminal();
  try {
    await write(terminal, "saved prompt\x1b[?1049h\x1b[?25l\x1b[?1003;1004;2004;2026h");
    assert.equal(await cursorVisible(terminal), false);
    await write(terminal, OFFLINE_TERMINAL_MODES);
    assert.equal(await cursorVisible(terminal), true);
    assert.equal(terminal.buffer.active.type, "normal");
    assert.equal(terminal.modes.sendFocusMode, false);
    assert.equal(terminal.modes.bracketedPasteMode, false);
    assert.equal(terminal.modes.synchronizedOutputMode, false);
    assert.equal(terminal.modes.mouseTrackingMode, "none");
    assert.equal(terminal.buffer.active.getLine(0).translateToString(true), "saved prompt");
  } finally { terminal.dispose(); }
});

for (const partial of ["\x1b[", "\x1b]0;unfinished title"]) {
  test(`manual recovery survives a partial ${JSON.stringify(partial)} without leaving the TUI`, async () => {
    const terminal = new Terminal();
    try {
      await write(terminal, "\x1b[?1049hfull screen\x1b[?25l" + partial);
      await write(terminal, RESTORE_CURSOR);
      assert.equal(await cursorVisible(terminal), true);
      assert.equal(terminal.buffer.active.type, "alternate");
      assert.equal(terminal.buffer.active.getLine(0).translateToString(true), "full screen");
    } finally { terminal.dispose(); }
  });
}
