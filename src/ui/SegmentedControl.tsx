import { useId, type CSSProperties, type ReactNode } from "react";

export interface SegmentOption<Value extends string> {
  value: Value;
  label: string;
  content?: ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<Value extends string> {
  label: string;
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  className?: string;
}

/** Native radio semantics keep arrow navigation and form labels consistent. */
export function SegmentedControl<Value extends string>({
  label, options, value, onChange, className = "",
}: SegmentedControlProps<Value>) {
  const name = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      aria-label={label}
      className={`segmented-control ${className}`.trim()}
      role="radiogroup"
      style={{
        "--segment-count": options.length,
        "--segment-index": Math.max(0, selectedIndex),
      } as CSSProperties}
      data-selected={selectedIndex >= 0}
    >
      {options.map((option) => (
        <label className="segmented-control__option" key={option.value} title={option.label}>
          <input
            aria-label={option.label}
            checked={option.value === value}
            disabled={option.disabled}
            name={name}
            onChange={() => onChange(option.value)}
            type="radio"
            value={option.value}
          />
          {option.content ?? option.label}
        </label>
      ))}
    </div>
  );
}
