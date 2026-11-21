import { filterPaletteItems } from "./paletteSearch";
import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { createPortal } from "react-dom";
import { IconButton } from "../ui/IconButton";
import type { IconName } from "../ui/Icon";

export interface PaletteItem {
  id: string;
  label: string;
  /** Right-aligned category label (e.g. 连接 / 终端 / 动作). */
  hint?: string;
  icon?: IconName;
  /** Extra searchable text not shown in the label. */
  keywords?: string;
  /** Lower values keep secondary navigation behind matching actions. */
  searchPriority?: number;
  run: () => void;
}

interface CommandPaletteProps {
  items: PaletteItem[];
  onClose: () => void;
}

export function CommandPalette({ items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const dismissed = useRef(false);
  const listId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      if (!dismissed.current && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, []);

  const results = useMemo(() => filterPaletteItems(items, query), [items, query]);

  const selectedIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, results]);

  function dismiss() {
    // Hand focus back before an action opens its next dialog.
    dismissed.current = true;
    dialogRef.current?.close();
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    onClose();
  }

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    dismiss();
    item.run();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(results.length ? (selectedIndex + 1) % results.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(results.length ? (selectedIndex + results.length - 1) % results.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[selectedIndex]);
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="palette is-glass-overlay"
      role="dialog"
      aria-label="命令面板"
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
      onClick={(event) => { if (event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
      } }}
    >
      <div className="palette__search">
        <Icon name="search" height="16" width="16" />
        <input
          ref={inputRef}
          className="palette__input"
          role="combobox"
          aria-label="搜索命令"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results.length ? `${listId}-${selectedIndex}` : undefined}
          placeholder="搜索连接、标签页、工具或动作…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <IconButton label="关闭命令面板" onClick={dismiss}><Icon name="close" /></IconButton>
      </div>
      <div className="palette__list" id={listId} aria-label="匹配的命令" ref={listRef} role="listbox">
        {results.length === 0 ? (
          <div className="palette__empty" role="status">没有匹配项。</div>
        ) : (
          results.map((item, index) => (
            <div
              key={item.id}
              id={`${listId}-${index}`}
              className="palette__item"
              data-active={index === selectedIndex}
              role="option"
              aria-selected={index === selectedIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              {item.icon ? <Icon name={item.icon} height="16" width="16" /> : <span className="palette__item-spacer" />}
              <span className="palette__item-label">{item.label}</span>
              {item.hint ? <span className="palette__item-hint">{item.hint}</span> : null}
            </div>
          ))
        )}
      </div>
    </dialog>, document.body,
  );
}
