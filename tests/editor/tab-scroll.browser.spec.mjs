import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
async function ready(page, markdown = false) {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/tests/editor/workbench.html?local');
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await page.evaluate(async markdown => { const f = window.workbenchFixture; for (let i = 0; i < 10; i++) { const path = `/root/document-${i}-long-name.${markdown ? 'md' : 'txt'}`; f.files.set(path, { ...f.files.get('/root/a2.ts'), path, content: markdown ? `# Preview ${i}\n` : `File ${i}\n` }); await f.handle.open(path); } }, markdown);
  await expect(page.getByRole('tablist', { name: '文件标签', exact: true }).getByRole('tab')).toHaveCount(10);
}
const list = page => page.getByRole('tablist', { name: '文件标签', exact: true }).first();
async function visibleSelected(tabs) { await expect.poll(() => tabs.evaluate(el => { const a = el.querySelector('[aria-selected="true"]')?.getBoundingClientRect(), b = el.getBoundingClientRect(); return !!a && a.left >= b.left - 1 && a.right <= b.right + 1; })).toBe(true); }

test('overflow file tabs retain widths, scroll both ways and reveal keyboard selections', { tag: "@smoke" }, async ({ page }) => {
  await ready(page); const tabs = list(page); await visibleSelected(tabs);
  expect(await tabs.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const originalWidth = await tabs.getByRole('tab').first().evaluate(el => el.getBoundingClientRect().width); expect(originalWidth).toBeGreaterThan(150);
  const left = page.getByRole('button', { name: '向左滚动文件标签', exact: true }), right = page.getByRole('button', { name: '向右滚动文件标签', exact: true });
  await expect(left).toBeEnabled();
  const before = await tabs.evaluate(el => el.scrollLeft); await left.click();
  await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBeLessThan(before);
  await tabs.hover(); await page.mouse.wheel(0, -3000); await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBe(0);
  await expect(left).toBeDisabled(); await expect(right).toBeEnabled();
  await page.evaluate(() => { const m = window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor' && m.getValue() === 'File 9\n'); m.pushEditOperations([], [{ range: m.getFullModelRange(), text: 'Draft' }], () => null); });
  await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBe(0);
  await right.click(); await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await tabs.evaluate(el => el.scrollLeft = 0); await tabs.getByRole('tab').first().focus(); await page.keyboard.press('End');
  await visibleSelected(tabs); await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home'); await visibleSelected(tabs); await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  expect(await tabs.getByRole('tab').first().evaluate(el => el.getBoundingClientRect().width)).toBe(originalWidth);
  expect(before).toBeGreaterThanOrEqual(0);
});

test('tab overflow adapts to narrow themed groups while file actions remain pinned', async ({ page }) => {
  await ready(page); const tabs = list(page);
  for (const width of [1280, 620, 360]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 650 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    await visibleSelected(tabs);
    const row = await page.locator('.editor-group__tabs').boundingBox(), actions = await page.getByRole('toolbar', { name: '文件快捷操作' }).boundingBox(), box = await tabs.boundingBox();
    expect(row.height).toBe(32); expect(box.x + box.width).toBeLessThanOrEqual(actions.x); expect(actions.x + actions.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole('button', { name: '保存当前文件', exact: true })).toBeVisible();
    if (width !== 620) await page.screenshot({ path: editorArtifact(`tab-overflow-${width}-${theme}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1280, height: 650 });
  await page.getByRole('button', { name: '向右拆分当前编辑组', exact: true }).click();
  await expect(page.getByRole('tablist', { name: '文件标签', exact: true })).toHaveCount(2);
  await expect(page.locator('.editor-group').last().getByRole('button', { name: '向左滚动文件标签' })).toHaveCount(0);
});

test('preview tabs scroll independently and still reveal and close their own selection', async ({ page }) => {
  await ready(page, true);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(async i => window.workbenchFixture.handle.open(`/root/document-${i}-long-name.md`), i);
    await page.getByRole('button', { name: 'Markdown 预览', exact: true }).click();
  }
  const tabs = page.getByRole('tablist', { name: 'Markdown 预览标签', exact: true }); await expect(tabs.getByRole('tab')).toHaveCount(6); await visibleSelected(tabs);
  const original = await list(page).evaluate(el => el.scrollLeft);
  await tabs.hover(); await page.mouse.wheel(0, -3000); await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBe(0);
  expect(await list(page).evaluate(el => el.scrollLeft)).toBe(original);
  await tabs.getByRole('tab').first().focus(); await page.keyboard.press('End'); await visibleSelected(tabs);
  await tabs.getByRole('tab').last().getByRole('button').click(); await expect(tabs.getByRole('tab')).toHaveCount(5); await visibleSelected(tabs);
});
