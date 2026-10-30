export interface CompletionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CompletionPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Prefer below the input, reducing rows before falling back above it. */
export function placeCompletionMenu(
  bounds: CompletionBounds,
  anchorX: number,
  rowTop: number,
  rowBottom: number,
  desiredWidth: number,
  itemCount: number,
  rowHeight: number,
  scrollbarHeight = 0,
): CompletionPlacement | null {
  const gap = 4;
  const chrome = 6 + scrollbarHeight; // Padding, borders and any horizontal scrollbar.
  const availableWidth = bounds.right - bounds.left - gap * 2;
  if (availableWidth < 40 || rowBottom <= bounds.top || rowTop >= bounds.bottom || itemCount < 1) return null;

  const width = Math.min(desiredWidth, availableWidth);
  const idealRows = Math.min(itemCount, 6);
  const aboveSpace = rowTop - bounds.top - gap;
  const belowSpace = bounds.bottom - rowBottom - gap;
  // Preserve previous output above the prompt whenever at least one complete
  // suggestion fits below it. Remaining matches stay available by scrolling.
  const above = belowSpace < rowHeight + chrome;
  const availableHeight = above ? aboveSpace : belowSpace;
  const rows = Math.min(idealRows, Math.floor((availableHeight - chrome) / rowHeight));
  if (rows < 1) return null;

  const height = rows * rowHeight + chrome;
  const left = Math.max(bounds.left + gap, Math.min(anchorX, bounds.right - gap - width));
  const top = above ? rowTop - gap - height : rowBottom + gap;
  return { left, top, width, height };
}
