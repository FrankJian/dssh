import { lazyFeature } from "../ui/lazyFeature";
import { loadTerminalAddons } from "./terminalAddonLoader";

/** Engine and view load once, in parallel, before any instance is acquired. */
export const LazyTerminalView = lazyFeature("终端", async () => {
  const [module] = await Promise.all([import("./TerminalView"), loadTerminalAddons()]);
  return { default: module.TerminalView };
});
