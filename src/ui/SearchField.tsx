import { useId, type InputHTMLAttributes } from "react";

interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function SearchField({ id, label, ...props }: SearchFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label className="search-field" htmlFor={inputId}>
      <span>{label}</span>
      <input id={inputId} type="search" {...props} />
    </label>
  );
}
