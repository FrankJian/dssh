import type { BrowserSide } from "./fileBrowserModel.ts";

export interface FilePaneDrag {
  pointerId: number;
  side: BrowserSide;
  paths: string[];
  name: string;
  startX: number;
  startY: number;
  active: boolean;
}

export function activateFilePaneDrag(
  drag: FilePaneDrag,
  pointerId: number,
  x: number,
  y: number,
): boolean {
  if (drag.pointerId !== pointerId) return false;
  if (!drag.active && Math.hypot(x - drag.startX, y - drag.startY) < 5)
    return false;
  drag.active = true;
  return true;
}

/** A release must belong to this drag and target the other file pane. */
export function filePaneDrop(
  drag: FilePaneDrag,
  pointerId: number,
  target: BrowserSide | null,
) {
  return drag.active &&
    drag.pointerId === pointerId &&
    target !== null &&
    target !== drag.side &&
    drag.paths.length > 0
    ? { side: drag.side, paths: [...drag.paths] }
    : null;
}
