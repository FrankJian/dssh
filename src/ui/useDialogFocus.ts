import { useEffect, useRef } from "react";

/** Share focus isolation and restoration across application dialogs. */
export function useDialogFocus<DialogElement extends HTMLElement = HTMLElement>() {
  const ref = useRef<DialogElement>(null);
  const previousFocus = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const previous = previousFocus.current;
    const dialog = ref.current;
    if (!dialog) return;
    const ownerDocument = dialog.ownerDocument;
    const previousTabIndex = dialog.getAttribute("tabindex");
    if (previousTabIndex === null) dialog.tabIndex = -1;
    function controls() {
      return Array.from(dialog!.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]), select, textarea, summary, a[href], [tabindex]')).filter((e) => e.tabIndex >= 0 && !e.matches(":disabled") && !e.closest("[inert]") && e.getClientRects().length > 0);
    }
    if (!dialog.contains(ownerDocument.activeElement)) (controls()[0] ?? dialog).focus({ preventScroll: true });
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      // Disabling the focused action can move focus to body. Listen on the
      // document so a busy modal with no enabled controls still contains Tab.
      // A newer native or nested dialog owns focus until it closes.
      const nativeModal = Array.from(ownerDocument.querySelectorAll<HTMLDialogElement>("dialog[open]")).pop();
      if (nativeModal && !nativeModal.contains(dialog)) return;
      const topmost = Array.from(ownerDocument.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]')).filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0).pop();
      if (topmost !== dialog) return;
      const elements = controls(); const first = elements[0]; const last = elements[elements.length - 1];
      const active = ownerDocument.activeElement;
      if (!first) { event.preventDefault(); dialog!.focus({ preventScroll: true }); }
      else if (!elements.includes(active as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
    ownerDocument.addEventListener("keydown", trap);
    return () => {
      ownerDocument.removeEventListener("keydown", trap);
      if (previousTabIndex === null) dialog.removeAttribute("tabindex");
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
