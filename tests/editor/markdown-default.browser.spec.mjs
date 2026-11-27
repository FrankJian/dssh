import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
const source = page => page.getByRole('radio', { name: '源码', exact: true });
const rendered = page => page.getByRole('radio', { name: '所见即所得', exact: true });
const rich = page => page.getByRole('textbox', { name: 'Markdown 所见即所得编辑器', exact: true });
async function open(page, name) {
  await page.evaluate(async name => {
    const f = window.workbenchFixture, path = `/root/${name}`;
    f.files.set(path, { ...f.files.get('/root/a2.ts'), path, content: `# ${name}\n\nOriginal text.\n` });
    await f.handle.open(path);
  }, name);
}
for (const local of [false, true]) test(`new ${local ? 'local' : 'SFTP'} Markdown starts in source despite old preference and switches, edits and saves`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dssh.editor.markdownMode', 'rich'));
  await page.goto(`/tests/editor/workbench.html${local ? '?local' : ''}`);
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await open(page, 'first.md');
  await expect(source(page)).toBeChecked(); await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(rich(page)).toHaveCount(0); await expect(page.getByLabel('未保存', { exact: true })).toHaveCount(0);
  await rendered(page).check(); await expect(rich(page)).toBeVisible();
  await rich(page).getByRole('heading', { name: 'first.md', exact: true }).click();
  await page.keyboard.press('End'); await page.keyboard.insertText(' edited');
  await expect(page.getByLabel('未保存', { exact: true })).toBeVisible();
  await source(page).check(); await expect(page.locator('.monaco-editor')).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor').getValue())).toContain('# first.md edited');
  await page.evaluate(() => window.workbenchFixture.handle.save());
  expect(await page.evaluate(() => window.workbenchFixture.files.get('/root/first.md').content)).toContain('# first.md edited');
  await expect(page.getByLabel('未保存', { exact: true })).toHaveCount(0);
  await rendered(page).check(); await expect(rich(page)).toBeVisible();
  await open(page, 'second.md'); await expect(source(page)).toBeChecked();
  await page.getByRole('tab', { name: /first.md/ }).click(); await expect(rendered(page)).toBeChecked(); await expect(rich(page)).toBeVisible();
  await page.getByRole('tab', { name: /second.md/ }).click(); await expect(source(page)).toBeChecked();
  for (const [theme, width] of [['light', 1280], ['dark', 620]]) {
    await page.setViewportSize({ width, height: 720 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    const header = await page.locator('.editor-group__tabs').boundingBox();
    const modes = await page.getByRole('radiogroup', { name: 'Markdown 编辑模式' }).boundingBox();
    expect(header.height).toBe(32); expect(modes.y).toBeGreaterThanOrEqual(header.y);
    expect(modes.y + modes.height).toBeLessThanOrEqual(header.y + header.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: editorArtifact(`dssh-md-source-${local ? 'local' : 'sftp'}-${theme}.png`), animations: 'disabled' });
  }
  await page.getByRole('button', { name: '关闭 second.md', exact: true }).click();
  await page.getByRole('button', { name: '关闭 first.md', exact: true }).click();
  await open(page, 'first.md'); await expect(source(page)).toBeChecked();
});
