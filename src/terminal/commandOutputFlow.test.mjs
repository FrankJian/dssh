import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { CommandOutputTracker, COMMAND_OUTPUT_LIMIT } from './commandOutput.ts';
import { TerminalOutputStream } from './terminalOutputStream.ts';

const osc = s => `\x1b]133;${s}\x07`;
function begin(tracker) { tracker.output(osc('A') + 'demo$ ' + osc('B') + 'demo'); tracker.input('\r'); tracker.output('\r\n' + osc('C')); }

test('four bounded captures with real xterm and ACK credit survive 64 MB flood and accept input before drain', {timeout:15000}, async context => {
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm');
  const terminal = new Terminal({cols:100,rows:30,scrollback:100});
  const trackers = ['a','b','c','d'].map(id => new CommandOutputTracker(id));
  trackers.forEach(begin);
  const chunk = 'x'.repeat(16000); // no line breaks: also exercises bounded long-line state
  const total = chunk.length * 4000;
  const credit = 128 * 1024;
  let callback, sent = 0, acknowledged = 0, queued = 0, maxQueued = 0, interrupted = false;
  let complete, fail;
  const done = new Promise((resolve,reject) => { complete=resolve; fail=reject; });
  const before = process.memoryUsage(); const started = performance.now(); let maxParseMs = 0; let peakHeap=before.heapUsed, peakRss=before.rss, packets=0;
  function pump() {
    while (sent < total && sent + chunk.length - acknowledged <= credit) {
      const startOffset=sent; sent += chunk.length;
      callback({type:'output',sessionId:'a',subscriptionId:'qa',data:chunk,startOffset,endOffset:sent});
    }
  }
  const stream = new TerminalOutputStream({
    token:()=>'qa', unsubscribe:async()=>{},
    subscribe:async(id,token,fn)=>{callback=fn;return {session:{id,kind:'local',profileId:'local',title:id,status:'connected'},data:'',startOffset:0,endOffset:0};},
    acknowledge:async(_id,_token,end)=>{acknowledged=end;if(end===total)complete();else pump();},
  }, event => new Promise(resolve => {
    const begin=performance.now();trackers.forEach(tracker => tracker.output(event.data));maxParseMs=Math.max(maxParseMs,performance.now()-begin);
    if (++packets % 64 === 0) { const sample=process.memoryUsage(); peakHeap=Math.max(peakHeap,sample.heapUsed); peakRss=Math.max(peakRss,sample.rss); }
    queued += event.data.length;maxQueued=Math.max(maxQueued,queued);
    terminal.write(event.data,()=>{queued-=event.data.length;resolve();});
  }),()=>{},fail);
  const input = terminal.onData(data=>{if(data==='\x03'){trackers[0].input(data);interrupted=queued>0;}});
  try {
    await stream.start('a',()=>{});pump();terminal.input('\x03',true);
    assert.ok(interrupted);await done;
    trackers.forEach(tracker => tracker.output(osc('D;0')));
    assert.equal(trackers[0].snapshot().length,0);
    for (const tracker of trackers.slice(1)) {
      assert.equal(tracker.snapshot()[0].output.length,COMMAND_OUTPUT_LIMIT);
      assert.equal(tracker.snapshot()[0].truncated,true);
    }
    assert.ok(maxQueued<=credit);assert.equal(queued,0);assert.equal(acknowledged,total);
    const after=process.memoryUsage();
    context.diagnostic(JSON.stringify({bytes:total,captures:4,elapsedMs:Math.round(performance.now()-started),maxParseMs:Math.round(maxParseMs*100)/100,maxQueued,sampledPeakHeapDelta:peakHeap-before.heapUsed,sampledPeakRssDelta:peakRss-before.rss,heapDelta:after.heapUsed-before.heapUsed,rssDelta:after.rss-before.rss}));
  } finally {stream.stopAll();input.dispose();terminal.dispose();}
});
