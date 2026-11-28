import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
const leaves = nodes => nodes.flatMap(node => node.children?.length ? leaves(node.children) : [node]);
async function current(page) { return page.evaluate(() => window.workbenchFixture.nativeMenuModels.at(-1)); }
async function emit(page, command, ownerLabel = 'main') { await page.evaluate(async payload => { const { emit } = await import('/node_modules/@tauri-apps/api/event.js'); await emit('editor://native-menu', payload); }, { ownerLabel, command }); }

test('native editor chrome moves commands to titlebar and routes live owner menus safely', { tag: "@smoke" }, async ({ page }) => {
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

test('native titlebar and Quick Open stay bounded across sizes and palettes', async ({ page }) => {
  await page.goto('/tests/editor/workbench.html?local&nativeMenu&nativeChrome');
  await expect(page.getByRole('button', { name: '搜索工作区文件', exact: true })).toBeVisible();
  for (const width of [1280, 900, 620, 360]) {
    await page.setViewportSize({ width, height: 700 });
    for (const mode of ['dark', 'light']) {
      await page.evaluate(mode => { document.documentElement.dataset.theme = mode; window.workbenchFixture.palette.setPaletteColor("#986aa6"); }, mode);
      const search = page.getByRole('button', { name: '搜索工作区文件', exact: true });
      const box = await search.boundingBox(); expect(box.y).toBeLessThan(36); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      await search.click(); const dialog = page.getByRole('dialog', { name: '快捷打开', exact: true });
      await expect(dialog).toBeVisible(); await expect(page.getByRole('option').first()).toBeVisible(); if (width === 1280 || width === 360) await page.screenshot({ path: editorArtifact(`native-chrome-${width}-${mode}.png`) }); const bounds = await dialog.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.getByRole('textbox', { name: '搜索文件名或相对路径' }).fill('a2');
      await expect(page.getByRole('option', { name: 'a2.ts', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '筛选搜索范围', exact: true }).click();
      await expect(page.getByRole('textbox', { name: '快捷打开包含 glob' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }
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


test('selected controls use flat surfaces while keyboard focus remains visible', async ({ page }) => {
  await page.goto('/tests/editor/workbench.html?local&nativeMenu&nativeChrome');
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await page.evaluate(async () => { const f = window.workbenchFixture; f.files.set('/root/flat.md', { ...f.files.get('/root/a2.ts'), path: '/root/flat.md', content: '# Flat\n' }); await f.handle.open('/root/flat.md'); });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    const source = page.locator('.editor-markdown-mode-switch label').filter({ has: page.getByRole('radio', { name: '源码', exact: true }) });
    await expect(source).toHaveCSS('box-shadow', 'none');
    await expect(page.locator('.editor-file-tab.is-active')).toHaveCSS('box-shadow', 'none');
    const style = await page.evaluate(() => {
      const row = document.createElement('button'); row.className = 'profile-row'; row.dataset.selected = 'true'; row.textContent = 'Selected connection'; document.body.appendChild(row);
      const computed = getComputedStyle(row), marker = getComputedStyle(row, '::before');
      const result = { marker: marker.content, shadow: computed.boxShadow, background: computed.backgroundColor };
      row.remove(); return result;
    });
    expect(style.marker).toBe('none'); expect(style.shadow).toBe('none'); expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
    await page.getByRole('radio', { name: '源码', exact: true }).focus();
    expect(await source.evaluate(el => { const css = getComputedStyle(el); return css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) >= 1; })).toBe(true);
  }
});
