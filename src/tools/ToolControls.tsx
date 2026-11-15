import type { ReactNode } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SelectMenu, type SelectMenuOption } from "../ui/SelectMenu";

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
        {onExample ? <Button variant="ghost" onClick={onExample} disabled={busy}>载入示例</Button> : null}
        {onClear ? <Button variant="ghost" onClick={onClear} disabled={busy || !canClear}>清空</Button> : null}
        <Button variant="primary" onClick={onRun} disabled={busy}>{action}</Button>
      </div>
    </div>
  );
}

export function ToolPanel({ label, htmlFor, actions, children }: {
  label: string;
  htmlFor?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {actions ? <div className="tool-panel__actions">{actions}</div> : null}
      </div>
      {children}
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
