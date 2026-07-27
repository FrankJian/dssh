import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generatedId = useId();
  const listId = `${id ?? generatedId}-list`;
  const hasOptions = options.length > 0;

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointer(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  function selectOption(option: ComboBoxOption) {
    onChange(option.value);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open && hasOptions) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      if (!open) {
        return;
      }
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < options.length) {
        event.preventDefault();
        selectOption(options[activeIndex]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  return (
    <div className="combobox" ref={containerRef}>
      <div className="combobox__control">
        <input
          aria-controls={listId}
          aria-expanded={open}
          aria-label={ariaLabel}
          autoComplete="off"
          className="combobox__input"
          id={id}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            if (hasOptions) {
              setOpen(true);
            }
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (hasOptions) {
              setOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          value={value}
        />
        {hasOptions ? (
          <button
            aria-label="展开选项"
            className={`combobox__caret ${open ? "is-open" : ""}`.trim()}
            onClick={() => {
              setOpen((current) => !current);
              inputRef.current?.focus();
            }}
            tabIndex={-1}
            type="button"
          >
            <Icon name="chevron-right" height="16" width="16" />
          </button>
        ) : null}
      </div>
      {open && hasOptions ? (
        <ul className="combobox__menu" id={listId} role="listbox">
          {options.map((option, index) => (
            <li key={option.value}>
              <button
                className={`combobox__option ${index === activeIndex ? "is-active" : ""} ${
                  option.value === value ? "is-selected" : ""
                }`.trim()}
                onClick={() => selectOption(option)}
                onMouseEnter={() => setActiveIndex(index)}
                type="button"
              >
                <span className="combobox__option-value">{option.value}</span>
                {option.label ? <span className="combobox__option-label">{option.label}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
