import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';

async function ready(page) {
  await page.goto('/tests/editor/workbench.html');
  await expect(page.getByRole('treeitem').filter({ hasText: 'a2.ts' })).toBeVisible();
}
async function gateListing(page, fail = false) {
  await page.evaluate(async fail => {
    const { EditorFileProvider } = await import('/src/editor/fileProvider.ts');
    const original = EditorFileProvider.prototype.list;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    window.refreshCalls = 0;
    window.releaseRefresh = release;
    EditorFileProvider.prototype.list = async function (path) {
      window.refreshCalls++;
      await pending;
      if (fail) throw new Error('合成目录刷新失败');
      return original.call(this, path);
    };
  }, fail);
}

test('tree refresh shows pending feedback, prevents duplicate clicks and recovers from errors', async ({ page }) => {
  await ready(page); await gateListing(page, true);
  const button = page.getByRole('button', { name: '刷新文件树', exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true'); await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', '正在刷新…');
  await expect.poll(() => button.locator('svg').evaluate(el => getComputedStyle(el).animationName)).toBe('editor-refresh-spin');
  await page.waitForTimeout(650); // The spinner must outlive the quick-click pulse on a slow request.
  await expect(button).toHaveClass(/is-refreshing/);
  expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
  await expect(page.getByRole('treeitem').filter({ hasText: 'a2.ts' })).toBeVisible();
  await page.evaluate(() => window.releaseRefresh());
  await expect(page.getByRole('alert')).toContainText('合成目录刷新失败');
  await expect(button).toBeEnabled(); await expect(button).toHaveAttribute('aria-busy', 'false');
  await expect(button).not.toHaveClass(/is-refreshing/);
});

test('modern tree actions fit one row, show states and retain fast refresh feedback in all palettes', async ({ page }) => {
  await ready(page);
  const header = page.getByRole('group', { name: '项目根目录', exact: true });
  const hidden = header.getByRole('button', { name: '显示隐藏文件', exact: true });
  const original = await hidden.locator('svg').innerHTML();
  await hidden.click(); await expect(hidden).toHaveAttribute('aria-pressed', 'true');
  expect(await hidden.locator('svg').innerHTML()).not.toBe(original);
  await expect(page.getByRole('treeitem').filter({ hasText: '.hidden' })).toBeVisible();
  const button = header.getByRole('button', { name: '刷新文件树', exact: true });
  await button.focus(); await page.keyboard.press('Enter');
  await expect(button).toHaveClass(/is-refreshing/); await expect(button).toBeEnabled();
  await expect(button).not.toHaveClass(/is-refreshing/);
  await expect(header.getByRole('button', { name: '定位活动文件' })).toBeDisabled();
  for (const [theme, width] of [['light', 1280], ['dark', 620]]) {
    await page.setViewportSize({ width, height: 720 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    const bounds = await header.boundingBox();
    for (const action of await header.getByRole('button').all()) {
      const box = await action.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(bounds.x); expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      await expect(action).toHaveAttribute('title', /.+/);
    }
    await page.screenshot({ path: editorArtifact(`dssh-editor-tree-toolbar-${theme}.png`), animations: 'disabled' });
  }
  await page.locator('.editor-sidebar-sash').focus();
  for (let index = 0; index < 12; index++) await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.editor-sidebar-dock')).toHaveCSS('width', '120px');
  const compact = await header.boundingBox();
  for (const action of await header.getByRole('button').all()) {
    const box = await action.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(compact.x + compact.width);
  }
  await page.screenshot({ path: editorArtifact('dssh-editor-tree-toolbar-compact.png'), animations: 'disabled' });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await gateListing(page);
  await button.click(); await expect(button).toHaveAttribute('aria-busy', 'true');
  expect(await button.locator('svg').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.evaluate(() => window.releaseRefresh()); await expect(button).toBeEnabled();
  await page.evaluate(() => window.workbenchFixture.lock(true));
  await expect(button).toBeDisabled(); await expect(hidden).toBeDisabled();
});

test('breadcrumb directory refresh shares pending and reduced motion feedback', async ({ page }) => {
  await ready(page);
  await page.getByRole('treeitem').filter({ hasText: 'a2.ts' }).dblclick();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.getByRole('navigation', { name: '编辑器面包屑' }).getByRole('button', { name: 'root', exact: true }).click();
  const popup = page.getByRole('dialog', { name: '面包屑目录浏览' });
  await expect(popup.getByRole('menuitem', { name: 'nested', exact: true })).toBeVisible();
  await gateListing(page);
  const button = popup.getByRole('button', { name: '刷新当前目录', exact: true });
  await button.click(); await expect(button).toHaveAttribute('aria-busy', 'true'); await expect(button).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await button.locator('svg').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.evaluate(() => window.releaseRefresh());
  await expect(button).toBeEnabled(); await expect(popup.getByRole('menuitem', { name: 'nested', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(popup).toHaveCount(0);
});
