import { expect } from "@playwright/test";

// CI may still be downloading/evaluating Monaco after the HTML load event.
// Only host initialization gets this budget; action assertions retain 5 seconds,
// and the smoke suite retains its 20-second test and 3-minute global limits.
export async function expectEditorHost(locator) {
  await expect(locator, "编辑器宿主应完成模块加载并显示内容").toBeVisible({ timeout: 15_000 });
}
