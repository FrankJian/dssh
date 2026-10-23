import assert from "node:assert/strict";
import { test } from "node:test";
import { jumpServerAssetIp, TerminalTargetTracker } from "./terminalTarget.ts";

test("JumpServer direct-login username exposes the asset IP, not the gateway", () => {
  assert.equal(jumpServerAssetIp("alice@root@10.8.0.12@203.0.113.1"), "10.8.0.12");
  assert.equal(jumpServerAssetIp("alice"), null);
  assert.equal(jumpServerAssetIp("alice@root@999.8.0.12@gateway"), null);
});

test("unrelated output and an asset search table do not rename the tab", () => {
  const tracker = new TerminalTargetTracker();
  assert.equal(tracker.observeOutput("ping 10.0.0.99\r\n"), undefined);
  assert.equal(tracker.observeOutput("Welcome to JumpServer\r\n"), null);
  assert.equal(tracker.observeOutput("1) machine-a 10.8.0.12\r\n"), undefined);
  assert.equal(tracker.address, null);
});

test("JumpServer asset choice is promoted only after an asset shell prompt", () => {
  const tracker = new TerminalTargetTracker();
  tracker.observeOutput("Welcome to JumpServer\r\n1) machine-a 10.8.0.12\r\n");
  tracker.observeInput("1\r");
  assert.equal(tracker.address, null);
  assert.equal(tracker.observeOutput("Connecting...\r\n[root@machine-a ~]# "), "10.8.0.12");
  assert.equal(tracker.observeOutput("cat file 10.8.0.99\r\n"), undefined);
  assert.equal(tracker.address, "10.8.0.12");
});

test("JumpServer accepts an IP entered directly, but never mistakes its own OSC title for the asset", () => {
  const tracker = new TerminalTargetTracker();
  tracker.observeOutput("Welcome to JumpServer\r\n");
  tracker.observeInput("10.8.0.12\r");
  assert.equal(tracker.observeOutput("\x1b]0;JumpServer 203.0.113.1\x07"), undefined);
  assert.equal(tracker.observeOutput("user@asset:~$ "), "10.8.0.12");
});

test("split OSC title from an ordinary SSH shell can identify the connected IP", () => {
  const tracker = new TerminalTargetTracker();
  assert.equal(tracker.observeOutput("\x1b]0;ping 10.3.4.99\x07"), undefined);
  assert.equal(tracker.observeOutput("\x1b]0;root@10.3."), undefined);
  assert.equal(tracker.observeOutput("4.5: ~\x1b\\"), "10.3.4.5");
});

test("reconnection clears an old JumpServer asset while keeping the gateway hidden", () => {
  const tracker = new TerminalTargetTracker();
  tracker.observeOutput("Welcome to JumpServer\r\n");
  tracker.observeInput("10.8.0.12\r");
  tracker.observeOutput("root@asset:~# ");
  assert.equal(tracker.address, "10.8.0.12");
  assert.equal(tracker.resetConnection(), null);
  assert.equal(tracker.address, null);
});
