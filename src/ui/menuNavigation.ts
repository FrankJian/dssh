import type { KeyboardEvent } from "react";

/** Restore a stable owner before an action mounts a dialog or another surface. */
export function dismissMenu(dismiss: () => void, trigger: HTMLElement | null) {
  dismiss();
  trigger?.focus({ preventScroll: true });
}

/** Keep action menus consistent while their owners retain dismissal/focus policy. */
export function handleMenuNavigation(event: KeyboardEvent<HTMLElement>, dismiss: () => void) {
  if (event.nativeEvent.isComposing) return;
  if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") event.preventDefault();
    event.stopPropagation();
    dismiss();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
    .filter((item) => item.getClientRects().length > 0);
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1)
    : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  event.stopPropagation();
  items[next].focus();
}
