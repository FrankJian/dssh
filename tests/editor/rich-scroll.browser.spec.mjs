import { test, expect } from "@playwright/test";
import { editorArtifact } from "./artifacts.mjs";
const editor = page => page.getByRole("textbox", { name: "Markdown 所见即所得编辑器", exact: true });
const scroll = page => page.locator(".editor-rich-scroll");
const content = "# Document beginning\n\n" + Array.from({ length: 120 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}: a long document for scroll verification.\n\n`).join("") + "## Document end\n";
async function ready(page) {
  await page.goto("/tests/editor/workbench.html?local&wysiwyg");
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  await page.evaluate(async content => { const f = window.workbenchFixture; f.files.set("/root/long.md", { ...f.files.get("/root/a2.ts"), path: "/root/long.md", content }); await f.handle.open("/root/long.md"); }, content);
  await page.getByRole("radio", { name: "所见即所得", exact: true }).check();
  await expect(editor(page)).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("rendered long documents begin at the top and wheel and keyboard scroll within the editor", async ({ page }) => {
  await ready(page);
  await expect.poll(() => scroll(page).evaluate(el => el.scrollTop)).toBe(0);
  const bounds = await scroll(page).boundingBox(); expect(bounds.height).toBeLessThan(800);
  expect(await scroll(page).evaluate(el => el.scrollHeight > el.clientHeight + 1000)).toBe(true);
  await expect(scroll(page)).toHaveCSS("overflow-y", "auto");
  const tabTop = (await page.getByRole("tab", { name: /long.md/ }).boundingBox()).y;
  const statusTop = (await page.locator(".editor-statusbar").boundingBox()).y;
  await page.keyboard.press("PageDown"); await expect.poll(() => scroll(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await scroll(page).hover(); await page.mouse.wheel(0, 1000); await expect.poll(() => scroll(page).evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  expect((await page.getByRole("tab", { name: /long.md/ }).boundingBox()).y).toBe(tabTop);
  expect((await page.locator(".editor-statusbar").boundingBox()).y).toBe(statusTop);
  await page.mouse.wheel(0, 100000);
  await expect(editor(page).getByRole("heading", { name: "Document end", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);
});

test("source-to-rendered switching starts at the top and header controls preserve text and undo", async ({ page }) => {
  await ready(page);
  const actions = page.getByRole("toolbar", { name: "文件快捷操作", exact: true });
  await expect(actions.getByRole("radiogroup", { name: "Markdown 编辑模式", exact: true })).toBeVisible();
  await expect(page.locator(".editor-markdown-modebar")).toHaveCount(0);
  await editor(page).getByRole("heading", { name: "Document beginning", exact: true }).click();
  await page.keyboard.press("End"); await page.keyboard.insertText(" edited");
  const value = await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue());
  await actions.getByRole("radio", { name: "源码", exact: true }).check();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(() => { const f = window.workbenchFixture; const e = f.monaco.editor.getEditors().find(e => e.getModel()?.uri.scheme === "dssh-editor"); e.setPosition({ lineNumber: e.getModel().getLineCount(), column: 1 }); e.revealLine(e.getModel().getLineCount()); });
  await actions.getByRole("radio", { name: "所见即所得", exact: true }).check();
  await expect(editor(page)).toBeVisible(); await expect.poll(() => scroll(page).evaluate(el => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue())).toBe(value);
  await editor(page).focus(); await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue())).toBe(content);
});

test("icon modes fit one row in themed narrow groups, expose names and retain disabled protection", async ({ page }) => {
  await ready(page);
  for (const [theme, width] of [["light",1280], ["dark",620]]) {
    await page.setViewportSize({ width, height: 800 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(theme => { document.documentElement.dataset.theme=theme; window.workbenchFixture.palette.setPaletteColor("#986aa6"); }, theme);
    const header=await page.locator(".editor-group__tabs").boundingBox(), mode=await page.getByRole("radiogroup", { name: "Markdown 编辑模式" }).boundingBox();
    expect(mode.y).toBeGreaterThanOrEqual(header.y); expect(mode.y+mode.height).toBeLessThanOrEqual(header.y+header.height); expect(mode.x+mode.width).toBeLessThanOrEqual(header.x+header.width);
    await expect(page.locator(".editor-markdown-mode-switch")).toHaveCSS("border-top-width", "0px");
    await expect(page.locator('.editor-markdown-mode-switch label[title="所见即所得"]')).toBeVisible();
    await expect(page.locator('.editor-markdown-mode-switch label[title="源码"]')).toBeVisible();
    await page.screenshot({ path: editorArtifact(`dssh-rich-scroll-${theme}.png`), animations:"disabled" });
  }
  await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(page.getByRole("radio", { name:"源码",exact:true })).toBeDisabled();
  await page.evaluate(() => window.workbenchFixture.lock(false));
  await page.evaluate(() => window.workbenchFixture.handoff(true)); await expect(page.getByRole("radio", { name:"源码",exact:true })).toBeDisabled();
});
