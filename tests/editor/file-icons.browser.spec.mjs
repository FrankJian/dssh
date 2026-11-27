import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
const row = (page, name) => page.locator('.editor-tree-row').filter({ has: page.getByText(name, { exact: true }) });

async function ready(page) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/tests/editor/workbench.html?icons');
  await expect(row(page, 'package.json')).toBeVisible();
  await page.evaluate(() => document.fonts.load('24px "Duo Seti"'));
}

test('Seti loads locally and file names select the same glyph in tree, tabs and breadcrumbs', async ({ page }) => {
  const external = []; page.on('request', request => { if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) external.push(request.url()); });
  await ready(page);
  await page.getByRole('button', { name: '显示隐藏文件', exact: true }).click();
  const cases = { '.gitignore': '_git', '.gitattributes': '_git', 'build.rs': '_rust', 'Cargo.toml': '_config', 'Cargo.lock': '_default', 'Info.plist': '_xml', 'AGENTS.md': '_markdown', 'index.html': '_html_3', 'package.json': '_json', 'playwright.editor.config.ts': '_typescript', 'pnpm-lock.yaml': '_yml', 'README.md': '_info', 'TODO.md': '_todo', 'tsconfig.json': '_tsconfig', 'vite.config.ts': '_vite' };
  for (const [name, icon] of Object.entries(cases)) await expect(row(page, name).locator('.file-entry-icon')).toHaveAttribute('data-seti', icon);
  expect(await page.evaluate(() => document.fonts.check('24px "Duo Seti"'))).toBe(true);
  // Draw actual glyphs to ensure the font has ink and distinct families, not empty spans.
  const pixels = await page.evaluate(() => {
    return ['package.json', 'build.rs', 'README.md'].map(name => {
      const target = [...document.querySelectorAll('.editor-tree-row')].find(r => r.getAttribute('data-path') === `/root/${name}`).querySelector('.file-entry-icon__seti');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48; const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'black'; ctx.font = '32px "Duo Seti"'; ctx.fillText(target.getAttribute("data-glyph"), 8, 36);
      const data = ctx.getImageData(0, 0, 48, 48).data; return { ink: [...data].filter((_, i) => i % 4 === 3 && data[i] > 0).length, signature: canvas.toDataURL() };
    });
  });
  for (const image of pixels) expect(image.ink).toBeGreaterThan(20);
  expect(new Set(pixels.map(p => p.signature)).size).toBe(3);
  await page.screenshot({ path: editorArtifact('dssh-seti-file-tree.png'), animations: 'disabled' });
  await row(page, 'package.json').dblclick();
  const tab = page.getByRole('tab', { name: /package.json/ });
  const breadcrumb = page.getByRole('navigation', { name: '编辑器面包屑' }).locator('[aria-current="page"]');
  for (const item of [row(page, 'package.json'), tab, breadcrumb]) await expect(item.locator('.file-entry-icon')).toHaveAttribute('data-seti', '_json');
  const glyphs = await Promise.all([row(page, 'package.json'), tab, breadcrumb].map(item => item.locator('.file-entry-icon__seti').getAttribute('data-glyph')));
  expect(new Set(glyphs).size).toBe(1); expect(external).toEqual([]);
  await expect(page.locator('.editor-tree-row[data-path="/root/link.ts"]').locator('.file-entry-icon__link')).toBeVisible();
  await expect(row(page, 'nested').locator('.file-entry-icon')).toHaveAttribute('data-tone', 'folder');
});

test('Seti light colors, custom palettes and compact rows keep icons aligned without changing the model', async ({ page }) => {
  await ready(page); await row(page, 'build.rs').dblclick();
  const uri = await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor').uri.toString());
  const icon = row(page, 'build.rs').locator('.file-entry-icon'); let prior;
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    await page.setViewportSize({ width: theme === 'dark' ? 1280 : 620, height: 1000 });
    const color = await icon.evaluate(el => getComputedStyle(el).color);
    if (prior) expect(color).not.toBe(prior); prior = color;
    const bounds = await icon.boundingBox(); const entry = await row(page, 'build.rs').boundingBox();
    expect(Math.abs(bounds.y + bounds.height / 2 - entry.y - entry.height / 2)).toBeLessThan(1);
    expect(bounds.width).toBeLessThanOrEqual(18); expect(bounds.height).toBeLessThanOrEqual(18);
    await page.screenshot({ path: editorArtifact(`dssh-seti-icons-${theme}.png`), animations: 'disabled' });
  }
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor').uri.toString())).toBe(uri);
});
