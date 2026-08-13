import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";

export interface PaletteItem {
  id: string;
  label: string;
  /** Right-aligned category label (e.g. 连接 / 终端 / 动作). */
  hint?: string;
  icon?: IconName;
  /** Extra searchable text not shown in the label. */
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  items: PaletteItem[];
  onClose: () => void;
}

/** Case-insensitive subsequence match with a light score (earlier + tighter = better). */
function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastIndex = -1;
  for (let i = 0; i < haystack.length && qi < query.length; i += 1) {
    if (haystack[i] === query[qi]) {
      score += lastIndex === i - 1 ? 2 : 1; // reward adjacency
      lastIndex = i;
      qi += 1;
    }
  }
  return qi === query.length ? score : null;
}

export function CommandPalette({ items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return items;
    }
    return items
      .map((item) => ({
        item,
        score: fuzzyScore(q, `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`),
      }))
      .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="palette is-glass-overlay"
        role="dialog"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette__search">
          <Icon name="search" height="16" width="16" />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="搜索连接、标签页或动作…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="palette__list" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="palette__empty">没有匹配项。</div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                className="palette__item"
                data-active={index === activeIndex}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(item)}
                type="button"
              >
                {item.icon ? <Icon name={item.icon} height="16" width="16" /> : <span className="palette__item-spacer" />}
                <span className="palette__item-label">{item.label}</span>
                {item.hint ? <span className="palette__item-hint">{item.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
