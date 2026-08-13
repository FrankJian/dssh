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

/**
 * Returns the match tier used by the searchable menu:
 * 0 = contiguous substring, 1 = ordered but non-contiguous characters,
 * null = no match.
 */
function fuzzyMatchTier(query: string, option: SelectMenuOption): number | null {
  const needle = normalizeSearchText(query);
  if (!needle) {
    return 0;
  }

  const haystack = normalizeSearchText(`${option.label} ${option.value}`);
  if (haystack.includes(needle)) {
    return 0;
  }

  let needleIndex = 0;
  for (const character of haystack) {
    if (character === needle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex === needle.length) {
        return 1;
      }
    }
  }
  return null;
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
  const previousValueRef = useRef(value);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const filteredOptions = useMemo(
    () => {
      if (!searchable || !searchQuery.trim()) {
        return options;
      }

      return options
        .map((option, index) => ({ index, option, tier: fuzzyMatchTier(searchQuery, option) }))
        .filter((item): item is { index: number; option: SelectMenuOption; tier: number } => item.tier !== null)
        .sort((left, right) => left.tier - right.tier || left.index - right.index)
        .map((item) => item.option);
    },
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

  // A parent may replace the surrounding form when a selection changes. Keep
  // the popover closed after that controlled value update as well as in the
  // option click handler, so it cannot remain visible after a single click.
  useEffect(() => {
    if (previousValueRef.current === value) return;
    previousValueRef.current = value;
    setOpen(false);
    setSearchQuery("");
  }, [value]);

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
    // Close before notifying the parent. Some parents replace the option
    // list or switch the surrounding form immediately; doing this first
    // prevents that synchronous update from leaving the popover mounted.
    setOpen(false);
    setSearchQuery("");
    onChange(option.value);
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
        <div className="select-menu__popover is-glass-overlay">
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
