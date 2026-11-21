import test from "node:test";
import assert from "node:assert/strict";
import { LINUX_COMMANDS, searchLinuxCommands } from "./linuxCommands.ts";

test("Linux quick reference searches command names, long options, and Chinese explanations", () => {
  assert.ok(searchLinuxCommands("SSH 跳板").some(({ name }) => name === "ssh"));
  assert.ok(searchLinuxCommands("--max-depth").some(({ name }) => name === "du"));
  assert.ok(searchLinuxCommands("  journalctl   --since  ").some(({ name }) => name === "journalctl"));
  assert.ok(searchLinuxCommands("监听端口").some(({ name }) => name === "ss"));
  assert.ok(searchLinuxCommands("awk 字段").some(({ name }) => name === "awk"));
  assert.ok(searchLinuxCommands("rsync --dry-run").some(({ name }) => name === "rsync"));
  assert.ok(searchLinuxCommands("续传", "网络与连接").some(({ name }) => name === "sftp"));
  assert.equal(searchLinuxCommands("no-such-command-xyz").length, 0);
});

test("Linux quick reference applies category and all search terms together", () => {
  assert.equal(searchLinuxCommands("ssh", "文件与权限").length, 0);
  assert.ok(searchLinuxCommands("", "文件与权限").every(({ category }) => category === "文件与权限"));
  assert.deepEqual(searchLinuxCommands("  "), LINUX_COMMANDS);
});

test("Every command has unique identity, HTTPS documentation, explained options, and copyable examples", () => {
  assert.equal(new Set(LINUX_COMMANDS.map(({ name }) => name)).size, LINUX_COMMANDS.length);
  for (const entry of LINUX_COMMANDS) {
    assert.ok(entry.summary && entry.syntax && entry.source.label, entry.name);
    assert.equal(new URL(entry.source.url).protocol, "https:");
    assert.ok(entry.options.length > 0 && entry.examples.length > 0, entry.name);
    assert.equal(new Set(entry.options.map(([flag]) => flag)).size, entry.options.length, entry.name);
    for (const [value, explanation] of [...entry.options, ...entry.examples]) {
      assert.ok(value.trim() && explanation.trim(), entry.name);
    }
    for (const [command] of entry.examples) {
      assert.ok(command === entry.name || command.startsWith(`${entry.name} `), command);
      assert.ok(!command.includes("\n"), command);
    }
  }
});
