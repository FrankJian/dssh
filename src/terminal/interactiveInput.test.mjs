import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TerminalTargetTracker } from './terminalTarget.ts';
import { TerminalCommandActivityTracker } from './commandActivity.ts';

test('observed interactive input identifies a JumpServer asset after the shell opens', () => {
  const target = new TerminalTargetTracker();
  target.observeOutput('Welcome to JumpServer\r\nOpt> ');
  assert.equal(target.address, null);
  target.observeInput('10.20.30.40\r');
  target.observeOutput('10.20.30.40\r\n[deploy@app ~]$ ');
  assert.equal(target.address, '10.20.30.40');
});

test('observed AI input marks a remote command running until its prompt returns', () => {
  const activity = new TerminalCommandActivityTracker();
  activity.observeOutput('[deploy@app ~]$ ');
  assert.equal(activity.observeInput('sleep 10\r'), 'running');
  assert.equal(activity.observeOutput('sleep 10\r\n[deploy@app ~]$ '), 'idle');
});
