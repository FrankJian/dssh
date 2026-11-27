import { test, expect } from "@playwright/test";
const rich = page => page.getByRole("textbox", { name: "Markdown 所见即所得编辑器", exact: true });
async function ready(page) {
  await page.goto("/tests/editor/workbench.html?local&wysiwyg");
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await page.evaluate(async () => { const f = window.workbenchFixture; f.files.set("/root/draft.md", { ...f.files.get("/root/a2.ts"), path: "/root/draft.md", content: "# Draft\n" }); await f.handle.open("/root/draft.md"); });
  await page.getByRole("radio", { name: "所见即所得", exact: true }).check();
  await expect(rich(page)).toBeVisible(); await rich(page).getByRole("heading", { name: "Draft", exact: true }).click();
  await page.keyboard.press("End"); await page.keyboard.insertText(" changed");
  await expect(page.getByLabel("未保存", { exact: true })).toBeVisible();
}

test("closing the last rendered file preserves cancel and save failure, then releases its model after discard", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  const close = () => page.getByRole("button", { name: "关闭 draft.md", exact: true }).click();
  await close(); await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(rich(page).getByRole("heading", { name: "Draft changed", exact: true })).toBeVisible();
  await page.evaluate(() => { window.workbenchFixture.writeFailure.enabled = true; });
  await close(); await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".editor-error[role='alert']")).toContainText("合成保存失败"); await expect(rich(page)).toBeVisible();
  await close(); await page.getByRole("dialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0); await expect(rich(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().filter(model => model.uri.scheme === "dssh-editor").length)).toBe(0);
  expect(await page.evaluate(() => window.workbenchFixture.files.get("/root/draft.md").content)).toBe("# Draft\n"); expect(errors).toEqual([]);
});

test("workbench close disposes a rendered view safely after discard", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await ready(page); await page.getByRole("button", { name: "关闭工作台", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByRole("region", { name: "文本编辑器 fixture", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().filter(model => model.uri.scheme === "dssh-editor").length)).toBe(0);
  expect(errors).toEqual([]);
});

test("restored Markdown defaults to source, reports ready and blocks mode switching until handoff release", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  await page.evaluate(async () => {
    const f = window.workbenchFixture; await f.handle.save();
    const state = f.handle.snapshot(); if (!state) throw new Error("missing clean snapshot");
    f.handoff(true); f.restart(state);
  });
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.getByRole("radio", { name: "源码", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "所见即所得", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.ready.includes(true))).toBe(true);
  await page.evaluate(() => window.workbenchFixture.handoff(false));
  await page.getByRole("radio", { name: "所见即所得", exact: true }).check();
  await expect(rich(page)).toHaveAttribute("contenteditable", "true");
  await expect(rich(page).getByRole("heading", { name: "Draft changed", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
