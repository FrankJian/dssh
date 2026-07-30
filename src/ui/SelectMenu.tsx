import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "./Icon";

export interface SelectMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectMenuProps {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: readonly SelectMenuOption[];
  value: string;
}

/**
 * A compact application-rendered select control. Native <select> menus cannot
 * be styled consistently across macOS and Windows, so this control owns both
 * the trigger and the option list while retaining basic keyboard navigation.
 */
export function SelectMenu({ ariaLabel, disabled = false, onChange, options, value }: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

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
    <div className="select-menu" ref={rootRef}>
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
        <ul aria-label={ariaLabel} className="select-menu__options" id={listId} role="listbox">
          {options.map((option) => {
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
      ) : null}
    </div>
  );
}
