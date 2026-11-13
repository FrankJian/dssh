import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromeThemeHeader } from './rdp-chrome-theme.mjs';

const css = readFileSync(new URL('../src/theme/global.css', import.meta.url), 'utf8');
function luminance(hex) {
  const rgb = [16, 8, 0].map((shift) => ((hex >> shift) & 255) / 255);
  return rgb.map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
}
function contrast(a, b) {
  const levels = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (levels[0] + .05) / (levels[1] + .05);
}
test('workbench themes generate readable opaque native toolbar palettes', () => {
  const header = chromeThemeHeader(css);
  for (const theme of ['dark', 'light']) {
    const values = header.match(new RegExp(`dssh_chrome_${theme} = \\{ ([^}]+) \\}`))[1]
      .split(', ').map((v) => Number(v));
    assert.equal(values.length, 10);
    assert.ok(values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff));
    const [surface, , text, muted, , , , , closeHover, onDanger] = values;
    assert.ok(contrast(surface, text) >= 4.5, `${theme}: title contrast`);
    assert.ok(contrast(surface, muted) >= 3, `${theme}: grip contrast`);
    assert.ok(contrast(closeHover, onDanger) >= 4.5, `${theme}: close hover contrast`);
  }
});
test('missing or unsupported native theme tokens fail the build explicitly', () => {
  const textBase = /--text-base:\s*#[\da-f]{6};/i;
  assert.match(css, textBase);
  assert.throws(() => chromeThemeHeader(css.replace(textBase, '')), /Missing RDP chrome token: text-base/);
  assert.throws(() => chromeThemeHeader(css.replace(textBase, '--text-base: var(--text-strong);')), /Unsupported RDP chrome token: text-base/);
});
