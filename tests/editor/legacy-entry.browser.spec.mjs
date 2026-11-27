import { test, expect } from '@playwright/test';
test('SFTP and local legacy text entry routes the actual pane source to the shared editor', async ({ page }) => {
  await page.goto('/tests/editor/legacy-entry.html');
  await page.getByText('remote-only.txt', { exact: true }).dblclick();
  await page.getByText('local-only.txt', { exact: true }).dblclick();
  await page.getByText('readme.md', { exact: true }).dblclick();
  expect(await page.evaluate(() => window.legacyEditorFixture.opened)).toEqual([
    { source: 'remote', path: '/remote/remote-only.txt', directory: false, rootPath: '/remote' },
    { source: 'local', path: '/local/local-only.txt', directory: false, rootPath: '/local' },
    { source: 'remote', path: '/remote/readme.md', directory: false, rootPath: '/remote' },
  ]);
  expect(await page.evaluate(() => window.legacyEditorFixture.calls.some((command) => command.includes('read_text') || command.includes('write_text')))).toBe(false);
  await page.getByText('photo.png', { exact: true }).dblclick();
  await expect(page.getByRole('img', { name: 'photo.png' })).toBeVisible();
  expect(await page.evaluate(() => window.legacyEditorFixture.opened.length)).toBe(3);
});

for (const source of ['remote', 'local']) test(`${source} file-list action opens the new editor workbench directly`, async ({ page }) => {
  await page.goto('/tests/editor/legacy-entry.html?workbench=1');
  const folder = `${source}-folder`;
  await page.getByText(folder, { exact: true }).click();
  await page.getByText(folder, { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '在文件列表中打开', exact: true }).click();
  await expect(page.getByRole('treeitem').filter({ hasText: 'inside.txt' })).toBeVisible();
  await expect(page.locator('.editor-workbench')).toBeVisible();
  await expect(page.locator('.sftp-dual-browser__file-tree')).toHaveCount(0);
  expect(await page.evaluate(() => window.legacyEditorFixture.opened)).toEqual([{ source, path: `/${source}/` + folder, directory: true }]);
});
