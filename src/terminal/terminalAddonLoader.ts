import { createLazyResource } from "../ui/lazyResource";
const addons = createLazyResource(() => import("./terminalAddons"));
export const loadTerminalAddons = addons.load;
export function getTerminalAddons() {
  const ready = addons.get();
  if (!ready) throw new Error("终端组件尚未加载完成，请重试。");
  return ready;
}
