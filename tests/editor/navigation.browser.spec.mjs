import { editorArtifact } from "./artifacts.mjs";
import { test, expect } from "@playwright/test";

test("editor sidebar action follows settings, persists and synchronizes without closing work", async ({ page, context }) => {
  await page.goto("/tests/editor/navigation.html");
  await expect(page.getByRole("switch", { name: "文本编辑器", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "打开文本编辑器", exact: true }).click();
  await expect(page.getByLabel("已打开的编辑器")).toHaveText("1");
  const other = await context.newPage(); await other.goto("/tests/editor/navigation.html");
  await page.getByRole("switch", { name: "文本编辑器", exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "打开文本编辑器", exact: true })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "打开文本编辑器", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("已打开的编辑器")).toHaveText("1");
  await other.reload(); await expect(other.getByRole("switch", { name: "文本编辑器", exact: true })).not.toBeChecked();
  await other.getByRole("switch", { name: "文本编辑器", exact: true }).check();
  await expect(page.getByRole("button", { name: "打开文本编辑器", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开文本编辑器", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("已打开的编辑器")).toHaveText("1");
  for (const mode of ["dark", "light"]) {
    await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; }, mode);
    await page.setViewportSize({ width: mode === "light" ? 720 : 1280, height: 800 });
    await page.screenshot({ path: editorArtifact(`dssh-editor-navigation-${mode}.png`) });
    await expect(page.getByRole("button", { name: "打开文本编辑器", exact: true })).toBeVisible();
  }
  await other.close();
});

test("saved navigation choices keep the editor hidden until explicitly enabled", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("dssh.navigation.icons.v3", JSON.stringify(["connections"])); });
  await page.goto("/tests/editor/navigation.html");
  await expect(page.getByRole("button", { name: "打开文本编辑器", exact: true })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "文本编辑器", exact: true })).not.toBeChecked();
  await page.getByRole("switch", { name: "文本编辑器", exact: true }).check();
  await expect(page.getByRole("button", { name: "打开文本编辑器", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开文本编辑器", exact: true }).click();
  await expect(page.getByRole("region", { name: "编辑工作台", exact: true })).toBeVisible();
});

test("sidebar reveals the most recently focused editor without adding tabs or losing drafts", async ({ page }) => {
  await page.goto("/tests/editor/navigation.html");
  const entry = page.getByRole("button", { name: "打开文本编辑器", exact: true });
  const count = page.getByLabel("已打开的编辑器");
  await entry.click(); await page.getByLabel("草稿 编辑器 1").fill("keep this unsaved draft");
  await entry.click(); await entry.click(); await expect(count).toHaveText("1");
  await expect(page.getByLabel("草稿 编辑器 1")).toHaveValue("keep this unsaved draft");
  await page.getByRole("button", { name: "新建文本编辑器", exact: true }).click();
  await page.getByRole("button", { name: "新建文本编辑器", exact: true }).click();
  await expect(count).toHaveText("3");
  await page.getByRole("tab", { name: "编辑器 1", exact: true }).click();
  await page.getByRole("button", { name: "切换到终端", exact: true }).click();
  await entry.click(); await expect(count).toHaveText("3");
  await expect(page.getByRole("tab", { name: "编辑器 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "工具箱", exact: true }).click(); await entry.click();
  await expect(page.getByRole("region", { name: "编辑工作台", exact: true })).toBeVisible();
  await expect(page.getByLabel("草稿 编辑器 1")).toHaveValue("keep this unsaved draft");
  await page.getByRole("button", { name: "关闭 编辑器 1", exact: true }).click(); await entry.click();
  await expect(count).toHaveText("2");
  await expect(page.getByRole("tab", { name: "编辑器 3", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "关闭 编辑器 2", exact: true }).click();
  await page.getByRole("button", { name: "关闭 编辑器 3", exact: true }).click(); await entry.click();
  await expect(count).toHaveText("1"); await expect(page.getByRole("tab", { name: "编辑器 4", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("initial repeated sidebar clicks share one pending creation and windows keep separate editor histories", async ({ page, context }) => {
  await page.goto("/tests/editor/navigation.html?deferred=1");
  const entry = page.getByRole("button", { name: "打开文本编辑器", exact: true });
  await entry.click(); await entry.click(); await entry.click();
  expect(await page.evaluate(() => window.editorNavigationFixture.createCalls)).toBe(1);
  await expect(page.getByLabel("已打开的编辑器")).toHaveText("0");
  await page.evaluate(() => window.editorNavigationFixture.release());
  await expect(page.getByLabel("已打开的编辑器")).toHaveText("1");
  const other = await context.newPage(); await other.goto("/tests/editor/navigation.html");
  await expect(other.getByLabel("已打开的编辑器")).toHaveText("0");
  await other.getByRole("button", { name: "打开文本编辑器", exact: true }).click();
  await other.getByRole("button", { name: "新建文本编辑器", exact: true }).click();
  await other.getByRole("button", { name: "切换到终端", exact: true }).click();
  await other.getByRole("button", { name: "打开文本编辑器", exact: true }).click();
  await expect(other.getByRole("tab", { name: "编辑器 2", exact: true })).toHaveAttribute("aria-selected", "true");
  await entry.click(); await expect(page.getByLabel("已打开的编辑器")).toHaveText("1");
  await expect(page.getByRole("tab", { name: "编辑器 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await other.close();
});
