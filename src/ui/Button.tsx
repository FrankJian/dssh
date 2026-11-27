import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
  variant?: ButtonVariant;
}

export function Button({ children, className = "", variant = "secondary", ...props }: ButtonProps) {
  return (
    <button className={`button button--${variant} ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}
