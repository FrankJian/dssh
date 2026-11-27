import { test, expect } from "@playwright/test";
import { editorArtifact } from "./artifacts.mjs";
const row = (page, path) => page.locator(`.editor-tree-row[data-path="${path}"]`);
const menu = page => page.getByRole("menu", { name: "文件树操作", exact: true });
async function ready(page) { await page.goto("/tests/editor/workbench.html?chrome"); await expect(row(page, "/root/a2.ts")).toBeVisible(); }
async function name(page, value) { await page.getByRole("dialog").getByRole("textbox").fill(value); await page.getByRole("button", { name: "确定", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); }

test("directory context creates and reveals files, and file context creates siblings without replacing drafts", async ({ page }) => {
  await ready(page);
  await row(page, "/root/nested").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "新建文件", exact: true }).click(); await name(page, "created.md");
  await expect(row(page, "/root/nested/created.md")).toBeVisible();
  await expect(page.getByRole("tab", { name: /created.md/ })).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").setValue("keep this draft"));
  await row(page, "/root/nested/created.md").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "新建文件", exact: true }).click(); await name(page, "sibling.txt");
  await expect(row(page, "/root/nested/sibling.txt")).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().some(m => m.getValue() === "keep this draft"))).toBe(true);
  await page.getByRole("button", { name: "在当前目录新建文件夹", exact: true }).click(); await name(page, "new-folder");
  await expect(row(page, "/root/nested/new-folder")).toBeVisible();
  expect(await page.evaluate(() => window.workbenchFixture.files.has("/root/created.md"))).toBe(false);
});

test("right click preserves multiselection and blank-space creation targets the workspace root", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page);
  await row(page, "/root/a2.ts").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "/root/a10.ts").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "/root/a2.ts").click({ button: "right" });
  await expect(page.locator('.editor-tree-row[aria-selected="true"]')).toHaveCount(2);
  for (const selected of await page.locator('.editor-tree-row[aria-selected="true"]').all()) {
    await expect(selected).toHaveCSS("box-shadow", "none");
    await expect(selected).toHaveCSS("border-left-width", "0px");
  }
  await expect(menu(page).getByRole("menuitem", { name: "重命名", exact: true })).toBeDisabled();
  await menu(page).getByRole("menuitem", { name: "复制相对路径", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("a2.ts\na10.ts");
  const tree = page.getByRole("tree", { name: "文件树", exact: true }); const bounds = await tree.boundingBox();
  await tree.click({ button: "right", position: { x: 20, y: bounds.height - 12 } });
  await expect(menu(page).getByRole("menuitem", { name: "删除…", exact: true })).toBeDisabled();
  await menu(page).getByRole("menuitem", { name: "新建文件", exact: true }).click(); await name(page, "root-created.txt");
  await expect(row(page, "/root/root-created.txt")).toBeVisible();
  await expect(page.getByRole("tab", { name: /root-created.txt/ })).toHaveAttribute("aria-selected", "true");
});

test("keyboard context restores focus, closes on handoff and preserves dirty files when deletion is cancelled", async ({ page }) => {
  await ready(page);
  const root = page.getByRole("group", { name: "项目根目录", exact: true });
  await root.focus(); await page.keyboard.press("Shift+F10"); await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "删除…", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(root).toBeFocused();
  const file = row(page, "/root/a2.ts"); await file.focus(); await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toBeVisible(); await page.keyboard.press("Escape"); await expect(file).toBeFocused();
  await file.click({ button: "right" }); await page.evaluate(() => window.workbenchFixture.handoff(true));
  await expect(menu(page)).toHaveCount(0); await expect(page.getByRole("button", { name: "在当前目录新建文件", exact: true })).toBeDisabled();
  await page.evaluate(() => window.workbenchFixture.handoff(false));
  await file.dblclick(); await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").setValue("dirty context source"));
  await file.click({ button: "right" }); await menu(page).getByRole("menuitem", { name: "删除…", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => window.workbenchFixture.mutationCalls.length)).toBe(0);
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().some(m => m.getValue() === "dirty context source"))).toBe(true);
  await file.click({ button: "right" }); await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(menu(page)).toHaveCount(0);
});

test("context creation failures leave existing files intact and modern chrome respects palettes and reduced motion", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "在当前目录新建文件", exact: true }).click(); await name(page, "a2.ts");
  await expect(page.getByRole("status")).toContainText("目标已存在");
  expect(await page.evaluate(() => window.workbenchFixture.files.get("/root/a2.ts").content)).toContain("// a2.ts");
  const feedback = await page.getByRole("status").boundingBox(); expect(feedback.x).toBeGreaterThanOrEqual(0); expect(feedback.x + feedback.width).toBeLessThanOrEqual(1280);
  await page.locator(".editor-file-management__feedback summary").click();
  await page.getByRole("button", { name: "搜索工作区文件", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape");
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: theme === "light" ? 1280 : 720, height: 800 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.workbenchFixture.palette.setPaletteColor("#8c9bd8"); }, theme);
    await row(page, "/root/nested").click({ button: "right" }); await expect(menu(page)).toBeVisible();
    await page.screenshot({ path: editorArtifact(`dssh-editor-modern-context-${theme}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce" }); await row(page, "/root/a2.ts").dblclick();
  await expect(page.locator(".editor-content-transition")).toBeHidden();
  await expect(row(page, "/root/a2.ts")).toHaveCSS("transition-duration", "0s");
  await row(page, "/root/a2.ts").click({ button: "right" }); await expect(menu(page)).toHaveCSS("animation-name", "none");
});
