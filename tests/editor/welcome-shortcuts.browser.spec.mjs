import { test, expect } from '@playwright/test';
const welcome = page => page.getByRole('region', { name: '编辑器欢迎页', exact: true });
const action = (page, label) => welcome(page).getByRole('button', { name: label, exact: true });
const keys = (page, label) => action(page, label).locator('kbd');
async function ready(page) {
  await page.goto('/tests/editor/workbench.html?welcomeCommands');
  await expect(welcome(page)).toBeVisible();
  await expect(action(page, '新建文本文件')).toBeFocused();
}
async function setBinding(page, id, binding) {
  await page.evaluate(async ({ id, binding }) => { const s = await import('/src/app/shortcuts.ts'); s.setShortcutBinding(id, binding); }, { id, binding });
}
for (const mac of [true, false]) test.describe(mac ? 'Mac welcome shortcuts' : 'Windows welcome shortcuts', () => {
  test.use({ userAgent: mac ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' });
  test('displayed defaults actually create files, open quick search and invoke the global command palette', async ({ page }) => {
    await ready(page);
    const mod = mac ? 'Meta' : 'Control', label = mac ? '⌘' : 'Ctrl';
    await expect(keys(page, '新建文本文件')).toHaveText([label, 'N']);
    await expect(keys(page, '快捷打开')).toHaveText([label, 'P']);
    await expect(keys(page, '显示所有命令')).toHaveText([label, 'K']);
    await page.keyboard.press(`${mod}+k`); expect(await page.evaluate(() => window.workbenchFixture.commandRequests)).toBe(1);
    await page.keyboard.press(`${mod}+p`); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
    await page.keyboard.press(`${mod}+n`); await expect(page.locator('.monaco-editor')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(1);
  });
  test('custom bindings update immediately and reset consistently with actual dispatch', async ({ page }) => {
    await ready(page);
    const mod = mac ? 'Meta' : 'Control', primary = mac ? '⌘' : 'Ctrl', alt = mac ? '⌥' : 'Alt', shift = mac ? '⇧' : 'Shift';
    await setBinding(page, 'editorNewFile', { key: 'u', primary: true, shift: false, alt: true });
    await setBinding(page, 'editorQuickOpen', { key: 'o', primary: true, shift: true, alt: true });
    await setBinding(page, 'commandPalette', { key: 'y', primary: true, shift: true, alt: true });
    await expect(keys(page, '新建文本文件')).toHaveText([primary, alt, 'U']);
    await expect(keys(page, '快捷打开')).toHaveText([primary, shift, alt, 'O']);
    await expect(keys(page, '显示所有命令')).toHaveText([primary, shift, alt, 'Y']);
    await expect(page.getByRole('button', { name: '搜索工作区文件' })).toHaveAttribute('title', /O/);
    await page.keyboard.press(`${mod}+n`); await expect(page.getByRole('tab')).toHaveCount(0);
    await page.keyboard.press(`${mod}+Alt+Shift+y`); expect(await page.evaluate(() => window.workbenchFixture.commandRequests)).toBe(1);
    await page.keyboard.press(`${mod}+Alt+Shift+o`); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
    await page.keyboard.press(`${mod}+Alt+u`); await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.getByRole('button', { name: /关闭 未命名/ }).click();
    const discard = page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true });
    if (await discard.isVisible()) await discard.click();
    await expect(welcome(page)).toBeVisible();
    await page.evaluate(async () => { const s = await import('/src/app/shortcuts.ts'); s.resetShortcutBinding('editorQuickOpen'); });
    await expect(keys(page, '快捷打开')).toHaveText([primary, 'P']);
    await page.evaluate(async () => { const s = await import('/src/app/shortcuts.ts'); s.resetAllShortcutBindings(); });
    await expect(keys(page, '新建文本文件')).toHaveText([primary, 'N']);
    await expect(keys(page, '显示所有命令')).toHaveText([primary, 'K']);
    await page.keyboard.press(`${mod}+k`); expect(await page.evaluate(() => window.workbenchFixture.commandRequests)).toBe(2);
  });
});

test('another window binding changes refresh existing keycaps through storage events', async ({ page, context }) => {
  await ready(page);
  const other = await context.newPage(); await ready(other);
  await setBinding(other, 'editorNewFile', { key: 'u', primary: true, shift: false, alt: true });
  await expect(keys(page, '新建文本文件').last()).toHaveText('U');
  await other.close(); await page.bringToFront();
  const mod = await page.evaluate(() => /Mac/.test(navigator.userAgent)) ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+Alt+u`); await expect(page.locator('.monaco-editor')).toBeVisible();
});
