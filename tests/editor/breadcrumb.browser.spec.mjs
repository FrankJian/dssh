import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
async function ready(page) {
  await page.goto('/tests/editor/workbench.html'); await page.getByRole('treeitem').filter({ hasText: 'a2.ts' }).dblclick(); await expect(page.locator('.monaco-editor')).toBeVisible();
}

test('breadcrumbs show a clear hierarchy, current file and a separate keyboard-accessible outline', async ({ page }) => {
  await ready(page);
  const bar = page.getByRole('navigation', { name: '编辑器面包屑' });
  const path = bar.getByRole('list', { name: '文件路径' });
  await expect(path.getByRole('button')).toHaveText(['root', 'a2.ts']);
  await expect(path.locator('[aria-current="page"]')).toHaveText('a2.ts');
  await expect(path.locator('[aria-current="page"] .file-entry-icon [class="file-entry-icon__seti"]')).toHaveCount(1);
  await expect(path.getByRole('button', { name: 'a2.ts', exact: true })).toHaveAttribute('title', '/root/a2.ts');
  await expect(path.getByLabel('已省略上级目录')).toHaveCount(0);
  const outline = bar.getByRole('button', { name: '文档符号', exact: true });
  // Providers attach asynchronously; wait for the real TypeScript capability.
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getAction('editor.action.quickOutline')?.isSupported())).toBe(true);
  // A real edit refreshes the capability-dependent controls.
  await page.evaluate(() => { const model = window.workbenchFixture.monaco.editor.getEditors()[0].getModel(); model.pushEditOperations([], [{ range: model.getFullModelRange(), text: 'function breadcrumbExample() { return 1; }\n' }], () => null); });
  await expect(outline).toHaveAttribute('title', '文档符号'); await expect(outline).toHaveText('');
  await outline.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('menu', { name: '文档符号' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(outline).toBeFocused();
  await page.getByRole('toolbar', { name: '编辑器工具栏' }).getByRole('button', { name: '视图', exact: true }).click(); await page.getByRole('menuitem', { name: '隐藏文件树', exact: true }).click(); await expect(page.getByRole('tree')).toHaveCount(0);
  await path.getByRole('button', { name: 'root', exact: true }).click(); await expect(page.getByRole('dialog', { name: '面包屑目录浏览' })).toBeVisible();
  await expect(page.getByRole('tree')).toHaveCount(0); await page.keyboard.press('Escape');
  await expect(path.getByRole('button', { name: 'root', exact: true })).toBeFocused();
  await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(outline).toBeHidden(); await expect(path.getByRole('button', { name: 'root', exact: true })).toBeDisabled();
});

test('long plaintext breadcrumbs stay on one row without unavailable outline controls', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const f = window.workbenchFixture; const path = '/root/first-long-directory/second-long-directory/third-long-directory/very-long-current-filename-for-breadcrumbs.txt';
    f.files.set(path, { ...f.files.get('/root/a2.ts'), path, content: 'long path sample' }); await f.handle.open(path);
  });
  const bar = page.getByRole('navigation', { name: '编辑器面包屑' });
  await expect(bar.getByLabel('已省略上级目录')).toHaveText('…');
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: theme === 'dark' ? 1280 : 620, height: 700 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    await expect(bar.getByRole('button', { name: '文档符号', exact: true })).toBeHidden();
    const box = await bar.boundingBox(); const current = await bar.locator('[aria-current="page"]').boundingBox();
    expect(box.height).toBe(24); expect(current.y + current.height).toBeLessThanOrEqual(box.y + box.height);
    expect(current.width).toBeGreaterThan(35); expect(current.x + current.width).toBeLessThanOrEqual(box.x + box.width);
    expect(await bar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: editorArtifact(`dssh-editor-breadcrumb-${theme}.png`), animations: 'disabled' });
  }
  await page.getByRole('button', { name: '向右拆分当前编辑组', exact: true }).click(); await expect(page.locator('.editor-group')).toHaveCount(2);
  for (const row of await page.getByRole('navigation', { name: '编辑器面包屑' }).all()) {
    const box = await row.boundingBox(); const current = await row.locator('[aria-current="page"]').boundingBox();
    expect(box.height).toBe(24); expect(current.x + current.width).toBeLessThanOrEqual(box.x + box.width + 1);
    await expect(row.getByRole('button', { name: '文档符号', exact: true })).toBeHidden();
  }
  await page.evaluate(() => window.workbenchFixture.handoff(true));
  await expect(page.getByRole('button', { name: '文档符号', exact: true })).toHaveCount(0);
});

const popup = page => page.getByRole('dialog', { name: '面包屑目录浏览', exact: true });
const directory = (page, name = 'root') => page.getByRole('navigation', { name: '编辑器面包屑' }).first().getByRole('button', { name, exact: true });
async function browse(page, local = false) {
  if (local) { await page.goto('/tests/editor/workbench.html?local'); await page.getByRole('treeitem').filter({ hasText: 'a2.ts' }).dblclick(); await expect(page.locator('.monaco-editor')).toBeVisible(); }
  else await ready(page);
  await directory(page).click(); await expect(popup(page).getByRole('menuitem', { name: 'nested', exact: true })).toBeVisible();
}

for (const local of [false, true]) test(`breadcrumb directory browsing opens nested files and preserves the ${local ? 'local' : 'SFTP'} root and tree`, async ({ page }) => {
  await browse(page, local);
  await expect(popup(page).getByRole('menuitem')).toHaveText(['fail', 'nested', 'a2.ts', 'a10.ts']);
  await expect(popup(page).getByRole('button', { name: '返回上级目录', exact: true })).toBeDisabled();
  await popup(page).getByRole('menuitem', { name: 'nested', exact: true }).click();
  await expect(popup(page).locator('header > span')).toHaveAttribute('title', '/root/nested');
  await popup(page).getByRole('menuitem', { name: 'child.txt', exact: true }).click();
  await expect(popup(page)).toHaveCount(0); await expect(page.getByRole('tab').filter({ hasText: 'child.txt' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('treeitem').filter({ hasText: 'a2.ts' })).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await directory(page, 'nested').click(); await expect(popup(page).locator('header > span')).toHaveAttribute('title', '/root/nested');
  await page.keyboard.press('Alt+ArrowLeft'); await expect(popup(page).getByRole('menuitem', { name: 'a2.ts', exact: true })).toBeVisible();
});

test('breadcrumb menu filters hidden files, shows empty directories, retries errors and supports keyboard navigation', async ({ page }) => {
  await browse(page);
  await expect(popup(page).getByRole('menuitem', { name: '.hidden', exact: true })).toHaveCount(0);
  await popup(page).getByRole('button', { name: '显示目录隐藏项目', exact: true }).click();
  await popup(page).getByRole('textbox', { name: '筛选目录项目', exact: true }).fill('.hidden');
  await expect(popup(page).getByRole('menuitem')).toHaveText(['.hidden']);
  await popup(page).getByRole('textbox').fill('missing'); await expect(popup(page).getByRole('status')).toHaveText('没有匹配的项目');
  await popup(page).getByRole('textbox').fill('fail'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(popup(page).getByRole('alert')).toContainText('读取目录失败');
  await popup(page).getByRole('button', { name: '重试', exact: true }).click(); await expect(popup(page).getByRole('menuitem', { name: 'retry.txt' })).toBeVisible();
  await page.evaluate(() => window.workbenchFixture.directories.add('/root/empty'));
  await page.keyboard.press('Alt+ArrowLeft'); await popup(page).getByRole('textbox').fill('empty');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await expect(popup(page).getByRole('status')).toHaveText('目录为空');
  await page.keyboard.press('Escape'); await expect(directory(page)).toBeFocused();
});

async function gateNested(page) {
  await page.evaluate(async () => {
    const { EditorFileProvider } = await import('/src/editor/fileProvider.ts'); const original = EditorFileProvider.prototype.list;
    const gate = new Promise(resolve => { window.releaseDirectory = resolve; });
    EditorFileProvider.prototype.list = async function(path) { if (path === '/root/nested') await gate; return original.call(this, path); };
  });
}
test('late directory results cannot replace a newer level or reopen a closed or locked popup', async ({ page }) => {
  await browse(page); await gateNested(page);
  await popup(page).getByRole('menuitem', { name: 'nested', exact: true }).click(); await expect(popup(page).getByRole('status')).toHaveText('正在读取目录…');
  await popup(page).getByRole('button', { name: '返回上级目录', exact: true }).click(); await expect(popup(page).getByRole('menuitem', { name: 'a10.ts' })).toBeVisible();
  await page.evaluate(() => window.releaseDirectory()); await expect(popup(page).locator('header > span')).toHaveAttribute('title', '/root');
  await gateNested(page); await popup(page).getByRole('menuitem', { name: 'nested', exact: true }).click(); await page.keyboard.press('Escape'); await page.evaluate(() => window.releaseDirectory()); await expect(popup(page)).toHaveCount(0);
  await directory(page).click(); await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(popup(page)).toHaveCount(0); await expect(directory(page)).toBeDisabled();
  await page.evaluate(() => window.workbenchFixture.lock(false)); await directory(page).click();
  await page.evaluate(() => window.workbenchFixture.handoff(true)); await expect(popup(page)).toHaveCount(0);
});

test('a delayed breadcrumb file opens in its owner group even after focus changes', async ({ page }) => {
  await ready(page); await page.getByRole('button', { name: '向右拆分当前编辑组', exact: true }).click();
  const first = page.locator('.editor-group').first(), second = page.locator('.editor-group').last();
  await page.evaluate(async () => {
    const { EditorFileProvider } = await import('/src/editor/fileProvider.ts'); const original = EditorFileProvider.prototype.read;
    const gate = new Promise(resolve => { window.releaseFile = resolve; });
    EditorFileProvider.prototype.read = async function(path, options) { if (path === '/root/a10.ts') await gate; return original.call(this, path, options); };
  });
  await first.getByRole('navigation', { name: '编辑器面包屑' }).getByRole('button', { name: 'root', exact: true }).click();
  await popup(page).getByRole('menuitem', { name: 'a10.ts', exact: true }).click();
  await second.getByRole('tab').click(); await page.evaluate(() => window.releaseFile());
  await expect(first.getByRole('tab').filter({ hasText: 'a10.ts' })).toHaveAttribute('aria-selected', 'true');
  await expect(second.getByRole('tab')).toHaveCount(1); await expect(second.getByRole('tab')).toContainText('a2.ts');
  await expect(second).toHaveClass(/is-focused/);
});

test('bounded breadcrumb lists render only visible rows and stay inside narrow themed viewports', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const f = window.workbenchFixture; for (let index=0; index<11000; index++) { const path = `/root/item${index}.txt`; f.files.set(path, { ...f.files.get('/root/a2.ts'), path }); } });
  await directory(page).click(); await expect(popup(page).getByRole('status')).toContainText('目录项目过多');
  expect(await popup(page).getByRole('menuitem').count()).toBeLessThan(30);
  await popup(page).getByRole('textbox').press('ArrowDown'); await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-path'))).toMatch(/item/);
  expect(await popup(page).getByRole('menuitem').count()).toBeLessThan(30);
  for (const [theme, width] of [['light',1280], ['dark',620]]) {
    await page.keyboard.press('Escape'); await page.setViewportSize({ width, height: 700 });
    await page.evaluate(theme => { document.documentElement.dataset.theme=theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    await directory(page).click(); await expect(popup(page).getByRole('menuitem').first()).toBeVisible();
    const box = await popup(page).boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(width); expect(box.y+box.height).toBeLessThanOrEqual(700);
    await page.screenshot({ path: editorArtifact(`dssh-directory-breadcrumb-${theme}.png`), animations: 'disabled' });
  }
});

test('closing the owner group during a breadcrumb read does not open another group or retain an unused model', async ({ page }) => {
  await ready(page); await page.getByRole('button', { name: '向右拆分当前编辑组', exact: true }).click();
  const first = page.locator('.editor-group').first();
  await page.evaluate(async () => {
    const { EditorFileProvider } = await import('/src/editor/fileProvider.ts'); const original = EditorFileProvider.prototype.read;
    const gate = new Promise(resolve => { window.releaseFile = resolve; });
    EditorFileProvider.prototype.read = async function(path, options) { if (path === '/root/a10.ts') await gate; const result = await original.call(this, path, options); window.breadcrumbReadFinished = true; return result; };
  });
  await first.getByRole('navigation', { name: '编辑器面包屑' }).getByRole('button', { name: 'root', exact: true }).click();
  await popup(page).getByRole('menuitem', { name: 'a10.ts', exact: true }).click();
  await first.getByRole('button', { name: '关闭编辑分组', exact: true }).click();
  await expect(page.locator('.editor-group')).toHaveCount(1); await page.evaluate(() => window.releaseFile());
  await expect.poll(() => page.evaluate(() => window.breadcrumbReadFinished)).toBe(true);
  await expect(page.getByRole('tab')).toHaveCount(1); await expect(page.getByRole('tab')).toContainText('a2.ts');
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().filter(model => model.uri.scheme === 'dssh-editor').map(model => model.uri.path))).toEqual(['/1/root/a2.ts']);
});
