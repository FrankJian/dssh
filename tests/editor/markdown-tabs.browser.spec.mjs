import { test, expect } from "@playwright/test";
const tabs = (page) => page.getByRole("tablist", { name: "Markdown 预览标签", exact: true });
const preview = (page) => page.getByRole("article", { name: "Markdown 预览", exact: true });
const sash = (page) => page.getByRole("separator", { name: "调整 Markdown 预览宽度", exact: true });
const shortcut = (key) => `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;
async function ready(page) {
  await page.goto("/tests/editor/workbench.html?local&nativeMenu");
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
}
async function open(page, name = "one", content = `# Preview ${name}`) {
  await page.evaluate(async ({ name, content }) => {
    const f = window.workbenchFixture, path = `/root/${name}.md`;
    if (!f.files.has(path)) f.files.set(path, { ...f.files.get("/root/a2.ts"), path, content });
    await f.handle.open(path);
  }, { name, content });
  await page.locator(".editor-group").last().getByRole("button", { name: "Markdown 预览", exact: true }).click();
  await expect(tabs(page).getByRole("tab", { name: `预览 ${name}.md`, exact: true })).toHaveAttribute("aria-selected", "true");
}
async function edit(page, text) {
  await page.evaluate((text) => {
    const model = window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor" && m.uri.path.endsWith("/one.md"));
    model.setValue(text);
  }, text);
}
const closeSource = (page) => page.locator(".editor-group").getByRole("button", { name: "关闭 one.md", exact: true }).click();

test("source close releases its model but leaves the preview until explicit close; reopening resumes live updates", async ({ page }) => {
  await ready(page); await open(page);
  await open(page); await expect(tabs(page).getByRole("tab")).toHaveCount(1);
  await closeSource(page); await expect(page.locator(".editor-group").getByRole("tab")).toHaveCount(0);
  await expect(preview(page).getByRole("heading", { name: "Preview one" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().filter(m => m.uri.scheme === "dssh-editor").length)).toBe(0);
  await open(page); await expect(tabs(page).getByRole("tab")).toHaveCount(1);
  await edit(page, "# Reopened live draft"); await expect(preview(page).getByRole("heading", { name: "Reopened live draft" })).toBeVisible();
  await page.getByRole("button", { name: "关闭预览 one.md", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(tabs(page)).toHaveCount(0); await expect(sash(page)).toHaveCount(0);
  await expect(page.locator(".editor-group").getByRole("tab")).toHaveCount(1);
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
});

test("dirty source cancel/save/discard keep the last preview and preserve the existing save decision", async ({ page }) => {
  await ready(page); await open(page); await edit(page, "# Saved draft");
  await closeSource(page); await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".editor-group").getByRole("tab")).toHaveCount(1);
  await expect(preview(page).getByRole("heading", { name: "Saved draft" })).toBeVisible();
  await closeSource(page); await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".editor-group").getByRole("tab")).toHaveCount(0);
  await expect(preview(page).getByRole("heading", { name: "Saved draft" })).toBeVisible();
  await open(page); await edit(page, "# Discarded source snapshot");
  await expect(preview(page).getByRole("heading", { name: "Discarded source snapshot" })).toBeVisible();
  await closeSource(page); await page.getByRole("dialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.locator(".editor-group").getByRole("tab")).toHaveCount(0);
  await expect(preview(page).getByRole("heading", { name: "Discarded source snapshot" })).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.files.get("/root/one.md").content)).toBe("# Saved draft");
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(1);
});

test("multiple preview tabs survive source group removal and support keyboard selection and contextual close", async ({ page }) => {
  await ready(page); await open(page);
  await page.evaluate(() => window.workbenchFixture.handle.execute("editorSplitHorizontal"));
  await open(page, "two"); await expect(tabs(page).getByRole("tab")).toHaveCount(2);
  await page.locator(".editor-group").last().getByRole("button", { name: "关闭编辑分组", exact: true }).click();
  await expect(page.locator(".editor-group")).toHaveCount(1);
  // Removing the split remounts the remaining Monaco view. Wait for its focus
  // restoration before deliberately moving keyboard context to the preview.
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getEditors().some(editor => editor.hasTextFocus()))).toBe(true);
  await expect(preview(page).getByRole("heading", { name: "Preview two" })).toBeVisible();
  await tabs(page).getByRole("tab", { name: "预览 two.md", exact: true }).focus();
  await page.keyboard.press("ArrowLeft"); await expect(preview(page).getByRole("heading", { name: "Preview one" })).toBeVisible();
  await page.keyboard.press(shortcut("s")); expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  await page.keyboard.press(shortcut("w")); await expect(tabs(page).getByRole("tab")).toHaveCount(1);
  await expect(preview(page).getByRole("heading", { name: "Preview two" })).toBeVisible();
  await page.evaluate(async () => { const { emit } = await import("/node_modules/@tauri-apps/api/event.js"); await emit("editor://native-menu", { ownerLabel: "main", command: "editorCloseFile" }); });
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.locator(".editor-group").getByRole("tab")).toHaveCount(1);
});
