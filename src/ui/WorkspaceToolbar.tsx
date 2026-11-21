import type { ReactNode } from "react";

interface WorkspaceToolbarProps {
  label: string;
  identity: ReactNode;
  children: ReactNode;
  className?: string;
}

export function WorkspaceToolbar({ label, identity, children, className = "" }: WorkspaceToolbarProps) {
  return (
    <header className={`workspace-toolbar ${className}`.trim()} aria-label={label}>
      <div className="workspace-toolbar__identity">{identity}</div>
      <div className="workspace-toolbar__actions" role="group" aria-label={`${label}操作`}>
        {children}
      </div>
    </header>
  );
}
