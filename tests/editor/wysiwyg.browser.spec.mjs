import { test, expect } from "@playwright/test";
import { editorArtifact } from "./artifacts.mjs";
const rich = page => page.getByRole("textbox", { name: "Markdown 所见即所得编辑器", exact: true });
const modelText = page => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue());
const shortcut = key => `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;
async function ready(page, content = "# Title\n\nA **bold** paragraph.\n", readOnly = false) {
  await page.goto("/tests/editor/workbench.html?local&nativeMenu&wysiwyg");
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await page.evaluate(async ({ content, readOnly }) => { const f = window.workbenchFixture; f.files.set("/root/readme.md", { ...f.files.get("/root/a2.ts"), path: "/root/readme.md", content, readOnly }); await f.handle.open("/root/readme.md"); }, { content, readOnly });
  await page.getByRole("radio", { name: "所见即所得", exact: true }).check();
  await expect(rich(page)).toBeVisible();
}

test("rendered editor switches losslessly and rich edits share saves and undo with source", async ({ page }) => {
  const initial = "# Title\n\nA **bold** paragraph.\n";
  await ready(page, initial);
  await expect(rich(page).getByRole("heading", { name: "Title", exact: true })).toBeVisible();
  await expect(rich(page).locator("strong")).toHaveText("bold");
  expect(await modelText(page)).toBe(initial); await expect(page.getByLabel("未保存", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "源码", exact: true }).check(); await expect(page.locator(".monaco-editor")).toBeVisible();
  expect(await modelText(page)).toBe(initial);
  await page.getByRole("radio", { name: "所见即所得", exact: true }).check();
  await rich(page).locator("h1").click(); await page.keyboard.press("End"); await page.keyboard.insertText(" 中文");
  await expect.poll(() => modelText(page)).toContain("# Title 中文");
  await page.keyboard.press(shortcut("z")); await expect.poll(() => modelText(page)).toBe(initial);
  await page.keyboard.press(shortcut("Shift+z")); await expect.poll(() => modelText(page)).toContain("Title 中文");
  await page.keyboard.press(shortcut("s")); await expect.poll(() => page.evaluate(() => window.workbenchFixture.writes.length)).toBe(1);
  await page.getByRole("radio", { name: "源码", exact: true }).check(); expect(await modelText(page)).toContain("Title 中文");
});

test("editing one block retains frontmatter, comments, references, blank lines and untouched source exactly", async ({ page }) => {
  const initial = '---\ntitle: "keep"\n---\n\n# Heading\n\n\nUntouched __bold__ and *italic*.\n\nChange me.\n\n<!-- private source comment -->\n\n[reference]: https://example.com "Title"\n\n[Link][reference]\n\n```custom meta\n<keep>\n```\n';
  await ready(page, initial);
  await expect(rich(page).locator(".editor-rich-raw")).not.toHaveCount(0);
  await rich(page).locator("p").filter({ hasText: "Change me." }).click(); await page.keyboard.press("End"); await page.keyboard.insertText(" Extra");
  await expect.poll(() => modelText(page)).toBe(initial.replace("Change me.", "Change me. Extra"));
  await page.getByRole("button", { name: "保存当前文件", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.files.get("/root/readme.md").content)).toBe(initial.replace("Change me.", "Change me. Extra"));
});

test("GFM tasks and tables are editable and Mermaid renders while unsafe HTML and images remain inert", async ({ page }) => {
  const external = []; page.on("request", request => { if (/evil\.invalid/.test(request.url())) external.push(request.url()); });
  await ready(page, '# Document\n\n- [ ] First task\n- [x] Done\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n![image](https://evil.invalid/a.png)\n\n<script>window.richAttack = true</script>\n');
  await expect(rich(page).getByRole("checkbox")).toHaveCount(2);
  await rich(page).getByRole("checkbox").first().check(); await expect.poll(() => modelText(page)).toContain("- [x] First task");
  await expect(rich(page).getByRole("table")).toBeVisible();
  await rich(page).getByRole("cell", { name: "Two", exact: true }).click(); await page.keyboard.press("End"); await page.keyboard.insertText(" edited");
  await expect.poll(() => modelText(page)).toContain("Two edited");
  await expect(page.getByRole("figure", { name: "Mermaid 图表", exact: true }).getByRole("img")).toBeVisible();
  await expect(rich(page).locator('[data-image-reference="true"]')).toBeVisible();
  expect(await page.evaluate(() => window.richAttack)).toBeUndefined(); expect(external).toEqual([]);
  await rich(page).locator("h1").click();
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData("text/html", '<img src="https://evil.invalid/paste.png" onerror="window.richAttack=true">'); data.setData("text/plain", " pasted");
    document.querySelector('.editor-rich-host [contenteditable="true"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => modelText(page)).toContain("pasted"); expect(external).toEqual([]);
});

test("source changes sync across rendered splits and lock and close protection retain drafts", async ({ page }) => {
  await ready(page); await page.getByRole("button", { name: "向右拆分当前编辑组", exact: true }).click();
  await page.locator(".editor-group").last().getByRole("radio", { name: "所见即所得", exact: true }).check();
  await expect(rich(page)).toHaveCount(2);
  const first = page.locator(".editor-group").first(), second = page.locator(".editor-group").last();
  await first.getByRole("radio", { name: "源码", exact: true }).check();
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").setValue("# Shared draft\n\nText\n"));
  await expect(second.getByRole("heading", { name: "Shared draft" })).toBeVisible();
  await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(rich(page)).toHaveAttribute("contenteditable", "false");
  await page.evaluate(() => window.workbenchFixture.lock(false)); await expect(rich(page)).toHaveAttribute("contenteditable", "true");
  await second.getByRole("button", { name: "关闭编辑分组", exact: true }).click(); await expect(page.locator(".editor-group")).toHaveCount(1);
  await first.getByRole("button", { name: "关闭 readme.md", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  expect(await modelText(page)).toContain("Shared draft");
});

test("rendered layout stays compact in themes and narrow windows and large sources remain available", async ({ page }) => {
  await ready(page);
  for (const [theme, width] of [["light", 1280], ["dark", 760], ["light", 620]]) {
    await page.setViewportSize({ width, height: 800 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor("#e5b76d"); }, theme);
    await expect(rich(page)).toBeVisible(); await expect(page.getByRole("radiogroup", { name: "Markdown 编辑模式" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: editorArtifact(`dssh-wysiwyg-${theme}-${width}.png`) });
  }
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").setValue("Paragraph.\n\n".repeat(100000)));
  await expect(page.locator(".monaco-editor")).toBeVisible(); await expect(page.getByRole("radio", { name: "所见即所得", exact: true })).toBeDisabled();
});

test("format and link menus edit rendered text while native undo uses the canonical model", async ({ page }) => {
  await ready(page, "# Title\n\nBody\n");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.nativeMenuContexts.at(-1))).toBe(true);
  await rich(page).locator("p").dblclick();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Body");
  await page.getByRole("button", { name: "格式", exact: true }).click(); await page.getByRole("menuitem", { name: "粗体", exact: true }).click();
  await expect.poll(() => modelText(page)).toContain("**Body**");
  await page.getByRole("button", { name: "格式", exact: true }).click(); await page.getByRole("menuitem", { name: "编辑链接", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("https://example.com"); await page.getByRole("dialog").getByRole("button", { name: "确定", exact: true }).click();
  await expect(rich(page).getByRole("link", { name: "Body", exact: true })).toHaveAttribute("href", "https://example.com");
  await rich(page).focus();
  await page.evaluate(async () => { const { emit } = await import("/node_modules/@tauri-apps/api/event.js"); await emit("editor://native-menu", { ownerLabel: "main", command: "undo" }); });
  await expect.poll(() => modelText(page)).not.toContain("example.com");
});

test("IME composition commits Chinese and a concurrent source update is never overwritten by stale composition", async ({ page }) => {
  await ready(page, "# Title\n\nText\n");
  await rich(page).locator("p").click(); await page.keyboard.press("End");
  const session = await page.context().newCDPSession(page);
  await session.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
  await session.send("Input.insertText", { text: "中文" });
  await expect.poll(() => modelText(page)).toContain("Text中文");
  await session.send("Input.imeSetComposition", { text: "旧", selectionStart: 1, selectionEnd: 1 });
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").setValue("# External\n\nPreserved\n"));
  await session.send("Input.insertText", { text: "旧输入" });
  await expect.poll(() => modelText(page)).toBe("# External\n\nPreserved\n");
  await expect(rich(page).getByRole("heading", { name: "External", exact: true })).toBeVisible();
});

test("read-only Markdown permits switching display modes without allowing rendered edits", async ({ page }) => {
  await ready(page, "# Readonly\n", true);
  await expect(rich(page)).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("button", { name: "格式", exact: true })).toBeDisabled();
  await page.getByRole("radio", { name: "源码", exact: true }).check(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("radio", { name: "所见即所得", exact: true }).check(); await expect(rich(page)).toHaveAttribute("contenteditable", "false");
  expect(await modelText(page)).toBe("# Readonly\n"); expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
});

test("find opens the existing source search and lazy loading failure keeps raw editing available", async ({ page }) => {
  await ready(page);
  await rich(page).focus(); await page.keyboard.press(shortcut("f"));
  await expect(page.locator(".monaco-editor .find-widget")).toBeVisible();
  expect(await modelText(page)).toBe("# Title\n\nA **bold** paragraph.\n");
  await page.route("**/RichMarkdownView.tsx*", route => route.abort());
  await page.reload(); await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await page.evaluate(async () => { localStorage.setItem("dssh.editor.markdownMode", "rich"); const f = window.workbenchFixture; f.files.set("/root/failure.md", { ...f.files.get("/root/a2.ts"), path: "/root/failure.md", content: "# Kept\n" }); await f.handle.open("/root/failure.md"); });
  await page.getByRole("radio", { name: "所见即所得", exact: true }).check();
  await expect(page.getByRole("alert").filter({ hasText: "Markdown 编辑器加载失败" })).toBeVisible();
  await page.getByRole("button", { name: "使用源码编辑", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible(); expect(await modelText(page)).toBe("# Kept\n");
});

test("fenced Mermaid paste preserves literal code, language changes and atomic undo", async ({ page }) => {
  await ready(page, '# Keep\n\nInsert\n');
  await rich(page).locator('p').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  const before = await modelText(page);
  const fence = '```mermaid\ngraph TD\n  A[开始] --> B{是否登录?}\n  B -->|是| C[进入主页]\n```';
  await page.evaluate(text => { const data = new DataTransfer(); data.setData('text/plain', text); data.setData('text/html', '<img src="https://evil.invalid/paste" onerror="window.richAttack=true">'); document.querySelector('.editor-rich-host .tiptap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, fence);
  await expect.poll(() => modelText(page)).toContain(fence);
  await expect(page.getByRole('figure', { name: 'Mermaid 图表', exact: true }).getByRole('img')).toBeVisible();
  expect(await page.evaluate(() => window.richAttack)).toBeUndefined();
  const pasted = await modelText(page);
  await page.keyboard.press(shortcut('z')); await expect.poll(() => modelText(page)).toBe(before);
  await page.keyboard.press(shortcut('Shift+z')); await expect.poll(() => modelText(page)).toBe(pasted);
  const language = page.getByRole('combobox', { name: '代码块语言', exact: true });
  await language.fill('yaml'); await page.getByRole('option', { name: 'yaml', exact: true }).click();
  await expect.poll(() => modelText(page)).toContain('```yaml\ngraph TD\n  A[开始] --> B{是否登录?}');
  await expect(page.getByRole('figure', { name: 'Mermaid 图表', exact: true })).toHaveCount(0);
  await rich(page).locator('code').click(); await page.keyboard.press(shortcut('z'));
  await expect.poll(() => modelText(page)).toBe(pasted);
  await page.getByRole('button', { name: '保存当前文件', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.files.get('/root/readme.md').content)).toBe(pasted);
});

test("typing a code fence creates a language picker and code paste stays literal", async ({ page }) => {
  await ready(page, 'Start\n'); await rich(page).locator('p').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('```'); await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: '代码块语言', exact: true })).toBeVisible();
  await page.keyboard.insertText('A[x] --> B');
  await expect.poll(() => modelText(page)).toContain('A[x] --> B');
  await page.evaluate(() => { const data = new DataTransfer(); data.setData('text/plain', '\n```bash\necho [ok]\n```'); document.querySelector('.editor-rich-host .tiptap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(rich(page).locator('.editor-rich-code')).toHaveCount(1);
  await expect(rich(page).locator('code')).toContainText('```bash');
  await page.evaluate(() => window.workbenchFixture.lock(true));
  await expect(page.getByRole('combobox', { name: '代码块语言', exact: true })).toBeDisabled();
});

test('triple backticks immediately suggest languages and prefix acceptance is undoable', async ({ page }) => {
  await ready(page, 'Start\n'); await rich(page).locator('p').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  const popup = page.getByRole('listbox', { name: '代码围栏语言建议', exact: true });
  await expect(popup).toBeVisible(); await expect(popup.getByRole('option', { name: 'mermaid', exact: true })).toBeVisible();
  await page.keyboard.type('me'); await expect(popup.getByRole('option')).toHaveCount(1);
  await expect(rich(page)).toBeFocused();
  await page.screenshot({ path: editorArtifact('fence-language-prefix.png') });
  await page.keyboard.press('Enter'); await expect(popup).toBeHidden();
  await expect(rich(page).locator('code')).toHaveAttribute('data-language', 'mermaid');
  await page.keyboard.press(shortcut('z')); await expect(rich(page).locator('p').last()).toHaveText('```me');
  await page.keyboard.press(shortcut('Shift+z')); await expect(rich(page).locator('code')).toHaveAttribute('data-language', 'mermaid');
  await page.keyboard.insertText('graph TD\nA[开始] --> B[结束]');
  await expect(page.getByRole('figure', { name: 'Mermaid 图表', exact: true }).getByRole('img')).toBeVisible();
  await expect.poll(() => modelText(page)).toContain('```mermaid\ngraph TD\nA[开始] --> B[结束]\n```');
  await page.keyboard.press(shortcut('s'));
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.files.get('/root/readme.md').content)).toContain('```mermaid');
});

test('fence suggestions support arrows, cancellation, Tab and do not trigger in inline text or code', async ({ page }) => {
  await ready(page, 'Start\n'); await rich(page).locator('p').click(); await page.keyboard.press('End');
  await page.keyboard.type(' ```me'); await expect(page.getByRole('listbox', { name: '代码围栏语言建议' })).toHaveCount(0);
  await page.keyboard.press('Enter'); await page.keyboard.type('```');
  const popup = page.getByRole('listbox', { name: '代码围栏语言建议' }); await expect(popup).toBeVisible();
  await page.keyboard.press('ArrowDown'); await expect(popup.getByRole('option', { name: 'bash', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape'); await expect(popup).toBeHidden(); await expect(rich(page).locator('p').last()).toHaveText('```');
  await page.keyboard.type('py'); await expect(popup).toBeVisible(); await expect(popup.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Tab'); await expect(rich(page).locator('code')).toHaveAttribute('data-language', 'python');
  await page.keyboard.type('```me'); await expect(popup).toBeHidden();
  await expect(rich(page).locator('code')).toHaveText('```me');
});

test('pasted fence prefixes allow pointer completion and bounded themed suggestions close on lock', async ({ page }) => {
  await ready(page, 'Start\n'); await rich(page).locator('p').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.evaluate(() => { const data = new DataTransfer(); data.setData('text/plain', '```ya'); document.querySelector('.editor-rich-host .tiptap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  const popup = page.getByRole('listbox', { name: '代码围栏语言建议' }); await expect(popup).toBeVisible();
  for (const width of [1280, 360]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 650 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    await expect(popup).toBeVisible(); const box = await popup.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(650);
    await page.screenshot({ path: editorArtifact(`fence-language-${width}-${theme}.png`), animations: 'disabled' });
  }
  await popup.getByRole('option', { name: 'yaml', exact: true }).click();
  await expect(rich(page).locator('code')).toHaveAttribute('data-language', 'yaml'); await expect(rich(page)).toBeFocused();
  await page.keyboard.press(shortcut('z')); await expect(rich(page).locator('p').last()).toHaveText('```ya'); await rich(page).locator('p').last().click(); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight'); await expect(popup).toBeVisible();
  await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(popup).toBeHidden();
  await expect(rich(page)).toHaveAttribute('contenteditable', 'false');
});


test('code language picker stays compact and shows one name per option', async ({ page }) => {
  await ready(page, '```mermaid\ngraph TD\nA-->B\n```\n');
  const control = page.locator('.editor-rich-code__toolbar .combobox'), input = page.getByRole('combobox', { name: '代码块语言', exact: true });
  for (const width of [1280, 360]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 650 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    const box = await control.boundingBox(), toolbar = await page.locator('.editor-rich-code__toolbar').boundingBox();
    expect(box.width).toBeLessThanOrEqual(128); expect(box.height).toBe(24); expect(toolbar.x + toolbar.width - box.x - box.width).toBeLessThanOrEqual(9);
    await control.getByRole('button', { name: '展开选项', exact: true }).click(); const menu = page.getByRole('listbox', { name: '代码块语言', exact: true });
    await expect(menu.getByRole('option', { name: 'yaml', exact: true })).toHaveText('yaml');
    await expect(menu.locator('.combobox__option-label')).toHaveCount(0);
    await expect(menu.getByRole('option', { name: '纯文本', exact: true })).toHaveText('纯文本');
    await page.screenshot({ path: editorArtifact(`compact-language-${width}-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
  }
  await input.fill('yaml'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect.poll(() => modelText(page)).toContain('```yaml');
  await rich(page).locator('code').click(); await page.keyboard.press(shortcut('z')); await expect.poll(() => modelText(page)).toContain('```mermaid');
});

test('rendered formatting menus share the compact breadcrumb row beside document symbols', async ({ page }) => {
  await ready(page);
  const breadcrumb = page.getByRole('navigation', { name: '编辑器面包屑', exact: true });
  await expect(breadcrumb.getByRole('toolbar', { name: 'Markdown 排版', exact: true })).toBeVisible();
  await expect(page.locator('.editor-rich-view > .editor-rich-actions')).toHaveCount(0);
  for (const width of [1280, 620, 360]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 650 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor('#986aa6'); }, theme);
    const row = await breadcrumb.boundingBox(), symbols = await breadcrumb.getByRole('button', { name: '文档符号', exact: true }).boundingBox();
    expect(row.height).toBe(24);
    for (const name of ['格式', '表格']) {
      const box = await breadcrumb.getByRole('button', { name, exact: true }).boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(row.y); expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height);
      expect(box.x).toBeGreaterThanOrEqual(symbols.x + symbols.width); expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width);
    }
    await expect(breadcrumb.locator('.editor-breadcrumb__rich-actions')).toHaveCSS('border-left-width', '1px');
    if (width !== 620) await page.screenshot({ path: editorArtifact(`breadcrumb-format-${width}-${theme}.png`), animations: 'disabled' });
  }
  await page.getByRole('radio', { name: '源码', exact: true }).check();
  await expect(breadcrumb.getByRole('button', { name: '格式', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: '所见即所得', exact: true }).check();
  await expect(breadcrumb.getByRole('button', { name: '格式', exact: true })).toHaveCount(1);
});

test('breadcrumb formatting acts on its own rendered group and keeps lock protection', async ({ page }) => {
  await ready(page, '# Left\n\nLeftword\n');
  await page.getByRole('button', { name: '向右拆分当前编辑组', exact: true }).click();
  const left = page.locator('.editor-group').first(), right = page.locator('.editor-group').last();
  await page.evaluate(async () => { const f = window.workbenchFixture; f.files.set('/root/right.md', { ...f.files.get('/root/a2.ts'), path: '/root/right.md', content: '# Right\n\nRightword\n' }); await f.handle.open('/root/right.md'); });
  await right.getByRole('radio', { name: '所见即所得', exact: true }).check();
  await left.locator('.tiptap p').dblclick(); await expect.poll(() => page.evaluate(() => getSelection().toString())).toBe('Leftword');
  await right.locator('.tiptap p').dblclick();
  await left.getByRole('button', { name: '格式', exact: true }).click(); await page.getByRole('menuitem', { name: '粗体', exact: true }).click();
  await expect(left.locator('.tiptap strong')).toHaveText('Leftword');
  await expect(right.locator('.tiptap strong')).toHaveCount(0);
  await left.getByRole('button', { name: '表格', exact: true }).click(); await expect(page.getByRole('menu')).toBeVisible(); await page.keyboard.press('Escape');
  await page.evaluate(() => window.workbenchFixture.lock(true));
  for (const group of [left, right]) { await expect(group.getByRole('button', { name: '格式', exact: true })).toBeDisabled(); await expect(group.getByRole('button', { name: '表格', exact: true })).toBeDisabled(); }
  await page.evaluate(() => window.workbenchFixture.lock(false));
  await right.getByRole('button', { name: '关闭编辑分组', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Markdown 排版', exact: true })).toHaveCount(1);
});
