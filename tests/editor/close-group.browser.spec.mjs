import { editorArtifact } from "./artifacts.mjs";
import { test, expect } from "@playwright/test";

const groups = (page) => page.locator(".editor-group");
const close = (group) => group.getByRole("button", { name: "关闭编辑分组", exact: true });
async function ready(page) {
  await page.goto("/tests/editor/workbench.html");
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
}
async function open(page, path = "/root/a2.ts") {
  await page.evaluate((path) => window.workbenchFixture.handle.open(path), path);
  await expect(groups(page).last().locator(".monaco-editor")).toBeVisible();
}
async function split(page, direction = "editorSplitHorizontal") {
  await page.evaluate((direction) => window.workbenchFixture.handle.execute(direction), direction);
}
async function edit(page, path, text) {
  await page.evaluate(({ path, text }) => {
    const model = window.workbenchFixture.monaco.editor.getModels().find((model) => model.uri.scheme === "dssh-editor" && model.uri.path.endsWith(path));
    if (!model) throw new Error(`missing model ${path}`);
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  }, { path, text });
}
async function uniqueDraft(page) {
  await ready(page); await open(page); await split(page); await open(page, "/root/a10.ts");
  await edit(page, "/root/a10.ts", "unique draft");
}

test("direct group close preserves shared dirty document and undo, and last-tab close collapses only extra groups", { tag: "@smoke" }, async ({ page }) => {
  await ready(page); await open(page); await edit(page, "/root/a2.ts", "shared draft"); await split(page);
  await expect(groups(page)).toHaveCount(2);
  await close(groups(page).last()).click();
  await expect(groups(page)).toHaveCount(1); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("未保存", { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  expect(await page.evaluate(() => { const f = window.workbenchFixture; const model = f.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor"); model.undo(); return model.getValue(); })).toContain("const value = 1;");
  await split(page);
  await groups(page).last().getByRole("button", { name: "关闭 a2.ts", exact: true }).click();
  await expect(groups(page)).toHaveCount(1); await expect(close(groups(page).first())).toHaveCount(0);
  await groups(page).first().getByRole("button", { name: "关闭 a2.ts", exact: true }).click();
  await expect(groups(page)).toHaveCount(1); await expect(page.getByRole("tab")).toHaveCount(0);
});

test("unique dirty group supports cancel, failed save, then successful save without losing its group", { tag: "@smoke" }, async ({ page }) => {
  await uniqueDraft(page);
  await close(groups(page).last()).click(); await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(groups(page)).toHaveCount(2); await expect(page.getByRole("tab").filter({ hasText: "a10.ts" })).toBeVisible();
  await page.evaluate(() => { window.workbenchFixture.writeFailure.enabled = true; });
  await close(groups(page).last()).click(); await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".editor-error[role='alert']")).toContainText("合成保存失败");
  await expect(groups(page)).toHaveCount(2); await expect(close(groups(page).last())).toBeEnabled();
  await page.evaluate(() => { window.workbenchFixture.writeFailure.enabled = false; });
  await close(groups(page).last()).click(); await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(groups(page)).toHaveCount(1);
  expect(await page.evaluate(() => window.workbenchFixture.files.get("/root/a10.ts").content)).toBe("unique draft");
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(1);
});

test("discard closes only the requested group, while content added during confirmation cancels stale group removal", async ({ page }) => {
  await uniqueDraft(page);
  await close(groups(page).last()).click(); await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => window.workbenchFixture.handle.newFile());
  await page.getByRole("dialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(groups(page)).toHaveCount(2);
  await expect(page.locator(".editor-error[role='alert']")).toContainText("分组中的文件已变化");
  await expect(groups(page).last().getByRole("tab")).toHaveCount(3);
  await close(groups(page).last()).click(); await page.getByRole("dialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("未命名文档");
  await page.getByRole("dialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(groups(page)).toHaveCount(1);
  expect(await page.evaluate(() => window.workbenchFixture.files.get("/root/a10.ts").content)).toContain("const value = 1;");
});

test("empty and nested vertical groups close by keyboard and return focus to the adjacent group", async ({ page }) => {
  await ready(page); await split(page); await split(page, "editorSplitVertical");
  await expect(groups(page)).toHaveCount(3);
  await close(groups(page).last()).focus(); await page.keyboard.press("Enter");
  await expect(groups(page)).toHaveCount(2); await expect(groups(page).last()).toHaveClass(/is-focused/);
  await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(close(groups(page).last())).toBeHidden();
  await page.evaluate(() => window.workbenchFixture.lock(false));
  await page.evaluate(() => window.workbenchFixture.handoff(true)); await expect(close(groups(page).last())).toBeHidden();
  await page.evaluate(() => window.workbenchFixture.handoff(false));
  await close(groups(page).last()).click(); await expect(groups(page)).toHaveCount(1);
  await open(page); await split(page);
  await groups(page).last().locator(".monaco-editor .view-lines").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+w" : "Control+w");
  await expect(groups(page)).toHaveCount(1); await expect(groups(page).first()).toHaveClass(/is-focused/);
});

test("group close stays within the single-row header in light, dark and compact custom palettes", async ({ page }) => {
  await ready(page); await open(page); await split(page);
  for (const [theme, width] of [["light", 1280], ["dark", 760], ["light", 620]]) {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor("#e5b76d"); }, theme);
    for (const group of await groups(page).all()) {
      const bounds = await group.locator(".editor-group__tabs").boundingBox();
      const button = close(group); await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
      expect(bounds.height).toBeLessThanOrEqual(44);
    }
    await page.screenshot({ path: editorArtifact(`dssh-close-group-${theme}-${width}.png`) });
  }
  await close(groups(page).last()).click(); await expect(groups(page)).toHaveCount(1);
});
