import type { AiRequestHeader } from "../models/ai";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export function AiRequestHeaders({ headers, onChange }: { headers: AiRequestHeader[]; onChange: (headers: AiRequestHeader[]) => void }) {
  const patch = (id: string, change: Partial<AiRequestHeader>) => onChange(headers.map((header) => header.id === id ? { ...header, ...change } : header));
  return <div className="ai-request-headers">
    <span>额外请求头</span>
    <span className="settings-field__hint">用于测试连接、获取模型及对话请求；同名头会覆盖默认值。保存后不回显值，留空保持已保存的值。</span>
    {headers.map((header, index) => <div className="ai-request-headers__row" key={header.id}>
      <label className="field">名称
        <input aria-label={`请求头 ${index + 1} 名称`} autoComplete="off" spellCheck={false} placeholder="X-Custom-Header" value={header.name} onChange={(event) => patch(header.id, { name: event.currentTarget.value })} />
      </label>
      <label className="field">值
        <input aria-label={`请求头 ${index + 1} 值`} type="password" autoComplete="new-password" placeholder={header.hasValue ? "已保存，留空保持" : "请求头的值"} value={header.value ?? ""} onChange={(event) => patch(header.id, { value: event.currentTarget.value || (header.hasValue ? undefined : "") })} />
      </label>
      <Button variant="ghost" aria-label={`删除请求头 ${index + 1}`} title="删除请求头" onClick={() => onChange(headers.filter((item) => item.id !== header.id))}><Icon name="trash" /></Button>
    </div>)}
    <Button variant="ghost" disabled={headers.length >= 32} onClick={() => onChange([...headers, { id: `header-${crypto.randomUUID()}`, name: "", value: "", hasValue: false }])}><Icon name="plus" />添加请求头</Button>
  </div>;
}
