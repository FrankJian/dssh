import { SegmentedControl } from "../ui/SegmentedControl";
import { Icon } from "../ui/Icon";
import type { MarkdownMode } from "./markdownMode";

export function MarkdownModeSwitch({ mode, disabled, richDisabled, onChange }: {
  mode: MarkdownMode; disabled: boolean; richDisabled: boolean; onChange(mode: MarkdownMode): void;
}) {
  return <SegmentedControl label="Markdown 编辑模式" className="editor-markdown-mode-switch" value={mode} onChange={onChange} options={[
    { value: "source", label: "源码", content: <Icon name="fileCode" width="16" height="16" />, disabled },
    { value: "rich", label: "所见即所得", content: <Icon name="edit" width="16" height="16" />, disabled: disabled || richDisabled },
  ]} />;
}
