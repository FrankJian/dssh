import { test, expect } from '@playwright/test';
import { editorArtifact } from './artifacts.mjs';
async function ready(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/tests/editor/workbench.html'); await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible(); await page.locator('[data-path="/root/a2.ts"]').dblclick();
  await page.locator('.monaco-editor textarea').focus();
  await page.evaluate(() => { const f = window.workbenchFixture; const model = f.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor'); model.setValue('cat CAT scatter\ncat'); });
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await page.getByRole('menuitem', { name: '替换', exact: true }).click();
  await expect(page.locator('.find-widget.visible')).toBeVisible();
}
test('find and replace uses valid palette colors, compact surfaces and bounded native layouts', async ({ page }) => {
  await ready(page);
  const widget = page.locator('.find-widget.visible');
  for (const width of [1280, 620, 360]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(async theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); const { refreshMonacoTheme } = await import('/src/sftp/monacoLoader.ts'); refreshMonacoTheme(window.workbenchFixture.monaco); }, theme);
    await expect(widget).not.toHaveCSS('background-color', 'rgb(255, 0, 0)');
    const themeColors = await page.evaluate(() => { const element = document.querySelector('.monaco-editor'); const css = getComputedStyle(element); return ['editorWidget-background', 'editorWidget-foreground', 'input-background', 'focusBorder'].map(key => css.getPropertyValue(`--vscode-${key}`).trim()); });
    expect(themeColors.every(color => /^(#|rgba?\(|color\()/.test(color))).toBe(true);
    const channels = await widget.evaluate(el => getComputedStyle(el).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number));
    expect(channels.every(value => theme === 'light' ? value > 150 : value < 150)).toBe(true);
    await expect(widget).toHaveCSS('border-top-width', '1px'); await expect(widget).toHaveCSS('border-top-left-radius', '8px');
    const box = await widget.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1); expect(box.height).toBeLessThan(85);
    const find = widget.getByRole('textbox', { name: 'Find', exact: true }); await find.fill('unmatched');
    await expect(widget.locator('.matchesCount')).toContainText(/No results/);
    if (width === 1280 || width === 360) await page.screenshot({ path: editorArtifact(`find-style-${width}-${theme}.png`), animations: 'disabled' });
  }
});
test('find options, replacement, regex errors and undo stay functional after styling', async ({ page }) => {
  await ready(page); const widget = page.locator('.find-widget.visible'); const find = widget.getByRole('textbox', { name: 'Find', exact: true });
  await find.fill('cat'); await widget.getByRole('textbox', { name: 'Replace', exact: true }).fill('dog'); await expect(widget.locator('.matchesCount')).toContainText('of 4');
  await widget.getByRole('button', { name: /^Replace All/ }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor').getValue())).toBe('dog dog sdogter\ndog');
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === 'dssh-editor').undo());
  await find.focus(); await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Alt+r`); await find.fill('[');
  await expect(widget.locator('.monaco-inputbox.error')).toBeVisible(); await expect(widget).not.toHaveCSS('background-color', 'rgb(255, 0, 0)');
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await find.press('Escape'); await expect(widget).toHaveCount(0);
});

test('find tooltips escape editor clipping and remain visible at viewport edges', async ({ page }) => {
  await ready(page); const widget = page.locator('.find-widget.visible'); await widget.getByRole('textbox', { name: 'Find', exact: true }).fill('cat');
  for (const width of [1280, 620, 360]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 700 }); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    const button = widget.getByRole('button', { name: width === 1280 ? /^Previous Match/ : /^Close/ });
    await button.hover(); const tooltip = page.locator('body > .context-view .hover-contents').filter({ hasText: width === 1280 ? /Previous Match/ : /Close/ });
    await expect(tooltip).toBeVisible();
    const box = await tooltip.boundingBox(); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(await tooltip.evaluate(el => { const b = el.getBoundingClientRect(), top = document.elementFromPoint(b.x + b.width / 2, b.y + 2); return el.contains(top); })).toBe(true);
    if (width !== 620) await page.screenshot({ path: editorArtifact(`find-hover-${width}-${theme}.png`), animations: 'disabled' });
    await page.mouse.move(0, 690); await expect(tooltip).toHaveCount(0);
  }
});

test('find tooltips clean up on scroll, resize, split targets and workspace hiding', async ({ page }) => {
  await ready(page); await page.getByRole('button', { name: '向右拆分当前编辑组', exact: true }).click();
  const group = page.locator('.editor-group').last(); await group.locator('.monaco-editor textarea').focus();
  await page.evaluate(() => window.workbenchFixture.handle.execute('editorReplace'));
  const widget = group.locator('.find-widget.visible'); await expect(widget).toBeVisible();
  const button = widget.getByRole('button', { name: /^Close/ }), tooltip = page.locator('body > .context-view .hover-contents').filter({ hasText: /Close/ });
  await button.hover(); await expect(tooltip).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('scroll'))); await expect(tooltip).toHaveCount(0);
  await page.mouse.move(0, 690); await button.hover(); await expect(tooltip).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 720 }); await expect(tooltip).toHaveCount(0);
  await page.mouse.move(0, 690); await button.hover(); await expect(tooltip).toBeVisible();
  await page.evaluate(() => window.workbenchFixture.visibility(false)); await expect(tooltip).toHaveCount(0);
  await page.evaluate(() => window.workbenchFixture.visibility(true)); await expect(widget).toBeVisible();
  await page.mouse.move(0, 690); await button.hover(); await expect(tooltip).toBeVisible();
  await group.getByRole('button', { name: '关闭编辑分组', exact: true }).click(); await expect(tooltip).toHaveCount(0);
});
