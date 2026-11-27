import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
  label: string;
}

export function IconButton({ active = false, children, className = "", label, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`icon-button ${active ? "is-active" : ""} ${className}`.trim()}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
