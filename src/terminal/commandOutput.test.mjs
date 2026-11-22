import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandOutputTracker, commandOutputPreview } from './commandOutput.ts';
const osc = (s) => `\x1b]133;${s}\x07`;
const prompt = (t) => t.output(osc('A') + 'user@host:~$ ' + osc('B'));
function start(t, command = 'demo') {
  prompt(t); t.input(command); t.output(command); t.input('\r'); t.output('\r\n' + osc('C'));
}
function finish(t, output = 'hello\r\n', exit = 0) { t.output(output + osc(`D;${exit}`)); }

test('only complete live A/B/C/D with submitted visible echo creates records', () => {
  const t = new CommandOutputTracker('one');
  t.input('hidden\r'); t.output('user$ command\r\noutput\r\nuser$ '); assert.equal(t.snapshot().length, 0);
  t.output(osc('C') + 'not qualified' + osc('D;0')); assert.equal(t.snapshot().length, 0);
  start(t); t.output('user@host:~$ '); assert.equal(t.snapshot().length, 0);
  finish(t, '\r\nstill running\r\n', 1);
  assert.equal(t.snapshot()[0].exitCode, 1);
  assert.equal(t.snapshot()[0].output, 'user@host:~$ \nstill running\n');
  start(t); finish(t, '');
  assert.deepEqual(t.snapshot().map(r => r.command), ['demo', 'demo']);
  assert.equal(t.snapshot()[0].output, '');
});
test('byte-by-byte split controls and plain text preserve output', () => {
  const t = new CommandOutputTracker('one'); prompt(t); t.output('demo'); t.input('\r');
  for (const char of '\r\n' + osc('C') + '\x1b[31m你好\x1b[0m  x\r\n' + osc('D;0')) t.output(char);
  assert.equal(t.snapshot()[0].output, '你好  x\n');
});
test('CR, erase line, backspace, tab and logical line without display wrapping', () => {
  const t = new CommandOutputTracker('one'); start(t);
  finish(t, 'progress 10%\r\x1b[2Kdone\r\nabc\bD\tE\n' + 'x'.repeat(10000));
  assert.equal(t.snapshot()[0].output, 'done\nabD     E\n' + 'x'.repeat(10000));
});
test('excluded input, interaction, unsupported screen controls, cancellation and resync', () => {
  for (const command of ['vim file', 'top', 'read answer', 'ssh host', 'bash', 'python', 'demo --token=fictional']) {
    const t = new CommandOutputTracker('one'); start(t, command); finish(t); assert.equal(t.snapshot().length, 0, command);
  }
  for (const output of ['Password: ', '验证码: ', 'Continue [y/n]', '\x1b[?1049htext', '\x1b[2J']) {
    const t = new CommandOutputTracker('one'); start(t); finish(t, output); assert.equal(t.snapshot().length, 0, output);
    start(t); finish(t); assert.equal(t.snapshot().length, 1);
  }
  const t = new CommandOutputTracker('one'); start(t); t.input('fictional-answer\r'); finish(t); assert.equal(t.snapshot().length, 0);
  start(t); t.input('\x03'); finish(t); assert.equal(t.snapshot().length, 0);
  prompt(t); t.input('echo-off\r'); t.output(osc('C') + osc('D')); assert.equal(t.snapshot().length, 0);
});
test('bounded UTF-8 prefix, duplicate eviction, immutable snapshots and notifications', () => {
  const t = new CommandOutputTracker('one', 7); let count = 0; let notifiedSnapshot = t.snapshot();
  const unsub = t.subscribe(() => { if (notifiedSnapshot !== t.snapshot()) { notifiedSnapshot = t.snapshot(); count++; } });
  for (let i = 0; i < 21; i++) { start(t); finish(t, '你你你' + 'x'.repeat(100000)); }
  assert.equal(count, 21); assert.equal(t.snapshot().length, 20);
  assert.equal(t.snapshot()[0].output, '你你'); assert.equal(t.snapshot()[0].truncated, true);
  assert.equal(t.snapshot()[19].sequence, 2);
  const previous = t.snapshot(); t.reset(); assert.equal(t.snapshot(), previous);
  t.reset(true); assert.equal(t.snapshot().length, 0); assert.equal(count, 22);
  unsub();
});
test('snapshot restore/gap discards pending execution; preview allocation is bounded', () => {
  const t = new CommandOutputTracker('one'); start(t); t.restore(); finish(t); assert.equal(t.snapshot().length, 0);
  start(t); finish(t); start(t); t.reset(); finish(t); assert.equal(t.snapshot().length, 1);
  assert.equal(commandOutputPreview(('x'.repeat(1000) + '\n').repeat(20)).length <= 8 * 241, true);
});


test('session ownership store survives view reuse, cancels gaps, imports handoff once, and cleans shell generation', async () => {
  const {attachCommandOutput,commandOutputTracker,forgetCommandOutput,exportCommandOutputs,importCommandOutputs,invalidateCommandOutputs} = await import('./commandOutputStore.ts');
  const one = attachCommandOutput('source'); const two = attachCommandOutput('other');
  start(one); finish(one, 'source only'); start(two); finish(two, 'other only');
  assert.equal(commandOutputTracker('source'), one);
  assert.equal(attachCommandOutput('source').snapshot()[0].output, 'source only');
  start(one); invalidateCommandOutputs(); finish(one); assert.equal(one.snapshot().length, 1);
  const handed = structuredClone(exportCommandOutputs(['source']));
  forgetCommandOutput('source'); assert.equal(commandOutputTracker('source'), undefined);
  importCommandOutputs(handed); const moved = commandOutputTracker('source');
  assert.equal(moved.snapshot()[0].output, 'source only');
  attachCommandOutput('source'); start(moved); finish(moved, 'after move');
  assert.notEqual(moved.snapshot()[0].id, moved.snapshot()[1].id);
  assert.equal(two.snapshot()[0].output, 'other only');
  moved.reset(true); assert.equal(moved.snapshot().length, 0);
  forgetCommandOutput('source'); forgetCommandOutput('other');
});


test('initial history can restore a marked prompt without replaying command records', () => {
  const t = new CommandOutputTracker('one');
  t.restore(osc('A') + 'demo$ ' + osc('B') + 'old' + osc('C') + 'old output' + osc('D;0') + osc('A') + 'demo$ ' + osc('B'));
  assert.equal(t.snapshot().length,0);
  t.output('demo'); t.input('\r'); t.output('\r\n'+osc('C')+'first live output'+osc('D;0'));
  assert.equal(t.snapshot()[0].output,'first live output');
});
test('UTF-8 truncation, supplementary overwrite, long interaction signals and malformed controls', () => {
  const t = new CommandOutputTracker('one', 5); start(t); finish(t,'😀😀');
  assert.equal(t.snapshot()[0].output,'😀'); assert.equal(t.snapshot()[0].truncated,true);
  const u = new CommandOutputTracker('two'); start(u); finish(u,'😀\bX'); assert.equal(u.snapshot().length,0);
  for (const text of ['Password: '+ 'x'.repeat(1000), '\x7f', '\x9b', '你好\rXX', '\x1b]'+ 'x'.repeat(10000)]) {
    const tracker = new CommandOutputTracker('three'); start(tracker); finish(tracker,text); assert.equal(tracker.snapshot().length,0);
  }
});


test('readline bracketed-paste toggles and clear-to-end echo do not break complete shell markers', () => {
  const t=new CommandOutputTracker('one');
  prompt(t);t.output('\x1b[?2004h\x1b[Kdemo');t.input('\r');
  t.output('\r\n\x1b[?2004l'+osc('C')+'result\r\n'+osc('D;0'));
  assert.equal(t.snapshot()[0].output,'result\n');
});
