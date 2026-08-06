/**
 * Coordination between a pane-divider drag and the terminals it resizes.
 *
 * Dragging a divider changes every pane's box on every frame. Fitting a
 * terminal is not free — it forces a layout read and reflows the whole buffer —
 * and the intermediate sizes are never read by anyone, so terminals skip
 * fitting while a drag is in flight and run once when it settles.
 */

let dragDepth = 0;
const endListeners = new Set<() => void>();

export function beginPaneDrag() {
  dragDepth += 1;
}

export function endPaneDrag() {
  if (dragDepth === 0) {
    return;
  }
  dragDepth -= 1;
  if (dragDepth > 0) {
    return;
  }
  for (const listener of [...endListeners]) {
    listener();
  }
}

export function isPaneDragging() {
  return dragDepth > 0;
}

export function onPaneDragEnd(listener: () => void) {
  endListeners.add(listener);
  return () => {
    endListeners.delete(listener);
  };
}
