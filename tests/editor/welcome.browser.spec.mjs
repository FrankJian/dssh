import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
const welcome = page => page.getByRole('region', { name: '编辑器欢迎页', exact: true });
async function ready(page, query = '') {
  await page.goto(`/tests/editor/workbench.html${query}`);
  await expect(welcome(page)).toBeVisible();
}

test('welcome uses aligned actions and actual keycaps in wide, narrow and short custom palettes', async ({ page }) => {
  await ready(page, '?welcomeCommands');
  await expect(welcome(page).getByRole('button')).toHaveText(['新建文本文件⌘N', '打开文件', '打开文件夹', '快捷打开⌘P', '显示所有命令⌘K'].map(t => process.platform === 'darwin' ? t : t.replace('⌘', 'Ctrl')));
  await expect(welcome(page).locator('.editor-welcome__mark')).toHaveAttribute('aria-hidden', 'true');
  await welcome(page).getByRole('button', { name: '显示所有命令', exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.commandRequests)).toBe(1);
  for (const [theme, width, height] of [['light', 1280, 800], ['dark', 620, 720], ['light', 420, 420]]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const area = await welcome(page).boundingBox();
    for (const button of await welcome(page).getByRole('button').all()) {
      const box = await button.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(area.x); expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 1);
      if (height === 420) { expect(box.y).toBeGreaterThanOrEqual(area.y); expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height); }
      await button.focus(); await expect(button).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.scrollingElement.scrollTop === 0)).toBe(true);
    await page.screenshot({ path: editorArtifact(`dssh-editor-welcome-${theme}-${width}.png`), animations: 'disabled' });
  }
  await page.evaluate(() => window.workbenchFixture.lock(true));
  for (const button of await welcome(page).getByRole('button').all()) await expect(button).toBeDisabled();
  await page.evaluate(() => { window.workbenchFixture.lock(false); window.workbenchFixture.handoff(true); });
  for (const button of await welcome(page).getByRole('button').all()) await expect(button).toBeDisabled();
});

test('empty workspace local actions create text or open files and folders using existing pickers', async ({ page }) => {
  await ready(page, '?local&emptyWorkspace');
  await expect(welcome(page).getByRole('button', { name: '快捷打开', exact: true })).toHaveCount(0);
  await expect(welcome(page).getByRole('button', { name: '显示所有命令', exact: true })).toHaveCount(0);
  await welcome(page).getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(welcome(page)).toBeVisible();
  await page.evaluate(() => { window.workbenchFixture.nativeSelection.path = '/root/a2.ts'; });
  await welcome(page).getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(page.getByRole('tab').filter({ hasText: 'a2.ts' })).toBeVisible(); await expect(welcome(page)).toHaveCount(0);
  await page.reload(); await expect(welcome(page)).toBeVisible();
  await page.evaluate(() => { window.workbenchFixture.nativeSelection.path = '/root'; });
  await welcome(page).getByRole('button', { name: '打开文件夹', exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.nativeSelection.folders)).toEqual(['/root']);
  await welcome(page).getByRole('button', { name: '新建文本文件', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.monaco-editor')).toBeVisible(); await expect(welcome(page)).toHaveCount(0);
});

test('remote welcome reuses path prompts and quick open and empty split actions target their group', async ({ page }) => {
  await ready(page);
  await welcome(page).getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('打开远程文件');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); await expect(welcome(page)).toBeVisible();
  await welcome(page).getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('打开远程目录'); await page.keyboard.press('Escape');
  await welcome(page).getByRole('button', { name: '快捷打开', exact: true }).click();
  const query = page.getByRole('textbox', { name: '搜索文件名或相对路径', exact: true });
  await query.fill('nch'); await expect(page.getByRole('option', { name: 'nested/child.txt', exact: true })).toBeVisible();
  await query.press('Enter'); await expect(page.getByRole('tab').filter({ hasText: 'child.txt' })).toBeVisible();
  await page.reload(); await expect(welcome(page)).toBeVisible();
  await page.getByRole('toolbar', { name: '编辑器工具栏' }).getByRole('button', { name: '视图', exact: true }).click();
  await page.getByRole('menuitem', { name: '左右拆分编辑器', exact: true }).click(); await expect(welcome(page)).toHaveCount(2);
  await page.locator('.editor-group').last().getByRole('button', { name: '新建文本文件', exact: true }).click();
  await expect(page.locator('.editor-group').last().locator('.monaco-editor')).toBeVisible();
  await expect(page.locator('.editor-group').first().getByRole('region', { name: '编辑器欢迎页' })).toBeVisible();
});
