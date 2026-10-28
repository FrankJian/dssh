import assert from "node:assert/strict";
import { test } from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
globalThis.window = new EventTarget();

const {
  CommandInputTracker,
  COMMAND_HISTORY_DEFAULT_LIMIT,
  clearCommandHistory,
  getCommandHistoryLimit,
  getCommandHistoryCount,
  matchingCommands,
  recordCommand,
  setCommandCompletionEnabled,
  setCommandHistoryLimit,
  commandHistoryClearedEvent,
  commandCompletionEnabled,
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

test("submission accepts single-line bracketed paste and rejects multiline input", () => {
  const tracker = new CommandInputTracker();
  tracker.observe("\x1b[200~systemctl restart delayed.service\x1b[201~", "$ ");
  assert.equal(tracker.observe("\r", "$ "), "systemctl restart delayed.service");
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

test("a five-command cap stores five unique records while matching filters by prefix", () => {
  clearCommandHistory();
  setCommandHistoryLimit(5);
  for (const command of ["echo one", "echo two", "echo three", "echo four", "pwd"]) recordCommand(command);
  assert.equal(getCommandHistoryCount(), 5);
  assert.equal(matchingCommands("echo").length, 4);
  recordCommand("echo one");
  assert.equal(getCommandHistoryCount(), 5);
  clearCommandHistory();
  assert.equal(getCommandHistoryCount(), 0);
});

test("shell Tab completion and command line edits recover the final echoed input", () => {
  const tracker = new CommandInputTracker();
  tracker.observe("systemct", "$ ");
  tracker.observe("\t", "$ systemct");
  assert.equal(tracker.canSuggest, false);
  assert.equal(tracker.observe("\r", "$ systemctl", "systemctl"), "systemctl");
  tracker.observe("\x1b[A", "$ ");
  assert.equal(tracker.observe("\r", "$ echo previous", "echo previous"), "echo previous");
  assert.equal(tracker.observe("secret\r", "Password: ", "secret"), null);
});

test("submitted commands are stored immediately without output or exit-code reporting", () => {
  setCommandCompletionEnabled(true);
  setCommandHistoryLimit(5);
  clearCommandHistory();
  const tracker = new CommandInputTracker();
  for (const command of ["echo hello", "ls --invalid-option"]) {
    tracker.observe(command, "$ ");
    const submitted = tracker.observe("\r", `$ ${command}`);
    assert.equal(submitted, command);
    recordCommand(submitted);
    assert.deepEqual(matchingCommands(command), [command]);
  }
  assert.equal(getCommandHistoryCount(), 2);
});

test("input recording does not depend on a painted or recognizable shell prompt", () => {
  setCommandCompletionEnabled(true);
  setCommandHistoryLimit(5);
  clearCommandHistory();
  let changes = 0;
  const onChange = () => { changes += 1; };
  window.addEventListener("dssh:command-history-changed", onChange);
  try {
    for (const visibleLine of ["", "➜  ~ ", "custom prompt λ ", "[user@host ~]$ e"]) {
      const tracker = new CommandInputTracker();
      tracker.observe("echo hello", visibleLine);
      assert.equal(tracker.canSuggest, true);
      const command = tracker.observe("\r", "echo hello");
      assert.equal(command, "echo hello");
      recordCommand(command);
      assert.equal(getCommandHistoryCount(), 1);
      assert.deepEqual(matchingCommands("echo"), ["echo hello"]);
    }
    assert.equal(changes, 4);
  } finally {
    window.removeEventListener("dssh:command-history-changed", onChange);
  }
});

test("credential prompts still exclude hidden input without requiring shell integration", () => {
  for (const prompt of ["Password: ", "Enter passphrase: ", "验证码："]) {
    const tracker = new CommandInputTracker();
    tracker.observe("private-value", prompt);
    assert.equal(tracker.observe("\r", prompt), null);
    tracker.observe("pwd", "custom λ ");
    assert.equal(tracker.observe("\r", "custom λ pwd"), "pwd");
  }
});

test("clearing history keeps input recording active without reconnecting or setup", () => {
  setCommandCompletionEnabled(true);
  setCommandHistoryLimit(5);
  const tracker = new CommandInputTracker();
  let clearedEvents = 0;
  const onClear = () => { clearedEvents += 1; };
  window.addEventListener(commandHistoryClearedEvent, onClear);
  try {
    tracker.observe("echo before-clear", "$ ");
    recordCommand(tracker.observe("\r", "$ echo before-clear"));
    clearCommandHistory();
    assert.equal(getCommandHistoryCount(), 0);
    assert.equal(clearedEvents, 1);
    tracker.observe("echo after-clear", "$ ");
    recordCommand(tracker.observe("\r", "$ echo after-clear"));
    assert.deepEqual(matchingCommands("echo"), ["echo after-clear"]);
    assert.equal(getCommandHistoryCount(), 1);
    assert.equal(getCommandHistoryLimit(), 5);
    assert.equal(commandCompletionEnabled(), true);
  } finally {
    window.removeEventListener(commandHistoryClearedEvent, onClear);
  }
});
