import { editorArtifact } from "./artifacts.mjs";
import { test, expect } from "@playwright/test";
async function menuAction(page, menu, name) {
  await page.getByRole("toolbar", { name: "编辑器工具栏" }).getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menu", { name: menu, exact: true }).getByRole("menuitem", { name, exact: true }).click();
}
const tree = (page, name) => page.getByRole("treeitem").filter({ hasText: name });
async function ready(page) { await page.goto("/tests/editor/workbench.html"); await expect(tree(page, "a2.ts")).toBeVisible(); }
async function edit(page, text) { await page.evaluate((text) => { const f = window.workbenchFixture; const model = f.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor"); if (!model) throw new Error("missing model"); model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null); }, text); }

test("local editor opens files and requests folders without SSH while selection cancellation preserves work", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/tests/editor/workbench.html?local");
  await expect(tree(page, "a2.ts")).toBeVisible();
  await menuAction(page, "文件", "打开文件");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.evaluate(() => { window.workbenchFixture.nativeSelection.path = "/root/a2.ts"; });
  await menuAction(page, "文件", "打开文件");
  await expect(page.getByRole("tab").filter({ hasText: "a2.ts" })).toBeVisible();
  await edit(page, "local draft");
  await page.evaluate(() => { window.workbenchFixture.nativeSelection.path = null; });
  await menuAction(page, "文件", "打开文件");
  await page.evaluate(() => { window.workbenchFixture.nativeSelection.fail = true; });
  await menuAction(page, "文件", "打开文件");
  await expect(page.locator(".editor-error[role='alert']")).toContainText("合成文件选择失败");
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").getValue())).toBe("local draft");
  await page.evaluate(() => { const n = window.workbenchFixture.nativeSelection; n.fail = false; n.path = "/root/nested"; });
  await menuAction(page, "文件", "打开文件夹");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.nativeSelection.folders)).toEqual(["/root/nested"]);
  const state = await page.evaluate(() => window.workbenchFixture.nativeSelection);
  expect(state.calls.map((c) => c.directory)).toEqual([false, false, false, false, true]);
  expect(state.commands.some((c) => /ssh|sftp|session/.test(c))).toBe(false);
  await menuAction(page, "文件", "新建文本文件");
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("workbench tree is lazy, naturally sorted, hidden-aware and retries one failed node", { tag: "@smoke" }, async ({ page }) => {
  await ready(page);
  expect(await page.getByRole("treeitem").allTextContents()).toEqual(["fail", "nested", "a2.ts", "a10.ts"]);
  expect(await page.evaluate(() => window.workbenchFixture.reads.every((path) => path === "/root"))).toBe(true);
  await tree(page, "fail").click(); await expect(page.getByRole("alert")).toContainText("读取目录失败");
  await page.getByRole("button", { name: "重试", exact: true }).click(); await expect(tree(page, "retry.txt")).toBeVisible();
  await page.getByRole("button", { name: "显示隐藏文件" }).click(); await expect(tree(page, ".hidden")).toBeVisible();
  await tree(page, ".hidden").click(); await page.getByRole("button", { name: "显示隐藏文件" }).click();
  await expect(tree(page, ".hidden")).toHaveCount(0); await expect(page.locator(".editor-tree-row.is-selected")).toHaveCount(0);
});

test("preview edits pin tabs, splits share text, save updates baseline and hiding retains models", { tag: "@smoke" }, async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".editor-file-tab.is-preview")).toHaveCount(1);
  await edit(page, "const changed = 2;"); await expect(page.locator(".editor-file-tab.is-preview")).toHaveCount(0);
  await tree(page, "a10.ts").click(); await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").filter({ hasText: "a2.ts" }).click(); await menuAction(page, "视图", "左右拆分编辑器");
  await expect(page.locator(".editor-group .monaco-editor")).toHaveCount(2);
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors().map((e) => e.getModel()).every((m, _, models) => m === models[0]))).toBe(true);
  await menuAction(page, "文件", "保存");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.writes.length)).toBe(1);
  await expect(page.getByLabel("未保存", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "切换可见" }).click(); await page.getByRole("button", { name: "切换可见" }).click();
  await expect(page.locator(".editor-group .monaco-editor")).toHaveCount(2);
});

test("cancelled close preserves the draft and lock makes every mounted view read-only", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible(); await edit(page, "draft");
  await page.getByRole("button", { name: "关闭工作台" }).click(); await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.workbenchFixture.closeResult)).toBe(false);
  await page.getByRole("button", { name: "切换锁定" }).click();
  expect(await page.evaluate(() => { const f = window.workbenchFixture; return f.monaco.editor.getEditors().every((e) => e.getOption(f.monaco.editor.EditorOption.readOnly)); })).toBe(true);
  await page.getByRole("button", { name: "切换锁定" }).click();
  await page.getByRole("button", { name: "关闭工作台" }).click(); await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByRole("tree")).toHaveCount(0);
});

test("repeated split commands preserve a restorable layout at the group budget", async ({ page }) => {
  await ready(page);
  // Dispatch in one event to exercise commands arriving before React renders again.
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.workbenchFixture.handle.execute(i % 2 ? "editorSplitHorizontal" : "editorSplitVertical"); });
  await expect(page.locator(".editor-group")).toHaveCount(8);
  await page.getByRole("button", { name: "视图", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "左右拆分编辑器" })).toBeHidden();
  await expect(page.getByRole("menuitem", { name: "上下拆分编辑器" })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toContainText("最多同时打开 8 个编辑分组");
  expect(await page.evaluate(() => {
    const handle = window.workbenchFixture.handle;
    return { state: handle.snapshot(), splitDisabled: handle.commands().filter((c) => ["editorSplitHorizontal", "editorSplitVertical"].includes(c.id)).every((c) => c.disabled) };
  })).toMatchObject({ state: { focused: expect.any(String), layout: { kind: "split" } }, splitDisabled: true });
  await page.locator(".editor-group").first().getByRole("button", { name: "文件标签操作" }).click();
  await page.getByRole("menuitem", { name: "关闭编辑分组", exact: true }).click();
  await expect(page.locator(".editor-group")).toHaveCount(7);
  await page.getByRole("button", { name: "视图", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "左右拆分编辑器" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await menuAction(page, "视图", "左右拆分编辑器");
  await expect(page.locator(".editor-group")).toHaveCount(8);
});

test("workbench layout remains bounded in dark, light and narrow views", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.screenshot({ path: editorArtifact("dssh-editor-dark.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.setViewportSize({ width: 720, height: 650 });
  await page.screenshot({ path: editorArtifact("dssh-editor-light-narrow.png") });
  const bounds = await page.locator(".editor-workbench").boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(720); expect(bounds.y + bounds.height).toBeLessThanOrEqual(650);
});

test("menus run native edit actions and group close keeps the shared document", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await edit(page, "draft"); await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("menuitem", { name: "撤销", exact: true }).click(); await expect(page.getByLabel("未保存", { exact: true })).toHaveCount(0);
  await menuAction(page, "视图", "左右拆分编辑器"); await expect(page.locator(".editor-group")).toHaveCount(2);
  await page.locator(".editor-group").last().getByRole("button", { name: "文件标签操作" }).click();
  await page.getByRole("menuitem", { name: "关闭编辑分组", exact: true }).click();
  await expect(page.locator(".editor-group")).toHaveCount(1); await expect(page.locator(".monaco-editor")).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().length)).toBe(1);
});

test("encoding and EOL changes are dirty and save-as cancel leaves the same document", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "文件行尾", exact: true }).click(); await page.getByRole("option", { name: "CRLF", exact: true }).click();
  await expect(page.getByLabel("未保存", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "文件编码", exact: true }).click(); await page.getByRole("option", { name: "UTF-16LE", exact: true }).click();
  await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: "另存为", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await menuAction(page, "文件", "保存");
  expect(await page.evaluate(() => { const request = window.workbenchFixture.writes[0]; return { path: request.path, encoding: request.encoding, lineEnding: request.lineEnding }; })).toEqual({ path: "/root/a2.ts", encoding: "utf-16le", lineEnding: "crlf" });
});

test("directory replacement reviews memory and disk separately and cancellation changes neither", async ({ page }) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await edit(page, "needle in draft");
  await page.evaluate(() => { const f = window.workbenchFixture; f.files.set("/root/a10.ts", { ...f.files.get("/root/a10.ts"), content: "needle on disk" }); });
  await menuAction(page, "视图", "目录内容搜索");
  await page.getByRole("textbox", { name: "目录搜索文本", exact: true }).fill("needle");
  await page.getByRole("button", { name: "替换", exact: true }).click();
  await page.getByRole("textbox", { name: "目录替换文本", exact: true }).fill("changed");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("button", { name: "预览替换", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "预览替换", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("1 个已打开文档仅修改内存");
  await expect(page.getByRole("dialog")).toContainText("1 个未打开文件将直接落盘");
  await expect(page.getByRole("dialog").locator(".monaco-diff-editor")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await page.getByRole("button", { name: "预览替换", exact: true }).click();
  await page.getByRole("button", { name: "确认应用替换", exact: true }).click();
  await expect(page.getByRole("region", { name: "替换结果" })).toContainText("已修改内存，尚未保存");
  await expect(page.getByRole("region", { name: "替换结果" })).toContainText("已落盘");
  expect(await page.evaluate(() => { const f = window.workbenchFixture; return { memory: f.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").getValue(), disk: f.files.get("/root/a10.ts").content, writes: f.writes.length }; })).toEqual({ memory: "changed in draft", disk: "changed on disk", writes: 1 });
  expect(errors).toEqual([]);
});

test("catastrophic regex is terminated in a worker while browser events remain responsive", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    let responsive = false; setTimeout(() => { responsive = true; }, 20);
    const start = performance.now();
    try { await window.workbenchFixture.searchInWorker("a".repeat(30000) + "!", { pattern: "(a+)+$", regex: true, wholeWord: false, caseSensitive: true }, 2000, new AbortController().signal); return { error: "missing timeout", responsive, duration: performance.now() - start }; }
    catch (error) { return { error: error.message, responsive, duration: performance.now() - start }; }
  });
  expect(result.error).toContain("超过 1 秒"); expect(result.responsive).toBe(true); expect(result.duration).toBeLessThan(2000);
});

test("quick-open fuzzy paths open files and modal cancellation preserves the current buffer", async ({ page }) => {
  await ready(page); await menuAction(page, "视图", "快捷打开");
  await expect(page.getByRole("dialog")).toBeVisible();
  const query = page.getByRole("textbox", { name: "搜索文件名或相对路径", exact: true });
  await query.fill("nch"); await expect(page.getByRole("option", { name: "nested/child.txt", exact: true })).toBeVisible();
  await query.press("Enter"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByRole("tab").filter({ hasText: "child.txt" })).toBeVisible();
  await menuAction(page, "视图", "快捷打开"); await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("tab").filter({ hasText: "child.txt" })).toBeVisible();
});

test("editor shortcut overrides suppress old defaults, ignore IME, and close only the current file", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible(); await edit(page, "draft");
  const primary = await page.evaluate(() => navigator.userAgent.includes("Mac") ? "Meta" : "Control");
  await page.evaluate(() => {
    localStorage.setItem("dssh.shortcuts.v1", JSON.stringify({ editorSave: { key: "u", primary: true, shift: true, alt: false } }));
    window.workbenchFixture.monaco.editor.getEditors()[0].focus();
  });
  await page.keyboard.press(`${primary}+s`); expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await page.evaluate((primary) => {
    const input = document.querySelector(".monaco-editor textarea"); input.dispatchEvent(new KeyboardEvent("keydown", { key: "u", shiftKey: true, metaKey: primary === "Meta", ctrlKey: primary === "Control", isComposing: true, bubbles: true, cancelable: true }));
  }, primary);
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await page.keyboard.press(`${primary}+Shift+u`); await expect.poll(() => page.evaluate(() => window.workbenchFixture.writes.length)).toBe(1);
  await page.keyboard.press(`${primary}+w`); await expect(page.getByRole("tab")).toHaveCount(0); await expect(page.getByRole("tree")).toBeVisible();
});

test("large-file cancel creates no model and accepted limited mode disables language and costly views", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const f = window.workbenchFixture; f.files.set("/root/large.ts", { ...f.files.get("/root/a2.ts"), path: "/root/large.ts", largeFile: true, byteLength: 21 * 1024 * 1024 }); void f.handle.open("/root/large.ts"); });
  await expect(page.getByRole("dialog")).toContainText("受限模式"); await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().length)).toBe(0);
  await page.evaluate(() => { void window.workbenchFixture.handle.open("/root/large.ts"); }); await page.getByRole("button", { name: "以受限模式打开", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  const mode = await page.evaluate(() => { const f = window.workbenchFixture; const editor = f.monaco.editor.getEditors()[0]; const options = f.monaco.editor.EditorOption; return { language: editor.getModel().getLanguageId(), minimap: editor.getOption(options.minimap).enabled, folding: editor.getOption(options.folding), codeLens: editor.getOption(options.codeLens), content: editor.getValue() }; });
  expect(mode).toEqual({ language: "plaintext", minimap: false, folding: false, codeLens: false, content: "// a2.ts\nconst value = 1;" });
  await expect(page.getByRole("button", { name: "文本语言", exact: true })).toBeDisabled(); await page.getByRole("button", { name: "工具", exact: true }).click(); await expect(page.getByRole("menuitem", { name: "与已保存版本比较", exact: true })).toBeHidden(); await page.keyboard.press("Escape");
});

test("native find/replace handles literal matches, invalid regex and undo without saving", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible(); await edit(page, "cat CAT scatter\ncat");
  await page.getByRole("button", { name: "编辑", exact: true }).click(); await page.getByRole("menuitem", { name: "替换", exact: true }).click();
  const widget = page.locator(".find-widget.visible"); await expect(widget).toBeVisible();
  const find = widget.getByRole("textbox", { name: "Find", exact: true }); const replacement = widget.getByRole("textbox", { name: "Replace", exact: true });
  await find.fill("cat"); await replacement.fill("dog");
  await expect(widget.locator(".matchesCount")).toContainText("of 4");
  await expect(widget.getByRole("button", { name: /^Replace All/ })).toBeEnabled();
  await widget.getByRole("button", { name: /^Replace All/ }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").getValue())).toBe("dog dog sdogter\ndog");
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await page.evaluate(async () => { await window.workbenchFixture.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").undo(); });
  await find.focus();
  const primary = await page.evaluate(() => navigator.userAgent.includes("Mac") ? "Meta" : "Control");
  await page.keyboard.press(`${primary}+Alt+r`);
  await expect(widget.getByRole("checkbox", { name: /Regular Expression/ })).toHaveAttribute("aria-checked", "true");
  await find.fill("[");
  const original = await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").getValue());
  await widget.getByRole("button", { name: /^Replace All/ }).click({ force: true });
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").getValue())).toBe(original);
});

test("JSON formatting is provider-backed and problems are scoped to loaded workspace models", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible(); await edit(page, '{"a":1}');
  await page.getByRole("button", { name: "文本语言", exact: true }).click(); await page.getByRole("option", { name: "JSON", exact: true }).click();
  await page.getByRole("button", { name: "工具", exact: true }).click(); await expect(page.getByRole("menuitem", { name: "格式化文档", exact: true })).toBeEnabled();
  await page.getByRole("menuitem", { name: "格式化文档", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").getValue())).toContain('\n');
  await page.evaluate(() => {
    const f = window.workbenchFixture; const model = f.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor");
    f.monaco.editor.setModelMarkers(model, "test", [{ severity: f.monaco.MarkerSeverity.Error, message: "本工作台问题", startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }]);
    const foreign = f.monaco.editor.createModel("foreign", "plaintext"); f.monaco.editor.setModelMarkers(foreign, "test", [{ severity: f.monaco.MarkerSeverity.Error, message: "其他工作台问题", startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }]);
  });
  await menuAction(page, "视图", "显示问题面板"); await expect(page.getByRole("region", { name: "问题列表", exact: true })).toContainText("本工作台问题");
  await expect(page.getByRole("region", { name: "问题列表", exact: true })).not.toContainText("其他工作台问题");
});

test("delete preview cancel retains descendant drafts and confirmed deletion waits for every view to close", async ({ page }) => {
  await ready(page); await tree(page, "nested").click(); await tree(page, "child.txt").click(); await expect(page.locator(".monaco-editor")).toBeVisible(); await edit(page, "unsaved descendant");
  await tree(page, "nested").click();
  async function requestDelete() { await page.getByRole("button", { name: "文件", exact: true }).click(); await page.getByRole("menuitem", { name: "删除…", exact: true }).click(); await page.getByRole("button", { name: "放弃修改", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("删除无法撤销"); }
  await requestDelete(); await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => { const f = window.workbenchFixture; return { writes: f.mutationCalls.length, text: f.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").getValue() }; })).toEqual({ writes: 0, text: "unsaved descendant" });
  await requestDelete(); await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.mutationCalls.length)).toBe(1);
  expect(await page.evaluate(() => window.workbenchFixture.mutationCalls[0].openModels)).toBe(0);
  await expect(page.getByRole("tab")).toHaveCount(0); await expect(tree(page, "nested")).toHaveCount(0);
});

test("legacy editor preferences sync across windows without replacing models or losing undo", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible(); await edit(page, "draft survives preferences");
  const uri = await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find((m) => m.uri.scheme === "dssh-editor").uri.toString());
  const peer = await page.context().newPage(); await peer.goto("/tests/editor/workbench.html"); await expect(tree(peer, "a2.ts")).toBeVisible();
  await peer.evaluate(() => { const settings = window.workbenchFixture.settings; settings.setInheritTerminal(false); settings.setFontSize(18); settings.setMinimap(false); settings.setTabSize(4); settings.setWordWrap(true); });
  await expect.poll(() => page.evaluate(() => { const f = window.workbenchFixture; return f.monaco.editor.getEditors()[0].getOption(f.monaco.editor.EditorOption.fontSize); })).toBe(18);
  expect(await page.evaluate(() => { const f = window.workbenchFixture; const editor = f.monaco.editor.getEditors()[0]; return { uri: editor.getModel().uri.toString(), text: editor.getValue(), minimap: editor.getOption(f.monaco.editor.EditorOption.minimap).enabled, tabSize: editor.getModel().getOptions().tabSize }; })).toEqual({ uri, text: "draft survives preferences", minimap: false, tabSize: 4 });
  await page.evaluate(async () => { await window.workbenchFixture.monaco.editor.getEditors()[0].getModel().undo(); });
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getValue())).toBe("// a2.ts\nconst value = 1;"); await peer.close();
});


test("navigation restores closed file positions and breadcrumbs browse folders or reveal the current file", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const f = window.workbenchFixture; const a = f.files.get("/root/a2.ts"); f.files.set(a.path, { ...a, content: "one\ntwo\nthree\nfour" }); });
  await tree(page, "a2.ts").dblclick(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].setPosition({ lineNumber: 3, column: 2 }));
  await tree(page, "a10.ts").click(); await expect(page.getByRole("tab", { name: /a10/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect(page.getByRole("tab", { name: /a2/ })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getPosition().lineNumber)).toBe(3);
  await page.getByRole("button", { name: "前进", exact: true }).click(); await expect(page.getByRole("tab", { name: /a10/ })).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => window.workbenchFixture.handle.open("/root/nested/child.txt"));
  await page.getByRole("navigation", { name: "编辑器面包屑" }).getByRole("button", { name: "nested", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "面包屑目录浏览" }).getByRole("menuitem", { name: "child.txt", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "编辑器面包屑" }).getByRole("button", { name: "child.txt", exact: true }).click();
  await expect(tree(page, "child.txt")).toHaveAttribute("aria-selected", "true");
  await expect(tree(page, "child.txt")).toBeFocused();
});

test("Markdown preview blocks active HTML and remote images while image previews stay read-only", async ({ page }) => {
  await ready(page);
  const external = []; page.on("request", (request) => { if (request.url().includes("untrusted.example")) external.push(request.url()); });
  await page.evaluate(async () => { const f = window.workbenchFixture; f.files.set("/root/readme.md", { ...f.files.get("/root/a2.ts"), path: "/root/readme.md", content: '# Preview\n<script>window.previewExecuted=true</script>\n![remote](https://untrusted.example/image.png)\n[bad](javascript:alert(1))' }); await f.handle.open("/root/readme.md"); });
  await expect(page.locator(".monaco-editor")).toBeVisible(); await page.getByRole("button", { name: "视图", exact: true }).click(); await page.getByRole("menuitem", { name: "Markdown 预览", exact: true }).click();
  await expect(page.getByRole("article", { name: "Markdown 预览" }).getByRole("heading", { name: "Preview" })).toBeVisible();
  expect(await page.evaluate(() => window.previewExecuted)).toBeUndefined();
  expect(await page.getByRole("article").locator("img,script,a[href^='javascript:']").count()).toBe(0); expect(external).toEqual([]);
  await page.evaluate(() => window.workbenchFixture.handle.open("/root/image.png"));
  await expect(page.getByRole("img", { name: "/root/image.png" })).toBeVisible();
  await page.getByRole("button", { name: "关闭图片预览" }).click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
});

test("disk and other-file diff preserve the draft and release temporary models", async ({ page }) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await ready(page); await tree(page, "a2.ts").dblclick(); await expect(page.locator(".monaco-editor")).toBeVisible(); await edit(page, "draft text");
  await page.getByRole("button", { name: "工具", exact: true }).click(); await page.getByRole("menuitem", { name: "与磁盘版本比较", exact: true }).click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();
  await page.getByRole("button", { name: "下一个差异", exact: true }).click(); await page.getByRole("button", { name: "内联", exact: true }).click();
  const temporary = await page.evaluate(() => { const model = window.workbenchFixture.monaco.editor.getDiffEditors()[0].getModel(); return [model.original.uri.toString(), model.modified.uri.toString()]; });
  await page.getByRole("button", { name: "关闭差异比较" }).click();
  await expect.poll(() => page.evaluate((uris) => { const f = window.workbenchFixture; return uris.every((uri) => !f.monaco.editor.getModel(f.monaco.Uri.parse(uri))); }, temporary)).toBe(true);
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().filter((model) => model.uri.scheme === "dssh-editor").length)).toBe(1);
  await page.getByRole("button", { name: "工具", exact: true }).click(); await page.getByRole("menuitem", { name: "与另一文件比较…", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("/root/a10.ts"); await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();
  const anotherTemporary = await page.evaluate(() => { const model = window.workbenchFixture.monaco.editor.getDiffEditors()[0].getModel(); return [model.original.uri.toString(), model.modified.uri.toString()]; });
  await page.getByRole("button", { name: "关闭差异比较" }).click();
  await expect.poll(() => page.evaluate((uris) => { const f = window.workbenchFixture; return uris.every((uri) => !f.monaco.editor.getModel(f.monaco.Uri.parse(uri))); }, anotherTemporary)).toBe(true);
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find((model) => model.uri.scheme === "dssh-editor").getValue())).toBe("draft text"); expect(errors).toEqual([]);
});


test("clean layout references restore split files and positions without retaining dirty bodies", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").dblclick(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await menuAction(page, "视图", "左右拆分编辑器");
  await tree(page, "a10.ts").dblclick(); await expect(page.locator(".editor-group").last().getByRole("tab", { name: /a10/ })).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => {
    const f = window.workbenchFixture; const a = f.monaco.editor.getModels().find((model) => model.getValue().includes("a2.ts"));
    a.pushEditOperations([], [{ range: a.getFullModelRange(), text: "UNSAVED-DRAFT-ONLY-IN-MEMORY" }], () => null);
    const state = f.handle.snapshot(); if (JSON.stringify(state).includes("UNSAVED") || JSON.stringify(state).includes("a2.ts")) throw new Error("dirty data persisted");
    f.restart(state);
  });
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.ready.at(-1))).toBe(true);
  await expect(page.locator(".editor-group")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: /a10/ })).toHaveCount(1);
  await expect(page.getByRole("tab", { name: /a2/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().map((model) => model.getValue()).join(""))).not.toContain("UNSAVED");
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
});

test("TypeScript symbols and definition use the local provider and plaintext degrades explicitly", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getLanguageId())).toBe("typescript");
  await edit(page, "function add(a: number, b: number) { return a + b; }\nconst result = add(1, 2);\n");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getAction("editor.action.quickOutline")?.isSupported())).toBe(true);
  await page.getByRole("button", { name: "文档符号", exact: true }).click(); await page.getByRole("menuitem", { name: "转到文档符号…", exact: true }).click();
  await expect(page.locator(".quick-input-widget")).toBeVisible(); await expect(page.locator(".quick-input-list")).toContainText("add"); await page.keyboard.press("Escape");
  await page.evaluate(() => { const f = window.workbenchFixture; f.monaco.editor.getEditors()[0].setPosition({ lineNumber: 2, column: 17 }); f.handle.execute("editor.action.revealDefinition"); });
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getPosition().lineNumber)).toBe(1);
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getPosition().lineNumber)).toBe(2);
  await page.getByRole("button", { name: "前进", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getPosition().lineNumber)).toBe(1);
  await page.getByRole("button", { name: "文本语言", exact: true }).click(); await page.getByRole("option", { name: "纯文本", exact: true }).click();
  await page.getByRole("button", { name: "文档符号", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "当前语言未提供文档符号", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "文档符号", exact: true })).toBeHidden();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getModel().getLanguageId())).toBe("plaintext");
});


test("native multi-cursor edits, line comments and indentation remain undoable", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click(); await page.getByRole("menuitem", { name: "切换列选择模式", exact: true }).click();
  expect(await page.evaluate(() => { const f = window.workbenchFixture; return f.monaco.editor.getEditors()[0].getOption(f.monaco.editor.EditorOption.columnSelection); })).toBe(true);
  await page.evaluate(() => window.workbenchFixture.handle.execute("editor.action.toggleColumnSelection"));
  await edit(page, "one\none\nthree\n");
  await page.evaluate(() => { const f = window.workbenchFixture; const instance = f.monaco.editor.getEditors()[0]; instance.setSelection(new f.monaco.Range(1, 1, 1, 4)); f.handle.execute("editor.action.selectHighlights"); });
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getSelections().length)).toBe(2);
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].trigger("test", "type", { text: "two" }));
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue())).toBe("two\ntwo\nthree\n");
  await page.evaluate(() => window.workbenchFixture.handle.execute("undo"));
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue())).toBe("one\none\nthree\n");
  await page.evaluate(() => { const f = window.workbenchFixture; const instance = f.monaco.editor.getEditors()[0]; instance.setSelection(new f.monaco.Range(1, 1, 2, 4)); f.handle.execute("editor.action.commentLine"); });
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue())).toContain("// one");
  await page.evaluate(() => window.workbenchFixture.handle.execute("undo"));
  await page.evaluate(() => window.workbenchFixture.handle.execute("editor.action.indentLines"));
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue().startsWith("  one"))).toBe(true);
  await page.evaluate(() => window.workbenchFixture.handle.execute("undo"));
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue())).toBe("one\none\nthree\n");
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
});

test("HTML and CSS use shipped local formatting providers without remote requests", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  const external = []; page.on("request", (request) => { if (!request.url().startsWith("http://127.0.0.1:")) external.push(request.url()); });
  for (const sample of [{ label: "HTML", text: "<html><body><div>hello</div></body></html>" }, { label: "CSS", text: "body{color:red;background:white;}" }]) {
    await edit(page, sample.text); await page.getByRole("button", { name: "文本语言", exact: true }).click(); await page.getByRole("option", { name: sample.label, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getAction("editor.action.formatDocument")?.isSupported())).toBe(true);
    await page.getByRole("button", { name: "工具", exact: true }).click(); await page.getByRole("menuitem", { name: "格式化文档", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue())).toContain("\n");
  }
  expect(external).toEqual([]); expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
});

test("native regex replacement stays inside the selected range and undo preserves the rest", async ({ page }) => {
  await ready(page); await tree(page, "a2.ts").click(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await edit(page, "value123\nvalue456\nvalue789\n");
  await page.evaluate(() => { const f = window.workbenchFixture; const instance = f.monaco.editor.getEditors()[0]; instance.setSelection(new f.monaco.Range(1, 1, 2, 9)); f.handle.execute("editorReplace"); });
  const widget = page.locator('.find-widget'); await expect(widget).toBeVisible();
  const scope = widget.getByRole('checkbox', { name: /Find in Selection/ });
  if (await scope.getAttribute('aria-checked') !== 'true') await scope.click();
  await expect(scope).toHaveAttribute('aria-checked', 'true');
  const find = widget.locator('textarea').first(); await find.focus();
  const primary = await page.evaluate(() => navigator.userAgent.includes('Mac') ? 'Meta' : 'Control');
  await page.keyboard.press(`${primary}+Alt+r`);
  await expect(widget.getByRole('checkbox', { name: /Regular Expression/ })).toHaveAttribute('aria-checked', 'true');
  await find.fill('value(\\d+)'); await widget.locator('textarea').nth(1).fill('item$1');
  await expect(widget.locator('.matchesCount')).toContainText('of 2');
  await widget.getByRole('button', { name: /^Replace All/ }).click();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue())).toBe('item123\nitem456\nvalue789\n');
  await page.keyboard.press('Escape'); await page.evaluate(() => window.workbenchFixture.handle.execute('undo'));
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue())).toBe('value123\nvalue456\nvalue789\n');
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
});


test("file menus create, rename, copy and move without overwriting existing targets", async ({ page }) => {
  await ready(page);
  async function operation(name, input) {
    await page.getByRole('button', { name: '文件', exact: true }).click(); await page.getByRole('menuitem', { name, exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox').fill(input); await page.getByRole('button', { name: '确定', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: '文件', exact: true })).toBeEnabled();
  }
  await operation('新建目录', 'folder'); await tree(page, 'folder').click();
  await operation('新建文件', 'new.txt'); await page.locator('[data-path="/root/folder/new.txt"]').click();
  await operation('重命名', 'renamed.txt'); await expect(page.locator('[data-path="/root/folder/renamed.txt"]')).toBeVisible();
  await page.locator('[data-path="/root/folder/renamed.txt"]').click(); await expect(page.locator('.monaco-editor')).toBeVisible(); await edit(page, 'keep source draft');
  await operation('复制到目录…', '/root'); await expect(page.locator('[data-path="/root/renamed.txt"]')).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find((model) => model.uri.scheme === 'dssh-editor').getValue())).toBe('keep source draft');
  await page.locator('[data-path="/root/renamed.txt"]').click(); await operation('重命名', 'copy.txt');
  await page.locator('[data-path="/root/folder/renamed.txt"]').click();
  // A rename/move must collect the source draft decision; cancelling keeps both files.
  await page.getByRole('button', { name: '文件', exact: true }).click(); await page.getByRole('menuitem', { name: '移动到目录…', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('/root'); await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.files.has('/root/folder/renamed.txt'))).toBe(true);
  await menuAction(page, "文件", "保存"); await operation('移动到目录…', '/root');
  await expect(page.locator('[data-path="/root/renamed.txt"]')).toBeVisible(); await expect(page.locator('[data-path="/root/folder/renamed.txt"]')).toHaveCount(0);
  await page.locator('[data-path="/root/copy.txt"]').click(); await operation('重命名', 'renamed.txt');
  await expect(page.getByRole('status').filter({ hasText: '目标已存在同名项目' })).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.files.has('/root/copy.txt') && window.workbenchFixture.files.has('/root/renamed.txt'))).toBe(true);
});


test("large directory trees limit rows and keep End/Home navigation responsive", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const f = window.workbenchFixture; const sample = f.files.get('/root/a2.ts'); f.files.clear(); f.directories.clear(); f.directories.add('/root');
    for (let index = 0; index < 10010; index++) { const path = `/root/bulk${String(index).padStart(5, '0')}.txt`; f.files.set(path, { ...sample, path, content: 'small' }); }
  });
  await page.getByRole('button', { name: '刷新文件树', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '仅显示前 10,000 项' })).toBeVisible();
  expect(await page.getByRole('treeitem').count()).toBeLessThan(80);
  await page.getByRole('treeitem').first().focus(); await page.keyboard.press('End');
  await expect(page.locator('[data-path="/root/bulk09999.txt"]')).toBeFocused();
  await page.keyboard.press('Home'); await expect(page.locator('[data-path="/root/bulk00000.txt"]')).toBeFocused();
  expect(await page.getByRole('treeitem').count()).toBeLessThan(80);
});


test("a real 21 MiB buffer remains complete in limited mode and saves without truncation", async ({ page }) => {
  test.setTimeout(45000); await ready(page);
  const baseline = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const started = Date.now();
  await page.evaluate(() => {
    const f = window.workbenchFixture; const original = f.files.get('/root/a2.ts');
    const content = `${'x'.repeat(1023)}\n`.repeat(21 * 1024);
    f.files.set('/root/a2.ts', { ...original, content, byteLength: content.length, largeFile: true });
  });
  await tree(page, 'a2.ts').click(); await page.getByRole('button', { name: '以受限模式打开', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  const result = await page.evaluate(() => {
    const f = window.workbenchFixture; const instance = f.monaco.editor.getEditors()[0]; const model = instance.getModel();
    const length = model.getValueLength(); const line = model.getLineCount();
    instance.executeEdits('test', [{ range: new f.monaco.Range(line, 1, line, 1), text: 'end' }]);
    return { length, language: model.getLanguageId(), minimap: instance.getOption(f.monaco.editor.EditorOption.minimap).enabled, heap: performance.memory?.usedJSHeapSize ?? null };
  });
  expect(result.length).toBe(21 * 1024 * 1024); expect(result.language).toBe('plaintext'); expect(result.minimap).toBe(false);
  await menuAction(page, "文件", "保存");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.writes.length)).toBe(1);
  expect(await page.evaluate(() => window.workbenchFixture.files.get('/root/a2.ts').content.length)).toBe(21 * 1024 * 1024 + 3);
  console.log('limited-buffer observation', { bytes: result.length, elapsedMs: Date.now() - started, baselineHeap: baseline, observedHeap: result.heap });
});


test("custom palettes update Monaco in wide and narrow layouts without replacing the document", async ({ page }) => {
  await ready(page); await tree(page, 'a2.ts').click(); await expect(page.locator('.monaco-editor')).toBeVisible();
  const uri = await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].uri.toString());
  await page.evaluate(() => window.workbenchFixture.palette.setPaletteColor('#986aa6'));
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize(theme === 'dark' ? { width: 1280, height: 800 } : { width: 720, height: 650 });
    await expect.poll(() => page.evaluate(() => {
      const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--bg-sunken)'; document.body.append(probe); const expected = getComputedStyle(probe).backgroundColor; probe.remove();
      return getComputedStyle(document.querySelector('.monaco-editor-background')).backgroundColor === expected;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const button = document.querySelector('.editor-toolbar [aria-label="在独立窗口打开编辑器"]'); const probe = document.createElement('span'); probe.style.color = 'var(--text-muted)'; document.body.append(probe);
      const settled = getComputedStyle(button).color === getComputedStyle(probe).color; probe.remove(); return settled;
    })).toBe(true);
    const contrast = await page.evaluate(() => {
      const luminance = (text) => { const values = text.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }); return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722; };
      const foreground = luminance(getComputedStyle(document.querySelector('.editor-toolbar [aria-label="在独立窗口打开编辑器"]')).color);
      const background = luminance(getComputedStyle(document.querySelector('.editor-toolbar')).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: editorArtifact(`dssh-editor-custom-${theme}.png`) });
    const bounds = await page.locator('.editor-workbench').boundingBox(); expect(bounds.width).toBeLessThanOrEqual(theme === 'dark' ? 1280 : 720);
  }
  await menuAction(page, "视图", "隐藏文件树"); await expect(page.getByRole('tree')).toHaveCount(0);
  await page.keyboard.press('Enter'); await expect(page.getByRole('menu', { name: '视图', exact: true })).toBeVisible(); await page.keyboard.press('Enter'); await expect(page.getByRole('tree')).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].uri.toString())).toBe(uri);
});

test("handoff targets stay read-only through initialization and release enables normal edits", async ({ page }) => {
  await ready(page); await tree(page, 'a2.ts').dblclick(); await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.evaluate(() => { const f = window.workbenchFixture; const state = f.handle.snapshot(); f.handoff(true); f.restart(state); });
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.ready.at(-1))).toBe(true);
  expect(await page.evaluate(() => { const f = window.workbenchFixture; return f.monaco.editor.getEditors()[0].getOption(f.monaco.editor.EditorOption.readOnly); })).toBe(true);
  const original = await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue());
  await page.evaluate(() => { const f = window.workbenchFixture; f.handle.execute('editorNewFile'); f.handle.execute('editorSave'); });
  expect(await page.getByRole('tab').count()).toBe(1); expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await page.evaluate(() => window.workbenchFixture.handoff(false));
  await expect.poll(() => page.evaluate(() => { const f = window.workbenchFixture; return f.monaco.editor.getEditors()[0].getOption(f.monaco.editor.EditorOption.readOnly); })).toBe(false);
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].focus()); await page.keyboard.press('End'); await page.keyboard.type(' changed');
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels()[0].getValue())).not.toBe(original);
});


test("mixed line endings and a literal body BOM open clean and survive an explicit EOL save", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const f = window.workbenchFixture; const file = f.files.get('/root/a2.ts'); f.files.set(file.path, { ...file, content: '\ufeffone\r\ntwo\nthree\r\n', lineEnding: 'mixed', encoding: 'utf-8-bom', bom: true }); });
  await tree(page, 'a2.ts').click(); await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByLabel('未保存', { exact: true })).toHaveCount(0);
  await menuAction(page, "文件", "保存"); expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await page.getByRole('button', { name: '文件行尾', exact: true }).click(); await page.getByRole('option', { name: 'LF', exact: true }).click();
  await expect(page.getByLabel('未保存', { exact: true })).toHaveCount(1); await menuAction(page, "文件", "保存");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.writes.length)).toBe(1);
  expect(await page.evaluate(() => { const write = window.workbenchFixture.writes[0]; return { content: write.content.replace(/\r\n/g, '\n'), lineEnding: write.lineEnding, bom: write.bom }; })).toEqual({ content: '\ufeffone\ntwo\nthree\n', lineEnding: 'lf', bom: true });
  await expect(page.getByLabel('未保存', { exact: true })).toHaveCount(0);
});

test("symbol breadcrumbs follow actual TypeScript and JSON provider scopes", async ({ page }) => {
  await ready(page); await tree(page, 'a2.ts').click(); await expect(page.locator('.monaco-editor')).toBeVisible();
  await edit(page, 'class Box {\n  value() {\n    function nested() { return 1; }\n    return nested();\n  }\n}\n');
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].setPosition({ lineNumber: 3, column: 27 }));
  const symbols = page.getByLabel('符号面包屑', { exact: true });
  await expect(symbols.getByRole('button', { name: 'Box', exact: true })).toBeVisible();
  await expect(symbols.getByRole('button', { name: 'value', exact: true })).toBeVisible();
  await expect(symbols.getByRole('button', { name: 'nested', exact: true })).toBeVisible();
  await symbols.getByRole('button', { name: 'nested', exact: true }).click(); await page.getByRole('menuitem', { name: 'nested', exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors()[0].getPosition().lineNumber)).toBe(3);
  await edit(page, '{"outer":{"inner":1}}');
  await page.getByRole('button', { name: '文本语言', exact: true }).click(); await page.getByRole('option', { name: 'JSON', exact: true }).click();
  await page.evaluate(() => { const instance = window.workbenchFixture.monaco.editor.getEditors()[0]; instance.setPosition(instance.getModel().getPositionAt(instance.getValue().indexOf('1'))); });
  await expect(symbols.getByRole('button', { name: 'outer', exact: true })).toBeVisible(); await expect(symbols.getByRole('button', { name: 'inner', exact: true })).toBeVisible();
  await expect(symbols.getByRole('button', { name: 'Box', exact: true })).toHaveCount(0);
});


test("macOS native menu routes only to the focused unlocked editor and retains dirty close protection", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130 Safari/537.36" });
  const page = await context.newPage();
  try {
    await page.goto("/tests/editor/workbench.html?local&nativeMenu");
    await expect(tree(page, "a2.ts")).toBeVisible();
    await tree(page, "a2.ts").dblclick();
    const editor = page.locator(".monaco-editor textarea");
    await editor.focus();
    await expect.poll(() => page.evaluate(() => window.workbenchFixture.nativeMenuContexts.at(-1))).toBe(true);
    await edit(page, "native menu draft");
    const emit = async (payload) => page.evaluate(async (payload) => { const { emit } = await import("/node_modules/@tauri-apps/api/event.js"); await emit("editor://native-menu", { ownerLabel: "main", command: payload }); }, payload);
    await page.evaluate(async () => { const { emit } = await import("/node_modules/@tauri-apps/api/event.js"); await emit("editor://native-menu", { ownerLabel: "another-window", command: "undo" }); });
    expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue())).toBe("native menu draft");
    await emit("undo");
    await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue())).toContain("const value = 1");
    await emit("redo");
    await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue())).toBe("native menu draft");
    await emit("editorCloseFile");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.workbenchFixture.nativeMenuContexts.at(-1))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.workbenchFixture.nativeMenuModels.at(-1)?.menus.flatMap(m => m.children ?? []).filter(m => !m.children).every(m => !m.enabled))).toBe(true);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await editor.focus();
    await page.getByRole("button", { name: "切换锁定" }).click();
    await emit("editorCloseFile");
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.workbenchFixture.nativeMenuContexts.at(-1))).toBe(false);
  } finally { await context.close(); }
});


test("native application quit waits for commit and abort restores every prepared draft", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/tests/editor/workbench.html?local&nativeMenu");
  await expect(tree(page, "a2.ts")).toBeVisible();
  await tree(page, "a2.ts").dblclick(); await edit(page, "quit draft");
  const request = (phase, requestId = "quit-fixture") => page.evaluate(async ({ phase, requestId }) => {
    const { emit } = await import("/node_modules/@tauri-apps/api/event.js"); await emit("workspace://application-exit", { ownerLabel: "main", requestId, phase });
  }, { phase, requestId });
  await page.evaluate(async () => { const { emit } = await import("/node_modules/@tauri-apps/api/event.js"); await emit("workspace://application-exit", { ownerLabel: "another-window", requestId: "foreign", phase: "prepare" }); });
  expect(await page.evaluate(() => window.workbenchFixture.exitReplies)).toEqual([]);
  await request("prepare"); await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.exitReplies.at(-1))).toMatchObject({ phase: "prepare", accepted: false });
  await request("abort");
  expect(await page.evaluate(() => document.body.inert)).toBe(false);
  await request("prepare", "quit-next");
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(true);
  expect(await page.evaluate(() => window.workbenchFixture.exitCommits)).toEqual([]);
  await request("validate", "quit-next");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.exitReplies.at(-1))).toMatchObject({ phase: "validate", accepted: true });
  await request("abort", "quit-next");
  await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(false);
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue())).toBe("quit draft");
  expect(await page.evaluate(() => window.workbenchFixture.exitCommits)).toEqual([]);
  await request("commit", "quit-next");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.exitReplies.at(-1))).toMatchObject({ phase: "commit", accepted: false });
  await request("prepare", "quit-lock");
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(true);
  await page.evaluate(() => window.workbenchFixture.lock(true));
  await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(false);
  expect(await page.evaluate(() => window.workbenchFixture.exitCommits)).toEqual([]);

});
