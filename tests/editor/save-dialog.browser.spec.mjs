import { test, expect } from '@playwright/test';
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
