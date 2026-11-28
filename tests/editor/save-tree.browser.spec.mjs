import { test, expect } from '@playwright/test';
async function ready(page, local = false) {
  await page.goto(`/tests/editor/workbench.html${local ? '?local' : ''}`);
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
}
async function draft(page) {
  await page.evaluate(() => window.workbenchFixture.handle.execute('editorNewFile'));
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.evaluate(() => {
    const f = window.workbenchFixture; const model = f.monaco.editor.getModels().filter(m => m.uri.scheme === 'dssh-editor').at(-1);
    model.setValue('synthetic new file\n');
  });
}
async function pathPrompt(page, path) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible(); await dialog.getByRole('textbox').fill(path); await dialog.getByRole('button', { name: '确定', exact: true }).click();
}
for (const local of [false, true]) test(`${local ? 'local' : 'SFTP'} first save refreshes and selects the file without losing expanded folders`, async ({ page }) => {
  await ready(page, local);
  await page.locator('[data-path="/root/nested"]').click(); await expect(page.locator('[data-path="/root/nested/child.txt"]')).toBeVisible();
  await draft(page);
  if (local) {
    await page.evaluate(() => { window.workbenchFixture.nativeSelection.path = '/root/first-save.txt'; });
    await page.getByRole('button', { name: '保存当前文件', exact: true }).click();
  } else {
    await page.locator('.monaco-editor textarea').focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await pathPrompt(page, '/root/first-save.txt');
  }
  const saved = page.locator('[data-path="/root/first-save.txt"]');
  await expect(saved).toBeVisible(); await expect(saved).toHaveAttribute('aria-selected', 'true');
  if (!local) expect(await page.evaluate(() => !!document.activeElement?.closest('.monaco-editor'))).toBe(true);
  await expect(page.locator('[data-path="/root/nested/child.txt"]')).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.files.get('/root/first-save.txt').content)).toBe('synthetic new file\n');
});

test('save as refreshes and expands the destination while preserving the old file and root', async ({ page }) => {
  await ready(page);
  await page.locator('[data-path="/root/a2.ts"]').dblclick(); await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.evaluate(() => window.workbenchFixture.handle.execute('editorSaveAs'));
  await pathPrompt(page, '/root/nested/copied.txt');
  await expect(page.locator('[data-path="/root/nested/copied.txt"]')).toBeVisible();
  await expect(page.locator('[data-path="/root/nested/copied.txt"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await expect(page.getByRole('group', { name: '项目根目录', exact: true })).toHaveAttribute('title', '/root');
});

test('save while closing still updates the tree after the document is released', async ({ page }) => {
  await ready(page); await draft(page);
  await page.getByRole('button', { name: /关闭 未命名/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await pathPrompt(page, '/root/.saved-on-close.txt');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.locator('[data-path="/root/.saved-on-close.txt"]')).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().filter(m => m.uri.scheme === 'dssh-editor').length)).toBe(0);
});

test('cancelled, failed and outside-root saves do not create misleading tree entries or change roots', async ({ page }) => {
  await ready(page); await draft(page);
  const reads = await page.evaluate(() => window.workbenchFixture.reads.length);
  await page.getByRole('button', { name: '保存当前文件', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.reads.length)).toBe(reads);
  await page.evaluate(() => { window.workbenchFixture.writeFailure.enabled = true; });
  await page.getByRole('button', { name: '保存当前文件', exact: true }).click(); await pathPrompt(page, '/root/failed.txt');
  await expect(page.locator('.editor-error')).toContainText('合成保存失败');
  await expect(page.locator('[data-path="/root/failed.txt"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.workbenchFixture.reads.length)).toBe(reads);
  await page.evaluate(() => { window.workbenchFixture.writeFailure.enabled = false; });
  await page.getByRole('button', { name: '保存当前文件', exact: true }).click(); await pathPrompt(page, '/outside/saved.txt');
  await expect(page.getByRole('tab', { name: /saved.txt/ })).toBeVisible();
  await expect(page.locator('[data-path="/outside/saved.txt"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.workbenchFixture.reads.length)).toBe(reads);
  await expect(page.getByRole('group', { name: '项目根目录', exact: true })).toHaveAttribute('title', '/root');
});

test('an in-flight save completed while locked is revealed after unlock', async ({ page }) => {
  await ready(page, true); await draft(page);
  await page.evaluate(async () => {
    const f = window.workbenchFixture; f.nativeSelection.path = '/root/unlock-save.txt';
    const { EditorFileProvider } = await import('/src/editor/fileProvider.ts');
    const original = EditorFileProvider.prototype.save;
    const pending = new Promise(resolve => { window.releaseSave = resolve; });
    EditorFileProvider.prototype.save = async function (...args) { window.saveStarted = true; await pending; return original.apply(this, args); };
    window.pendingSave = f.handle.save();
  });
  await expect.poll(() => page.evaluate(() => window.saveStarted)).toBe(true);
  const reads = await page.evaluate(() => window.workbenchFixture.reads.length);
  await page.evaluate(() => window.workbenchFixture.lock(true)); await page.evaluate(() => window.releaseSave());
  await page.evaluate(() => window.pendingSave);
  expect(await page.evaluate(() => window.workbenchFixture.reads.length)).toBe(reads);
  await page.evaluate(() => window.workbenchFixture.lock(false));
  await expect(page.locator('[data-path="/root/unlock-save.txt"]')).toBeVisible();
});

test('save all refreshes every already-expanded destination directory', async ({ page }) => {
  await ready(page); await page.locator('[data-path="/root/nested"]').click();
  await expect(page.locator('[data-path="/root/nested/child.txt"]')).toBeVisible();
  await draft(page); await draft(page);
  await page.evaluate(() => { window.batchSave = window.workbenchFixture.handle.saveAll(); });
  await pathPrompt(page, '/root/nested/batch-a.txt');
  await expect(page.getByRole('tab', { name: /batch-a.txt/ })).toBeVisible();
  await pathPrompt(page, '/root/batch-b.txt'); await page.evaluate(() => window.batchSave);
  await expect(page.locator('[data-path="/root/nested/batch-a.txt"]')).toBeVisible();
  await expect(page.locator('[data-path="/root/batch-b.txt"]')).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(2);
});
