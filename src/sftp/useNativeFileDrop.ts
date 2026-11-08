import { useEffect, useRef, useState, type RefObject } from "react";
import { isMacOS } from "../platform";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { nativeDropClientPoint } from "./nativeFileDrop";

interface NativeDropOptions {
  root: RefObject<HTMLElement | null>;
  disabled: boolean;
  targetPath: string;
  onDrop: (paths: string[]) => void;
  onError: (message: string) => void;
}

/** Wry 0.55.1 wraps macOS NSPoint values as PhysicalPosition without converting
 * to backing pixels. Windows reports pixels. Recheck this on Wry upgrades. */
export function useNativeFileDrop(options: NativeDropOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [isOver, setIsOver] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let size: { width: number; height: number } | null = null;
    let nativeToPhysicalScale = 1;
    let hover: { x: number; y: number } | null = null;
    function visible() {
      const root = latest.current.root.current;
      return (
        !disposed &&
        !latest.current.disabled &&
        root &&
        root.getClientRects().length > 0 &&
        !root.closest("[hidden], [inert]")
      );
    }
    function hit(position: { x: number; y: number }) {
      if (!visible() || !size) return false;
      const point = nativeDropClientPoint(
        position,
        size,
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        nativeToPhysicalScale,
      );
      if (!point) return false;
      const pane = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>('[data-sftp-native-side="remote"]');
      return Boolean(
        pane &&
          latest.current.root.current?.contains(pane) &&
          !pane.closest("[hidden], [inert]"),
      );
    }
    async function measure() {
      const nativeWindow = getCurrentWindow();
      const [next, scale] = await Promise.all([
        nativeWindow.innerSize(),
        isMacOS ? nativeWindow.scaleFactor() : Promise.resolve(1),
      ]);
      if (!disposed) {
        size = next;
        nativeToPhysicalScale = scale;
      }
    }
    function updateScale() {
      void measure()
        .then(() => {
          if (!disposed) setIsOver(Boolean(hover && hit(hover)));
        })
        .catch(() => {
          /* Retry on the next native drop; report failures there. */
        });
    }
    updateScale();
    window.addEventListener("resize", updateScale);
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          hover = null;
          setIsOver(false);
          return;
        }
        if (payload.type === "enter" || payload.type === "over") {
          hover = payload.position;
          setIsOver(hit(payload.position));
          if (payload.type === "enter" && visible()) updateScale();
          return;
        }
        hover = null;
        setIsOver(false);
        if (!visible() || !payload.paths.length) return;
        const targetPath = latest.current.targetPath;
        // Re-measure on release for windows moved between monitors with different DPI.
        void measure()
          .then(() => {
            if (
              !disposed &&
              targetPath === latest.current.targetPath &&
              hit(payload.position)
            )
              latest.current.onDrop([...payload.paths]);
          })
          .catch((reason: unknown) => {
            if (!disposed)
              latest.current.onError(
                reason instanceof Error
                  ? reason.message
                  : "无法定位拖入文件的目标位置。",
              );
          });
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((reason: unknown) => {
        if (!disposed)
          latest.current.onError(
            reason instanceof Error ? reason.message : "无法启用系统文件拖入。",
          );
      });
    return () => {
      disposed = true;
      hover = null;
      window.removeEventListener("resize", updateScale);
      unlisten?.();
    };
  }, []);
  return { isOver: isOver && !options.disabled };
}
