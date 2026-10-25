import assert from "node:assert/strict";
import { test } from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
globalThis.window = { dispatchEvent: () => {} };

const {
  CommandInputTracker,
  COMMAND_HISTORY_DEFAULT_LIMIT,
  commandWasEchoed,
  clearCommandHistory,
  getCommandHistoryLimit,
  matchingCommands,
  recordCommand,
  setCommandCompletionEnabled,
  setCommandHistoryLimit,
} = await import("./commandCompletion.ts");

test("disabled by default and shared history keeps recent unique commands", () => {
  recordCommand("systemctl restart a.service");
  assert.deepEqual(matchingCommands("systemctl"), []);
  setCommandCompletionEnabled(true);
  recordCommand("systemctl restart a.service");
  recordCommand("systemctl restart b.service");
  recordCommand("systemctl restart a.service");
  assert.deepEqual(matchingCommands("systemctl"), [
    "systemctl restart a.service",
    "systemctl restart b.service",
  ]);
  assert.deepEqual(matchingCommands("systemctl restart a.service"), ["systemctl restart a.service"]);
  setCommandCompletionEnabled(false);
  assert.deepEqual(matchingCommands("systemctl"), []);
});

test("secret-bearing commands and non-shell prompts are ignored", () => {
  setCommandCompletionEnabled(true);
  recordCommand("export API_TOKEN=abc");
  assert.deepEqual(matchingCommands("export"), []);

  const tracker = new CommandInputTracker();
  for (const char of "systemctl restart c.service") tracker.observe(char, "$ ");
  assert.equal(tracker.observe("\r", "$ systemctl restart c.service"), "systemctl restart c.service");
  for (const char of "hidden-password") tracker.observe(char, "Password: ");
  assert.equal(tracker.observe("\r", "Password: "), null);
  assert.equal(tracker.line, "");
});

test("submission survives delayed echo and single-line bracketed paste", () => {
  const tracker = new CommandInputTracker();
  tracker.observe("\x1b[200~systemctl restart delayed.service\x1b[201~", "$ ");
  assert.equal(tracker.observe("\r", "$ "), "systemctl restart delayed.service");
  assert.equal(commandWasEchoed("systemctl restart delayed.service", ["$ "]), false);
  assert.equal(commandWasEchoed("systemctl restart delayed.service", [
    "$ systemctl restart ", "delayed.service   right prompt",
  ]), true);
  tracker.observe("\x1b[200~echo first\necho second\x1b[201~", "$ ");
  assert.equal(tracker.line, "");
});

test("configurable history limit persists and trims older commands", () => {
  assert.equal(getCommandHistoryLimit(), COMMAND_HISTORY_DEFAULT_LIMIT);
  setCommandCompletionEnabled(true);
  recordCommand("echo first");
  recordCommand("echo second");
  recordCommand("echo third");
  assert.equal(setCommandHistoryLimit(2), 2);
  assert.equal(getCommandHistoryLimit(), 2);
  assert.deepEqual(matchingCommands("echo"), ["echo third", "echo second"]);
  setCommandHistoryLimit(3);
  assert.deepEqual(matchingCommands("echo"), ["echo third", "echo second"]);
  assert.equal(setCommandHistoryLimit(0), 1);
  assert.equal(setCommandHistoryLimit(10000), 5000);
});

test("all matching commands remain available beyond six visible rows", () => {
  setCommandCompletionEnabled(true);
  for (let index = 0; index < 8; index += 1) {
    recordCommand(`scrollcase-${index}`);
  }
  const matches = matchingCommands("scrollcase-");
  assert.equal(matches.length, 8);
  assert.deepEqual(matches, Array.from({ length: 8 }, (_, index) => `scrollcase-${7 - index}`));
});

test("clearing history removes every saved command but keeps preferences", () => {
  clearCommandHistory();
  assert.deepEqual(matchingCommands("scrollcase-"), []);
  assert.equal(getCommandHistoryLimit(), 5000);
  recordCommand("echo after-clear");
  assert.deepEqual(matchingCommands("echo after"), ["echo after-clear"]);
});
