import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
const center = page => page.getByRole('button', { name: '搜索工作区文件', exact: true });
async function ready(page) {
  await page.goto('/tests/editor/workbench.html');
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
}

test('flat command center stays centered on desktop and adapts without overlapping menus', async ({ page }) => {
  await ready(page);
  for (const theme of ['light', 'dark']) for (const width of [1280, 1100, 900, 760, 620, 360]) {
    await page.setViewportSize({ width, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    const toolbar = page.getByRole('toolbar', { name: '编辑器工具栏', exact: true });
    const row = await toolbar.boundingBox(); expect(row.height).toBeLessThanOrEqual(44);
    const menus = await toolbar.getByRole('group', { name: '编辑器菜单', exact: true }).boundingBox();
    const windows = await toolbar.getByRole('group', { name: '工作台', exact: true }).boundingBox();
    if (width <= 460) { await expect(center(page)).toBeHidden(); }
    else {
      const box = await center(page).boundingBox();
      expect(box.height).toBe(28); expect(box.x).toBeGreaterThanOrEqual(menus.x + menus.width);
      expect(box.x + box.width).toBeLessThanOrEqual(windows.x);
      expect(box.y).toBeGreaterThanOrEqual(row.y); expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height);
      if (width >= 1100) expect(Math.abs(box.x + box.width / 2 - row.x - row.width / 2)).toBeLessThan(1);
      if (width <= 760) { expect(box.width).toBe(28); await expect(center(page).locator('kbd')).toBeHidden(); }
      else { await expect(center(page).locator('kbd')).toBeVisible(); await expect(center(page)).toHaveAttribute('title', /快捷打开/); }
      expect(await center(page).evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if ([1280, 620].includes(width)) await page.screenshot({ path: editorArtifact(`dssh-command-center-${theme}-${width}.png`), animations: 'disabled' });
  }
});

test('command center opens fuzzy files, supports keyboard cancellation and preserves disabled guards', async ({ page }) => {
  await ready(page);
  await center(page).focus(); await page.keyboard.press('Enter');
  await expect(center(page)).toHaveAttribute('aria-expanded', 'true');
  const query = page.getByRole('textbox', { name: '搜索文件名或相对路径', exact: true });
  await query.fill('nch'); await expect(page.getByRole('option', { name: 'nested/child.txt', exact: true })).toBeVisible();
  await query.press('Enter'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab').filter({ hasText: 'child.txt' })).toBeVisible();
  // The tab appears before Monaco finishes mounting and restoring editor focus.
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors().some(editor => editor.hasTextFocus()))).toBe(true);
  await center(page).click(); await expect(query).toBeFocused(); await page.keyboard.press('Escape');
  await expect(center(page)).toBeFocused(); await expect(center(page)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
  await expect(query).toBeVisible(); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 620, height: 720 });
  await center(page).click(); await expect(query).toBeVisible(); await page.keyboard.press('Escape');
  await expect(center(page)).toBeFocused();
  await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(center(page)).toBeHidden();
  await page.evaluate(() => window.workbenchFixture.lock(false)); await expect(center(page)).toBeEnabled();
  await page.evaluate(() => window.workbenchFixture.handoff(true)); await expect(center(page)).toBeHidden();
});
