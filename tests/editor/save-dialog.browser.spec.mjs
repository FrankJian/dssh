import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
async function dirtyFile(page, path = '/root/nested/AGENTS.md') {
  await page.goto('/tests/editor/workbench.html?local');
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await page.evaluate(async path => {
    const f = window.workbenchFixture;
    f.files.set(path, { ...f.files.get('/root/a2.ts'), path, content: 'Original document\n' });
    await f.handle.open(path);
    f.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor').setValue('Changed document\n');
  }, path);
  await expect(page.locator('.monaco-editor')).toBeVisible();
}
const modal = page => page.getByRole('dialog', { name: '保存修改？', exact: true });
async function closeFile(page, label = 'AGENTS.md') { await page.getByRole('button', { name: `关闭 ${label}`, exact: true }).click(); await expect(modal(page)).toBeVisible(); }

test('save confirmation uses a quiet hierarchy, primary save and consistent narrow palettes', async ({ page }) => {
  const path = `/root/${'long-directory-'.repeat(14)}/documents/AGENTS.md`;
  await dirtyFile(page, path); await closeFile(page);
  await expect(modal(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await expect(modal(page).locator('.editor-save-dialog__name')).toHaveText('AGENTS.md');
  await expect(modal(page).locator('.editor-save-dialog__path')).toHaveAttribute('title', path);
  await expect(modal(page).getByRole('button', { name: '保存', exact: true })).toHaveClass(/button--primary/);
  await expect(modal(page).getByRole('button', { name: '放弃修改', exact: true })).toHaveClass(/button--ghost/);
  for (const [theme, width] of [['light', 1280], ['dark', 620], ['light', 360]]) {
    await page.setViewportSize({ width, height: 620 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    await expect(modal(page).locator('.profile-editor__topbar')).toHaveCSS('border-bottom-width', '0px');
    await expect(modal(page).locator('.app-dialog__footer')).toHaveCSS('border-top-width', '0px');
    const box = await modal(page).boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    for (const button of await modal(page).getByRole('button').all()) {
      const bounds = await button.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(box.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(box.y + box.height);
    }
    const discard = await modal(page).getByRole('button', { name: '放弃修改', exact: true }).boundingBox();
    const save = await modal(page).getByRole('button', { name: '保存', exact: true }).boundingBox(); expect(discard.x).toBeLessThan(save.x);
    await page.screenshot({ path: editorArtifact(`dssh-save-confirm-${theme}-${width}.png`), animations: 'disabled' });
  }
  await page.keyboard.press('Escape'); await expect(modal(page)).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(1); await expect(page.getByLabel('未保存', { exact: true })).toBeVisible();
  await closeFile(page); await modal(page).getByRole('button', { name: '关闭', exact: true }).click(); await expect(page.getByRole('tab')).toHaveCount(1);
  await closeFile(page); await modal(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(await page.evaluate(path => window.workbenchFixture.files.get(path).content, path)).toBe('Changed document\n');
});

test('save failure retains the document and unnamed discard has no fake path', async ({ page }) => {
  await dirtyFile(page); await page.evaluate(() => { window.workbenchFixture.writeFailure.enabled = true; });
  await closeFile(page); await modal(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.editor-error')).toContainText('合成保存失败'); await expect(page.getByRole('tab')).toHaveCount(1);
  await closeFile(page); await modal(page).getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(await page.evaluate(() => window.workbenchFixture.files.get('/root/nested/AGENTS.md').content)).toBe('Original document\n');
  await page.evaluate(() => window.workbenchFixture.handle.execute('editorNewFile'));
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.getByRole('button', { name: /关闭 未命名/ }).click(); await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator('.editor-save-dialog__name')).toHaveText('未命名文档');
  await expect(modal(page).locator('.editor-save-dialog__path')).toHaveCount(0);
  await modal(page).getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByRole('tab')).toHaveCount(1);
});
