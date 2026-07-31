import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "./Icon";

export interface SelectMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectMenuProps {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: readonly SelectMenuOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  value: string;
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\-_/,.'"]+/g, "");
}

function fuzzyMatches(query: string, option: SelectMenuOption): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) {
    return true;
  }

  const haystack = normalizeSearchText(`${option.label} ${option.value}`);
  if (haystack.includes(needle)) {
    return true;
  }

  let needleIndex = 0;
  for (const character of haystack) {
    if (character === needle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex === needle.length) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A compact application-rendered select control. Native <select> menus cannot
 * be styled consistently across macOS and Windows, so this control owns both
 * the trigger and the option list while retaining basic keyboard navigation.
 */
export function SelectMenu({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  options,
  searchable = false,
  searchPlaceholder = "搜索…",
  value,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const filteredOptions = useMemo(
    () => (searchable ? options.filter((option) => fuzzyMatches(searchQuery, option)) : options),
    [options, searchable, searchQuery],
  );

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      return;
    }

    if (searchable) {
      const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [open, searchable]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectOption(option: SelectMenuOption) {
    if (option.disabled) {
      return;
    }
    onChange(option.value);
    setOpen(false);
  }

  function moveSelection(direction: 1 | -1) {
    const currentIndex = Math.max(0, options.findIndex((option) => option.value === value));
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (currentIndex + direction * offset + options.length) % options.length;
      const option = options[index];
      if (!option.disabled) {
        onChange(option.value);
        return;
      }
    }
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (open) {
        moveSelection(1);
      } else {
        setOpen(true);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open) {
        moveSelection(-1);
      } else {
        setOpen(true);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={`select-menu${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`select-menu__trigger${open ? " is-open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        type="button"
      >
        <span>{selected?.label}</span>
        <Icon name="chevron-down" height="14" width="14" />
      </button>
      {open ? (
        <div className="select-menu__popover">
          {searchable ? (
            <input
              aria-label={`${ariaLabel}搜索`}
              autoComplete="off"
              className="select-menu__search"
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              ref={searchRef}
              type="search"
              value={searchQuery}
            />
          ) : null}
          <ul aria-label={ariaLabel} className="select-menu__options" id={listId} role="listbox">
            {filteredOptions.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    aria-selected={isSelected}
                    className={`select-menu__option${isSelected ? " is-selected" : ""}`}
                    disabled={option.disabled}
                    onClick={() => selectOption(option)}
                    role="option"
                    type="button"
                  >
                    <span>{option.label}</span>
                    {isSelected ? <Icon name="check" height="14" width="14" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {searchable && filteredOptions.length === 0 ? (
            <div className="select-menu__empty">未找到匹配字体</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
