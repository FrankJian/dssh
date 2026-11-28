import { test, expect } from "@playwright/test";
import { editorArtifact } from "./artifacts.mjs";
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

test("preview width supports drag/keyboard/reset/cancel, lock protection and narrow themed layouts", async ({ page }) => {
  await ready(page); await open(page); await page.getByRole("toolbar", { name: "编辑器工具栏" }).getByRole("button", { name: "视图", exact: true }).click(); await page.getByRole("menuitem", { name: "隐藏文件树", exact: true }).click();
  await expect(sash(page)).toHaveAttribute("aria-valuenow", "45");
  await expect.poll(() => page.locator(".editor-sidebar-dock").evaluate(el => el.getBoundingClientRect().width)).toBe(0);
  const initialWidth = (await page.locator(".editor-markdown-pane").boundingBox()).width;
  const box = await sash(page).boundingBox();
  await page.mouse.move(box.x + 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x - 150, box.y + 100); await page.mouse.up();
  expect((await page.locator(".editor-markdown-pane").boundingBox()).width).toBeGreaterThan(initialWidth + 100);
  const changed = await sash(page).getAttribute("aria-valuenow");
  const next = await sash(page).boundingBox();
  await page.mouse.move(next.x + 2, next.y + 100); await page.mouse.down(); await page.mouse.move(next.x + 100, next.y + 100); await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(sash(page)).toHaveAttribute("aria-valuenow", changed);
  await sash(page).focus(); await page.keyboard.press("Home"); await expect(sash(page)).toHaveAttribute("aria-valuenow", "20");
  await page.keyboard.press("End"); await expect(sash(page)).toHaveAttribute("aria-valuenow", "80");
  await sash(page).dblclick(); await expect(sash(page)).toHaveAttribute("aria-valuenow", "45");
  await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(sash(page)).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "关闭预览 one.md", exact: true })).toBeDisabled();
  await page.evaluate(() => window.workbenchFixture.lock(false));
  for (const [theme, width] of [["light", 1280], ["dark", 760], ["light", 620]]) {
    await page.setViewportSize({ width, height: 800 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor("#e5b76d"); }, theme);
    await expect(preview(page)).toBeVisible(); await expect(page.getByRole("button", { name: "关闭预览 one.md", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: editorArtifact(`dssh-markdown-tabs-${theme}-${width}.png`) });
  }
  await page.evaluate(() => window.workbenchFixture.handoff(true)); await expect(sash(page)).toHaveAttribute("aria-disabled", "true");
});

test("preview count and snapshot size stay bounded without replacing manually opened previews", async ({ page }) => {
  await ready(page);
  for (let index = 0; index < 8; index++) await open(page, `doc${index}`);
  await page.evaluate(async () => { const f = window.workbenchFixture; f.files.set("/root/extra.md", { ...f.files.get("/root/a2.ts"), path: "/root/extra.md", content: "# Extra" }); await f.handle.open("/root/extra.md"); });
  await page.getByRole("button", { name: "Markdown 预览", exact: true }).click();
  await expect(page.locator(".editor-error[role='alert']")).toContainText("最多打开 8 个 Markdown 预览");
  await expect(tabs(page).getByRole("tab")).toHaveCount(8);
  await page.getByRole("button", { name: "关闭预览 doc0.md", exact: true }).click();
  await page.getByRole("button", { name: "Markdown 预览", exact: true }).click();
  await expect(tabs(page).getByRole("tab")).toHaveCount(8);
  await page.evaluate(() => { window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor" && m.uri.path.endsWith("/extra.md")).setValue("x".repeat(1024 * 1024 + 1)); });
  await expect(page.getByRole("tabpanel", { name: "预览 extra.md", exact: true })).toContainText("超过 1 MiB");
});
