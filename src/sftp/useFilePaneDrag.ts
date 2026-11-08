import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { BrowserSide } from "./fileBrowserModel";
import {
  activateFilePaneDrag,
  filePaneDrop,
  type FilePaneDrag,
} from "./filePaneDrag";

interface DragOptions {
  root: RefObject<HTMLElement | null>;
  disabled: boolean;
  onSelect: (side: BrowserSide, paths: string[]) => void;
  onDrop: (side: BrowserSide, paths: string[]) => void;
}
interface Preview {
  name: string;
  count: number;
  x: number;
  y: number;
  target: BrowserSide | null;
}

/** Internal pane transfers use pointer events, independent of native file drops. */
export function useFilePaneDrag(options: DragOptions) {
  const latest = useRef(options);
  latest.current = options;
  const dragRef = useRef<FilePaneDrag | null>(null);
  const captureRef = useRef<HTMLElement | null>(null);
  const suppressClickRef = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    function targetAt(x: number, y: number): BrowserSide | null {
      if (latest.current.disabled) return null;
      const list = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-sftp-drop-side]");
      if (
        !list ||
        !latest.current.root.current?.contains(list) ||
        list.closest("[hidden], [inert]")
      )
        return null;
      const side = list.dataset.sftpDropSide;
      return side === "remote" || side === "local" ? side : null;
    }
    function clear() {
      const drag = dragRef.current;
      dragRef.current = null;
      const source = captureRef.current;
      captureRef.current = null;
      if (drag && source?.hasPointerCapture(drag.pointerId))
        source.releasePointerCapture(drag.pointerId);
      setPreview(null);
    }
    function move(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (latest.current.disabled) {
        clear();
        return;
      }
      const wasActive = drag.active;
      if (
        !activateFilePaneDrag(
          drag,
          event.pointerId,
          event.clientX,
          event.clientY,
        )
      )
        return;
      event.preventDefault();
      if (!wasActive) {
        suppressClickRef.current = true;
        latest.current.onSelect(drag.side, drag.paths);
        captureRef.current?.setPointerCapture(event.pointerId);
      }
      const target = targetAt(event.clientX, event.clientY);
      setPreview({
        name: drag.name,
        count: drag.paths.length,
        x: event.clientX + 12,
        y: event.clientY + 12,
        target: target !== drag.side ? target : null,
      });
    }
    function up(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const drop = filePaneDrop(
        drag,
        event.pointerId,
        targetAt(event.clientX, event.clientY),
      );
      if (drag.active) event.preventDefault();
      clear();
      if (drop) latest.current.onDrop(drop.side, drop.paths);
    }
    function cancel(event: PointerEvent) {
      if (dragRef.current?.pointerId === event.pointerId) clear();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && dragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        clear();
      }
    }
    function resetClick() {
      suppressClickRef.current = false;
    }
    document.addEventListener("pointerdown", resetClick, true);
    document.addEventListener("pointermove", move, {
      capture: true,
      passive: false,
    });
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      document.removeEventListener("pointerdown", resetClick, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", clear);
    };
  }, []);

  function begin(
    event: ReactPointerEvent<HTMLElement>,
    side: BrowserSide,
    name: string,
    paths: string[],
  ) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      latest.current.disabled ||
      !paths.length
    )
      return;
    captureRef.current = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      side,
      paths: [...paths],
      name,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  }
  function suppressClick(event: MouseEvent) {
    if (suppressClickRef.current && event.detail > 0) {
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }
  return { begin, preview, suppressClick };
}
