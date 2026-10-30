import { ASSISTANT_POSITIONS, type AssistantDockPosition } from "../app/assistantDock";
import type { AssistantDockControls } from "../app/useAssistantDock";
import { SelectMenu } from "../ui/SelectMenu";

export function AiDockSettings({ dock }: { dock: AssistantDockControls }) {
  return <div className="settings-row ai-dock-settings">
    <div><strong>助手停靠位置</strong><p className="settings-field__hint">左右停靠可调整宽度，底部停靠可调整高度；也可在助手标题栏切换。</p></div>
    <SelectMenu ariaLabel="助手停靠位置" value={dock.position} options={ASSISTANT_POSITIONS}
      onChange={(value) => dock.setPosition(value as AssistantDockPosition)} />
  </div>;
}
