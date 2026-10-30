export type AssistantDockPosition = "left" | "right" | "bottom";

export const ASSISTANT_DOCK_KEY = "dssh.ai.dockPosition";
export const ASSISTANT_WIDTH_KEY = "dssh.ai.panelWidth";
export const ASSISTANT_HEIGHT_KEY = "dssh.ai.panelHeight";
export const ASSISTANT_POSITIONS = [
  { value: "right", label: "右侧" },
  { value: "bottom", label: "底部" },
  { value: "left", label: "左侧" },
] as const;

export function normalizeDockPosition(value: unknown): AssistantDockPosition {
  return value === "left" || value === "bottom" ? value : "right";
}

export function boundedSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

/** Fit the two docks without persisting temporary window-size constraints. */
export function fitWorkspaceDocks({ width, height, railWidth, sidebarWidth, panelWidth, panelHeight, sidebar, panel, position }: {
  width: number; height: number; railWidth: number;
  sidebarWidth: number; panelWidth: number; panelHeight: number;
  sidebar: boolean; panel: boolean; position: AssistantDockPosition;
}) {
  const available = Math.max(0, width - railWidth);
  const sidePanel = panel && position !== "bottom";
  const showSidebar = sidebar && available >= 320 + 220 + (sidePanel ? 281 : 0);
  const panelMax = Math.max(160, Math.min(640, available - 320 - (showSidebar ? 221 : 0) - 1));
  const fittedPanel = boundedSize(panelWidth, Math.min(280, panelMax), panelMax);
  const sidebarMax = Math.max(160, Math.min(820, available - 320 - (sidePanel ? fittedPanel + 1 : 0) - 1));
  const panelHeightMax = Math.max(120, Math.min(600, height - 201));
  return {
    showSidebar,
    sidebarWidth: boundedSize(sidebarWidth, Math.min(220, sidebarMax), sidebarMax),
    panelWidth: fittedPanel,
    panelHeight: boundedSize(panelHeight, Math.min(220, panelHeightMax), panelHeightMax),
    panelMax, sidebarMax, panelHeightMax,
  };
}

export function workspaceDockGrid({ rail, sidebar, panel, position, sizes }: {
  rail: boolean; sidebar: boolean; panel: boolean; position: AssistantDockPosition;
  sizes: ReturnType<typeof fitWorkspaceDocks>;
}) {
  const columns: string[] = [];
  const top: string[] = [];
  if (rail) { columns.push("auto"); top.push("rail"); }
  if (sidebar && sizes.showSidebar) { columns.push(`${sizes.sidebarWidth}px`, "1px"); top.push("sidebar", "sidebar-resizer"); }
  if (panel && position === "left") { columns.push(`${sizes.panelWidth}px`, "1px"); top.push("dock", "dock-resizer"); }
  columns.push("minmax(0, 1fr)"); top.push("main");
  if (panel && position === "right") { columns.push("1px", `${sizes.panelWidth}px`); top.push("dock-resizer", "dock"); }
  const rows = [top];
  if (panel && position === "bottom") {
    rows.push(top.map((area) => area === "main" ? "dock-resizer" : area));
    rows.push(top.map((area) => area === "main" ? "dock" : area));
  }
  return {
    gridTemplateColumns: columns.join(" "),
    gridTemplateAreas: rows.map((row) => `"${row.join(" ")}"`).join(" "),
    gridTemplateRows: panel && position === "bottom" ? `minmax(0, 1fr) 1px ${sizes.panelHeight}px` : "minmax(0, 1fr)",
  };
}
