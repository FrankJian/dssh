import { test, expect } from '@playwright/test';
async function ready(page) {
  await page.goto('/tests/editor/reuse-empty.html');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.emptyEditorFixture.handles.size)).toBe(1);
}
const id = page => page.getByRole('tab').first().getAttribute('data-id');

test('a chosen directory replaces a blank workbench in place and remote folders use the same rule', async ({ page }) => {
  await ready(page); const first = await id(page);
  await page.evaluate(() => { window.emptyEditorFixture.selected = '/project'; });
  await page.getByRole('button', { name: '选择目录', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(1); await expect(page.getByRole('tab')).toHaveText('project');
  expect(await id(page)).toBe(first);
  await expect(page.getByRole('treeitem').filter({ hasText: 'sample.txt' })).toBeVisible();
  expect(await page.evaluate(() => window.emptyEditorFixture.closed)).toEqual(['blank-1']);
  await page.getByRole('treeitem').filter({ hasText: 'sample.txt' }).dblclick(); await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.getByRole('button', { name: '明确新建', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.emptyEditorFixture.handles.size)).toBe(2);
  const before = await page.getByRole('tab').nth(1).getAttribute('data-id');
  await page.evaluate(() => window.emptyEditorFixture.openFolder('/remote', false, { kind: 'sftp', profileId: 'synthetic-remote' }));
  await expect(page.getByRole('tab')).toHaveCount(2); expect(await page.getByRole('tab').nth(1).getAttribute('data-id')).toBe(before);
  expect(await page.evaluate(() => window.emptyEditorFixture.tabs()[1].workspace.source)).toEqual({ kind: 'sftp', profileId: 'synthetic-remote' });
});

test('even untouched untitled files, loaded files and images protect their workbench', async ({ page }) => {
  for (const kind of ['untitled', 'file', 'image']) {
    await ready(page); const first = await id(page);
    const protectedState = await page.evaluate(async kind => {
      const f = window.emptyEditorFixture; const h = f.handles.get(f.tabs()[0].id);
      if (kind === 'untitled') h.newFile(); else await h.open(kind === 'file' ? '/sample.txt' : '/sample.png');
      return h.claimEmpty();
    }, kind);
    expect(protectedState).toBe(false);
    await page.evaluate(() => window.emptyEditorFixture.openFolder('/project'));
    await expect(page.getByRole('tab')).toHaveCount(2); expect(await id(page)).toBe(first);
    expect(await page.evaluate(() => window.emptyEditorFixture.closed)).toEqual([]);
    await page.getByRole('tab').first().click();
    if (kind === 'image') await expect(page.getByRole('button', { name: '关闭图片预览' })).toBeVisible();
    else await expect(page.locator('.monaco-editor').filter({ visible: true })).toBeVisible();
  }
});

test('directory selection cancel or failure leaves the blank tab and source unchanged', async ({ page }) => {
  await ready(page); const first = await id(page);
  await page.getByRole('button', { name: '选择目录', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(1); expect(await id(page)).toBe(first);
  await page.evaluate(() => { const f = window.emptyEditorFixture; f.fail = true; f.selected = '/project'; });
  await page.getByRole('button', { name: '选择目录', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('合成选择失败');
  expect(await page.evaluate(() => ({ opened: window.emptyEditorFixture.opened, root: window.emptyEditorFixture.tabs()[0].workspace.rootPath }))).toEqual({ opened: [], root: null });
});

test('a draft created while a directory is opening remains in its original workbench', async ({ page }) => {
  await ready(page); const first = await id(page);
  await page.evaluate(() => { const f = window.emptyEditorFixture; f.deferFolder = true; void f.openFolder('/project'); });
  await page.evaluate(() => { const f = window.emptyEditorFixture; f.handles.get(f.tabs()[0].id).newFile(); });
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.insertText('preserve this draft');
  await page.evaluate(() => window.emptyEditorFixture.releaseFolder());
  await expect(page.getByRole('tab')).toHaveCount(2); expect(await id(page)).toBe(first);
  await page.getByRole('tab').first().click(); await expect(page.locator('.view-lines').filter({ visible: true })).toContainText('preserve this draft');
  await expect(page.locator('.editor-dirty').filter({ visible: true })).toBeVisible();
});

test('an in-flight file read, locking and handoff prevent an empty claim', async ({ page }) => {
  await ready(page);
  const pending = await page.evaluate(() => {
    const f = window.emptyEditorFixture; f.deferRead = true; const h = f.handles.get(f.tabs()[0].id); void h.open('/slow.txt'); return h.claimEmpty();
  });
  expect(pending).toBe(false);
  await page.evaluate(() => window.emptyEditorFixture.openFolder('/project')); await expect(page.getByRole('tab')).toHaveCount(2);
  await page.evaluate(() => window.emptyEditorFixture.releaseRead());
  await page.getByRole('tab').first().click(); await expect(page.locator('.view-lines').filter({ visible: true })).toContainText('synthetic document');
  await ready(page); await page.getByRole('button', { name: '锁屏', exact: true }).click();
  expect(await page.evaluate(() => window.emptyEditorFixture.openFolder('/blocked'))).toBe(''); await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: '锁屏', exact: true }).click(); await page.getByRole('button', { name: '交接', exact: true }).click();
  expect(await page.evaluate(() => window.emptyEditorFixture.openFolder('/blocked'))).toBe(''); await expect(page.getByRole('tab')).toHaveCount(1);
});

test('same-folder concurrent opens coalesce while explicit new and other windows remain independent', async ({ page, context }) => {
  await ready(page); const first = await id(page);
  const result = await page.evaluate(() => Promise.all([window.emptyEditorFixture.openFolder('/project'), window.emptyEditorFixture.openFolder('/project')]));
  expect(result).toEqual([first, first]); await expect(page.getByRole('tab')).toHaveCount(1);
  await page.evaluate(() => window.emptyEditorFixture.openFolder('/project', true)); await expect(page.getByRole('tab')).toHaveCount(2);
  const other = await context.newPage(); await ready(other);
  await other.evaluate(() => window.emptyEditorFixture.openFolder('/another')); await expect(other.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab')).toHaveCount(2); expect(await page.getByRole('tab').first().textContent()).toBe('project');
  await other.close();
});
