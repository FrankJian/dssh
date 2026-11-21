import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { normalizeTerminalScrollback, TERMINAL_SCROLLBACK_DEFAULT, TERMINAL_SCROLLBACK_MAX } from "./terminalScrollbackStore.ts";

let instance = 0;
async function withStore(raw, run) {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const key = "dssh.terminal.scrollbackLines";
  const values = new Map(raw === null ? [] : [[key, raw]]);
  const events = [];
  const storage = { getItem:k=>values.get(k) ?? null, setItem:(k,v)=>values.set(k,v) };
  Object.defineProperty(globalThis, "localStorage", { configurable:true,value:storage });
  Object.defineProperty(globalThis, "window", { configurable:true,value:{ addEventListener:(name,fn)=>{ if(name==="storage") events.push(fn); } } });
  try {
    const store = await import(`./terminalScrollbackStore.ts?test=${++instance}`);
    await run(store, {storage,values,key,events});
  } finally {
    if (oldStorage) Object.defineProperty(globalThis,"localStorage",oldStorage); else delete globalThis.localStorage;
    if (oldWindow) Object.defineProperty(globalThis,"window",oldWindow); else delete globalThis.window;
  }
}

test("scrollback has a finite PuTTY-style default and bounds invalid preferences", () => {
  assert.equal(TERMINAL_SCROLLBACK_DEFAULT,2000);
  for (const value of [NaN,Infinity,-Infinity,undefined,null,"unlimited",{}]) {
    assert.equal(normalizeTerminalScrollback(value),2000);
  }
  assert.equal(normalizeTerminalScrollback(0),0);
  assert.equal(normalizeTerminalScrollback(-1),0);
  assert.equal(normalizeTerminalScrollback(1e9),TERMINAL_SCROLLBACK_MAX);
  assert.equal(normalizeTerminalScrollback(2048),2048);
});

test("stored zero survives reload; absent, empty and corrupt storage use the default", async () => {
  for (const [raw, expected] of [[null,2000],["",2000],["oops",2000],["Infinity",2000],["0",0],["10000",10000]]) {
    await withStore(raw, async store=>assert.equal(store.getTerminalScrollback(),expected));
  }
});

test("changes persist and notify local subscribers, cross-window edits and clearing synchronize", async () => {
  await withStore(null, async (store,env)=>{
    let updates=0;
    const unsubscribe=store.subscribeTerminalScrollback(()=>updates++);
    store.setTerminalScrollback(5000);
    assert.equal(env.values.get(env.key),"5000");
    assert.equal(store.getTerminalScrollback(),5000);
    store.setTerminalScrollback(5000);
    assert.equal(updates,1);
    env.values.set(env.key,"0");
    for(const handler of env.events) handler({key:env.key});
    assert.equal(store.getTerminalScrollback(),0);
    env.values.clear();
    for(const handler of env.events) handler({key:null});
    assert.equal(store.getTerminalScrollback(),2000);
    assert.equal(updates,3);
    unsubscribe();
    store.setTerminalScrollback(1000);
    assert.equal(updates,3);
  });
});

test("storage write failure keeps the active history limit instead of reporting a saved setting", async () => {
  await withStore("5000",async(store,env)=>{
    env.storage.setItem=()=>{ throw new Error("quota"); };
    assert.throws(()=>store.setTerminalScrollback(0),/保存终端滚动历史设置失败/);
    assert.equal(store.getTerminalScrollback(),5000);
  });
});

test("real xterm discards oldest rows at the limit and changing it preserves the current screen", async () => {
  const { Terminal }=createRequire(import.meta.url)("@xterm/xterm");
  const terminal=new Terminal({cols:80,rows:5,scrollback:8});
  const write=data=>new Promise(resolve=>terminal.write(data,resolve));
  const contents=()=>Array.from({length:terminal.buffer.normal.length},(_,i)=>terminal.buffer.normal.getLine(i).translateToString(true)).join("\n");
  try {
    await write(Array.from({length:1000},(_,i)=>`line-${i}\r\n`).join(""));
    assert.equal(terminal.buffer.normal.length,13);
    assert.match(contents(),/line-999/);
    assert.doesNotMatch(contents(),/line-0\n/);
    terminal.options.scrollback=2;
    assert.equal(terminal.buffer.normal.length,7);
    assert.match(contents(),/line-999/);
    terminal.options.scrollback=0;
    assert.equal(terminal.buffer.normal.length,5);
    const screen=contents();
    terminal.options.scrollback=100;
    assert.equal(contents(),screen); // Increasing cannot resurrect discarded rows.
    await write("\x1b[?1049hTUI");
    const tuiRow=terminal.buffer.active.cursorY;
    terminal.options.scrollback=0;
    assert.equal(terminal.buffer.active.type,"alternate");
    assert.equal(terminal.buffer.active.cursorY,tuiRow);
    assert.match(terminal.buffer.active.getLine(tuiRow).translateToString(true),/TUI/);
  } finally { terminal.dispose(); }
});
