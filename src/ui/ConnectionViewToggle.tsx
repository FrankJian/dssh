import { Icon } from "./Icon";
import { SegmentedControl } from "./SegmentedControl";

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
  return <SegmentedControl
    label={label}
    className="segmented-control--icons"
    value={value}
    onChange={onChange}
    options={OPTIONS.map((option) => ({
      value: option.id,
      label: option.label,
      content: <Icon name={option.icon} height="16" width="16" />,
    }))}
  />;
}
