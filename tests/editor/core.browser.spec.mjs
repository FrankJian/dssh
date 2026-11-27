import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }, info) => {
  if (info.title.startsWith("loading ")) return;
  await page.goto("/tests/editor/index.html");
  await expect(page.getByTestId("left").locator(".monaco-editor")).toBeVisible();
  await expect(page.getByTestId("right").locator(".monaco-editor")).toBeVisible();
});

test("real Monaco shares models, preserves undo and independent group positions", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = window.editorFixture;
    const left = f.editors.left; const right = f.editors.right;
    left.setPosition({ lineNumber: 4, column: 2 }); right.setPosition({ lineNumber: 10, column: 2 });
    left.executeEdits("test", [{ range: new f.monaco.Range(1, 1, 1, 1), text: "// edit\n" }]);
    const changed = f.dirty();
    const shared = left.getModel() === right.getModel();
    await left.getModel().undo();
    return { changed, shared, clean: !f.dirty(), rightLine: right.getPosition().lineNumber };
  });
  expect(result).toEqual({ changed: true, shared: true, clean: true, rightLine: 10 });
  await page.evaluate(() => { window.editorFixture.editors.left.setPosition({ lineNumber: 42, column: 3 }); });
  await page.getByRole("button", { name: "文件 B", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.editorFixture.editors.left.getModel()?.getValue())).toBe("const other = 2;");
  await page.getByRole("button", { name: "文件 A", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.editorFixture.editors.left.getPosition()?.lineNumber)).toBe(42);
});

test("closing a group retains the other buffer and remount recovers its view", async ({ page }) => {
  await page.evaluate(() => { window.editorFixture.editors.right.setPosition({ lineNumber: 35, column: 2 }); });
  await page.getByRole("button", { name: "切换右组" }).click();
  expect(await page.evaluate(() => window.editorFixture.registry.get(window.editorFixture.a).model.isDisposed())).toBe(false);
  await page.getByRole("button", { name: "切换右组" }).click();
  await expect.poll(() => page.evaluate(() => window.editorFixture.editors.right.getPosition()?.lineNumber)).toBe(35);
});

test("text commands, find, replacement and read-only diff use real editors", async ({ page }) => {
  await page.evaluate(async () => {
    const instance = window.editorFixture.editors.left;
    await instance.getAction("actions.find").run();
  });
  await expect(page.getByTestId("left").locator(".find-widget.visible")).toBeVisible();
  await page.evaluate(() => {
    const f = window.editorFixture;
    f.editors.left.executeEdits("replace", [{ range: new f.monaco.Range(1, 1, 1, 6), text: "let" }]);
  });
  expect(await page.evaluate(() => window.editorFixture.dirty())).toBe(true);
  await page.getByRole("button", { name: "比较", exact: true }).click();
  await expect(page.getByTestId("diff").locator(".monaco-diff-editor")).toBeVisible();
  await page.getByRole("button", { name: "比较", exact: true }).click();
});

test("local workers, theme switch and the existing loader run without external requests", async ({ page }) => {
  const external = [];
  page.on("request", (request) => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(request.url()); });
  await page.reload();
  await expect(page.getByTestId("left").locator(".monaco-editor")).toBeVisible();
  await page.evaluate(async () => {
    const f = window.editorFixture;
    const getWorker = await f.monaco.typescript.getTypeScriptWorker();
    const worker = await getWorker(f.registry.get(f.a).model.uri);
    await worker.getSyntacticDiagnostics(f.registry.get(f.a).uri);
    await f.monaco.editor.colorize("", "javascript", {});
    if (!f.monaco.editor.tokenize("const example = 1;", "javascript")[0].length) throw new Error("旧代码图片 tokenizer 不可用");
  });
  await page.getByRole("button", { name: "主题", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  expect(external).toEqual([]);
});

test("loading views can unmount before the wrapper resolves without retaining stale views", async ({ page }) => {
  await page.route("**/@monaco-editor_react.js*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto("/tests/editor/index.html");
  await page.getByRole("button", { name: "切换右组" }).click();
  await expect(page.getByTestId("left").locator(".monaco-editor")).toBeVisible();
  expect(await page.evaluate(() => window.editorFixture.registry.viewCount(window.editorFixture.a))).toBe(1);
  await page.getByRole("button", { name: "切换右组" }).click();
  await expect(page.getByTestId("right").locator(".monaco-editor")).toBeVisible();
  expect(await page.evaluate(() => window.editorFixture.registry.viewCount(window.editorFixture.a))).toBe(2);
});

test("loading failure can be retried without discarding the registry", async ({ page }) => {
  let rejected = false;
  await page.route("**/@monaco-editor_react.js*", async (route) => {
    if (!rejected) { rejected = true; await route.abort(); } else await route.continue();
  });
  await page.goto("/tests/editor/index.html");
  await expect(page.getByTestId("left").getByRole("button", { name: "重试" })).toBeVisible();
  await page.getByTestId("left").getByRole("button", { name: "重试" }).click();
  await expect(page.getByTestId("left").locator(".monaco-editor")).toBeVisible();
  expect(await page.evaluate(() => window.editorFixture.registry.list().length)).toBe(2);
});
