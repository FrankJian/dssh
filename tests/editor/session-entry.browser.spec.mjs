import { editorArtifact } from "./artifacts.mjs";
import { test, expect } from "@playwright/test";

for (const local of [false, true]) {
  test(`${local ? "local" : "remote"} session file entry retains its root and reveals the selected nested hidden file`, async ({ page }) => {
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/editor/session-entry.html?${local ? "local=1&detached=1" : ""}`);
    await page.getByText("nested", { exact: true }).click();
    await page.getByText(".settings.txt", { exact: true }).click();
    await expect(page.locator(".editor-group .monaco-editor")).toBeVisible();
    await expect(page.getByText("打开文件夹以浏览文件。", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("treeitem").filter({ hasText: "other.txt" })).toBeVisible();
    const selected = page.getByRole("treeitem").filter({ hasText: ".settings.txt" });
    await expect(selected).toBeVisible(); await expect(selected).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => window.sessionEntryFixture.requests)).toEqual([{ source: local ? { kind: "local" } : { kind: "sftp", profileId: "fixture" }, path: "/root/nested/.settings.txt", directory: false, rootPath: "/root" }]);
    if (local) { await page.evaluate(() => { document.documentElement.dataset.theme = "light"; }); await page.setViewportSize({ width: 720, height: 650 }); }
    await page.screenshot({ path: editorArtifact(`dssh-editor-session-${local ? "local" : "remote"}.png`), animations: "disabled" });
    expect(errors).toEqual([]);
  });
}

test("folder layout restoration keeps cached files and activates the file explicitly opened from the session", async ({ page }) => {
  await page.goto("/tests/editor/session-entry.html?cached=1");
  await page.getByText("nested", { exact: true }).click(); await page.getByText(".settings.txt", { exact: true }).click();
  await expect(page.getByRole("tab").filter({ hasText: ".settings.txt" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab").filter({ hasText: "other.txt" })).toBeVisible();
  await expect(page.getByRole("treeitem").filter({ hasText: ".settings.txt" })).toBeVisible();
});

test("three legacy rootless remote references restore without home-directory type errors", async ({ page }) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/editor/session-entry.html?startup=1");
  await expect(page.getByRole("tab").filter({ hasText: "three.txt" })).toBeVisible();
  expect(await page.evaluate(() => window.sessionEntryFixture.requests.map((r) => ({ path: r.path, directory: r.directory })))).toEqual([
    { path: "/root/one.txt", directory: false }, { path: "/root/two.txt", directory: false }, { path: "/root/three.txt", directory: false },
  ]);
  expect(await page.evaluate(() => window.sessionEntryFixture.startupErrors)).toEqual([]);
  await expect(page.locator(".editor-error")).toHaveCount(0); expect(errors).toEqual([]);
});
