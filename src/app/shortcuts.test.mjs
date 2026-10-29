import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

// A separate runtime per OS ensures platform detection is exercised as shipped.
for (const platform of ['Macintosh', 'Windows NT']) {
  test(`${platform}: bindings, shell handoff and workspace dispatch`, () => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ${JSON.stringify(platform)} } });
      const data = new Map();
      globalThis.localStorage = {
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key),
      };
      const s = await import(${JSON.stringify(new URL('./shortcuts.ts', import.meta.url).href)});
      const mac = ${platform === 'Macintosh'};
      function key(id, extra = {}) {
        const b = s.getShortcutBinding(id);
        return { key: b.key, ctrlKey: b.primary && !mac, metaKey: b.primary && mac,
          shiftKey: b.shift, altKey: b.alt, repeat: false, isComposing: false, defaultPrevented: false, ...extra };
      }
      assert.equal(s.getShortcutDefinitions().length, 26);
      for (const def of s.getShortcutDefinitions()) {
        assert.equal(s.findShortcutConflict(def.id, def.defaultBinding), null, def.id);
        if (def.input === 'key') assert(s.matchesShortcut(key(def.id), def.id));
      }
      for (const id of s.ACTION_SHORTCUT_IDS) {
        assert(s.isAppShortcut(key(id)), id + ' must not reach shell');
        assert.equal(s.resolveActionShortcut(key(id), [id]), id);
        assert.equal(s.resolveActionShortcut(key(id), []), null);
        assert.equal(s.resolveActionShortcut(key(id), [id], { blocked:true }), null);
        for (const field of ['repeat', 'isComposing', 'defaultPrevented']) {
          assert.equal(s.resolveActionShortcut(key(id, { [field]:true }), [id]), null);
        }
      }
      for (const id of ['splitHorizontal','splitVertical','closePane','closeTab','nextTab','newLocalTerminal']) {
        assert.equal(s.resolveActionShortcut(key(id), [id], {editing:true}), null);
      }
      assert.equal(s.resolveActionShortcut(key('focusTerminal'), ['focusTerminal'], {editing:true}), 'focusTerminal');
      assert(!s.isAppShortcut({key:'c', ctrlKey:true, metaKey:false, altKey:false, shiftKey:false}));
      assert(!s.isAppShortcut({key:'d', ctrlKey:true, metaKey:false, altKey:false, shiftKey:false}));
      assert(!s.matchesShortcut(key('splitHorizontal', {ctrlKey:true, metaKey:true}), 'splitHorizontal'));
      assert(!s.matchesShortcut(key('splitHorizontal', {isComposing:true}), 'splitHorizontal'));
      // Existing overrides survive the expanded registry and still reach the app.
      const custom = {primary:true, shift:true, alt:false, key:'y'};
      s.setShortcutBinding('splitHorizontal', custom);
      assert(s.isAppShortcut(key('splitHorizontal')));
      assert.equal(s.resolveActionShortcut(key('splitHorizontal'), ['splitHorizontal']), 'splitHorizontal');
      assert.equal(s.findShortcutConflict('splitVertical', custom).id, 'splitHorizontal');
      assert.equal(s.getShortcutBinding('commandPalette').key, 'k');
      s.resetShortcutBinding('splitHorizontal');
      assert.equal(s.getShortcutBinding('splitHorizontal').key, 'e');
      // Old customized terminal actions win over newly introduced defaults.
      s.setShortcutBinding('copyTerminalSelection', s.getShortcutBinding('splitHorizontal'));
      assert(!s.matchesShortcut(key('splitHorizontal'), 'splitHorizontal'));
      assert(s.matchesShortcut(key('splitHorizontal'), 'copyTerminalSelection'));
      assert(!s.isAppShortcut(key('splitHorizontal')));
      s.resetShortcutBinding('copyTerminalSelection');
      assert.equal(s.cycleItem(['a','b','c'], 'c', 1), 'a');
      assert.equal(s.cycleItem(['a','b','c'], 'a', -1), 'c');
      assert.equal(s.cycleItem(['a','b','c'], null, -1), 'c');
      assert.equal(s.cycleItem([], null, 1), null);
    `], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
