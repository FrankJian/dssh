import { useCallback, useRef, type ReactNode } from "react";

interface AppLayoutProps {
  titleBar: ReactNode;
  activityBar: ReactNode | null;
  /** Left sidebar content; when null the sidebar (and its resizer) is not rendered. */
  sidebar: ReactNode | null;
  /** Top tab strip for the main column; when null the tab row is omitted. */
  tabStrip: ReactNode | null;
  /** Active tab surface. */
  main: ReactNode;
  /** Right dock content (assistant / host tools); when null the dock is closed. */
  rightPanel?: ReactNode | null;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  rightPanelWidth: number;
  onRightPanelWidthChange: (width: number) => void;
}

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 820;
const RIGHT_MIN_WIDTH = 280;
const RIGHT_MAX_WIDTH = 640;

function clamp(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function AppLayout({
  titleBar,
  activityBar,
  sidebar,
  tabStrip,
  main,
  rightPanel,
  sidebarWidth,
  onSidebarWidthChange,
  rightPanelWidth,
  onRightPanelWidthChange,
}: AppLayoutProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // A single drag handler drives both docks; `sign` flips the delta for the
  // right dock (dragging left widens it) and the clamp bounds differ per side.
  const makeResizeHandler = useCallback(
    (
      getWidth: () => number,
      setWidth: (width: number) => void,
      sign: 1 | -1,
      min: number,
      max: number,
    ) =>
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragRef.current = { startX: event.clientX, startWidth: getWidth() };

        const handleMove = (moveEvent: MouseEvent) => {
          const drag = dragRef.current;
          if (!drag) {
            return;
          }
          const delta = (moveEvent.clientX - drag.startX) * sign;
          setWidth(clamp(drag.startWidth + delta, min, max));
        };
        const handleUp = () => {
          dragRef.current = null;
          window.removeEventListener("mousemove", handleMove);
          window.removeEventListener("mouseup", handleUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      },
    [],
  );

  const handleSidebarResize = makeResizeHandler(
    () => sidebarWidth,
    onSidebarWidthChange,
    1,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  );
  const handleRightResize = makeResizeHandler(
    () => rightPanelWidth,
    onRightPanelWidthChange,
    -1,
    RIGHT_MIN_WIDTH,
    RIGHT_MAX_WIDTH,
  );

  return (
    <div className="app-shell">
      {titleBar}
      <div className="app-body">
        {activityBar ? <div className="activity-rail">{activityBar}</div> : null}
        {sidebar ? (
          <>
            <aside
              className="side-dock"
              style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
            >
              {sidebar}
            </aside>
            <div
              className="pane-resizer"
              onMouseDown={handleSidebarResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整侧栏宽度"
            />
          </>
        ) : null}
        <div className="main-column">
          {tabStrip ? <div className="main-column__tabs">{tabStrip}</div> : null}
          <div className="main-column__content">{main}</div>
        </div>
        {rightPanel ? (
          <>
            <div
              className="pane-resizer"
              onMouseDown={handleRightResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整面板宽度"
            />
            <aside
              className="right-dock"
              style={{ width: `${rightPanelWidth}px`, minWidth: `${rightPanelWidth}px` }}
            >
              {rightPanel}
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
