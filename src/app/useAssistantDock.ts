import { useEffect, useState } from "react";
import { ASSISTANT_DOCK_KEY, ASSISTANT_HEIGHT_KEY, ASSISTANT_WIDTH_KEY, boundedSize, normalizeDockPosition, type AssistantDockPosition } from "./assistantDock";

function loadSize(key: string, fallback: number, min: number, max: number) {
  const value = Number(localStorage.getItem(key) ?? fallback);
  return Number.isFinite(value) ? boundedSize(value, min, max) : fallback;
}

export interface AssistantDockControls {
  position: AssistantDockPosition;
  setPosition: (position: AssistantDockPosition) => void;
}

export function useAssistantDock() {
  const [position, setPosition] = useState<AssistantDockPosition>(() => normalizeDockPosition(localStorage.getItem(ASSISTANT_DOCK_KEY)));
  const [width, setWidth] = useState(() => loadSize(ASSISTANT_WIDTH_KEY, 360, 280, 640));
  const [height, setHeight] = useState(() => loadSize(ASSISTANT_HEIGHT_KEY, 320, 220, 600));
  useEffect(() => { localStorage.setItem(ASSISTANT_DOCK_KEY, position); }, [position]);
  useEffect(() => { localStorage.setItem(ASSISTANT_WIDTH_KEY, String(width)); }, [width]);
  useEffect(() => { localStorage.setItem(ASSISTANT_HEIGHT_KEY, String(height)); }, [height]);
  return { position, setPosition, width, setWidth, height, setHeight };
}
