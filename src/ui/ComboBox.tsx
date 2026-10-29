import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export interface ComboBoxOption {
  value: string;
  label?: string;
}

interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboBoxOption[];
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
}

export function ComboBox({ value, onChange, options, placeholder, ariaLabel, id }: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<React.CSSProperties | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generatedId = useId();
  const listId = `${id ?? generatedId}-list`;
  const hasOptions = options.length > 0;
  const filteredOptions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return search ? options.filter((option) =>
      `${option.value} ${option.label ?? ""}`.toLocaleLowerCase().includes(search),
    ) : options;
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition(event?: Event) {
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const upwards = below < 204 && above > below;
      setPosition({
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(64, Math.min(192, (upwards ? above : below) - 12)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      menuRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  function selectOption(option: ComboBoxOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(hasOptions);
      if (!filteredOptions.length) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => Math.max(0, Math.min(filteredOptions.length - 1, index + direction)));
    } else if (event.key === "Enter" && open && activeIndex >= 0 && activeIndex < filteredOptions.length) {
      event.preventDefault();
      selectOption(filteredOptions[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="combobox" ref={containerRef}>
      <div className="combobox__control">
        <input
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-expanded={open}
          aria-label={ariaLabel}
          autoComplete="off"
          className="combobox__input"
          id={id}
          role="combobox"
          onChange={(event) => {
            const next = event.currentTarget.value;
            onChange(next);
            setQuery(next);
            setOpen(hasOptions);
            setActiveIndex(-1);
          }}
          onFocus={() => { setQuery(""); setOpen(hasOptions); }}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          value={value}
        />
        {hasOptions ? (
          <button
            aria-label="展开选项"
            className={`combobox__caret ${open ? "is-open" : ""}`.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              inputRef.current?.focus();
              setQuery("");
              setActiveIndex(-1);
              setOpen(!open);
            }}
            tabIndex={-1}
            type="button"
          >
            <Icon name="chevron-right" height="16" width="16" />
          </button>
        ) : null}
      </div>
      {open && hasOptions && position ? createPortal(
        <ul aria-label={ariaLabel} className="combobox__menu" id={listId} ref={menuRef} role="listbox" style={position}>
          {filteredOptions.map((option, index) => (
            <li key={option.value} role="presentation">
              <button
                aria-selected={option.value === value}
                id={`${listId}-${index}`}
                data-option-index={index}
                role="option"
                tabIndex={-1}
                className={`combobox__option ${index === activeIndex ? "is-active" : ""} ${
                  option.value === value ? "is-selected" : ""
                }`.trim()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                onMouseEnter={() => setActiveIndex(index)}
                type="button"
              >
                <span className="combobox__option-value" title={option.value}>{option.value}</span>
                {option.label ? <span className="combobox__option-label">{option.label}</span> : null}
              </button>
            </li>
          ))}
          {!filteredOptions.length ? <li className="combobox__empty" role="presentation">未找到匹配项，可直接输入模型 ID。</li> : null}
        </ul>, document.body,
      ) : null}
    </div>
  );
}
