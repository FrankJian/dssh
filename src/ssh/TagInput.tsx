import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../ui/Icon";

interface TagInputProps {
  value: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}

export function TagInput({ value, suggestions, onChange }: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const normalizedInput = inputValue.trim();

  const availableSuggestions = useMemo(() => {
    const selected = new Set(value);
    const query = normalizedInput.toLowerCase();
    return suggestions
      .filter((tag) => !selected.has(tag))
      .filter((tag) => (query ? tag.toLowerCase().includes(query) : true));
  }, [suggestions, value, normalizedInput]);

  const canCreate =
    normalizedInput.length > 0 &&
    !value.some((tag) => tag.toLowerCase() === normalizedInput.toLowerCase()) &&
    !suggestions.some((tag) => tag.toLowerCase() === normalizedInput.toLowerCase());

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || value.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      setInputValue("");
      return;
    }
    onChange([...value, trimmed]);
    setInputValue("");
  }

  function removeTag(tag: string) {
    onChange(value.filter((item) => item !== tag));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (normalizedInput.length > 0) {
        addTag(normalizedInput);
      }
    } else if (event.key === "Backspace" && inputValue.length === 0 && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  }

  return (
    <div className="tag-input" ref={containerRef}>
      <div className="tag-input__control" onClick={() => setIsOpen(true)}>
        {value.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button
              aria-label={`移除标签 ${tag}`}
              className="tag-chip__remove"
              onClick={(event) => {
                event.stopPropagation();
                removeTag(tag);
              }}
              type="button"
            >
              <Icon name="close" height="12" width="12" />
            </button>
          </span>
        ))}
        <input
          className="tag-input__field"
          onChange={(event) => {
            setInputValue(event.currentTarget.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          value={inputValue}
        />
      </div>
      {isOpen && (availableSuggestions.length > 0 || canCreate) ? (
        <ul className="tag-input__menu" role="listbox">
          {availableSuggestions.map((tag) => (
            <li key={tag}>
              <button
                className="tag-input__option"
                onClick={() => addTag(tag)}
                type="button"
              >
                {tag}
              </button>
            </li>
          ))}
          {canCreate ? (
            <li>
              <button
                className="tag-input__option tag-input__option--create"
                onClick={() => addTag(normalizedInput)}
                type="button"
              >
                新建标签 “{normalizedInput}”
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
