import assert from "node:assert/strict";
import { test } from "node:test";
import { TerminalCommandActivityTracker } from "./commandActivity.ts";

test("OSC 133 command markers track command completion", () => {
  const tracker = new TerminalCommandActivityTracker();
  assert.equal(tracker.observeOutput("\x1b]133;C\x07"), "running");
  assert.equal(tracker.observeOutput("working\r\n\x1b]133;D;0\x1b\\"), "idle");
});

test("split OSC 133 markers are recognised without leaking into the prompt fallback", () => {
  const tracker = new TerminalCommandActivityTracker();
  assert.equal(tracker.observeOutput("\x1b]133;"), null);
  assert.equal(tracker.observeOutput("C\x1b\\"), "running");
  assert.equal(tracker.observeOutput("\r\nuser@host:~$ "), "idle");
});

test("ordinary shells use command submission and prompt fallback", () => {
  const tracker = new TerminalCommandActivityTracker();
  assert.equal(tracker.observeInput("sleep 10\r"), "running");
  assert.equal(tracker.observeOutput("done\r\nuser@host:~$ "), "idle");
});

test("split CSI sequences after a prompt do not keep a finished command running", () => {
  const tracker = new TerminalCommandActivityTracker();
  tracker.observeOutput("user@host:~$ ");
  assert.equal(tracker.observeInput("sleep 1\r"), "running");
  tracker.observeOutput("sleep 1\r\n");
  tracker.observeOutput("\x1b[?2004");
  assert.equal(tracker.observeOutput("huser@host:~$ "), "idle");
});

test("a custom prompt is recognised when it returns", () => {
  const tracker = new TerminalCommandActivityTracker();
  tracker.observeOutput("[myhost] » ");
  tracker.observeInput("l");
  assert.equal(tracker.observeInput("s\r"), "running");
  tracker.observeOutput("ls\r\nfile\r\n");
  assert.equal(tracker.observeOutput("[myhost] » "), "idle");
});

test("a silent command stays active after its echoed input until the prompt returns", () => {
  const tracker = new TerminalCommandActivityTracker();
  tracker.observeOutput("user@host:~$ ");
  assert.equal(tracker.observeInput("sleep 30\r"), "running");
  assert.equal(tracker.observeOutput("sleep 30\r\n"), null);
  assert.equal(tracker.observeOutput("\x1b[?2004h"), null);
  assert.equal(tracker.observeOutput("user@host:~$ "), "idle");
});

test("an interactive child shell does not keep the tab marked as running", () => {
  const tracker = new TerminalCommandActivityTracker();
  tracker.observeOutput("user@host:~$ ");

  assert.equal(tracker.observeInput("bash -l\r"), null);
  // The parent shell can emit this after receiving Enter. It describes the
  // child-shell launch, not a blocking command that should animate the tab.
  assert.equal(tracker.observeOutput("\x1b]133;C\x07"), null);

  assert.equal(tracker.observeInput("sleep 30\r"), "running");
  assert.equal(tracker.observeOutput("done\r\nuser@host:~$ "), "idle");
});

test("shell commands that run a script or -c command remain blocking", () => {
  const tracker = new TerminalCommandActivityTracker();
  assert.equal(tracker.observeInput("bash deploy.sh\r"), "running");
  assert.equal(tracker.observeOutput("done\r\nuser@host:~$ "), "idle");

  assert.equal(tracker.observeInput("bash -c 'sleep 30'\r"), "running");
});

test("Ctrl+C clears an active command immediately", () => {
  const tracker = new TerminalCommandActivityTracker();
  tracker.observeInput("top\r");
  assert.equal(tracker.observeInput("\x03"), "idle");
});
