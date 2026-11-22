import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CommandOutputTracker } from './commandOutput.ts';
const runner = fileURLToPath(new URL('../../scripts/test-shell-integration.py', import.meta.url));
for (const shell of ['bash','zsh']) {
  const skip = process.platform === 'win32' || !existsSync(`/bin/${shell}`);
  function run(scenario = 'normal', selected = shell) {
    const result = spawnSync('python3', [runner,shell,scenario,selected], {encoding:'utf8',timeout:15000});
    assert.equal(result.status,0, 'isolated PTY must exit successfully');
    return JSON.parse(result.stdout);
  }
  test(`${shell}: real PTY hooks capture ll alias and preserve prompt, existing hook, exit status and idempotence`, {skip,timeout:20000}, () => {
    const transcript = run(); assert.ok(transcript.bytes < 3900);
    const tracker = new CommandOutputTracker('pty'); tracker.restore(transcript.initial);
    for (const event of transcript.events) { tracker.input(event.input); tracker.output(event.output); }
    const records = tracker.snapshot();
    assert.deepEqual(records.map(r=>r.command),['ll','printf "status:%s\\n" "$?"','false','ll']);
    assert.ok(records[0].output.includes('example.txt'));
    assert.equal(records[1].output,'status:1\n');
    assert.equal(records[2].exitCode,1); assert.equal(records[2].output,'');
    assert.ok(records.every(r=>!r.output.includes('old-hook:') && !r.output.includes('before')));
    assert.ok(transcript.events.some(e=>e.output.includes('old-hook:1')));
    assert.ok(transcript.events[2].output.includes(shell === 'bash' ? 'before$' : 'before%'));
    assert.ok(transcript.events.slice(2,7).every(e=>(e.output.match(/\x1b\]133;C\x07/g)||[]).length===1));
    assert.equal(tracker.integrationSnapshot().state,'ready');
  });
  test(`${shell}: conflicting hooks and a mismatched shell do not install`, {skip,timeout:30000}, () => {
    for (const [scenario,selected,expected] of [['conflict',shell,'conflict'],['normal',shell==='bash'?'zsh':'bash','unsupported']]) {
      const transcript=run(scenario,selected);
      assert.ok(transcript.events[1].output.includes(`\x1b]133;DuoSshIntegration;${expected}\x07`));
      assert.ok(!transcript.events[2].output.includes('\x1b]133;C\x07'));
    }
  });
}

test('integration status is explicit, errors do not record commands, and reset clears the shell generation', () => {
  const tracker=new CommandOutputTracker('one'); assert.equal(tracker.integrationSnapshot().state,'unknown');
  tracker.beginIntegration(); assert.equal(tracker.integrationSnapshot().state,'enabling');
  tracker.output('\x1b]133;DuoSshIntegration;conflict\x07'); assert.equal(tracker.integrationSnapshot().state,'error');
  tracker.beginIntegration(); tracker.output('\x1b]133;DuoSshIntegration;ready\x07');
  assert.equal(tracker.integrationSnapshot().state,'ready'); assert.equal(tracker.snapshot().length,0);
  tracker.reset(true); assert.equal(tracker.integrationSnapshot().state,'unknown');
});

test('missing installation acknowledgement times out without claiming success or retrying', context => {
  context.mock.timers.enable({apis:['setTimeout']});
  const tracker=new CommandOutputTracker('one');
  tracker.beginIntegration(); context.mock.timers.tick(5001);
  assert.equal(tracker.integrationSnapshot().state,'error');
  assert.equal(tracker.snapshot().length,0);
  tracker.reset(true);
});


test('historical integration markers cannot claim that a newly connected shell is enabled', () => {
  const tracker=new CommandOutputTracker('one');
  const history='\x1b]133;DuoSshIntegration;ready\x07\x1b]133;A\x07old$ \x1b]133;B\x07';
  tracker.restore(history); assert.equal(tracker.integrationSnapshot().state,'unknown');
  tracker.output('\x1b]133;A\x07current$ \x1b]133;B\x07'); assert.equal(tracker.integrationSnapshot().state,'ready');
  tracker.reset(true); tracker.restore(history); assert.equal(tracker.integrationSnapshot().state,'unknown');
});
