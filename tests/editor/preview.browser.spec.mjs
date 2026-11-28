import { test, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { editorArtifact } from "./artifacts.mjs";
async function ready(page, content) {
  await page.goto("/tests/editor/workbench.html?local=1");
  await expect(page.locator('[data-path="/root/a2.ts"]')).toBeVisible();
  if (content !== undefined) {
    await page.evaluate(async content => { const f = window.workbenchFixture; f.files.set("/root/charts.md", { ...f.files.get("/root/a2.ts"), path: "/root/charts.md", content }); await f.handle.open("/root/charts.md"); }, content);
    await page.getByRole("button", { name: "Markdown 预览", exact: true }).click();
  }
}
const diagram = page => page.getByRole("figure", { name: "Mermaid 图表", exact: true });
const flow = 'flowchart LR\n  A[开始] --> B[完成]';
const markdown = chart => `# Preview\n\n\`\`\`mermaid\n${chart}\n\`\`\`\n`;
async function loaded(page, count = 1) {
  await expect(diagram(page).getByRole("img")).toHaveCount(count);
  await expect.poll(() => diagram(page).getByRole("img").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
}

test("Markdown renders multiple Mermaid diagrams and exports actual PNG pixels for each without changing source", async ({ page }) => {
  const source = markdown(flow) + '\n```mamerid\nsequenceDiagram\n Alice->>Bob: Hello\n Bob-->>Alice: Done\n```\n\n```js\nconsole.log("kept");\n```';
  await ready(page, source); await loaded(page, 2);
  const layout = await diagram(page).first().evaluate(figure => { const caption=figure.querySelector("figcaption"); const bounds=figure.getBoundingClientRect(); const heading=caption.getBoundingClientRect(); return { display:getComputedStyle(figure).display, width:bounds.width, captionWidth:heading.width }; });
  expect(layout.display).toBe("block"); expect(layout.captionWidth).toBeGreaterThanOrEqual(layout.width-4);
  await expect(page.getByRole("article").locator("pre code")).toHaveText('console.log("kept");');
  for (const figure of await diagram(page).all()) { await figure.getByRole("button", { name: "导出 PNG", exact: true }).click(); await expect(figure.getByRole("status")).toHaveText("PNG 已保存"); }
  const pngs = await page.evaluate(() => window.workbenchFixture.imageExports);
  expect(pngs).toHaveLength(2);
  for (const bytes of pngs) {
    expect(bytes.slice(0, 8)).toEqual([137,80,78,71,13,10,26,10]);
    const view = new DataView(Uint8Array.from(bytes).buffer); expect(view.getUint32(16)).toBeGreaterThan(1); expect(view.getUint32(16)).toBeLessThanOrEqual(1024); expect(view.getUint32(20)).toBeLessThanOrEqual(4096);
    const colors = await page.evaluate(async bytes => { const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: "image/png" })); const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap,0,0); const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data; bitmap.close(); const colors = new Set(); for(let i=0;i<pixels.length;i+=4) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]},${pixels[i+3]}`); return colors.size; }, bytes);
    expect(colors).toBeGreaterThan(3);
  }
  expect(pngs[0]).not.toEqual(pngs[1]);
  expect(await page.evaluate(() => window.workbenchFixture.monaco.editor.getModels().find(m => m.uri.scheme === "dssh-editor").getValue())).toBe(source);
  expect(await page.evaluate(() => window.workbenchFixture.writes.length)).toBe(0);
  const path = editorArtifact("dssh-mermaid-export.png"); await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.from(pngs[0]));
  await page.screenshot({ path: editorArtifact("dssh-mermaid-preview.png"), animations: "disabled" });
});

test("Mermaid export cancellation and failure preserve the diagram and allow retry", async ({ page }) => {
  await ready(page, markdown(flow)); await loaded(page);
  const figure = diagram(page); const button = figure.getByRole("button", { name: "导出 PNG", exact: true });
  await page.evaluate(() => { window.workbenchFixture.imageSave.mode = "cancel"; }); await button.click(); await expect(figure.getByRole("status")).toHaveText("已取消保存");
  expect(await page.evaluate(() => window.workbenchFixture.imageExports.length)).toBe(0);
  await page.evaluate(() => { window.workbenchFixture.imageSave.mode = "error"; }); await button.click(); await expect(figure.getByRole("alert")).toHaveText("合成图片保存失败");
  await expect(figure.getByRole("img")).toBeVisible(); await expect(button).toBeEnabled();
  await page.evaluate(() => { window.workbenchFixture.imageSave.mode = "save"; }); await button.click(); await expect(figure.getByRole("status")).toHaveText("PNG 已保存");
});

test("invalid or untrusted Mermaid stays isolated and recovers after edits and theme changes", async ({ page }) => {
  const external = []; page.on("request", request => { if (request.url().includes("untrusted.example")) external.push(request.url()); });
  await ready(page, markdown('flowchart LR\n A --> [') + markdown(flow));
  await expect(diagram(page).first().getByRole("alert")).toContainText("无法渲染");
  await expect(diagram(page).last().getByRole("img")).toBeVisible();
  await page.evaluate(source => window.workbenchFixture.monaco.editor.getModels().find(m=>m.uri.scheme === "dssh-editor").setValue(source), markdown('flowchart LR\n A@{ img: "https://untrusted.example/a.png" }'));
  await expect(diagram(page).getByRole("alert")).toContainText("外部资源");
  await expect(diagram(page).getByRole("button", { name: "导出 PNG" })).toBeDisabled(); expect(external).toEqual([]);
  await page.evaluate(source => window.workbenchFixture.monaco.editor.getModels().find(m=>m.uri.scheme === "dssh-editor").setValue(source), markdown(flow)); await loaded(page);
  const before = await diagram(page).getByRole("img").getAttribute("src");
  await page.evaluate(() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; });
  await expect.poll(async () => await diagram(page).getByRole("img").getAttribute("src") !== before).toBe(true); await loaded(page);
  await expect(page.getByRole("article").getByRole("heading", { name: "Preview" })).toBeVisible();
});

test("a pending PNG is not saved after lock and unlock or document replacement", async ({ page }) => {
  await ready(page, markdown(flow)); await loaded(page);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      const canvas=this;
      window.resumeMermaidPng=()=>new Promise(resolve=> { HTMLCanvasElement.prototype.toBlob=original; original.call(canvas, blob=>{ callback(blob); resolve(); }, ...args); });
    };
  });
  await diagram(page).getByRole("button", { name: "导出 PNG" }).click();
  await expect.poll(() => page.evaluate(() => typeof window.resumeMermaidPng)).toBe("function");
  await page.evaluate(() => window.workbenchFixture.lock(true)); await expect(diagram(page)).toHaveCount(0);
  await page.evaluate(() => window.workbenchFixture.lock(false)); await loaded(page);
  await page.evaluate(async () => { await window.resumeMermaidPng(); await Promise.resolve(); await Promise.resolve(); });
  expect(await page.evaluate(() => window.workbenchFixture.imageExports.length)).toBe(0);
  await page.evaluate(() => window.workbenchFixture.handoff(true)); await expect(diagram(page)).toHaveCount(0);
  await page.evaluate(() => window.workbenchFixture.handoff(false)); await loaded(page);
  await diagram(page).getByRole("button", { name: "导出 PNG" }).click(); await expect(diagram(page).getByRole("status")).toHaveText("PNG 已保存");
});

test("PNG JPEG WebP GIF BMP and SVG files decode read-only and corrupted images can be retried", { tag: "@smoke" }, async ({ page }) => {
  await ready(page);
  const external = []; page.on("request", request => { if (request.url().includes("untrusted.example")) external.push(request.url()); });
  await page.evaluate(() => {
    const f=window.workbenchFixture; const canvas=document.createElement("canvas");canvas.width=4;canvas.height=3;canvas.getContext("2d").fillRect(0,0,4,3);
    for(const [ext,mime] of [["png","image/png"],["jpg","image/jpeg"],["webp","image/webp"]]) f.imageResponses.set(`/root/image.${ext}`,canvas.toDataURL(mime));
    const bmp=new Uint8Array(58); const view=new DataView(bmp.buffer);bmp[0]=66;bmp[1]=77;view.setUint32(2,58,true);view.setUint32(10,54,true);view.setUint32(14,40,true);view.setInt32(18,1,true);view.setInt32(22,1,true);view.setUint16(26,1,true);view.setUint16(28,24,true);view.setUint32(34,4,true);bmp[55]=128;bmp[56]=255;
    f.imageResponses.set("/root/image.bmp","data:image/bmp;base64,"+btoa(String.fromCharCode(...bmp)));
    f.imageResponses.set("/root/image.gif","data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
    f.imageResponses.set("/root/image.svg","data:image/svg+xml;base64,"+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><script>window.imageExecuted=true</script><image href="https://untrusted.example/a.png"/><rect width="8" height="6" fill="red"/></svg>'));
  });
  for(const extension of ["png","jpg","webp","gif","bmp","svg"]) {
    await page.evaluate(extension=>window.workbenchFixture.handle.open(`/root/image.${extension}`),extension);
    const image=page.getByRole("img",{name:`/root/image.${extension}`,exact:true});await expect(image).toBeVisible();
    await expect.poll(()=>image.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  }
  expect(external).toEqual([]);expect(await page.evaluate(()=>window.imageExecuted)).toBeUndefined();
  await page.evaluate(async()=>{const f=window.workbenchFixture;f.imageResponses.set("/root/bad.png","data:image/png;base64,AAAA");await f.handle.open("/root/bad.png");});
  await expect(page.getByRole("alert")).toContainText("无法解码");
  await page.evaluate(()=>{const f=window.workbenchFixture;f.imageResponses.set("/root/bad.png",f.imageResponses.get("/root/image.png"));});
  await page.getByRole("button",{name:"重试",exact:true}).click();
  await expect.poll(()=>page.getByRole("img",{name:"/root/bad.png",exact:true}).evaluate(img=>img.naturalWidth)).toBe(4);
  await page.evaluate(()=>window.workbenchFixture.handoff(true));await expect(page.getByRole("img")).toHaveCount(0);
  expect(await page.evaluate(()=>window.workbenchFixture.writes.length)).toBe(0);
});

test("Markdown bounds the number of diagrams without blocking the surrounding document", async ({ page }) => {
  await ready(page, Array.from({length:34},()=>markdown('flowchart LR\nA')).join('\n')+'\n## After diagrams');
  await expect(diagram(page)).toHaveCount(32);
  await expect(page.getByRole("article").getByRole("status").filter({hasText:'前 32 幅'})).toBeVisible();
  await expect(page.getByRole("heading",{name:'After diagrams',exact:true})).toBeAttached();
  await page.getByRole("button",{name:'关闭预览 charts.md',exact:true}).click();
  await expect(diagram(page)).toHaveCount(0);
});
