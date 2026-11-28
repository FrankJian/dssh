import { test, expect } from '@playwright/test';
import { expectEditorHost } from './readiness.mjs';

// Full regression only: do not add fault-injection latency to routine smoke CI.
for (const kind of ['core', 'rich']) test(`${kind} host initializes with delayed Monaco and a slow CPU`, async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let delayed = false;
  await page.route(/\/deps\/monaco-editor\.js(?:\?|$)/, async route => {
    delayed = true;
    await new Promise(resolve => setTimeout(resolve, 6500));
    await route.continue();
  });
  await page.goto(`/tests/editor/${kind === 'core' ? 'index.html' : 'workbench.html?local&nativeMenu&wysiwyg'}`, { waitUntil: 'commit' });
  await expectEditorHost(kind === 'core' ? page.getByTestId('left').locator('.monaco-editor') : page.locator('[data-path="/root/a2.ts"]'));
  expect(delayed).toBe(true);
  if (kind === 'core') {
    await expectEditorHost(page.getByTestId('right').locator('.monaco-editor'));
    expect(await page.evaluate(() => window.editorFixture.editors.left.getModel() === window.editorFixture.editors.right.getModel())).toBe(true);
  } else {
    await page.evaluate(async () => {
      const f = window.workbenchFixture;
      f.files.set('/root/delayed.md', { ...f.files.get('/root/a2.ts'), path: '/root/delayed.md', content: '# Delayed host\n' });
      await f.handle.open('/root/delayed.md');
    });
    await page.getByRole('radio', { name: '所见即所得', exact: true }).check();
    await expect(page.getByRole('textbox', { name: 'Markdown 所见即所得编辑器', exact: true }).getByRole('heading', { name: 'Delayed host' })).toBeVisible();
  }
});
