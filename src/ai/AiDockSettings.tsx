import { ASSISTANT_POSITIONS, type AssistantDockPosition } from "../app/assistantDock";
import type { AssistantDockControls } from "../app/useAssistantDock";
import { SelectMenu } from "../ui/SelectMenu";

export function AiDockSettings({ dock }: { dock: AssistantDockControls }) {
  return <div className="settings-row ai-dock-settings">
    <strong>助手停靠位置</strong>
    <SelectMenu ariaLabel="助手停靠位置" value={dock.position} options={ASSISTANT_POSITIONS}
      onChange={(value) => dock.setPosition(value as AssistantDockPosition)} />
  </div>;
}
