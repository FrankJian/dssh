import type { AiReasoningLevel } from "../models/ai";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { REASONING_LEVEL_NAMES } from "./aiConfig";

export function AiReasoningLevels({ levels, onChange }: { levels: AiReasoningLevel[]; onChange: (next: AiReasoningLevel[]) => void }) {
  const available = REASONING_LEVEL_NAMES.filter((name) => !levels.some((row) => row.level === name));
  return (
    <div className="ai-reasoning-levels">
      <div className="ai-reasoning-levels__columns" aria-hidden="true"><span>档位</span><span>API 参数值</span><span /></div>
      {levels.map((row, index) => (
        <div className="ai-reasoning-levels__row" key={index}>
          <select className="settings-select" aria-label={`推理档位 ${index + 1}`} value={row.level} onChange={(event) => {
            const level = event.currentTarget.value;
            const apiValue = row.apiValue === row.level || !row.apiValue ? level === "off" ? "" : level : row.apiValue;
            onChange(levels.map((item, i) => i === index ? { level, apiValue } : item));
          }}>
            {REASONING_LEVEL_NAMES.map((name) => <option key={name} value={name} disabled={name !== row.level && levels.some((item) => item.level === name)}>{name}</option>)}
          </select>
          <input aria-label={`${row.level} 的 API 参数值`} disabled={row.level === "off"} value={row.apiValue}
            placeholder={row.level === "off" ? "关闭思考" : row.level}
            onChange={(event) => onChange(levels.map((item, i) => i === index ? { ...item, apiValue: event.currentTarget.value } : item))} />
          <button className="icon-button" type="button" aria-label={`删除 ${row.level} 档位`} disabled={levels.length === 1}
            onClick={() => onChange(levels.filter((_, i) => i !== index))}><Icon name="trash" width="16" height="16" /></button>
        </div>
      ))}
      <div><Button variant="ghost" disabled={!available.length} onClick={() => {
        const level = available[0];
        onChange([...levels, { level, apiValue: level === "off" ? "" : level }]);
      }}><Icon name="plus" width="16" height="16" />添加档位</Button></div>
    </div>
  );
}
