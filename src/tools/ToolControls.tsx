import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { SelectMenu, type SelectMenuOption } from "../ui/SelectMenu";

export function ToolAction({ label, icon, ...props }: Omit<ComponentProps<typeof Button>, "children"> & {
  label: string;
  icon: IconName;
}) {
  return <Button {...props} className={`tool-action ${props.className ?? ""}`.trim()} aria-label={label} title={label}>
    <Icon name={icon} />
  </Button>;
}

export function ToolNote({ children }: { children: string }) {
  return <div className="tool-form__note"><ToolAction variant="ghost" label={children} icon="info" /></div>;
}

export function ToolSelect({ label, value, options, onChange, searchable }: {
  label: string;
  value: string;
  options: readonly SelectMenuOption[];
  onChange: (value: string) => void;
  searchable?: boolean;
}) {
  return (
    <div className="tool-form__setting">
      <span>{label}</span>
      <SelectMenu
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
        searchable={searchable}
        selectOnArrowKeys
      />
    </div>
  );
}

export function ToolToolbar({ options, busy, action, onRun, onExample, onClear, canClear }: {
  options?: ReactNode;
  busy: boolean;
  action: string;
  onRun: () => void;
  onExample?: () => void;
  onClear?: () => void;
  canClear?: boolean;
}) {
  return (
    <div className="tool-form__toolbar">
      {options ? <fieldset className="tool-form__options" disabled={busy}>{options}</fieldset> : null}
      <div className="tool-form__actions">
        {onExample ? <ToolAction variant="ghost" label="载入示例" icon="fileInput" onClick={onExample} disabled={busy} /> : null}
        {onClear ? <ToolAction variant="ghost" label="清空" icon="trash" onClick={onClear} disabled={busy || !canClear} /> : null}
        <ToolAction variant="primary" label={action} icon="play" onClick={onRun} disabled={busy} />
      </div>
    </div>
  );
}

export function ToolPanel({ label, htmlFor, actions, children, expandable = false, feedback }: {
  label: string;
  htmlFor?: string;
  actions?: ReactNode;
  children: ReactNode;
  expandable?: boolean;
  feedback?: { error: string; status: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !expanded) return;
    dialog.showModal();
    return () => dialog.close();
  }, [expanded]);

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {actions || expandable ? <div className="tool-panel__actions">
          {actions}
          {expandable ? (
            <ToolAction variant="ghost" label={`放大查看${label}`} icon="maximize" onClick={() => setExpanded(true)} />
          ) : null}
        </div> : null}
      </div>
      {expanded ? <div className="tool-panel__expanded-placeholder" /> : children}
      {expandable ? (
        <dialog ref={dialogRef} className="tool-result-dialog" aria-labelledby={titleId}
          onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}
          onKeyDown={(event) => event.stopPropagation()}>
          {expanded ? (
            <div className="tool-panel tool-panel--expanded">
              <div className="tool-panel__header">
                <span id={titleId}>{label}</span>
                <div className="tool-panel__actions">
                  {actions}
                  <ToolAction variant="ghost" label="关闭放大查看" icon="close" autoFocus onClick={() => setExpanded(false)} />
                </div>
              </div>
              {children}
              {feedback ? <ToolFeedback {...feedback} /> : null}
            </div>
          ) : null}
        </dialog>
      ) : null}
    </div>
  );
}

export function ToolFeedback({ error, status }: { error: string; status: string }) {
  return (
    <>
      {error ? <p className="tool-form__feedback tool-form__error" role="alert"><Icon name="info" />{error}</p> : null}
      <p className="tool-form__feedback" role="status" hidden={!status}>{status}</p>
    </>
  );
}
