import { useDeferredValue, useMemo, useState } from "react";
import emojiData from "unicode-emoji-json/data-by-emoji.json";
import { Button } from "../ui/Button";
import { copyToolText } from "../services/toolsService";
import { ToolFeedback, ToolPanel } from "./ToolControls";

const entries = Object.entries(emojiData).map(([emoji, { name, group, slug }]) => ({
  emoji, name, search: `${emoji} ${name} ${group} ${slug}`.toLowerCase(),
}));

export default function EmojiTool() {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const deferredQuery = useDeferredValue(query);
  const matches = useMemo(() => {
    const terms = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(({ search }) => terms.every((term) => search.includes(term)));
  }, [deferredQuery]);

  async function copy(emoji: string) {
    setError("");
    setStatus("");
    try {
      await copyToolText(emoji);
      setStatus(`已复制 ${emoji}`);
    } catch {
      setError("无法复制 Emoji。");
    }
  }

  return (
    <div className="tool-form">
      <div className="tool-form__toolbar">
        <label className="tool-form__setting">
          搜索 Emoji
          <input className="tool-form__title-input" value={query} placeholder="英文名称或 Emoji"
            onChange={(event) => { setQuery(event.target.value); setLimit(100); }} />
        </label>
      </div>
      <ToolPanel label="选择并复制">
        {matches.length ? (
          <div className="tool-emoji__grid">
            {matches.slice(0, limit).map(({ emoji, name }) => (
              <Button key={emoji} variant="ghost" aria-label={`复制 ${name}`} title={name} onClick={() => void copy(emoji)}>
                {emoji}
              </Button>
            ))}
          </div>
        ) : <p className="tool-emoji__empty" role="status">没有找到匹配的 Emoji。</p>}
      </ToolPanel>
      {matches.length > limit ? <Button onClick={() => setLimit(limit + 100)}>显示更多</Button> : null}
      <ToolFeedback error={error} status={status} />
    </div>
  );
}
