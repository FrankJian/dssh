import { lazy } from "react";

/**
 * Keep the xterm implementation behind one lazy boundary.  TerminalView is
 * used by both the regular workspace and the pane grid; defining the loader
 * once prevents one consumer from turning the module back into a static
 * dependency and triggering Vite's ineffective-dynamic-import warning.
 */
export const LazyTerminalView = lazy(() =>
  import("./TerminalView").then((module) => ({ default: module.TerminalView })),
);
