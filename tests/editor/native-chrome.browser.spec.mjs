import { test, expect } from '@playwright/test';
const leaves = nodes => nodes.flatMap(node => node.children?.length ? leaves(node.children) : [node]);
async function current(page) { return page.evaluate(() => window.workbenchFixture.nativeMenuModels.at(-1)); }
async function emit(page, command, ownerLabel = 'main') { await page.evaluate(async payload => { const { emit } = await import('/node_modules/@tauri-apps/api/event.js'); await emit('editor://native-menu', payload); }, { ownerLabel, command }); }

test('native editor chrome moves commands to titlebar and routes live owner menus safely', async ({ page }) => {
  await page.goto('/tests/editor/workbench.html?local&nativeMenu&nativeChrome&welcomeCommands');
  await expect(page.getByRole('toolbar', { name: '编辑器标题栏操作' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toHaveCount(0);
  await expect.poll(async () => (await current(page))?.menus?.map(m => m.label)).toEqual(['文件', '视图', '转到', '工具']);
  const model = await current(page), all = leaves(model.menus);
  expect(new Set(all.map(m => m.id)).size).toBe(all.length);
  const create = all.find(m => /\/new$/.test(m.id)); expect(create.enabled).toBe(true);
  await emit(page, create.id, 'foreign'); await expect(page.locator('.editor-file-tab')).toHaveCount(0);
  await emit(page, create.id); await expect(page.locator('.editor-file-tab')).toHaveCount(1);
  await expect.poll(async () => (await current(page))?.menus?.map(m => m.label)).toEqual(['文件', '编辑', '选择', '视图', '转到', '工具']);
  await expect.poll(async () => leaves((await current(page)).menus).find(m => /\/save$/.test(m.id))?.enabled).toBe(true);
  await page.getByRole('button', { name: '搜索工作区文件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '快捷打开', exact: true }); await expect(dialog).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索文件名或相对路径' })).toBeFocused();
  await expect.poll(async () => leaves((await current(page)).menus).every(m => !m.enabled)).toBe(true);
  await emit(page, create.id); await expect(page.locator('.editor-file-tab')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { const m = window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor'); m.pushStackElement(); m.pushEditOperations([], [{ range: m.getFullModelRange(), text: 'draft' }], () => null); m.pushStackElement(); });
  const undo = leaves((await current(page)).menus).find(m => /\/undo$/.test(m.id));
  await emit(page, undo.id);
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor').getValue())).toBe('');

  await page.getByRole('button', { name: '在独立窗口打开编辑器', exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.detachRequests)).toBe(1);
  await page.evaluate(() => window.workbenchFixture.visibility(false));
  await expect(page.getByRole('toolbar', { name: '编辑器标题栏操作' })).toHaveCount(0);
  await expect.poll(async () => (await current(page)).active).toBe(false);
  await emit(page, create.id); expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().filter(m => m.uri.scheme === 'dssh-editor').length)).toBe(1);
});


test('background workbenches cannot clear active native menus in either tab order', async ({ page }) => {
  await page.goto('/tests/editor/workbench.html?local&nativeMenu&nativeChrome&multiMenu');
  await expect(page.getByRole('toolbar', { name: '编辑器标题栏操作' })).toBeVisible();
  await expect.poll(async () => (await current(page))?.active).toBe(true);
  for (const visible of [false, true, false, true]) {
    await page.evaluate(visible => window.workbenchFixture.visibility(visible), visible);
    await expect(page.getByRole('toolbar', { name: '编辑器标题栏操作' })).toHaveCount(1);
    await expect.poll(async () => (await current(page))?.active).toBe(true);
    await page.getByRole('button', { name: '搜索工作区文件', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '快捷打开', exact: true })).toBeVisible();
    await expect.poll(async () => (await current(page))?.active).toBe(true);
    await page.keyboard.press('Escape');
  }
});
