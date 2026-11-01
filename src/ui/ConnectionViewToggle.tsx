import { Icon } from "./Icon";

export type ConnectionViewMode = "grid" | "list" | "tree";

const OPTIONS = [
  { id: "grid", label: "网格", icon: "monitor" },
  { id: "list", label: "列表", icon: "connections" },
  { id: "tree", label: "分组", icon: "sessions" },
] as const;

/** Shared display choices for saved connections and authorized asset directories. */
export function ConnectionViewToggle({ value, onChange, label = "视图" }: {
  value: ConnectionViewMode;
  onChange: (view: ConnectionViewMode) => void;
  label?: string;
}) {
  return <div className="session-manager__views" role="group" aria-label={label}>
    {OPTIONS.map((option) => <button key={option.id} type="button"
      className={`session-manager__view${value === option.id ? " is-active" : ""}`}
      title={option.label} aria-label={option.label} aria-pressed={value === option.id}
      onClick={() => onChange(option.id)}>
      <Icon name={option.icon} height="15" width="15" />
    </button>)}
  </div>;
}
