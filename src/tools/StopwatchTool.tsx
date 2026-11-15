import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { ToolPanel } from "./ToolControls";

function duration(milliseconds: number): string {
  const centiseconds = Math.floor(milliseconds / 10);
  const seconds = Math.floor(centiseconds / 100);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}.${pad(centiseconds % 100)}`;
}

export default function StopwatchTool() {
  const display = useRef<HTMLOutputElement>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [accumulated, setAccumulated] = useState(0);
  const [now, setNow] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  useEffect(() => {
    if (started === null) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !display.current?.closest("[hidden]")) setNow(performance.now());
    }, 50);
    return () => window.clearInterval(timer);
  }, [started]);

  const elapsed = accumulated + (started === null ? 0 : now - started);
  function toggle() {
    const time = performance.now();
    if (started === null) {
      setNow(time);
      setStarted(time);
    } else {
      setAccumulated(accumulated + time - started);
      setStarted(null);
    }
  }

  return (
    <div className="tool-form">
      <div className="tool-form__toolbar">
        <Button variant="primary" onClick={toggle}>{started === null ? "开始" : "暂停"}</Button>
        <Button disabled={started === null || laps.length >= 100}
          onClick={() => { if (started !== null) setLaps([...laps, accumulated + performance.now() - started]); }}>计次</Button>
        <Button variant="ghost" disabled={!accumulated && started === null}
          onClick={() => { setStarted(null); setAccumulated(0); setLaps([]); }}>重置</Button>
      </div>
      <ToolPanel label="已用时间">
        <output ref={display} className="tool-stopwatch" aria-live="off">{duration(elapsed)}</output>
      </ToolPanel>
      {laps.length ? <ToolPanel label="计次记录"><ol className="tool-stopwatch__laps">
        {laps.map((lap, index) => <li key={index}>{duration(lap)}（加 ${duration(lap - (laps[index - 1] ?? 0))}）</li>)}
      </ol></ToolPanel> : null}
    </div>
  );
}
