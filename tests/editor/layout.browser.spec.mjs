import { editorArtifact } from "./artifacts.mjs";
import { test, expect } from "@playwright/test";
const file = page => page.getByRole("treeitem").filter({ hasText: "a2.ts" });
async function ready(page, chrome = false) {
  await page.goto(`/tests/editor/workbench.html${chrome ? "?chrome" : ""}`);
  await expect(file(page)).toBeVisible(); await file(page).dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible();
}

test("classified menus replace duplicate icons and stay reachable in compact windows", async ({ page }) => {
  await ready(page, true);
  const toolbar = page.getByRole("toolbar", { name: "编辑器工具栏" });
  await expect(toolbar.getByRole("button", { name: "切换文件树", exact: true })).toHaveCount(0);
  const detach = toolbar.getByRole("button", { name: "在独立窗口打开编辑器", exact: true });
  await expect(detach).toHaveText(""); await expect(detach.locator("svg")).toHaveCount(1);
  await expect(detach).toHaveAttribute("title", "在独立窗口打开编辑器");
  expect(await toolbar.locator(".icon-button").evaluateAll(buttons => buttons.every(button => !button.textContent.trim() && button.title === button.getAttribute("aria-label")))).toBe(true);
  await expect(toolbar.getByRole("button", { name: /保存|拆分/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存当前文件", exact: true })).toHaveCount(1);
  const row = await toolbar.boundingBox(); expect(row.height).toBeLessThanOrEqual(44);
  for (const width of [1280, 620, 360]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (const name of ["文件", "编辑", "视图", "工具"]) {
      const trigger = toolbar.getByRole("button", { name, exact: true });
      await expect(trigger).toBeVisible();
      const box = await trigger.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      await trigger.focus(); await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("menu", { name, exact: true }); await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem").filter({ hasText: name === "文件" ? "全部保存" : name === "编辑" ? "全选" : name === "视图" ? "快捷打开" : "格式化文档" })).toHaveCount(1);
      const popup = await menu.boundingBox(); expect(popup.x).toBeGreaterThanOrEqual(0); expect(popup.x + popup.width).toBeLessThanOrEqual(width);
      if (width === 620 && ["文件", "工具"].includes(name)) await page.screenshot({ path: editorArtifact(`dssh-editor-menu-${name === "文件" ? "file" : "tools"}.png`), animations: "disabled" });
      await page.keyboard.press("End"); expect(await menu.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
    }
    expect((await toolbar.boundingBox()).height).toBe(row.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 620, height: 700 });
  await toolbar.getByRole("button", { name: "视图", exact: true }).click();
  await page.getByRole("menuitem", { name: "左右拆分编辑器", exact: true }).click();
  await expect(page.locator(".editor-group")).toHaveCount(2);
  await page.getByRole("button", { name: "在独立窗口打开编辑器" }).click();
  expect(await page.evaluate(() => window.workbenchFixture.detachRequests)).toBe(1);
  await toolbar.getByRole("button", { name: "文件", exact: true }).click();
  await page.evaluate(() => window.workbenchFixture.lock(true));
  await expect(page.getByRole("menu", { name: "文件", exact: true })).toHaveCount(0);
  for (const name of ["文件", "编辑", "视图", "工具"]) await expect(toolbar.getByRole("button", { name, exact: true })).toBeDisabled();
  await page.evaluate(() => { window.workbenchFixture.lock(false); window.workbenchFixture.handoff(true); });
  await expect(page.getByRole("button", { name: "在独立窗口打开编辑器" })).toBeDisabled();
});

test("file menu saves the focused document once and keeps project commands available", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "向右拆分当前编辑组", exact: true }).click();
  await page.evaluate(async () => {
    const f = window.workbenchFixture; await f.handle.open("/root/a10.ts");
    for (const model of f.monaco.editor.getModels()) if (model.uri.scheme === "dssh-editor") model.setValue(model.getValue() + "\nmenu draft");
  });
  const toolbar = page.getByRole("toolbar", { name: "编辑器工具栏" });
  await toolbar.getByRole("button", { name: "文件", exact: true }).click();
  const menu = page.getByRole("menu", { name: "文件", exact: true });
  for (const name of ["新建文本文件", "新建文件", "新建目录", "另存为", "复制绝对路径", "删除…"]) await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveCount(1);
  await menu.getByRole("menuitem", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.writes.map(w => w.path))).toEqual(["/root/a10.ts"]);
  await expect(page.locator(".editor-group").first().locator(".editor-dirty")).toBeVisible();
  await page.locator(".editor-group").first().getByRole("button", { name: "保存当前文件", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.writes.map(w => w.path))).toEqual(["/root/a10.ts", "/root/a2.ts"]);
});

test("Explorer width supports pointer, keyboard, cancellation and persistence without replacing the model", async ({ page }) => {
  await ready(page);
  await expect(page.locator(".editor-open-documents")).toHaveCount(0);
  const sidebar = page.getByRole("complementary", { name: "编辑器侧栏" });
  const explorer = sidebar.locator(".editor-explorer");
  expect((await explorer.boundingBox()).y).toBe((await sidebar.boundingBox()).y);
  await expect(page.getByRole("tab", { name: /a2.ts/ })).toHaveAttribute("aria-selected", "true");
  const sash = page.getByRole("separator", { name: "调整文件树宽度" });
  const initial = Number(await sash.getAttribute("aria-valuenow"));
  const model = await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").uri.toString());
  const box = await sash.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 92, box.y + 100); await page.mouse.up();
  await expect(sash).toHaveAttribute("aria-valuenow", String(initial + 90));
  await sash.focus(); await page.keyboard.press("ArrowRight"); await expect(sash).toHaveAttribute("aria-valuenow", String(initial + 100));
  const narrowBox = await sash.boundingBox(); await page.mouse.move(narrowBox.x + 2, narrowBox.y + 100); await page.mouse.down(); await page.mouse.move(narrowBox.x + 2 - initial - 100 + 120, narrowBox.y + 100); await page.mouse.up();
  await expect(sash).toHaveAttribute("aria-valuenow", "120");
  const cancelBox = await sash.boundingBox(); await page.mouse.move(cancelBox.x + 2, cancelBox.y + 100); await page.mouse.down(); await page.mouse.move(cancelBox.x + 72, cancelBox.y + 100); await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(sash).toHaveAttribute("aria-valuenow", "120");
  await page.keyboard.press("End"); const max = await sash.getAttribute("aria-valuemax"); await expect(sash).toHaveAttribute("aria-valuenow", max);
  await sash.dblclick(); await expect(sash).toHaveAttribute("aria-valuenow", "240");
  await sash.focus(); await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").uri.toString())).toBe(model);
  await page.reload(); await expect(file(page)).toBeVisible();
  await expect(page.getByRole("separator", { name: "调整文件树宽度" })).toHaveAttribute("aria-valuenow", "250");
});

test("workspace chrome distinguishes projects from file tabs in wide, narrow and custom palettes", async ({ page }) => {
  await ready(page, true);
  const tabs = page.getByRole("tablist", { name: "工作区标签" });
  await expect(tabs.getByRole("tab", { name: "文本编辑器 1", exact: true })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "文本编辑器 2", exact: true })).toBeVisible();
  await expect(tabs.locator(".tab__source")).toHaveCount(0);
  await expect(tabs.locator('[aria-selected="true"]')).toHaveAttribute("title", "SSH · /root");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const ssh = tabs.getByRole("tab", { name: "118.31.169.7", exact: true });
  const editor = tabs.getByRole("tab", { name: "project", exact: true });
  const selectedColor = await page.evaluate(() => {
    const probe = document.createElement("span"); probe.style.background = "var(--bg-selected)"; document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color;
  });
  const styles = tab => tab.evaluate(el => {
    const css = getComputedStyle(el), close = getComputedStyle(el.querySelector(".tab__close"));
    return { tab: [css.height, css.borderRadius, css.borderColor, css.boxShadow, css.paddingLeft, css.paddingRight, css.gap, css.maxWidth, css.backgroundColor, css.color], close: [close.position, close.width, close.height, close.borderRadius, close.backgroundColor, close.display] };
  });
  await ssh.click(); await ssh.hover();
  await expect.poll(() => ssh.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(selectedColor);
  const referenceStyle = await styles(ssh);
  await editor.click(); await editor.hover();
  await expect.poll(() => styles(editor)).toEqual(referenceStyle);
  const a = await page.getByRole("button", { name: "新建本地终端", exact: true }).boundingBox();
  const b = await page.getByRole("button", { name: "新建文本编辑器", exact: true }).boundingBox();
  expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(1);
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await expect(page.locator(".editor-toolbar")).toHaveCSS("flex-wrap", "nowrap");
  await settledChrome(page);
  await page.screenshot({ path: editorArtifact("dssh-editor-ui-wide.png") });
  await page.setViewportSize({ width: 760, height: 700 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; window.workbenchFixture.palette.setPaletteColor("#e5b76d"); });
  await expect.poll(() => page.locator(".editor-toolbar").evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(44);
  await settledChrome(page);
  await page.screenshot({ path: editorArtifact("dssh-editor-ui-dark-narrow.png") });
  await page.setViewportSize({ width: 620, height: 700 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches)).toBe(true);
  await expect(page.locator(".activity-bar")).toHaveCSS("backdrop-filter", "none");
  await settledChrome(page);
  await page.screenshot({ path: editorArtifact("dssh-editor-ui-light-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function settledChrome(page) {
  const group = await page.locator(".editor-group").first().boundingBox();
  const firstTab = await page.locator(".editor-file-tab").first().boundingBox();
  expect(Math.abs(firstTab.x - group.x)).toBeLessThan(1);
  const header = await page.locator(".editor-group__tabs").first().boundingBox();
  expect(header.height).toBe(32);
  expect(Math.abs(firstTab.y - header.y)).toBeLessThan(1);
  expect(Math.abs(firstTab.y + firstTab.height - header.y - header.height)).toBeLessThanOrEqual(1);
}


test("an all-disabled file menu closes with Escape and keyboard navigation reaches the sidebar sash", async ({ page }) => {
  await page.goto("/tests/editor/workbench.html"); await expect(file(page)).toBeVisible();
  const trigger = page.getByRole("button", { name: "文件标签操作", exact: true });
  await trigger.click(); const menu = page.getByRole("menu", { name: "文件标签操作", exact: true });
  await expect(menu).toBeFocused();
  await page.keyboard.press("Escape"); await expect(menu).not.toBeVisible(); await expect(trigger).toBeFocused();
  await page.keyboard.press("Shift+Tab"); const sash = page.getByRole("separator", { name: "调整文件树宽度" });
  await expect(sash).toBeFocused(); await page.keyboard.press("ArrowRight"); await expect(sash).toHaveAttribute("aria-valuenow", "250");
});

test("file header exposes contextual Markdown preview and keeps actions visible in narrow palettes", async ({ page }) => {
  await ready(page);
  const group = page.locator(".editor-group").first();
  const actions = group.getByRole("toolbar", { name: "文件快捷操作" });
  await expect(actions.getByRole("button", { name: "Markdown 预览", exact: true })).toHaveCount(0);
  await page.evaluate(async () => { const f = window.workbenchFixture; f.files.set("/root/readme.md", { ...f.files.get("/root/a2.ts"), path: "/root/readme.md", content: "# Header preview\nUnsaved source" }); await f.handle.open("/root/readme.md"); });
  const preview = actions.getByRole("button", { name: "Markdown 预览", exact: true });
  await expect(preview).toBeVisible(); await expect(preview).toHaveAttribute("title", "Markdown 预览");
  await preview.focus(); await page.keyboard.press("Enter");
  await expect(preview).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article", { name: "Markdown 预览" }).getByRole("heading", { name: "Header preview" })).toBeVisible();
  await page.evaluate(() => { const f = window.workbenchFixture; f.monaco.editor.getModels().find(model => model.getValue().startsWith("# Header preview")).setValue("# Live Markdown draft"); });
  await expect(page.getByRole("article", { name: "Markdown 预览" }).getByRole("heading", { name: "Live Markdown draft" })).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width: 620, height: 700 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor("#e5b76d"); }, theme);
    const bar = await actions.boundingBox(); const header = await group.locator(".editor-group__tabs").boundingBox();
    expect(header.height).toBe(32);
    for (const row of await page.locator(".editor-group__tabs").all()) expect((await row.boundingBox()).height).toBe(32);
    expect(bar.x + bar.width).toBeLessThanOrEqual(header.x + header.width + 1);
    for (const button of await actions.getByRole("button").all()) { const bounds = await button.boundingBox(); expect(bounds.y).toBeGreaterThanOrEqual(header.y); expect(bounds.y + bounds.height).toBeLessThanOrEqual(header.y + header.height); }
    await page.screenshot({ path: editorArtifact(`dssh-editor-file-actions-${theme}.png`), animations: "disabled" });
  }
  await preview.click(); await expect(preview).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "关闭预览 readme.md", exact: true }).click();
  await expect(preview).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("article", { name: "Markdown 预览" })).toHaveCount(0);
  await page.evaluate(() => window.workbenchFixture.handoff(true)); await expect(preview).toBeDisabled();
  await page.evaluate(() => window.workbenchFixture.handoff(false)); await page.evaluate(() => window.workbenchFixture.lock(true));
  await expect(preview).toBeDisabled();
});

test("file header save and split target their own group rather than the previously focused group", async ({ page }) => {
  await ready(page);
  await page.getByRole("toolbar", { name: "文件快捷操作" }).getByRole("button", { name: "向右拆分当前编辑组", exact: true }).click();
  await expect(page.locator(".editor-group")).toHaveCount(2);
  await page.evaluate(async () => { const f = window.workbenchFixture; await f.handle.open("/root/a10.ts"); for (const model of f.monaco.editor.getModels()) { if (model.getValue().includes("// a2.ts")) model.setValue("first dirty"); else if (model.getValue().includes("// a10.ts")) model.setValue("second dirty"); } });
  const first = page.locator(".editor-group").first();
  await first.getByRole("button", { name: "保存当前文件", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.writes.map(w => w.path))).toEqual(["/root/a2.ts"]);
  await expect(page.locator(".editor-group").last().locator(".editor-dirty")).toBeVisible();
  await page.locator(".editor-group").last().getByRole("tab", { name: /a10.ts/ }).click();
  await first.getByRole("button", { name: "向右拆分当前编辑组", exact: true }).click();
  await expect(page.locator(".editor-group")).toHaveCount(3);
  await expect(page.locator(".editor-group").nth(1).getByRole("tab", { name: /a2.ts/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".editor-group").last().getByRole("tab", { name: /a10.ts/ })).toHaveAttribute("aria-selected", "true");
});

test("Markdown preview follows its explicit file and switching groups does not toggle the wrong preview", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => { const f = window.workbenchFixture; for (const name of ["one", "two"]) f.files.set(`/root/${name}.md`, { ...f.files.get("/root/a2.ts"), path: `/root/${name}.md`, content: `# Preview ${name}` }); await f.handle.open("/root/one.md"); });
  await page.getByRole("toolbar", { name: "文件快捷操作" }).getByRole("button", { name: "Markdown 预览" }).click();
  await page.getByRole("toolbar", { name: "文件快捷操作" }).getByRole("button", { name: "向右拆分当前编辑组", exact: true }).click();
  await page.evaluate(() => window.workbenchFixture.handle.open("/root/two.md"));
  const article = page.getByRole("article", { name: "Markdown 预览" });
  await expect(article.getByRole("heading", { name: "Preview one" })).toBeVisible();
  const last = page.locator(".editor-group").last().getByRole("button", { name: "Markdown 预览", exact: true });
  await expect(last).toHaveAttribute("aria-pressed", "false"); await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true"); await expect(article.getByRole("heading", { name: "Preview two" })).toBeVisible();
  await expect(page.locator(".editor-group").first().getByRole("button", { name: "Markdown 预览", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("tablist", { name: "Markdown 预览标签", exact: true }).getByRole("tab")).toHaveCount(2);
});


test("Explorer drag snaps closed on release and restores its width without changing drafts", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const f = window.workbenchFixture; f.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").setValue("snap draft"); });
  const sash = page.getByRole("separator", { name: "调整文件树宽度" });
  const toggle = page.getByRole("toolbar", { name: "编辑器工具栏" }).getByRole("button", { name: "视图", exact: true });
  await sash.focus(); await page.keyboard.press("ArrowRight");
  await expect(sash).toHaveAttribute("aria-valuenow", "250");
  const model = await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.getValue() === "snap draft").uri.toString());
  async function previewSnap() {
    const box = await sash.boundingBox(); await page.mouse.move(box.x + 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 2 - 200, box.y + 100);
    await expect(sash).toHaveAttribute("aria-valuenow", "0");
    await expect(page.locator(".editor-sidebar-dock")).toHaveClass(/is-snapping/);
    expect(await page.evaluate(() => localStorage.getItem("dssh.editor.sidebarWidth"))).toBe("250");
    return box;
  }
  const box = await previewSnap();
  await page.mouse.move(box.x + 2 - 100, box.y + 100); await expect(sash).toHaveAttribute("aria-valuenow", "150");
  await page.keyboard.press("Escape"); await page.mouse.up(); await expect(sash).toHaveAttribute("aria-valuenow", "250");
  await previewSnap(); await sash.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.up(); await expect(sash).toHaveAttribute("aria-valuenow", "250");
  await previewSnap(); await page.mouse.up(); await expect(sash).toHaveCount(0); await expect(toggle).toBeFocused();
  await toggle.click(); await page.getByRole("menuitem", { name: "显示文件树", exact: true }).click();
  await expect(sash).toHaveAttribute("aria-valuenow", "250");
  expect(await page.evaluate(() => { const m = window.workbenchFixture.monaco.editor.getModels().find(m => m.getValue() === "snap draft"); return m.uri.toString(); })).toBe(model);
  await expect(page.locator(".editor-dirty")).toBeVisible();
  await sash.focus(); await page.keyboard.press("Home"); await expect(sash).toHaveCount(0); await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByRole("menu", { name: "视图", exact: true })).toBeVisible(); await page.keyboard.press("Enter"); await expect(sash).toHaveAttribute("aria-valuenow", "250");
  await page.setViewportSize({ width: 620, height: 700 }); await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: editorArtifact("dssh-editor-sidebar-restored.png"), animations: "disabled" });
});

test("search sidebar supports snap cancellation and lock or handoff prevents resizing", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "视图", exact: true }).click(); await page.getByRole("menuitem", { name: "目录内容搜索", exact: true }).click();
  const sash = page.getByRole("separator", { name: "调整文件树宽度" });
  await expect(page.getByRole("textbox", { name: "目录搜索文本", exact: true })).toBeVisible();
  let box = await sash.boundingBox(); await page.mouse.move(box.x + 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x - 180, box.y + 100);
  await expect(sash).toHaveAttribute("aria-valuenow", "0");
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up();
  await expect(sash).toHaveAttribute("aria-valuenow", "240");
  box = await sash.boundingBox(); await page.mouse.move(box.x + 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 80, box.y + 100);
  await page.evaluate(() => window.workbenchFixture.lock(true)); await page.mouse.up();
  await expect(sash).toHaveAttribute("aria-valuenow", "240"); await expect(sash).toHaveAttribute("aria-disabled", "true");
  await sash.dispatchEvent("keydown", { key: "Home" }); await expect(sash).toBeVisible();
  await page.evaluate(() => { window.workbenchFixture.lock(false); window.workbenchFixture.handoff(true); });
  await expect(sash).toHaveAttribute("aria-disabled", "true");
  await page.evaluate(() => window.workbenchFixture.handoff(false));
  await sash.focus(); await page.keyboard.press("Home"); await expect(sash).toHaveCount(0);
  await page.getByRole("button", { name: "视图", exact: true }).click(); await page.getByRole("menuitem", { name: "目录内容搜索", exact: true }).click();
  await expect(sash).toHaveAttribute("aria-valuenow", "240");
  const detach = page.getByRole("button", { name: "在独立窗口打开编辑器", exact: true });
  await expect(detach).toHaveText(""); await expect(detach.locator("svg")).toHaveCount(1); await detach.click();
  expect(await page.evaluate(() => window.workbenchFixture.detachRequests)).toBe(1);
});
